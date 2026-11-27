import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { openDisposableDatabase } from '../lib/testing/disposable-database.ts'
import { readProtectedTriggers } from '../lib/testing/trigger-state.ts'

// Pin the verified database for all workers, including suites with their own
// pools. The child inherits the exact URL verified by the parent.
const guard = await openDisposableDatabase(process.env.DATABASE_URL)
try {
  const before = await readProtectedTriggers(guard)
  const runner = spawn(
    process.execPath,
    [
      '--no-deprecation',
      '--import',
      'tsx',
      '--test',
      '--test-force-exit',
      'src/**/*.db-test.ts',
    ],
    { stdio: 'inherit' },
  )
  const [code] = await once(runner, 'exit')
  process.exitCode = code ?? 1
  assert.deepEqual(await readProtectedTriggers(guard), before)
  process.stdout.write(
    `Verified ${before.length} active triggers after the DB suite.\n`,
  )
} finally {
  await guard.end()
}
