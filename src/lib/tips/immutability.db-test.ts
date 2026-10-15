/**
 * Proof that a published tip cannot be rewritten.
 *
 * This is the step's central claim, so it is attacked from three directions,
 * each one strictly stronger than the last:
 *
 *  1. THROUGH PAYLOAD with access control on — what a bad request would do.
 *  2. THROUGH PAYLOAD with `overrideAccess: true` — what OUR OWN server code
 *     does, including every script and every hook. This is the one a
 *     hook-only defence still catches but an access-control-only defence
 *     does not.
 *  3. DIRECT SQL, bypassing Payload entirely — what a migration, a support
 *     query or a psql session would do. Only the database trigger catches
 *     this, and it is the reason the triggers exist.
 *
 * If (3) ever passes, the immutability guarantee is a convention rather than a
 * guarantee, and the published track record is only as trustworthy as the
 * discipline of whoever last wrote a migration.
 *
 * Run with `pnpm test:db`.
 */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { getPayload, type Payload } from 'payload'

import type * as PayloadDrizzle from '@payloadcms/db-postgres/drizzle'

import config from '@/payload.config'

const RUN = `imm${Date.now().toString(36)}`
const MARKER = `dbtest-${RUN}`

let payload: Payload
let sql: typeof PayloadDrizzle.sql
let sportId: number
let competitionId: number
let eventId: number
/** A second event, so "move the selection elsewhere" is a real change. */
let otherEventId: number

const db = () =>
  (
    payload.db as unknown as {
      drizzle: { execute: (query: unknown) => Promise<unknown> }
    }
  ).drizzle

const rows = (result: unknown): Record<string, unknown>[] => {
  if (Array.isArray(result)) return result as Record<string, unknown>[]
  const r = (result as { rows?: unknown[] } | undefined)?.rows
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : []
}

/** Walk an error chain for a Postgres error. */
const pgErrorOf = (
  error: unknown,
): { code?: string; message?: string } | undefined => {
  let current: unknown = error

  for (let depth = 0; depth < 6 && current; depth += 1) {
    const candidate = current as {
      code?: unknown
      message?: unknown
      cause?: unknown
    }

    if (typeof candidate.code === 'string') {
      return typeof candidate.message === 'string'
        ? { code: candidate.code, message: candidate.message }
        : { code: candidate.code }
    }

    current = candidate.cause
  }

  return undefined
}

/** Assert a write was refused BY THE DATABASE, not by application code. */
const expectTriggerRefusal = async (
  run: () => Promise<unknown>,
  expectedText: RegExp,
) => {
  await assert.rejects(run, (error: unknown) => {
    const pg = pgErrorOf(error)

    // 23000 = integrity_constraint_violation, which the triggers raise.
    assert.equal(
      pg?.code,
      '23000',
      `expected a trigger refusal (SQLSTATE 23000), got ${JSON.stringify(pg)}`,
    )
    assert.match(String(pg?.message), expectedText)
    return true
  })
}

const lexical = (text: string) => ({
  root: {
    type: 'root',
    format: '' as const,
    indent: 0,
    version: 1,
    direction: 'ltr' as const,
    children: [
      {
        type: 'paragraph',
        format: '' as const,
        indent: 0,
        version: 1,
        direction: 'ltr' as const,
        textFormat: 0,
        children: [
          {
            type: 'text',
            detail: 0,
            format: 0,
            mode: 'normal',
            style: '',
            text,
            version: 1,
          },
        ],
      },
    ],
  },
})

/** A draft tip with one selection, ready to publish. */
const makeDraft = async (suffix: string, legs = 1) => {
  const tip = await payload.create({
    collection: 'tips',
    data: {
      slug: `${RUN}-${suffix}`,
      sport: sportId,
      title: `Test ${suffix}`,
      status: 'DRAFT',
      requiredFeatureKey: 'TIPS_REALTIME',
      stakeUnits: 2,
      confidence: 55,
      rationale: lexical('Původní odůvodnění.'),
      seedMarker: MARKER,
    },
    overrideAccess: true,
    depth: 0,
  })

  const selectionIds: number[] = []

  for (let index = 0; index < legs; index += 1) {
    const selection = await payload.create({
      collection: 'tip-selections',
      data: {
        tip: Number(tip.id),
        sportingEvent: eventId,
        market: 'OVER_UNDER',
        selection: 'OVER',
        line: 250,
        oddsAtPublication: 1900 + index * 10,
        minimumOdds: 1800,
        outcome: 'PENDING',
        seedMarker: MARKER,
      },
      overrideAccess: true,
      depth: 0,
    })

    selectionIds.push(Number(selection.id))
  }

  return { tipId: Number(tip.id), selectionIds }
}

const publish = async (tipId: number) =>
  payload.update({
    collection: 'tips',
    id: String(tipId),
    data: { status: 'PUBLISHED' },
    overrideAccess: true,
    depth: 0,
  })

before(async () => {
  payload = await getPayload({ config })
  sql = (await import('@payloadcms/db-postgres/drizzle')).sql

  const sport = await payload.create({
    collection: 'sports',
    data: {
      code: `TEST_${RUN.toUpperCase()}`,
      name: 'Test sport',
      active: true,
      sortOrder: 99,
      seedMarker: MARKER,
    },
    overrideAccess: true,
    depth: 0,
  })
  sportId = Number(sport.id)

  const competition = await payload.create({
    collection: 'competitions',
    data: { sport: sportId, name: `Test liga ${RUN}`, seedMarker: MARKER },
    overrideAccess: true,
    depth: 0,
  })
  competitionId = Number(competition.id)

  const event = await payload.create({
    collection: 'sporting-events',
    data: {
      competition: competitionId,
      homeName: 'Domácí',
      awayName: 'Hosté',
      startsAt: new Date('2026-05-01T18:00:00.000Z').toISOString(),
      status: 'FINISHED',
      finalScore: { home: 2, away: 1 },
      seedMarker: MARKER,
    },
    overrideAccess: true,
    depth: 0,
  })
  eventId = Number(event.id)

  const otherEvent = await payload.create({
    collection: 'sporting-events',
    data: {
      competition: competitionId,
      homeName: 'Jiní domácí',
      awayName: 'Jiní hosté',
      startsAt: new Date('2026-05-02T18:00:00.000Z').toISOString(),
      status: 'FINISHED',
      finalScore: { home: 0, away: 0 },
      seedMarker: MARKER,
    },
    overrideAccess: true,
    depth: 0,
  })
  otherEventId = Number(otherEvent.id)
})

after(async () => {
  // Raw SQL with the delete triggers off: refusing to delete a published tip
  // is the behaviour under test, so teardown has to go around it.
  const statements = [
    sql`ALTER TABLE "tip_audit_events" DISABLE TRIGGER "tip_audit_events_no_delete"`,
    sql`ALTER TABLE "tip_selections" DISABLE TRIGGER "tip_selections_no_delete_after_publication"`,
    sql`ALTER TABLE "tips" DISABLE TRIGGER "tips_no_delete_after_publication"`,
    sql`DELETE FROM "tip_audit_events" WHERE "tip_id" IN (SELECT "id" FROM "tips" WHERE "seed_marker" = ${MARKER})`,
    sql`DELETE FROM "tip_selections" WHERE "seed_marker" = ${MARKER}`,
    sql`DELETE FROM "tips" WHERE "seed_marker" = ${MARKER}`,
    sql`DELETE FROM "sporting_events" WHERE "seed_marker" = ${MARKER}`,
    sql`DELETE FROM "competitions" WHERE "seed_marker" = ${MARKER}`,
    sql`DELETE FROM "sports" WHERE "seed_marker" = ${MARKER}`,
    sql`ALTER TABLE "tips" ENABLE TRIGGER "tips_no_delete_after_publication"`,
    sql`ALTER TABLE "tip_selections" ENABLE TRIGGER "tip_selections_no_delete_after_publication"`,
    sql`ALTER TABLE "tip_audit_events" ENABLE TRIGGER "tip_audit_events_no_delete"`,
  ]

  for (const statement of statements) {
    await db().execute(statement)
  }
})

/* ========================================================================== */

describe('a draft is freely editable', () => {
  it('accepts every change while it is still a draft', async () => {
    const { tipId, selectionIds } = await makeDraft('draft-editable')

    await payload.update({
      collection: 'tips',
      id: String(tipId),
      data: { title: 'Změněný titul', stakeUnits: 7 },
      overrideAccess: true,
      depth: 0,
    })

    const updated = await payload.update({
      collection: 'tip-selections',
      id: String(selectionIds[0]),
      data: { oddsAtPublication: 2500, minimumOdds: 2400 },
      overrideAccess: true,
      depth: 0,
    })

    assert.equal(updated.oddsAtPublication, 2500)
  })

  it('can be deleted while it is a draft', async () => {
    const { tipId, selectionIds } = await makeDraft('draft-deletable')

    await payload.delete({
      collection: 'tip-selections',
      id: String(selectionIds[0]),
      overrideAccess: true,
    })

    await payload.delete({
      collection: 'tips',
      id: String(tipId),
      overrideAccess: true,
    })

    await assert.rejects(
      payload.findByID({
        collection: 'tips',
        id: String(tipId),
        overrideAccess: true,
      }),
    )
  })
})

/* ========================================================================== */

describe('a published tip refuses every forbidden edit', () => {
  it('refuses them through Payload with access control ON', async () => {
    const { tipId } = await makeDraft('acl')
    await publish(tipId)

    await assert.rejects(
      payload.update({
        collection: 'tips',
        id: String(tipId),
        data: { stakeUnits: 10 },
        overrideAccess: false,
        depth: 0,
      }),
    )
  })

  it('refuses them through Payload with overrideAccess: true', async () => {
    // The case access control cannot cover: this is what our own scripts and
    // hooks do, so a hook is the only application-level defence that applies.
    const { tipId } = await makeDraft('override')
    await publish(tipId)

    for (const forbidden of [
      { stakeUnits: 9 },
      { slug: `${RUN}-rewritten` },
      { title: 'Lepší titul po výsledku' },
      { requiredFeatureKey: 'ARCHIVE_EXPORT' as const },
      { confidence: 99 },
      { rationale: lexical('Přepsané odůvodnění po výsledku.') },
      { publishedAt: new Date('2020-01-01T00:00:00.000Z').toISOString() },
      { publicAt: new Date('2020-01-01T00:00:00.000Z').toISOString() },
      { sourcesSummary: [{ kind: 'MODEL', detail: 'vymyšleno' }] },
    ]) {
      await assert.rejects(
        payload.update({
          collection: 'tips',
          id: String(tipId),
          data: forbidden,
          overrideAccess: true,
          depth: 0,
        }),
        (error: unknown) => {
          assert.match(
            String((error as Error).message),
            /neměnný|immutable/i,
            `expected an immutability refusal for ${Object.keys(forbidden)[0]}`,
          )
          return true
        },
      )
    }
  })

  it('refuses a DIRECT SQL UPDATE — the trigger, not the hook', async () => {
    // The strongest case. Payload is not involved at all here; if this
    // succeeded, a migration or a support query could rewrite the record.
    const { tipId } = await makeDraft('sql-tip')
    await publish(tipId)

    await expectTriggerRefusal(
      () =>
        db().execute(
          sql`UPDATE "tips" SET "stake_units" = 10 WHERE "id" = ${tipId}`,
        ),
      /published and immutable/,
    )

    await expectTriggerRefusal(
      () =>
        db().execute(
          sql`UPDATE "tips" SET "rationale" = '{"root":{}}'::jsonb WHERE "id" = ${tipId}`,
        ),
      /published and immutable/,
    )

    await expectTriggerRefusal(
      () =>
        db().execute(
          sql`UPDATE "tips" SET "published_at" = now() - interval '400 days' WHERE "id" = ${tipId}`,
        ),
      /published and immutable/,
    )

    // And nothing changed.
    const after = rows(
      await db().execute(
        sql`SELECT "stake_units" FROM "tips" WHERE "id" = ${tipId}`,
      ),
    )[0]

    assert.equal(Number(after?.stake_units), 2, 'the stake must be untouched')
  })

  it('refuses a direct SQL UPDATE to a selection', async () => {
    const { tipId, selectionIds } = await makeDraft('sql-selection')
    await publish(tipId)
    const selectionId = selectionIds[0]

    for (const [column, value] of [
      ['odds_at_publication', '9999'],
      ['minimum_odds', '1001'],
      ['market', `'1X2'`],
      ['selection', `'HOME'`],
      ['line', '500'],
      // A DIFFERENT event: setting the column to the value it already holds
      // is not a change, and the trigger rightly lets it through.
      ['sporting_event_id', String(otherEventId)],
    ] as const) {
      await expectTriggerRefusal(
        () =>
          db().execute(
            sql.raw(
              `UPDATE "tip_selections" SET "${column}" = ${value} WHERE "id" = ${selectionId}`,
            ),
          ),
        /published tip .* immutable/,
      )
    }
  })
})

/* ========================================================================== */

describe('what MAY still change after publication', () => {
  it('records an outcome and a closing price on a selection', async () => {
    const { tipId, selectionIds } = await makeDraft('allowed-selection')
    await publish(tipId)

    const updated = await payload.update({
      collection: 'tip-selections',
      id: String(selectionIds[0]),
      data: {
        outcome: 'WON',
        closingOdds: 1850,
        settledAt: new Date().toISOString(),
      },
      overrideAccess: true,
      depth: 0,
    })

    assert.equal(updated.outcome, 'WON')
    assert.equal(updated.closingOdds, 1850)
  })

  it('moves the tip along its legal transitions', async () => {
    const { tipId } = await makeDraft('allowed-status')
    await publish(tipId)

    const voided = await payload.update({
      collection: 'tips',
      id: String(tipId),
      data: { status: 'VOIDED' },
      overrideAccess: true,
      depth: 0,
    })

    assert.equal(voided.status, 'VOIDED')
  })

  it('refuses an illegal transition, and SETTLED is terminal', async () => {
    const { tipId, selectionIds } = await makeDraft('terminal')
    await publish(tipId)

    // Settle it the normal way.
    await payload.update({
      collection: 'tip-selections',
      id: String(selectionIds[0]),
      data: { outcome: 'WON' },
      overrideAccess: true,
      depth: 0,
    })

    const settled = await payload.findByID({
      collection: 'tips',
      id: String(tipId),
      overrideAccess: true,
      depth: 0,
    })
    assert.equal(settled.status, 'SETTLED', 'the tip settled automatically')

    // Re-settling, or going back to PUBLISHED, is exactly the shape a
    // doctored record would take.
    for (const status of ['PUBLISHED', 'DRAFT', 'VOIDED'] as const) {
      await assert.rejects(
        payload.update({
          collection: 'tips',
          id: String(tipId),
          data: { status },
          overrideAccess: true,
          depth: 0,
        }),
      )
    }

    await expectTriggerRefusal(
      () =>
        db().execute(
          sql`UPDATE "tips" SET "status" = 'PUBLISHED' WHERE "id" = ${tipId}`,
        ),
      /already SETTLED|cannot change status/,
    )
  })
})

/* ========================================================================== */

describe('the set of selections is closed once published', () => {
  it('refuses a new selection through Payload', async () => {
    const { tipId } = await makeDraft('no-add')
    await publish(tipId)

    await assert.rejects(
      payload.create({
        collection: 'tip-selections',
        data: {
          tip: tipId,
          sportingEvent: eventId,
          market: '1X2',
          selection: 'HOME',
          oddsAtPublication: 1500,
          minimumOdds: 1400,
          outcome: 'PENDING',
          seedMarker: MARKER,
        },
        overrideAccess: true,
        depth: 0,
      }),
    )
  })

  it('refuses a new selection through direct SQL', async () => {
    const { tipId } = await makeDraft('no-add-sql')
    await publish(tipId)

    await expectTriggerRefusal(
      () =>
        db().execute(sql`
          INSERT INTO "tip_selections"
            ("tip_id", "sporting_event_id", "market", "selection",
             "odds_at_publication", "minimum_odds", "outcome",
             "updated_at", "created_at")
          VALUES (${tipId}, ${eventId}, '1X2', 'HOME', 1500, 1400,
                  'PENDING'::"enum_tip_selections_outcome", now(), now())
        `),
      /cannot add a selection/,
    )
  })

  it('refuses removing a selection, through Payload and through SQL', async () => {
    const { tipId, selectionIds } = await makeDraft('no-remove', 2)
    await publish(tipId)
    const selectionId = selectionIds[0]

    await assert.rejects(
      payload.delete({
        collection: 'tip-selections',
        id: String(selectionId),
        overrideAccess: true,
      }),
    )

    await expectTriggerRefusal(
      () =>
        db().execute(
          sql`DELETE FROM "tip_selections" WHERE "id" = ${selectionId}`,
        ),
      /cannot remove a selection/,
    )

    const remaining = rows(
      await db().execute(
        sql`SELECT count(*)::int AS n FROM "tip_selections" WHERE "tip_id" = ${tipId}`,
      ),
    )[0]

    assert.equal(Number(remaining?.n), 2, 'both legs survive')
  })
})

/* ========================================================================== */

describe('a published tip cannot be deleted', () => {
  it('refuses deletion through Payload, with and without overrideAccess', async () => {
    const { tipId } = await makeDraft('no-delete')
    await publish(tipId)

    await assert.rejects(
      payload.delete({
        collection: 'tips',
        id: String(tipId),
        overrideAccess: false,
      }),
    )

    await assert.rejects(
      payload.delete({
        collection: 'tips',
        id: String(tipId),
        overrideAccess: true,
      }),
      (error: unknown) => {
        assert.match(String((error as Error).message), /nelze smazat/)
        return true
      },
    )
  })

  it('refuses deletion through direct SQL', async () => {
    const { tipId } = await makeDraft('no-delete-sql')
    await publish(tipId)

    await expectTriggerRefusal(
      () => db().execute(sql`DELETE FROM "tips" WHERE "id" = ${tipId}`),
      /cannot be deleted/,
    )

    const still = rows(
      await db().execute(
        sql`SELECT count(*)::int AS n FROM "tips" WHERE "id" = ${tipId}`,
      ),
    )[0]

    assert.equal(Number(still?.n), 1)
  })
})

/* ========================================================================== */

describe('settlement happens only when every leg is decided', () => {
  it('leaves a two-leg tip PUBLISHED after one outcome', async () => {
    const { tipId, selectionIds } = await makeDraft('partial', 2)
    await publish(tipId)

    await payload.update({
      collection: 'tip-selections',
      id: String(selectionIds[0]),
      data: { outcome: 'WON' },
      overrideAccess: true,
      depth: 0,
    })

    const midway = await payload.findByID({
      collection: 'tips',
      id: String(tipId),
      overrideAccess: true,
      depth: 0,
    })

    assert.equal(
      midway.status,
      'PUBLISHED',
      'one leg must not settle an accumulator',
    )
    assert.equal(midway.settledAt ?? null, null)

    await payload.update({
      collection: 'tip-selections',
      id: String(selectionIds[1]),
      data: { outcome: 'LOST' },
      overrideAccess: true,
      depth: 0,
    })

    const finished = await payload.findByID({
      collection: 'tips',
      id: String(tipId),
      overrideAccess: true,
      depth: 0,
    })

    assert.equal(finished.status, 'SETTLED')
    assert.ok(finished.settledAt, 'settledAt is stamped')
  })

  it('does not settle a tip that was never published', async () => {
    const { tipId, selectionIds } = await makeDraft('draft-no-settle')

    await payload.update({
      collection: 'tip-selections',
      id: String(selectionIds[0]),
      data: { outcome: 'WON' },
      overrideAccess: true,
      depth: 0,
    })

    const tip = await payload.findByID({
      collection: 'tips',
      id: String(tipId),
      overrideAccess: true,
      depth: 0,
    })

    assert.equal(tip.status, 'DRAFT', 'a draft has no result to settle')
  })
})

/* ========================================================================== */

describe('the audit trail is append-only', () => {
  it('records publication and settlement', async () => {
    const { tipId, selectionIds } = await makeDraft('audit')
    await publish(tipId)

    await payload.update({
      collection: 'tip-selections',
      id: String(selectionIds[0]),
      data: { outcome: 'WON' },
      overrideAccess: true,
      depth: 0,
    })

    const events = await payload.find({
      collection: 'tip-audit-events',
      where: { tip: { equals: tipId } },
      pagination: false,
      overrideAccess: true,
      depth: 0,
      sort: 'id',
    })

    const types = events.docs.map((row) => row.type)

    assert.ok(
      types.includes('SELECTION_SETTLED'),
      `expected a SELECTION_SETTLED event, got ${types.join(', ')}`,
    )
    assert.ok(types.includes('SETTLED'), `got ${types.join(', ')}`)
    assert.ok(
      events.docs.every((row) => row.actor),
      'every event is attributed',
    )
  })

  it('refuses an update through access control and through the hook', async () => {
    const { tipId } = await makeDraft('audit-locked')
    await publish(tipId)

    const event = await payload.create({
      collection: 'tip-audit-events',
      data: {
        tip: tipId,
        type: 'EDIT_REJECTED',
        occurredAt: new Date().toISOString(),
        actor: 'test',
        before: { a: 1 },
        after: { a: 2 },
      },
      overrideAccess: true,
      depth: 0,
    })

    await assert.rejects(
      payload.update({
        collection: 'tip-audit-events',
        id: String(event.id),
        data: { actor: 'somebody else' },
        overrideAccess: false,
        depth: 0,
      }),
    )

    await assert.rejects(
      payload.update({
        collection: 'tip-audit-events',
        id: String(event.id),
        data: { actor: 'somebody else' },
        overrideAccess: true,
        depth: 0,
      }),
      (error: unknown) => {
        assert.match(
          String((error as Error).message),
          /immutable once created/i,
        )
        return true
      },
    )

    await assert.rejects(
      payload.delete({
        collection: 'tip-audit-events',
        id: String(event.id),
        overrideAccess: true,
      }),
    )
  })

  it('refuses an update and a delete through direct SQL', async () => {
    const { tipId } = await makeDraft('audit-sql')
    await publish(tipId)

    const event = await payload.create({
      collection: 'tip-audit-events',
      data: {
        tip: tipId,
        type: 'EDIT_REJECTED',
        occurredAt: new Date().toISOString(),
        actor: 'test',
      },
      overrideAccess: true,
      depth: 0,
    })

    await expectTriggerRefusal(
      () =>
        db().execute(
          sql`UPDATE "tip_audit_events" SET "actor" = 'forged' WHERE "id" = ${Number(event.id)}`,
        ),
      /append-only/,
    )

    await expectTriggerRefusal(
      () =>
        db().execute(
          sql`DELETE FROM "tip_audit_events" WHERE "id" = ${Number(event.id)}`,
        ),
      /append-only/,
    )
  })
})

/* ========================================================================== */

describe('odds columns are integers in the database', () => {
  it('stores odds, lines and stakes as integer, never numeric', async () => {
    const result = rows(
      await db().execute(sql`
        SELECT table_name, column_name, data_type
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND ((table_name = 'tip_selections'
                 AND column_name IN ('line','odds_at_publication','minimum_odds','closing_odds'))
             OR (table_name = 'tips'
                 AND column_name IN ('stake_units','confidence')))
         ORDER BY table_name, column_name
      `),
    )

    assert.equal(result.length, 6)

    for (const row of result) {
      assert.equal(
        row.data_type,
        'integer',
        `${String(row.table_name)}.${String(row.column_name)} is ${String(row.data_type)}`,
      )
    }
  })
})
