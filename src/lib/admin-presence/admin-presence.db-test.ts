/**
 * Administrator presence against a real Postgres, with the PRODUCTION policy.
 *
 * Every scenario the rule has to hold for runs here end to end: a fresh
 * install, the private initialization, an existing administrator, removal of
 * the last administrator while the server's check is running, and a database
 * replaced by an empty restore.
 *
 * ISOLATION
 *
 * The suite never touches the database `DATABASE_URL` names. It creates its
 * own database next to it (`<name>_sc019_<run>`), migrates it, and drops it at
 * the end. Creating and dropping databases is destructive enough that the
 * suite refuses to run unless the server is on a loopback address — a
 * disposable local container, never a hosted database.
 *
 * WHY THE ENVIRONMENT IS SET BEFORE ANY APPLICATION IMPORT
 *
 * The creation rule depends on `NODE_ENV`, which `src/lib/env.ts` reads once
 * at module load. `node --test` runs each file in its own process, so setting
 * it here affects this file only. Application modules are imported
 * dynamically below, after the environment is in place.
 */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, describe, it } from 'node:test'

import pg from 'pg'

import {
  ABSENCE_WINDOW_MS,
  COUNT_VERIFIED_ADMINISTRATORS_SQL,
} from './policy.ts'
import { createAdministratorWatch, type RefusalEvent } from './watch.ts'

const originalUrl = process.env.DATABASE_URL
if (!originalUrl) throw new Error('DATABASE_URL is required for DB tests')

const base = new URL(originalUrl)
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
if (!LOOPBACK.has(base.hostname)) {
  throw new Error(
    'admin-presence.db-test creates and drops databases; it runs only against a loopback Postgres.',
  )
}

const RUN = randomBytes(4).toString('hex')
const freshName = `${base.pathname.slice(1)}_sc019_${RUN}`.replace(
  /[^a-z0-9_]/gi,
  '_',
)
const freshUrl = new URL(originalUrl)
freshUrl.pathname = `/${freshName}`

// Production policy, pointed at the fresh database.
Object.assign(process.env, {
  NODE_ENV: 'production',
  DATABASE_URL: freshUrl.toString(),
})

const maintenance = new pg.Client({ connectionString: originalUrl })
await maintenance.connect()

const createFreshDatabase = () =>
  maintenance.query(`CREATE DATABASE "${freshName}"`)
const dropFreshDatabase = () =>
  maintenance.query(`DROP DATABASE IF EXISTS "${freshName}" WITH (FORCE)`)

await createFreshDatabase()

const { getPayload } = await import('payload')
const { default: config } = await import('../../payload.config.ts')
const { bootstrapContext } = await import('./bootstrap.ts')
const { createDatabaseProbe } = await import('./runtime.ts')

type Payload = Awaited<ReturnType<typeof getPayload>>
let payload: Payload

const direct = () => new pg.Client({ connectionString: freshUrl.toString() })

const countVerified = async (): Promise<number> => {
  const client = direct()
  await client.connect()
  try {
    const result = await client.query<{ count: number }>(
      COUNT_VERIFIED_ADMINISTRATORS_SQL,
    )

    return Number(result.rows[0]?.count)
  } finally {
    await client.end()
  }
}

const sqlOnFresh = async (text: string): Promise<void> => {
  const client = direct()
  await client.connect()
  try {
    await client.query(text)
  } finally {
    await client.end()
  }
}

const statusOf = (error: unknown): number | undefined =>
  (error as { status?: number }).status

const PASSWORD = `${RUN}-sc019-local-test-password`
const accountData = (label: string) => ({
  email: `${RUN}-${label}@example.test`,
  name: `SC-019 ${label}`,
  password: PASSWORD,
})

const asAdministrator = (doc: { id: number | string }) =>
  ({ ...doc, collection: 'users' }) as never

before(async () => {
  payload = await getPayload({ config })
  await payload.db.migrate()
})

/**
 * Prepare Payload's pool for the database being dropped under it.
 *
 * The adapter keeps one connection checked out for its whole life (with its
 * own error listener), so `pool.end()` would wait forever. Its idle
 * connections, though, report a forced disconnect on the pool, which has no
 * error listener of its own; unhandled, that event fails the test run after
 * the fact. A dropped database is exactly what this suite wants to cause, so
 * the error is expected and swallowed here.
 */
const closePayload = async (): Promise<void> => {
  const adapter = payload?.db as unknown as
    | {
        destroy?: () => Promise<void>
        pool?: { on: (event: 'error', listener: () => void) => void }
      }
    | undefined
  adapter?.pool?.on('error', () => undefined)
  await adapter?.destroy?.()
}

after(async () => {
  try {
    await closePayload()
  } finally {
    await dropFreshDatabase()
    await maintenance.end()
  }
})

describe('fresh install (production policy)', () => {
  it('the migrated database has no verified administrator', async () => {
    assert.equal(await countVerified(), 0)
  })

  it('the presence probe reports absent and the boot check refuses', async () => {
    const probe = createDatabaseProbe(freshUrl.toString())
    assert.deepEqual(await probe(), { kind: 'absent' })

    const refusals: RefusalEvent[] = []
    const watch = createAdministratorWatch({
      probe,
      refuse: (event) => refusals.push(event),
    })
    assert.equal(await watch.start(), false)
    assert.equal(refusals[0]?.phase, 'boot')
    assert.equal(refusals[0]?.reason, 'absent')
  })

  it('a create with access overrides and no signed-in user is refused', async () => {
    await assert.rejects(
      payload.create({
        collection: 'users',
        data: accountData('no-user'),
        overrideAccess: true,
      }),
      (error) => statusOf(error) === 403,
    )
    assert.equal(await countVerified(), 0)
  })

  it('an anonymous create through access control is refused', async () => {
    await assert.rejects(
      payload.create({
        collection: 'users',
        data: accountData('anonymous'),
        overrideAccess: false,
      }),
      (error) => statusOf(error) === 403,
    )
    assert.equal(await countVerified(), 0)
  })

  it('a context that merely looks like the bootstrap marker is refused', async () => {
    await assert.rejects(
      payload.create({
        collection: 'users',
        data: accountData('forged'),
        overrideAccess: true,
        context: { 'sazejchytre.admin-bootstrap': true, adminBootstrap: true },
      }),
      (error) => statusOf(error) === 403,
    )
  })
})

describe('private initialization and an existing administrator', () => {
  let owner: { id: number | string }

  it('the initialization path creates the first administrator', async () => {
    owner = await payload.create({
      collection: 'users',
      data: accountData('owner'),
      overrideAccess: true,
      context: bootstrapContext(),
      depth: 0,
    })
    assert.equal(await countVerified(), 1)

    const login = await payload.login({
      collection: 'users',
      data: { email: accountData('owner').email, password: PASSWORD },
    })
    assert.equal(String(login.user?.id), String(owner.id))
  })

  it('the probe and the boot check now pass', async () => {
    const probe = createDatabaseProbe(freshUrl.toString())
    assert.deepEqual(await probe(), { kind: 'present', count: 1 })

    const refusals: RefusalEvent[] = []
    const watch = createAdministratorWatch({
      probe,
      refuse: (event) => refusals.push(event),
    })
    assert.equal(await watch.start(), true)
    watch.stop()
    assert.equal(refusals.length, 0)
  })

  it('the initialization path refuses once an administrator exists', async () => {
    await assert.rejects(
      payload.create({
        collection: 'users',
        data: accountData('second-bootstrap'),
        overrideAccess: true,
        context: bootstrapContext(),
      }),
      (error) => statusOf(error) === 409,
    )
    assert.equal(await countVerified(), 1)
  })

  it('two concurrent initializations on an empty table create exactly one', async () => {
    await sqlOnFresh('DELETE FROM "users"')
    assert.equal(await countVerified(), 0)

    const results = await Promise.allSettled(
      ['race-a', 'race-b'].map((label) =>
        payload.create({
          collection: 'users',
          data: accountData(label),
          overrideAccess: true,
          context: bootstrapContext(),
          depth: 0,
        }),
      ),
    )
    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')
    assert.equal(fulfilled.length, 1)
    assert.equal(rejected.length, 1)
    assert.equal(statusOf((rejected[0] as PromiseRejectedResult).reason), 409)
    assert.equal(await countVerified(), 1)

    owner = (fulfilled[0] as PromiseFulfilledResult<{ id: number }>).value
  })

  it('an administrator may create another administrator', async () => {
    const second = await payload.create({
      collection: 'users',
      data: accountData('second'),
      overrideAccess: false,
      user: asAdministrator(owner),
      depth: 0,
    })
    assert.ok(second.id)
    assert.equal(await countVerified(), 2)
  })
})

describe('removal of administrators through Payload', () => {
  const ids = async (): Promise<(number | string)[]> =>
    (
      await payload.find({
        collection: 'users',
        overrideAccess: true,
        pagination: false,
        depth: 0,
      })
    ).docs.map((doc) => doc.id)

  it('one of two may be removed; the last one may not', async () => {
    const [first, second] = await ids()
    assert.ok(first !== undefined && second !== undefined)

    await payload.delete({
      collection: 'users',
      id: first,
      overrideAccess: true,
    })
    assert.equal(await countVerified(), 1)

    await assert.rejects(
      payload.delete({ collection: 'users', id: second, overrideAccess: true }),
      (error) => statusOf(error) === 409,
    )
    assert.equal(await countVerified(), 1)
  })

  it('two concurrent removals of the last two leave exactly one', async () => {
    const [remaining] = await ids()
    await payload.create({
      collection: 'users',
      data: accountData('concurrent'),
      overrideAccess: false,
      user: asAdministrator({ id: remaining as number }),
      depth: 0,
    })
    const both = await ids()
    assert.equal(both.length, 2)

    const results = await Promise.allSettled(
      both.map((id) =>
        payload.delete({ collection: 'users', id, overrideAccess: true }),
      ),
    )
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
    assert.equal(await countVerified(), 1)
  })

  it('a bulk delete of every administrator leaves exactly one', async () => {
    const [remaining] = await ids()
    for (const label of ['bulk-a', 'bulk-b']) {
      await payload.create({
        collection: 'users',
        data: accountData(label),
        overrideAccess: false,
        user: asAdministrator({ id: remaining as number }),
        depth: 0,
      })
    }
    assert.equal(await countVerified(), 3)

    const result = await payload.delete({
      collection: 'users',
      where: { id: { exists: true } },
      overrideAccess: true,
    })
    assert.equal(result.docs.length, 2)
    assert.equal(result.errors.length, 1)
    assert.equal(await countVerified(), 1)
  })

  it('a record that cannot sign in does not count, and does not block removal', async () => {
    await sqlOnFresh(
      `INSERT INTO "users" ("name", "email") VALUES ('no credentials', '${RUN}-nocreds@example.test')`,
    )
    assert.equal(await countVerified(), 1)

    const { docs } = await payload.find({
      collection: 'users',
      where: { email: { equals: `${RUN}-nocreds@example.test` } },
      overrideAccess: true,
      depth: 0,
    })
    const target = docs[0]
    assert.ok(target)
    await payload.delete({
      collection: 'users',
      id: target.id,
      overrideAccess: true,
    })
    assert.equal(await countVerified(), 1)
  })
})

describe('removal outside Payload while the server is running', () => {
  it(`the running check refuses within ${ABSENCE_WINDOW_MS} ms of the last administrator being removed`, async () => {
    assert.equal(await countVerified(), 1)

    let refusedAt: number | undefined
    let refusal: RefusalEvent | undefined
    const refused = new Promise<void>((resolve) => {
      const watch = createAdministratorWatch({
        // Real probe, real timer, default interval: the stated window.
        probe: createDatabaseProbe(freshUrl.toString()),
        refuse: (event) => {
          refusedAt = Date.now()
          refusal = event
          resolve()
        },
      })
      void watch.start().then((ok) => assert.equal(ok, true))
    })

    // Let at least one interval check pass first.
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    const removedAt = Date.now()
    await sqlOnFresh('DELETE FROM "users"')

    await Promise.race([
      refused,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('the check did not refuse in time')),
          ABSENCE_WINDOW_MS + 2_000,
        ),
      ),
    ])

    assert.equal(refusal?.phase, 'running')
    assert.equal(refusal?.reason, 'absent')
    assert.ok(refusedAt !== undefined)
    const elapsed = refusedAt - removedAt
    assert.ok(
      elapsed <= ABSENCE_WINDOW_MS,
      `refused after ${elapsed} ms, window is ${ABSENCE_WINDOW_MS} ms`,
    )
  })
})

describe('restoring an empty database', () => {
  it('a database replaced underneath the running check is refused', async () => {
    // Back to a state with an administrator, then start watching.
    await payload.create({
      collection: 'users',
      data: accountData('restore'),
      overrideAccess: true,
      context: bootstrapContext(),
      depth: 0,
    })
    assert.equal(await countVerified(), 1)

    let refusal: RefusalEvent | undefined
    const refused = new Promise<void>((resolve) => {
      const watch = createAdministratorWatch({
        probe: createDatabaseProbe(freshUrl.toString()),
        refuse: (event) => {
          refusal = event
          resolve()
        },
      })
      void watch.start()
    })
    await new Promise((resolve) => setTimeout(resolve, 500))

    // Replace the database with an empty one under the same name, as a
    // restore of an empty dump onto a recreated database would.
    await closePayload()
    await dropFreshDatabase()
    await createFreshDatabase()

    await Promise.race([
      refused,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('the check did not refuse in time')),
          ABSENCE_WINDOW_MS + 2_000,
        ),
      ),
    ])

    assert.equal(refusal?.phase, 'running')
    assert.ok(
      refusal?.reason === 'schema-missing' || refusal?.reason === 'absent',
      `reason ${refusal?.reason}`,
    )
  })

  it('a boot against the empty restored database refuses', async () => {
    const refusals: RefusalEvent[] = []
    const watch = createAdministratorWatch({
      probe: createDatabaseProbe(freshUrl.toString()),
      refuse: (event) => refusals.push(event),
    })
    assert.equal(await watch.start(), false)
    assert.equal(refusals[0]?.reason, 'schema-missing')
  })
})
