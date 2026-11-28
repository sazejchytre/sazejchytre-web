/** Owner-run lifecycle checks on an exclusively assigned, migrated fixture DB. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { test } from 'node:test'
import pg from 'pg'
import {
  disposableTarget,
  openDisposableDatabase,
} from './disposable-database.ts'
import { disposeDatabase } from './dispose-database.ts'
import { readProtectedTriggers } from './trigger-state.ts'

test('unmarked targets refuse fixture writes and disposal; interrupted retirement rolls back', async () => {
  const app = disposableTarget(process.env.DATABASE_URL)
  const owner = disposableTarget(process.env.DISPOSABLE_OWNER_URL)
  const database = app.pathname.slice(1)
  const maintenance = process.env.DISPOSABLE_MAINTENANCE_DATABASE
  assert.equal(owner.host, app.host)
  assert.equal(owner.pathname, app.pathname)
  assert.equal(process.env.DISPOSABLE_DROP_DATABASE, database)
  assert.ok(maintenance && maintenance !== database)
  const guard = await openDisposableDatabase(app.href)
  const admin = new pg.Client({ connectionString: owner.href })
  let snapshot
  try {
    await admin.connect()
    const identity =
      await admin.query(`SELECT current_database() AS db, session_user AS login,
      pg_catalog.pg_get_userbyid(datdba) AS owner FROM pg_catalog.pg_database WHERE datname = current_database()`)
    assert.deepEqual(identity.rows, [
      {
        db: database,
        login: decodeURIComponent(owner.username),
        owner: decodeURIComponent(owner.username),
      },
    ])
    snapshot = await readProtectedTriggers(guard)
    await assert.rejects(
      openDisposableDatabase(owner.href),
      /restricted application role/,
    )
    await admin.query(`COMMENT ON DATABASE "${database}" IS NULL`)
    try {
      const { seedTips } = await import('../../seed/tips.ts')
      await assert.rejects(seedTips(), /disposable marker/)
      await assert.rejects(
        disposeDatabase(owner.href, database, maintenance),
        /disposable marker/,
      )
    } finally {
      await admin.query(
        `COMMENT ON DATABASE "${database}" IS 'sazejchytre:disposable:v1:${database}'`,
      )
    }
  } finally {
    await admin.end()
    await guard.end()
  }

  // Pause the real purge entry point at its commit boundary in a child only.
  // Reaching COMMIT proves PostgreSQL already accepted and verified the rename.
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '--eval',
      `
    import pg from 'pg'
    const query = pg.Client.prototype.query
    pg.Client.prototype.query = function (statement, ...args) {
      if (typeof statement === 'string' && statement.startsWith('DROP DATABASE')) {
        throw new Error('Unexpected drop in interruption test.')
      }
      if (statement === 'COMMIT') {
        process.send('retirement pending')
        return new Promise(() => {})
      }
      return query.call(this, statement, ...args)
    }
    await import('./src/scripts/seed-tips.ts')
  `,
    ],
    {
      env: { ...process.env, DATABASE_URL: owner.href, SEED_PURGE: '1' },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    },
  )
  const exited = once(child, 'exit')
  try {
    const [message] = await Promise.race([
      once(child, 'message', { signal: AbortSignal.timeout(60000) }),
      exited.then(() => {
        throw new Error('Retirement exited before COMMIT.')
      }),
    ])
    assert.equal(message, 'retirement pending')
  } finally {
    child.kill('SIGKILL')
    await exited
  }
  const restored = await openDisposableDatabase(app.href)
  try {
    assert.deepEqual(await readProtectedTriggers(restored), snapshot)
  } finally {
    await restored.end()
  }
})
