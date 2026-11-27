import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import type * as EnvModule from './env.ts'
import { PLACEHOLDER_ENV } from './launch-gate/test-fixtures.ts'

/**
 * `LAUNCH_MODE` as `env.ts` validates it at boot.
 *
 * `env.ts` parses `process.env` at module load, so each case imports a fresh
 * instance of the module (a distinct query string is a distinct module to
 * the ESM loader). Its dependencies are pure and safe to share.
 */

let snapshot: NodeJS.ProcessEnv
let counter = 0

const loadEnv = async (launchMode: string | undefined) => {
  if (launchMode === undefined) {
    delete process.env.LAUNCH_MODE
  } else {
    process.env.LAUNCH_MODE = launchMode
  }

  counter += 1
  const loaded = (await import(
    `./env.ts?launch-mode-case=${counter}`
  )) as typeof EnvModule

  return loaded.env
}

beforeEach(() => {
  snapshot = { ...process.env }
  Object.assign(process.env, PLACEHOLDER_ENV)
})

afterEach(() => {
  process.env = snapshot
})

describe('LAUNCH_MODE in env.ts', () => {
  it('defaults to PRIVATE when the variable is absent', async () => {
    assert.equal((await loadEnv(undefined)).LAUNCH_MODE, 'PRIVATE')
  })

  it('accepts each mode by its exact name', async () => {
    for (const mode of ['PRIVATE', 'INFORMATIONAL', 'FULL']) {
      assert.equal((await loadEnv(mode)).LAUNCH_MODE, mode)
    }
  })

  it('fails the boot for any other value, without echoing it', async () => {
    for (const value of [
      '',
      'full',
      'FULL ',
      ' FULL',
      'PUBLIC',
      'on',
      'true',
    ]) {
      await assert.rejects(
        loadEnv(value),
        (error: unknown) => {
          assert.ok(error instanceof Error)
          assert.match(error.message, /LAUNCH_MODE/)
          // Only the variable name and the reason are printed, never the value.
          if (value.trim() !== '') {
            assert.equal(error.message.includes(`"${value}"`), false)
          }
          return true
        },
        JSON.stringify(value),
      )
    }
  })
})
