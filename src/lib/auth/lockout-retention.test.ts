import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  LOCKOUT_RETENTION_DAYS,
  isExpiredLockout,
  lockoutRetentionCutoff,
  partitionLockoutsByRetention,
} from './lockout-retention.ts'

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = new Date('2026-10-15T12:00:00.000Z')

describe('lockoutRetentionCutoff', () => {
  it('defaults to 90 days', () => {
    assert.equal(LOCKOUT_RETENTION_DAYS, 90)
    assert.equal(
      lockoutRetentionCutoff(NOW).toISOString(),
      new Date(NOW.getTime() - 90 * DAY_MS).toISOString(),
    )
  })

  it('honours a shorter window', () => {
    assert.equal(
      lockoutRetentionCutoff(NOW, 30).toISOString(),
      new Date(NOW.getTime() - 30 * DAY_MS).toISOString(),
    )
  })

  it('refuses a nonsensical window rather than deleting everything', () => {
    // A zero or negative window would put the cutoff at or after `now` and
    // sweep the entire table. Better to refuse than to be briefly obedient.
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      assert.throws(
        () => lockoutRetentionCutoff(NOW, bad),
        RangeError,
        String(bad),
      )
    }
  })
})

describe('isExpiredLockout', () => {
  it('keeps a record inside the window', () => {
    const record = { createdAt: new Date(NOW.getTime() - 89 * DAY_MS) }

    assert.equal(isExpiredLockout(record, NOW), false)
  })

  it('sweeps a record past the window', () => {
    const record = { createdAt: new Date(NOW.getTime() - 91 * DAY_MS) }

    assert.equal(isExpiredLockout(record, NOW), true)
  })

  it('keeps a record exactly on the boundary', () => {
    // The cutoff is exclusive, so a record created exactly 90 days ago stays
    // one more pass. Being off by one in the keeping direction is harmless.
    const record = { createdAt: new Date(NOW.getTime() - 90 * DAY_MS) }

    assert.equal(isExpiredLockout(record, NOW), false)
  })

  it('accepts an ISO string as well as a Date', () => {
    assert.equal(
      isExpiredLockout(
        { createdAt: new Date(NOW.getTime() - 120 * DAY_MS).toISOString() },
        NOW,
      ),
      true,
    )
  })

  it('keeps a record whose timestamp cannot be read', () => {
    // Failing to parse must not destroy the row. Keeping it leaves the defect
    // visible; deleting it hides both the data and the bug.
    assert.equal(isExpiredLockout({ createdAt: 'not-a-date' }, NOW), false)
  })
})

describe('partitionLockoutsByRetention', () => {
  it('splits a mixed set', () => {
    const records = [
      { id: 1, createdAt: new Date(NOW.getTime() - 200 * DAY_MS) },
      { id: 2, createdAt: new Date(NOW.getTime() - 91 * DAY_MS) },
      { id: 3, createdAt: new Date(NOW.getTime() - 10 * DAY_MS) },
      { id: 4, createdAt: NOW },
    ]

    const { keep, sweep } = partitionLockoutsByRetention(records, NOW)

    assert.deepEqual(
      sweep.map((r) => r.id),
      [1, 2],
    )
    assert.deepEqual(
      keep.map((r) => r.id),
      [3, 4],
    )
  })

  it('handles an empty table', () => {
    const { keep, sweep } = partitionLockoutsByRetention([], NOW)

    assert.equal(keep.length, 0)
    assert.equal(sweep.length, 0)
  })

  it('loses nothing — every record lands in exactly one bucket', () => {
    const records = Array.from({ length: 50 }, (_, index) => ({
      id: index,
      createdAt: new Date(NOW.getTime() - index * 5 * DAY_MS),
    }))

    const { keep, sweep } = partitionLockoutsByRetention(records, NOW)

    assert.equal(keep.length + sweep.length, records.length)
    assert.equal(
      new Set([...keep, ...sweep].map((r) => r.id)).size,
      records.length,
    )
  })
})
