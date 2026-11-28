/**
 * Proof that the published record holds at the database level, beyond the
 * fields `immutability.db-test.ts` already covers.
 *
 * Each invariant is attacked the same three ways as there:
 *
 *  1. through Payload with access control on (the ordinary interface);
 *  2. through Payload with `overrideAccess: true` (our own server code);
 *  3. through direct SQL as the restricted application role.
 *
 * and, where the risk is a race, from SEPARATE DATABASE CONNECTIONS whose
 * transactions are held open on purpose, so the test controls the
 * interleaving instead of hoping for it.
 *
 * Every SQL refusal is asserted by SQLSTATE and message, so a test cannot pass
 * because something unrelated failed.
 *
 * Run with `pnpm test:db`.
 */
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { after, before, describe, it } from 'node:test'

import pg from 'pg'
import { getPayload, type Payload } from 'payload'

import config from '@/payload.config'
import { env } from '@/lib/env'
import { openDisposableDatabase } from '@/lib/testing/disposable-database'
import { readProtectedTriggers } from '@/lib/testing/trigger-state'

const RUN = `rec${Date.now().toString(36)}`
const MARKER = `dbtest-${RUN}`

let guard: Awaited<ReturnType<typeof openDisposableDatabase>> | undefined
let payload: Payload
/** Autocommit connection for fixtures and assertions. */
let sql: pg.Client
const extraClients: pg.Client[] = []
/** Backend pid per connection, read once while the connection is idle. */
const backendPids = new WeakMap<pg.Client, number>()

/** A further connection to the verified database, closed in `after`. */
const connect = async (): Promise<pg.Client> => {
  // A bounded wait, so a broken interleaving fails the test instead of
  // hanging the suite.
  const client = new pg.Client({
    connectionString: env.DATABASE_URL,
    lock_timeout: 20_000,
  })
  await client.connect()
  extraClients.push(client)
  const { rows } = await client.query('SELECT pg_backend_pid() AS pid')
  backendPids.set(client, Number(rows[0].pid))
  return client
}

type Row = Record<string, unknown>

const one = async (
  client: pg.Client,
  text: string,
  params: unknown[] = [],
): Promise<Row> => {
  const result = await client.query(text, params)
  return (result.rows[0] ?? {}) as Row
}

/** The SQLSTATE of a refusal, wherever in the error chain it sits. */
const pgErrorOf = (error: unknown): { code?: string; message?: string } => {
  let current: unknown = error

  for (let depth = 0; depth < 6 && current; depth += 1) {
    const candidate = current as {
      code?: unknown
      message?: unknown
      cause?: unknown
    }

    if (
      typeof candidate.code === 'string' &&
      /^[0-9A-Z]{5}$/.test(candidate.code)
    ) {
      return {
        code: candidate.code,
        message: typeof candidate.message === 'string' ? candidate.message : '',
      }
    }

    current = candidate.cause
  }

  return {}
}

/** Assert a refusal BY THE DATABASE with this SQLSTATE and message. */
const expectRefusal = async (
  run: Promise<unknown> | (() => Promise<unknown>),
  expected: RegExp,
  code = '23000',
) => {
  await assert.rejects(
    typeof run === 'function' ? run() : run,
    (error: unknown) => {
      const pg = pgErrorOf(error)
      assert.equal(
        pg.code,
        code,
        `expected SQLSTATE ${code}, got ${JSON.stringify(pg)} (${String(error)})`,
      )
      assert.match(String(pg.message), expected)
      return true
    },
  )
}

/** Assert an application-level refusal (a Payload APIError) by message. */
const expectApiRefusal = async (run: Promise<unknown>, expected: RegExp) => {
  await assert.rejects(run, (error: unknown) => {
    assert.match(String((error as Error).message), expected)
    return true
  })
}

/**
 * Wait until the backend `pid` is blocked on a lock. This is what makes the
 * concurrency tests deterministic: the second statement is provably waiting
 * before the first transaction is allowed to finish.
 */
const waitUntilBlocked = async (pid: number) => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const row = await one(
      sql,
      `SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1`,
      [pid],
    )

    if (row.wait_event_type === 'Lock') return

    await delay(25)
  }

  assert.fail(`backend ${pid} never blocked on a lock`)
}

/**
 * The pid of a connection. Never queried on the connection itself: by the
 * time a test asks, that connection is usually the one waiting on a lock.
 */
const pidOf = async (client: pg.Client): Promise<number> => {
  const pid = backendPids.get(client)
  assert.ok(pid, 'connection was not opened through connect()')
  return pid
}

/** Did this promise settle within `ms`? Used to prove a statement is waiting. */
const settlesWithin = async (promise: Promise<unknown>, ms: number) => {
  const marker = Symbol('pending')
  const winner = await Promise.race([
    promise.then(
      () => 'settled',
      () => 'settled',
    ),
    delay(ms).then(() => marker),
  ])
  return winner !== marker
}

/* -------------------------------------------------------------------------- */
/* Fixtures, written as SQL so they exercise the triggers directly            */
/* -------------------------------------------------------------------------- */

type World = {
  sportId: number
  competitionId: number
  eventIds: number[]
}

let counter = 0
const nextName = (prefix: string) => {
  counter += 1
  return `${RUN}-${prefix}-${counter}`
}

/** A sport, a competition and `events` fixtures in it. */
const makeWorld = async (events = 2): Promise<World> => {
  const sport = await one(
    sql,
    `INSERT INTO "sports" (code, name, active, sort_order, seed_marker)
     VALUES ($1, $2, true, 99, $3) RETURNING id`,
    [nextName('SPORT').toUpperCase(), 'Testovací sport', MARKER],
  )
  const competition = await one(
    sql,
    `INSERT INTO "competitions" (sport_id, name, country, seed_marker)
     VALUES ($1, $2, 'CZ', $3) RETURNING id`,
    [sport.id, nextName('liga'), MARKER],
  )
  const eventIds: number[] = []

  for (let index = 0; index < events; index += 1) {
    const event = await one(
      sql,
      `INSERT INTO "sporting_events"
         (competition_id, home_name, away_name, starts_at, status, seed_marker)
       VALUES ($1, $2, $3, now() + interval '2 days', 'SCHEDULED', $4)
       RETURNING id`,
      [competition.id, `Domácí ${index}`, `Hosté ${index}`, MARKER],
    )
    eventIds.push(Number(event.id))
  }

  return {
    sportId: Number(sport.id),
    competitionId: Number(competition.id),
    eventIds,
  }
}

/** A draft tip with one selection per given event. */
const makeDraft = async (
  world: World,
  eventIds: readonly number[] = [world.eventIds[0]!],
) => {
  const tip = await one(
    sql,
    `INSERT INTO "tips" (slug, sport_id, title, status, stake_units, seed_marker)
     VALUES ($1, $2, 'Test', 'DRAFT', 2, $3) RETURNING id`,
    [nextName('tip'), world.sportId, MARKER],
  )
  const selectionIds: number[] = []

  for (const eventId of eventIds) {
    const selection = await one(
      sql,
      `INSERT INTO "tip_selections"
         (tip_id, sporting_event_id, market, selection, odds_at_publication,
          minimum_odds, outcome, seed_marker)
       VALUES ($1, $2, '1X2', 'HOME', 1900, 1800, 'PENDING', $3) RETURNING id`,
      [tip.id, eventId, MARKER],
    )
    selectionIds.push(Number(selection.id))
  }

  return { tipId: Number(tip.id), selectionIds }
}

const PUBLISH = `UPDATE "tips" SET status = 'PUBLISHED', published_at = now() WHERE id = $1`

const publish = (client: pg.Client, tipId: number) =>
  client.query(PUBLISH, [tipId])

/** A published single, settled WON with a closing price, tip SETTLED. */
const makeSettled = async (world: World) => {
  const { tipId, selectionIds } = await makeDraft(world)
  await publish(sql, tipId)
  await sql.query(
    `UPDATE "tip_selections"
        SET outcome = 'WON', closing_odds = 1850, settled_at = now()
      WHERE id = $1`,
    [selectionIds[0]],
  )
  await sql.query(
    `UPDATE "tips" SET status = 'SETTLED', settled_at = now() WHERE id = $1`,
    [tipId],
  )
  return { tipId, selectionId: selectionIds[0]! }
}

const lockStamp = async (table: string, id: number) =>
  (
    await one(sql, `SELECT record_locked_at FROM "${table}" WHERE id = $1`, [
      id,
    ])
  ).record_locked_at

const selectionRow = (id: number) =>
  one(
    sql,
    `SELECT tip_id, outcome::text AS outcome, closing_odds, settled_at
       FROM "tip_selections" WHERE id = $1`,
    [id],
  )

const correctionsFor = async (selectionId: number) =>
  (
    await sql.query(
      `SELECT * FROM "tip_corrections" WHERE selection_id = $1 ORDER BY id`,
      [selectionId],
    )
  ).rows as Row[]

const insertCorrection = (
  client: pg.Client,
  {
    tipId,
    selectionId,
    newOutcome,
    newClosingOdds = null,
    reason = 'Výsledek byl zadán chybně podle oficiálního zápisu.',
    actor = 'sql-test',
  }: {
    tipId: number
    selectionId: number
    newOutcome: string
    newClosingOdds?: number | null
    reason?: string
    actor?: string
  },
) =>
  client.query(
    `INSERT INTO "tip_corrections"
       (tip_id, selection_id, new_outcome, new_closing_odds, reason, actor,
        previous_outcome, recorded_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', now())
     RETURNING *`,
    [tipId, selectionId, newOutcome, newClosingOdds, reason, actor],
  )

/** An administrator, as the admin panel would pass it. */
const ADMIN = {
  id: 1,
  email: `admin-${RUN}@example.test`,
  collection: 'users',
} as never

/* -------------------------------------------------------------------------- */

before(async () => {
  guard = await openDisposableDatabase(env.DATABASE_URL)
  payload = await getPayload({ config })
  sql = await connect()
})

// Rows written here live for the lifetime of this disposable database.
after(async () => {
  for (const client of extraClients) {
    await client.end().catch(() => undefined)
  }
  await guard?.end()
})

/* ========================================================================== */

describe('both parents are checked when a selection moves', () => {
  it('refuses moving a draft leg INTO a published tip through direct SQL', async () => {
    const world = await makeWorld()
    const published = await makeDraft(world)
    await publish(sql, published.tipId)
    const draft = await makeDraft(world, [world.eventIds[1]!])

    await expectRefusal(
      sql.query(`UPDATE "tip_selections" SET tip_id = $1 WHERE id = $2`, [
        published.tipId,
        draft.selectionIds[0],
      ]),
      /cannot move from tip .* to tip .*PUBLISHED/,
    )

    const legs = await one(
      sql,
      `SELECT count(*)::int AS n FROM "tip_selections" WHERE tip_id = $1`,
      [published.tipId],
    )
    assert.equal(legs.n, 1, 'the published tip still has exactly one leg')
  })

  it('refuses moving a published leg OUT to a draft through direct SQL', async () => {
    const world = await makeWorld()
    const published = await makeDraft(world)
    await publish(sql, published.tipId)
    const draft = await makeDraft(world, [world.eventIds[1]!])

    await expectRefusal(
      sql.query(`UPDATE "tip_selections" SET tip_id = $1 WHERE id = $2`, [
        draft.tipId,
        published.selectionIds[0],
      ]),
      /cannot move from tip .*PUBLISHED/,
    )
  })

  it('refuses the move through Payload, with and without overrideAccess', async () => {
    const world = await makeWorld()
    const published = await makeDraft(world)
    await publish(sql, published.tipId)
    const draft = await makeDraft(world, [world.eventIds[1]!])

    await assert.rejects(
      payload.update({
        collection: 'tip-selections',
        id: String(draft.selectionIds[0]),
        data: { tip: published.tipId },
        overrideAccess: false,
        depth: 0,
      }),
    )

    await expectApiRefusal(
      payload.update({
        collection: 'tip-selections',
        id: String(draft.selectionIds[0]),
        data: { tip: published.tipId },
        overrideAccess: true,
        depth: 0,
      }),
      /nelze přesunout/,
    )

    assert.equal(
      (await selectionRow(draft.selectionIds[0]!)).tip_id,
      draft.tipId,
    )
  })

  it('still lets a leg move between two drafts', async () => {
    const world = await makeWorld()
    const first = await makeDraft(world)
    const second = await makeDraft(world, [world.eventIds[1]!])

    await sql.query(`UPDATE "tip_selections" SET tip_id = $1 WHERE id = $2`, [
      second.tipId,
      first.selectionIds[0],
    ])

    const moved = await payload.update({
      collection: 'tip-selections',
      id: String(first.selectionIds[0]),
      data: { tip: first.tipId },
      overrideAccess: true,
      depth: 0,
    })

    assert.equal(Number(moved.tip), first.tipId)
  })
})

/* ========================================================================== */

describe('publication and composition changes never interleave', () => {
  it('a publication waits for an in-flight new leg, then publishes it and locks its event', async () => {
    const world = await makeWorld()
    const { tipId } = await makeDraft(world)
    const writer = await connect()
    const publisher = await connect()

    await writer.query('BEGIN')
    await writer.query(
      `INSERT INTO "tip_selections"
         (tip_id, sporting_event_id, market, selection, odds_at_publication,
          minimum_odds, outcome)
       VALUES ($1, $2, '1X2', 'AWAY', 3100, 3000, 'PENDING')`,
      [tipId, world.eventIds[1]],
    )

    const publishing = publish(publisher, tipId)
    await waitUntilBlocked(await pidOf(publisher))
    await writer.query('COMMIT')
    await publishing

    const legs = await one(
      sql,
      `SELECT count(*)::int AS n FROM "tip_selections" WHERE tip_id = $1`,
      [tipId],
    )
    assert.equal(
      legs.n,
      2,
      'the leg committed before publication is part of it',
    )
    assert.ok(
      await lockStamp('sporting_events', world.eventIds[1]!),
      "the late leg's event is locked by the publication",
    )
  })

  it('a new leg waits for an in-flight publication, then is refused', async () => {
    const world = await makeWorld()
    const { tipId } = await makeDraft(world)
    const writer = await connect()
    const publisher = await connect()

    await publisher.query('BEGIN')
    await publish(publisher, tipId)

    const inserting = writer.query(
      `INSERT INTO "tip_selections"
         (tip_id, sporting_event_id, market, selection, odds_at_publication,
          minimum_odds, outcome)
       VALUES ($1, $2, '1X2', 'AWAY', 3100, 3000, 'PENDING')`,
      [tipId, world.eventIds[1]],
    )
    inserting.catch(() => undefined)
    await waitUntilBlocked(await pidOf(writer))
    await publisher.query('COMMIT')

    await expectRefusal(inserting, /cannot add a selection to published tip/)
  })

  it('a leg moving into a tip waits for its publication, then is refused', async () => {
    const world = await makeWorld()
    const target = await makeDraft(world)
    const other = await makeDraft(world, [world.eventIds[1]!])
    const mover = await connect()
    const publisher = await connect()

    await publisher.query('BEGIN')
    await publish(publisher, target.tipId)

    const moving = mover.query(
      `UPDATE "tip_selections" SET tip_id = $1 WHERE id = $2`,
      [target.tipId, other.selectionIds[0]],
    )
    moving.catch(() => undefined)
    await waitUntilBlocked(await pidOf(mover))
    await publisher.query('COMMIT')

    await expectRefusal(moving, /cannot move from tip .* to tip .*PUBLISHED/)
  })

  it('a leg removal waits for an in-flight publication, then is refused', async () => {
    const world = await makeWorld()
    const { tipId, selectionIds } = await makeDraft(world, world.eventIds)
    const remover = await connect()
    const publisher = await connect()

    await publisher.query('BEGIN')
    await publish(publisher, tipId)

    const removing = remover.query(
      `DELETE FROM "tip_selections" WHERE id = $1`,
      [selectionIds[0]],
    )
    removing.catch(() => undefined)
    await waitUntilBlocked(await pidOf(remover))
    await publisher.query('COMMIT')

    await expectRefusal(
      removing,
      /cannot remove a selection from published tip/,
    )
  })

  it('a publication waits for an in-flight event edit and locks the edited values', async () => {
    const world = await makeWorld()
    const { tipId } = await makeDraft(world)
    const editor = await connect()
    const publisher = await connect()
    const eventId = world.eventIds[0]!

    await editor.query('BEGIN')
    await editor.query(
      `UPDATE "sporting_events" SET home_name = 'Opravený název' WHERE id = $1`,
      [eventId],
    )

    const publishing = publish(publisher, tipId)
    await waitUntilBlocked(await pidOf(publisher))
    await editor.query('COMMIT')
    await publishing

    const event = await one(
      sql,
      `SELECT home_name, record_locked_at FROM "sporting_events" WHERE id = $1`,
      [eventId],
    )
    assert.equal(event.home_name, 'Opravený název')
    assert.ok(event.record_locked_at, 'locked by the publication')

    await expectRefusal(
      sql.query(
        `UPDATE "sporting_events" SET home_name = 'Až po publikaci' WHERE id = $1`,
        [eventId],
      ),
      /part of the published record and immutable/,
    )
  })

  it('an event edit waits for an in-flight publication, then is refused', async () => {
    const world = await makeWorld()
    const { tipId } = await makeDraft(world)
    const editor = await connect()
    const publisher = await connect()
    const eventId = world.eventIds[0]!

    await publisher.query('BEGIN')
    await publish(publisher, tipId)

    const editing = editor.query(
      `UPDATE "sporting_events" SET starts_at = starts_at - interval '1 day' WHERE id = $1`,
      [eventId],
    )
    editing.catch(() => undefined)
    await waitUntilBlocked(await pidOf(editor))
    await publisher.query('COMMIT')

    await expectRefusal(
      editing,
      /part of the published record and immutable \(attempted: starts_at\)/,
    )
  })

  it('a REPEATABLE READ editor whose snapshot predates the publication fails to serialise', async () => {
    const world = await makeWorld()
    const { tipId } = await makeDraft(world)
    const editor = await connect()

    await editor.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
    // Take the snapshot while the tip is still a draft.
    await editor.query(`SELECT status FROM "tips" WHERE id = $1`, [tipId])

    await publish(sql, tipId)

    await expectRefusal(
      editor.query(
        `UPDATE "sporting_events" SET away_name = 'Jiný soupeř' WHERE id = $1`,
        [world.eventIds[0]],
      ),
      /could not serialize/,
      '40001',
    )
    await editor.query('ROLLBACK')
  })

  it('refuses to publish outside READ COMMITTED', async () => {
    const world = await makeWorld()
    const { tipId } = await makeDraft(world)
    const publisher = await connect()

    for (const level of ['REPEATABLE READ', 'SERIALIZABLE']) {
      await publisher.query(`BEGIN ISOLATION LEVEL ${level}`)
      await expectRefusal(
        publish(publisher, tipId),
        /must be published at READ COMMITTED/,
      )
      await publisher.query('ROLLBACK')
    }

    assert.equal(
      (
        await one(sql, `SELECT status::text AS s FROM "tips" WHERE id = $1`, [
          tipId,
        ])
      ).s,
      'DRAFT',
    )
  })

  it('two publications sharing events queue instead of deadlocking', async () => {
    const world = await makeWorld(3)
    const [a, b, c] = world.eventIds as [number, number, number]
    // Legs created in opposite event order, so only the trigger's ordering
    // keeps the locks consistent.
    const first = await makeDraft(world, [c, b, a])
    const second = await makeDraft(world, [a, b, c])
    const one_ = await connect()
    const two = await connect()

    await one_.query('BEGIN')
    await publish(one_, first.tipId)

    const publishing = publish(two, second.tipId)
    await waitUntilBlocked(await pidOf(two))
    await one_.query('COMMIT')
    await publishing

    const statuses = await sql.query(
      `SELECT status::text AS s FROM "tips" WHERE id = ANY($1) ORDER BY id`,
      [[first.tipId, second.tipId]],
    )
    assert.deepEqual(
      statuses.rows.map((row) => row.s),
      ['PUBLISHED', 'PUBLISHED'],
    )
  })

  it('concurrent settlement of the last two legs still settles the tip', async () => {
    // Legs of one tip are written one at a time (each holds the tip row), so
    // the second writer sees the first one's outcome and settles the tip.
    for (let round = 0; round < 3; round += 1) {
      const world = await makeWorld()
      const { tipId, selectionIds } = await makeDraft(world, world.eventIds)
      await publish(sql, tipId)

      await Promise.all(
        selectionIds.map((id, index) =>
          payload.update({
            collection: 'tip-selections',
            id: String(id),
            data: { outcome: index === 0 ? 'WON' : 'LOST' },
            overrideAccess: true,
            depth: 0,
          }),
        ),
      )

      const tip = await one(
        sql,
        `SELECT status::text AS s, settled_at FROM "tips" WHERE id = $1`,
        [tipId],
      )
      assert.equal(tip.s, 'SETTLED', `round ${round}`)
      assert.ok(tip.settled_at)
    }
  })
})

/* ========================================================================== */

describe('what a published tip refers to is frozen with it', () => {
  it('publication stamps the event, competition and sport; a draft does not', async () => {
    const world = await makeWorld()
    const { tipId } = await makeDraft(world)

    assert.equal(await lockStamp('sporting_events', world.eventIds[0]!), null)
    await publish(sql, tipId)

    assert.ok(await lockStamp('sporting_events', world.eventIds[0]!))
    assert.ok(await lockStamp('competitions', world.competitionId))
    assert.ok(await lockStamp('sports', world.sportId))
    assert.equal(
      await lockStamp('sporting_events', world.eventIds[1]!),
      null,
      'an event no published tip refers to stays editable',
    )

    await sql.query(
      `UPDATE "sporting_events" SET home_name = 'Volně upravitelné' WHERE id = $1`,
      [world.eventIds[1]],
    )
  })

  it('refuses every identifying change through direct SQL and allows the lifecycle fields', async () => {
    const world = await makeWorld()
    const { tipId } = await makeDraft(world)
    await publish(sql, tipId)
    const eventId = world.eventIds[0]!
    const otherCompetition = await one(
      sql,
      `INSERT INTO "competitions" (sport_id, name) VALUES ($1, $2) RETURNING id`,
      [world.sportId, nextName('jina-liga')],
    )

    for (const [table, id, assignment, column] of [
      ['sporting_events', eventId, `home_name = 'X'`, 'home_name'],
      ['sporting_events', eventId, `away_name = 'Y'`, 'away_name'],
      [
        'sporting_events',
        eventId,
        `starts_at = starts_at + interval '1 hour'`,
        'starts_at',
      ],
      [
        'sporting_events',
        eventId,
        `competition_id = ${Number(otherCompetition.id)}`,
        'competition_id',
      ],
      ['sporting_events', eventId, `seed_marker = NULL`, 'seed_marker'],
      [
        'sporting_events',
        eventId,
        `record_locked_at = NULL`,
        'record_locked_at',
      ],
      ['competitions', world.competitionId, `name = 'Jiná'`, 'name'],
      ['competitions', world.competitionId, `country = 'SK'`, 'country'],
      ['competitions', world.competitionId, `sport_id = sport_id`, null],
      ['sports', world.sportId, `name = 'Jiný sport'`, 'name'],
      ['sports', world.sportId, `code = code || '_X'`, 'code'],
      [
        'sports',
        world.sportId,
        `record_locked_at = now() - interval '1 year'`,
        'record_locked_at',
      ],
    ] as const) {
      const statement = `UPDATE "${table}" SET ${assignment} WHERE id = ${id}`

      if (column === null) {
        // Writing a value it already holds is not a change.
        await sql.query(statement)
        continue
      }

      await expectRefusal(
        sql.query(statement),
        new RegExp(
          `${table} ${id} is part of the published record and immutable \\(attempted: ${column}\\)`,
        ),
      )
    }

    await sql.query(
      `UPDATE "sporting_events"
          SET status = 'FINISHED', final_score = '{"home":1,"away":0}',
              external_refs = '{"feed":"1"}'
        WHERE id = $1`,
      [eventId],
    )
    await sql.query(
      `UPDATE "competitions" SET external_refs = '{"feed":"2"}' WHERE id = $1`,
      [world.competitionId],
    )
    await sql.query(
      `UPDATE "sports" SET active = false, sort_order = 5 WHERE id = $1`,
      [world.sportId],
    )
  })

  it('refuses deleting a locked event, competition or sport through direct SQL', async () => {
    const world = await makeWorld()
    const { tipId } = await makeDraft(world)
    await publish(sql, tipId)

    for (const [table, id] of [
      ['sporting_events', world.eventIds[0]!],
      ['competitions', world.competitionId],
      ['sports', world.sportId],
    ] as const) {
      await expectRefusal(
        sql.query(`DELETE FROM "${table}" WHERE id = $1`, [id]),
        new RegExp(
          `${table} ${id} is part of the published record and cannot be deleted`,
        ),
      )
    }
  })

  it('refuses the change through Payload and keeps the stamp out of its reach', async () => {
    const world = await makeWorld()
    const { tipId } = await makeDraft(world)
    await publish(sql, tipId)
    const eventId = world.eventIds[0]!

    await assert.rejects(
      payload.update({
        collection: 'sporting-events',
        id: String(eventId),
        data: { homeName: 'Přes rozhraní' },
        overrideAccess: false,
        depth: 0,
      }),
    )

    await expectApiRefusal(
      payload.update({
        collection: 'sporting-events',
        id: String(eventId),
        data: { homeName: 'Přes rozhraní' },
        overrideAccess: true,
        depth: 0,
      }),
      /součástí publikovaného tipu.*homeName/,
    )

    await expectApiRefusal(
      payload.delete({
        collection: 'sports',
        id: String(world.sportId),
        overrideAccess: true,
      }),
      /nelze ji smazat/,
    )

    const stamp = await lockStamp('sporting_events', eventId)
    const updated = await payload.update({
      collection: 'sporting-events',
      id: String(eventId),
      data: { status: 'LIVE' },
      overrideAccess: true,
      depth: 0,
    })
    assert.equal(updated.status, 'LIVE', 'the lifecycle still moves')

    // Refused or silently dropped by field access; either way it stays.
    await payload
      .update({
        collection: 'sporting-events',
        id: String(eventId),
        data: { recordLockedAt: null } as never,
        overrideAccess: true,
        depth: 0,
      })
      .catch(() => undefined)
    assert.deepEqual(
      await lockStamp('sporting_events', eventId),
      stamp,
      'Payload cannot clear the stamp',
    )
  })
})

/* ========================================================================== */

describe('the tip row is a whitelist and publication is a checked transition', () => {
  it('freezes columns the original trigger did not list', async () => {
    const world = await makeWorld()
    const { tipId } = await makeDraft(world)
    await publish(sql, tipId)

    await expectRefusal(
      sql.query(`UPDATE "tips" SET seed_marker = NULL WHERE id = $1`, [tipId]),
      /published and immutable.*attempted: seed_marker/,
    )
    await expectRefusal(
      sql.query(`UPDATE "tips" SET id = id + 1000000 WHERE id = $1`, [tipId]),
      /published and immutable.*attempted: id/,
    )
  })

  it('writes settled_at once, with the final status', async () => {
    const world = await makeWorld()
    const published = await makeDraft(world)
    await publish(sql, published.tipId)

    await expectRefusal(
      sql.query(`UPDATE "tips" SET settled_at = now() WHERE id = $1`, [
        published.tipId,
      ]),
      /settled_at is written once/,
    )

    const { tipId } = await makeSettled(world)

    await expectRefusal(
      sql.query(
        `UPDATE "tips" SET settled_at = settled_at - interval '1 day' WHERE id = $1`,
        [tipId],
      ),
      /settled_at is written once/,
    )

    await expectApiRefusal(
      payload.update({
        collection: 'tips',
        id: String(tipId),
        data: { settledAt: new Date('2020-01-01T00:00:00Z').toISOString() },
        overrideAccess: true,
        depth: 0,
      }),
      /settledAt/,
    )
  })

  it('refuses a tip inserted in a published state', async () => {
    const world = await makeWorld()

    await expectRefusal(
      sql.query(
        `INSERT INTO "tips" (slug, sport_id, title, status, published_at)
         VALUES ($1, $2, 'Rovnou publikovaný', 'PUBLISHED', now())`,
        [nextName('direct'), world.sportId],
      ),
      /created as DRAFT/,
    )

    await expectApiRefusal(
      payload.create({
        collection: 'tips',
        data: {
          slug: nextName('direct-payload'),
          sport: world.sportId,
          title: 'Rovnou publikovaný',
          status: 'PUBLISHED',
          requiredFeatureKey: 'TIPS_REALTIME',
          stakeUnits: 1,
        },
        overrideAccess: true,
        depth: 0,
      }),
      /zakládá jako koncept/,
    )
  })

  it('refuses skipping PUBLISHED, publishing without a time or without a leg', async () => {
    const world = await makeWorld()
    const { tipId } = await makeDraft(world)

    for (const status of ['SETTLED', 'VOIDED']) {
      await expectRefusal(
        sql.query(
          `UPDATE "tips" SET status = $1, settled_at = now() WHERE id = $2`,
          [status, tipId],
        ),
        /illegal tip status transition DRAFT -> /,
      )
    }

    await expectRefusal(
      sql.query(`UPDATE "tips" SET status = 'PUBLISHED' WHERE id = $1`, [
        tipId,
      ]),
      /cannot be published without published_at/,
    )

    const empty = await one(
      sql,
      `INSERT INTO "tips" (slug, sport_id, title, status) VALUES ($1, $2, 'Prázdný', 'DRAFT') RETURNING id`,
      [nextName('empty'), world.sportId],
    )

    await expectRefusal(
      publish(sql, Number(empty.id)),
      /cannot be published without a selection/,
    )

    await expectApiRefusal(
      payload.update({
        collection: 'tips',
        id: String(empty.id),
        data: { status: 'PUBLISHED' },
        overrideAccess: true,
        depth: 0,
      }),
      /bez jediné sázky/,
    )
  })

  it('refuses SETTLED while a leg is pending, or without settled_at', async () => {
    const world = await makeWorld()
    const { tipId, selectionIds } = await makeDraft(world, world.eventIds)
    await publish(sql, tipId)
    await sql.query(
      `UPDATE "tip_selections" SET outcome = 'WON' WHERE id = $1`,
      [selectionIds[0]],
    )

    await expectRefusal(
      sql.query(
        `UPDATE "tips" SET status = 'SETTLED', settled_at = now() WHERE id = $1`,
        [tipId],
      ),
      /cannot be SETTLED while 1 of 2 selections are pending/,
    )

    await sql.query(
      `UPDATE "tip_selections" SET outcome = 'LOST' WHERE id = $1`,
      [selectionIds[1]],
    )

    await expectRefusal(
      sql.query(`UPDATE "tips" SET status = 'SETTLED' WHERE id = $1`, [tipId]),
      /cannot be SETTLED without settled_at/,
    )

    await sql.query(
      `UPDATE "tips" SET status = 'SETTLED', settled_at = now() WHERE id = $1`,
      [tipId],
    )
  })
})

/* ========================================================================== */

describe('a recorded result moves one way only', () => {
  it('keeps ordinary settlement working: PENDING to a result, empty to a price', async () => {
    const world = await makeWorld()
    const { tipId, selectionIds } = await makeDraft(world)
    await publish(sql, tipId)

    await sql.query(
      `UPDATE "tip_selections" SET closing_odds = 1880 WHERE id = $1`,
      [selectionIds[0]],
    )

    const settled = await payload.update({
      collection: 'tip-selections',
      id: String(selectionIds[0]),
      data: { outcome: 'HALF_WON', settledAt: new Date().toISOString() },
      overrideAccess: true,
      depth: 0,
    })

    assert.equal(settled.outcome, 'HALF_WON')
    assert.equal(
      (
        await one(sql, `SELECT status::text AS s FROM "tips" WHERE id = $1`, [
          tipId,
        ])
      ).s,
      'SETTLED',
      'the normal path still settles the tip',
    )
  })

  it('refuses rewriting a decided outcome, also back to PENDING, through SQL', async () => {
    const world = await makeWorld()
    const { tipId, selectionIds } = await makeDraft(world, world.eventIds)
    await publish(sql, tipId)
    const selectionId = selectionIds[0]!
    await sql.query(
      `UPDATE "tip_selections" SET outcome = 'WON' WHERE id = $1`,
      [selectionId],
    )

    for (const outcome of ['LOST', 'PENDING', 'VOID']) {
      await expectRefusal(
        sql.query(`UPDATE "tip_selections" SET outcome = $1 WHERE id = $2`, [
          outcome,
          selectionId,
        ]),
        /already has outcome WON; a decided result changes only through a recorded correction/,
      )
    }

    assert.equal((await selectionRow(selectionId)).outcome, 'WON')
    assert.equal((await correctionsFor(selectionId)).length, 0)
  })

  it('refuses rewriting a recorded closing price or settled_at through SQL', async () => {
    const world = await makeWorld()
    const { tipId, selectionIds } = await makeDraft(world, world.eventIds)
    await publish(sql, tipId)
    const selectionId = selectionIds[0]!

    await sql.query(
      `UPDATE "tip_selections" SET outcome = 'WON', closing_odds = 1700, settled_at = now() WHERE id = $1`,
      [selectionId],
    )

    await expectRefusal(
      sql.query(
        `UPDATE "tip_selections" SET closing_odds = 2500 WHERE id = $1`,
        [selectionId],
      ),
      /already has a closing price/,
    )
    await expectRefusal(
      sql.query(
        `UPDATE "tip_selections" SET closing_odds = NULL WHERE id = $1`,
        [selectionId],
      ),
      /already has a closing price/,
    )
    await expectRefusal(
      sql.query(
        `UPDATE "tip_selections" SET settled_at = settled_at - interval '3 days' WHERE id = $1`,
        [selectionId],
      ),
      /settled_at is written once/,
    )
    await expectRefusal(
      sql.query(
        `UPDATE "tip_selections" SET settled_at = now() WHERE id = $1`,
        [selectionIds[1]],
      ),
      /settled_at belongs to a decided outcome/,
    )
  })

  it('freezes every result field once the tip is SETTLED or VOIDED', async () => {
    const world = await makeWorld()
    const settled = await makeSettled(world)
    const voided = await makeDraft(world)
    await publish(sql, voided.tipId)
    await sql.query(`UPDATE "tips" SET status = 'VOIDED' WHERE id = $1`, [
      voided.tipId,
    ])

    await expectRefusal(
      sql.query(`UPDATE "tip_selections" SET outcome = 'WON' WHERE id = $1`, [
        voided.selectionIds[0],
      ]),
      /of VOIDED tip .* has a final result/,
    )

    const fresh = await makeDraft(world)
    await publish(sql, fresh.tipId)
    await sql.query(
      `UPDATE "tip_selections" SET outcome = 'LOST', settled_at = now() WHERE id = $1`,
      [fresh.selectionIds[0]],
    )
    await sql.query(
      `UPDATE "tips" SET status = 'SETTLED', settled_at = now() WHERE id = $1`,
      [fresh.tipId],
    )

    await expectRefusal(
      sql.query(
        `UPDATE "tip_selections" SET closing_odds = 1500 WHERE id = $1`,
        [fresh.selectionIds[0]],
      ),
      /of SETTLED tip .* has a final result/,
    )

    await expectRefusal(
      sql.query(`UPDATE "tip_selections" SET outcome = 'LOST' WHERE id = $1`, [
        settled.selectionId,
      ]),
      /has a final result/,
    )
  })

  it('refuses the rewrite through Payload and points to the correction', async () => {
    const world = await makeWorld()
    const { selectionId } = await makeSettled(world)

    await assert.rejects(
      payload.update({
        collection: 'tip-selections',
        id: String(selectionId),
        data: { outcome: 'LOST' },
        overrideAccess: false,
        depth: 0,
      }),
    )

    for (const data of [
      { outcome: 'LOST' as const },
      { outcome: 'PENDING' as const },
      { closingOdds: 2000 },
    ]) {
      await expectApiRefusal(
        payload.update({
          collection: 'tip-selections',
          id: String(selectionId),
          data,
          overrideAccess: true,
          depth: 0,
        }),
        /nelze přepsat.*tip-corrections/,
      )
    }
  })
})

/* ========================================================================== */

describe('a correction is an attributable record written with the change', () => {
  it('applies a correction made through Payload and records the whole trail', async () => {
    const world = await makeWorld()
    const { tipId, selectionId } = await makeSettled(world)

    const correction = await payload.create({
      collection: 'tip-corrections',
      data: {
        selection: selectionId,
        newOutcome: 'LOST',
        reason: 'Oficiální zápis utkání uvádí jiný výsledek.',
        // Ignored: the signed-in administrator is the author.
        actor: 'somebody else',
      } as never,
      user: ADMIN,
      overrideAccess: true,
      depth: 0,
    })

    assert.equal(Number(correction.tip), tipId)
    assert.equal(correction.previousOutcome, 'WON')
    assert.equal(correction.newOutcome, 'LOST')
    assert.equal(correction.previousClosingOdds, 1850)
    assert.equal(
      correction.newClosingOdds,
      1850,
      'an empty price means unchanged',
    )
    assert.equal(correction.actor, (ADMIN as { email: string }).email)

    const row = (await correctionsFor(selectionId))[0]!
    assert.equal(row.database_role, 'sc_fixture_app')
    assert.match(String(row.transaction_id), /^\d+$/)
    assert.ok(row.recorded_at instanceof Date)

    const leg = await selectionRow(selectionId)
    assert.equal(leg.outcome, 'LOST', 'the correction was applied')
    assert.equal(leg.closing_odds, 1850)
    assert.equal(
      (
        await one(sql, `SELECT status::text AS s FROM "tips" WHERE id = $1`, [
          tipId,
        ])
      ).s,
      'SETTLED',
      'the tip stays settled: a correction keeps every leg decided',
    )
  })

  it('overwrites forged attribution and previous values on a direct SQL insert', async () => {
    const world = await makeWorld()
    const { tipId, selectionId } = await makeSettled(world)

    const inserted = await sql.query(
      `INSERT INTO "tip_corrections"
         (tip_id, selection_id, previous_outcome, previous_closing_odds,
          new_outcome, new_closing_odds, reason, actor, recorded_at,
          database_role, transaction_id)
       VALUES ($1, $2, 'LOST', 9999, 'VOID', 1900,
               'Utkání bylo podle svazu kontumováno.', 'support-script',
               '2020-01-01T00:00:00Z', 'postgres', '1')
       RETURNING *, pg_current_xact_id()::text AS txid`,
      [tipId, selectionId],
    )
    const row = inserted.rows[0] as Row

    assert.equal(
      row.previous_outcome,
      'WON',
      'previous value comes from the row',
    )
    assert.equal(row.previous_closing_odds, 1850)
    assert.equal(row.new_closing_odds, 1900)
    assert.equal(row.database_role, 'sc_fixture_app')
    assert.equal(row.transaction_id, row.txid)
    assert.ok((row.recorded_at as Date).getTime() > Date.parse('2026-01-01'))

    const leg = await selectionRow(selectionId)
    assert.equal(leg.outcome, 'VOID')
    assert.equal(leg.closing_odds, 1900)
  })

  it('corrects a closing price alone, also on a leg that is still pending', async () => {
    const world = await makeWorld()
    const { tipId, selectionIds } = await makeDraft(world)
    await publish(sql, tipId)
    await sql.query(
      `UPDATE "tip_selections" SET closing_odds = 1700 WHERE id = $1`,
      [selectionIds[0]],
    )

    await insertCorrection(sql, {
      tipId,
      selectionId: selectionIds[0]!,
      newOutcome: 'PENDING',
      newClosingOdds: 1750,
    })

    const leg = await selectionRow(selectionIds[0]!)
    assert.equal(leg.outcome, 'PENDING')
    assert.equal(leg.closing_odds, 1750)
  })

  it('refuses a correction that would settle, unsettle, change nothing or lack a reason', async () => {
    const world = await makeWorld()
    const settled = await makeSettled(world)
    const open = await makeDraft(world)
    await publish(sql, open.tipId)
    const draft = await makeDraft(world)

    const cases: [Parameters<typeof insertCorrection>[1], RegExp][] = [
      [
        { ...settled, newOutcome: 'PENDING' },
        /cannot settle a pending selection or return a decided one to PENDING/,
      ],
      [
        {
          tipId: open.tipId,
          selectionId: open.selectionIds[0]!,
          newOutcome: 'WON',
        },
        /cannot settle a pending selection/,
      ],
      [
        { ...settled, newOutcome: 'WON', newClosingOdds: 1850 },
        /changes nothing/,
      ],
      [
        { ...settled, newOutcome: 'LOST', reason: 'chyba' },
        /reason of at least 10 characters/,
      ],
      [{ ...settled, newOutcome: 'LOST', actor: '   ' }, /needs an author/],
      [
        { ...settled, newOutcome: 'LOST', newClosingOdds: 1000 },
        /out of range/,
      ],
      [
        {
          tipId: draft.tipId,
          selectionId: draft.selectionIds[0]!,
          newOutcome: 'WON',
        },
        /belongs to a draft/,
      ],
      [
        {
          tipId: open.tipId,
          selectionId: settled.selectionId,
          newOutcome: 'LOST',
        },
        /names tip .* but selection .* belongs to tip/,
      ],
    ]

    for (const [args, expected] of cases) {
      await expectRefusal(insertCorrection(sql, args), expected)
    }

    assert.equal((await correctionsFor(settled.selectionId)).length, 0)
    assert.equal((await selectionRow(settled.selectionId)).outcome, 'WON')

    await expectApiRefusal(
      payload.create({
        collection: 'tip-corrections',
        data: {
          selection: settled.selectionId,
          newOutcome: 'PENDING',
          reason: 'Vrátit do stavu čekající.',
        } as never,
        user: ADMIN,
        overrideAccess: true,
        depth: 0,
      }),
      /nemůže vyhodnotit čekající sázku ani vrátit/,
    )
  })

  it('refuses an unauthorised correction and any edit of the history', async () => {
    const world = await makeWorld()
    const { tipId, selectionId } = await makeSettled(world)

    await assert.rejects(
      payload.create({
        collection: 'tip-corrections',
        data: {
          selection: selectionId,
          newOutcome: 'LOST',
          reason: 'Bez přihlášení a bez oprávnění.',
          actor: 'anonymous',
        } as never,
        overrideAccess: false,
        depth: 0,
      }),
    )
    assert.equal((await selectionRow(selectionId)).outcome, 'WON')

    // A server-side caller without a user must name itself.
    await expectApiRefusal(
      payload.create({
        collection: 'tip-corrections',
        data: {
          selection: selectionId,
          newOutcome: 'LOST',
          reason: 'Skript bez uvedeného autora.',
        } as never,
        overrideAccess: true,
        depth: 0,
      }),
      /autora/,
    )

    const { rows } = await insertCorrection(sql, {
      tipId,
      selectionId,
      newOutcome: 'LOST',
    })
    const correctionId = Number((rows[0] as Row).id)

    await assert.rejects(
      payload.update({
        collection: 'tip-corrections',
        id: String(correctionId),
        data: { reason: 'Přepsaný důvod opravy.' },
        overrideAccess: false,
        depth: 0,
      }),
    )
    await expectApiRefusal(
      payload.update({
        collection: 'tip-corrections',
        id: String(correctionId),
        data: { reason: 'Přepsaný důvod opravy.' },
        overrideAccess: true,
        depth: 0,
      }),
      /immutable once created/,
    )
    await assert.rejects(
      payload.delete({
        collection: 'tip-corrections',
        id: String(correctionId),
        overrideAccess: true,
      }),
    )

    await expectRefusal(
      sql.query(`UPDATE "tip_corrections" SET actor = 'forged' WHERE id = $1`, [
        correctionId,
      ]),
      /tip_corrections is append-only \(attempted UPDATE\)/,
    )
    await expectRefusal(
      sql.query(`DELETE FROM "tip_corrections" WHERE id = $1`, [correctionId]),
      /tip_corrections is append-only \(attempted DELETE\)/,
    )
    // The application role has no TRUNCATE privilege; the owner meets the
    // trigger checked in the catalogue test below.
    await expectRefusal(
      sql.query(`TRUNCATE "tip_corrections"`),
      /permission denied/,
      '42501',
    )

    assert.equal((await correctionsFor(selectionId)).length, 1)
  })

  it('is bound to its own transaction and cannot be replayed', async () => {
    const world = await makeWorld()
    const { tipId, selectionId } = await makeSettled(world)
    const session = await connect()

    // Inside one transaction: after the correction is applied, a plain
    // update back is not covered by it.
    await session.query('BEGIN')
    await insertCorrection(session, { tipId, selectionId, newOutcome: 'LOST' })
    await expectRefusal(
      session.query(
        `UPDATE "tip_selections" SET outcome = 'WON' WHERE id = $1`,
        [selectionId],
      ),
      /has a final result/,
    )
    await session.query('ROLLBACK')

    // Two committed corrections, WON -> LOST -> WON. The first one matches
    // the current row again, but it belongs to another transaction.
    await insertCorrection(sql, { tipId, selectionId, newOutcome: 'LOST' })
    await insertCorrection(sql, { tipId, selectionId, newOutcome: 'WON' })

    await expectRefusal(
      sql.query(`UPDATE "tip_selections" SET outcome = 'LOST' WHERE id = $1`, [
        selectionId,
      ]),
      /has a final result/,
    )

    const trail = await correctionsFor(selectionId)
    assert.deepEqual(
      trail.map((row) => [row.previous_outcome, row.new_outcome]),
      [
        ['WON', 'LOST'],
        ['LOST', 'WON'],
      ],
      'the committed trail replays to the current value',
    )
    assert.equal((await selectionRow(selectionId)).outcome, 'WON')
  })

  it('rolls back together with the change it describes', async () => {
    const world = await makeWorld()
    const { tipId, selectionId } = await makeSettled(world)
    const session = await connect()

    await session.query('BEGIN')
    await insertCorrection(session, { tipId, selectionId, newOutcome: 'LOST' })
    assert.equal(
      (
        await one(
          session,
          `SELECT outcome::text AS o FROM "tip_selections" WHERE id = $1`,
          [selectionId],
        )
      ).o,
      'LOST',
      'applied inside the transaction',
    )
    await session.query('ROLLBACK')

    assert.equal((await selectionRow(selectionId)).outcome, 'WON')
    assert.equal((await correctionsFor(selectionId)).length, 0)

    // A statement that records two conflicting corrections at once fails as
    // a whole: no record without its change, no change without its record.
    await expectRefusal(
      sql.query(
        `INSERT INTO "tip_corrections"
           (tip_id, selection_id, new_outcome, reason, actor, previous_outcome, recorded_at)
         VALUES ($1, $2, 'LOST', 'První ze dvou souběžných oprav.', 't', 'WON', now()),
                ($1, $2, 'VOID', 'Druhá ze dvou souběžných oprav.', 't', 'WON', now())`,
        [tipId, selectionId],
      ),
      /has a final result/,
    )

    assert.equal((await selectionRow(selectionId)).outcome, 'WON')
    assert.equal((await correctionsFor(selectionId)).length, 0)
  })

  it('serialises concurrent corrections of one selection into a consistent chain', async () => {
    const world = await makeWorld()
    const { tipId, selectionId } = await makeSettled(world)
    const first = await connect()
    const second = await connect()

    await first.query('BEGIN')
    await insertCorrection(first, { tipId, selectionId, newOutcome: 'LOST' })

    const competing = insertCorrection(second, {
      tipId,
      selectionId,
      newOutcome: 'VOID',
    })
    assert.equal(
      await settlesWithin(competing, 200),
      false,
      'the second correction waits for the first',
    )
    await waitUntilBlocked(await pidOf(second))
    await first.query('COMMIT')
    await competing

    const trail = await correctionsFor(selectionId)
    assert.deepEqual(
      trail.map((row) => [row.previous_outcome, row.new_outcome]),
      [
        ['WON', 'LOST'],
        ['LOST', 'VOID'],
      ],
    )
    assert.equal((await selectionRow(selectionId)).outcome, 'VOID')
  })
})

/* ========================================================================== */

describe('every protection is installed and active', () => {
  it('lists the new triggers alongside the original ones, all enabled', async () => {
    assert.ok(guard)
    const triggers = await readProtectedTriggers(guard)
    const names = new Set(triggers.map((row) => row.name))

    for (const name of [
      'tips_immutable_after_publication',
      'tips_no_delete_after_publication',
      'tips_insert_as_draft',
      'tips_no_truncate',
      'tip_selections_immutable_after_publication',
      'tip_selections_no_insert_after_publication',
      'tip_selections_no_delete_after_publication',
      'tip_selections_no_truncate',
      'tip_audit_events_no_update',
      'tip_audit_events_no_delete',
      'tip_audit_events_no_truncate',
      'tip_corrections_prepare',
      'tip_corrections_apply',
      'tip_corrections_no_update',
      'tip_corrections_no_delete',
      'tip_corrections_no_truncate',
      'sporting_events_locked_after_publication',
      'sporting_events_no_delete_after_publication',
      'competitions_locked_after_publication',
      'competitions_no_delete_after_publication',
      'sports_locked_after_publication',
      'sports_no_delete_after_publication',
      'credit_notes_total_within_invoice',
    ]) {
      assert.ok(names.has(name), `missing trigger ${name}`)
    }

    // The original triggers now run the replaced functions.
    const bound = await sql.query(
      `SELECT t.tgname, p.proname
         FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE t.tgname IN ('tips_immutable_after_publication',
                           'tip_selections_immutable_after_publication')
        ORDER BY t.tgname`,
    )
    assert.deepEqual(
      bound.rows.map((row) => [row.tgname, row.proname]),
      [
        [
          'tip_selections_immutable_after_publication',
          'tip_selections_enforce_immutability',
        ],
        ['tips_immutable_after_publication', 'tips_enforce_immutability'],
      ],
    )
  })
})
