import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  DEFAULT_LAUNCH_MODE,
  GATED_SURFACES,
  LAUNCH_MODES,
  isLaunchMode,
  isSurfaceOpen,
  resolveLaunchMode,
} from './modes.ts'

describe('launch modes', () => {
  it('declares exactly the three modes, narrowest first', () => {
    assert.deepEqual([...LAUNCH_MODES], ['PRIVATE', 'INFORMATIONAL', 'FULL'])
  })

  it('defaults to the narrowest mode', () => {
    assert.equal(DEFAULT_LAUNCH_MODE, 'PRIVATE')
  })

  it('accepts each mode by its exact name', () => {
    for (const mode of LAUNCH_MODES) {
      assert.equal(isLaunchMode(mode), true)
      assert.equal(resolveLaunchMode(mode), mode)
    }
  })

  it('maps every value that is not exactly a mode to PRIVATE', () => {
    const invalid: unknown[] = [
      undefined,
      null,
      '',
      ' ',
      'full',
      'Full',
      ' FULL',
      'FULL ',
      'FULL\n',
      'informational',
      'PUBLIC',
      'ON',
      'true',
      '1',
      1,
      true,
      {},
      ['FULL'],
    ]

    for (const value of invalid) {
      assert.equal(isLaunchMode(value), false, `isLaunchMode(${String(value)})`)
      assert.equal(resolveLaunchMode(value), 'PRIVATE', String(value))
    }
  })

  it('opens exactly the surfaces each mode promises', () => {
    const matrix = Object.fromEntries(
      LAUNCH_MODES.map((mode) => [
        mode,
        GATED_SURFACES.filter((surface) => isSurfaceOpen(mode, surface)),
      ]),
    )

    assert.deepEqual(matrix, {
      PRIVATE: [],
      INFORMATIONAL: ['public'],
      FULL: ['public', 'accounts', 'payments'],
    })
  })

  it('makes each mode a superset of the one before it', () => {
    for (let index = 1; index < LAUNCH_MODES.length; index += 1) {
      const narrower = LAUNCH_MODES[index - 1]
      const wider = LAUNCH_MODES[index]

      for (const surface of GATED_SURFACES) {
        if (isSurfaceOpen(narrower, surface)) {
          assert.equal(
            isSurfaceOpen(wider, surface),
            true,
            `${wider}/${surface}`,
          )
        }
      }
    }
  })

  it('opens nothing for an invalid mode', () => {
    for (const surface of GATED_SURFACES) {
      assert.equal(isSurfaceOpen('full', surface), false)
      assert.equal(isSurfaceOpen(undefined, surface), false)
    }
  })
})
