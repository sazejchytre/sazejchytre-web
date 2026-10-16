import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  FIELD_RELOCATION_VERSION,
  apiVersionDate,
  compareApiVersions,
  isPreRelocationVersion,
} from './api-version.ts'

describe('apiVersionDate', () => {
  it('extracts the date from a versioned codename', () => {
    assert.equal(apiVersionDate('2025-11-17.clover'), '2025-11-17')
    assert.equal(apiVersionDate('2026-09-30.endive'), '2026-09-30')
  })

  it('accepts a bare date', () => {
    assert.equal(apiVersionDate('2024-06-20'), '2024-06-20')
  })

  it('returns null rather than guessing', () => {
    for (const value of [null, undefined, '', 'clover', 'v2', '2026-9-3']) {
      assert.equal(apiVersionDate(value), null, String(value))
    }
  })
})

describe('compareApiVersions', () => {
  it('orders by date, ignoring the codename', () => {
    // The codenames are not alphabetically ordered — basil < clover < endive
    // happens to sort, but nothing guarantees the next one will.
    assert.ok(
      (compareApiVersions('2025-03-31.basil', '2025-11-17.clover') ?? 0) < 0,
    )
    assert.ok(
      (compareApiVersions('2026-09-30.endive', '2025-11-17.clover') ?? 0) > 0,
    )
    assert.equal(
      compareApiVersions('2025-11-17.clover', '2025-11-17.clover'),
      0,
    )
  })

  it('treats the same day with different codenames as equal', () => {
    assert.equal(compareApiVersions('2025-11-17.clover', '2025-11-17.other'), 0)
  })

  it('returns null when either side is unparseable', () => {
    assert.equal(compareApiVersions(null, '2025-11-17.clover'), null)
    assert.equal(compareApiVersions('2025-11-17.clover', 'nonsense'), null)
  })
})

describe('isPreRelocationVersion', () => {
  it('knows which version moved the fields', () => {
    assert.equal(FIELD_RELOCATION_VERSION, '2025-03-31.basil')
  })

  it('flags a payload older than the move', () => {
    assert.equal(isPreRelocationVersion('2024-06-20.acacia'), true)
    assert.equal(isPreRelocationVersion('2025-03-30.anything'), true)
  })

  it('does not flag the move itself or anything after it', () => {
    // The relocation version is the first one with the NEW layout, so it is
    // readable and must not be reported as a fault.
    assert.equal(isPreRelocationVersion('2025-03-31.basil'), false)
    assert.equal(isPreRelocationVersion('2025-11-17.clover'), false)
    assert.equal(isPreRelocationVersion('2026-09-30.endive'), false)
  })

  it('does not treat an unknown version as an old one', () => {
    // Absent or unparseable is not evidence of anything. Reporting it as a
    // version fault would send somebody looking for a problem that may not
    // exist.
    assert.equal(isPreRelocationVersion(null), false)
    assert.equal(isPreRelocationVersion(undefined), false)
    assert.equal(isPreRelocationVersion('nonsense'), false)
  })
})
