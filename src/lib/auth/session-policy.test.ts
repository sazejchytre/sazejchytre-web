import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  SESSION_ABSOLUTE_MAX_MS,
  SESSION_DEFAULT_SECONDS,
  SESSION_REFRESH_AFTER_SECONDS,
  SESSION_REMEMBERED_SECONDS,
  clampExpiry,
  isBeyondAbsoluteMax,
  lifetimeForSignIn,
} from './session-policy.ts'

const DAY_MS = 24 * 60 * 60 * 1000
const at = (iso: string) => new Date(iso)

describe('session lifetimes', () => {
  it('is 7 days by default', () => {
    assert.equal(SESSION_DEFAULT_SECONDS, 7 * 24 * 60 * 60)
    assert.equal(lifetimeForSignIn(false), 7 * DAY_MS)
  })

  it('is 30 days when remember-me is ticked', () => {
    assert.equal(SESSION_REMEMBERED_SECONDS, 30 * 24 * 60 * 60)
    assert.equal(lifetimeForSignIn(true), 30 * DAY_MS)
  })

  it('refreshes at most once a day', () => {
    assert.equal(SESSION_REFRESH_AFTER_SECONDS, 24 * 60 * 60)
  })

  it('caps every session at 90 days from creation', () => {
    assert.equal(SESSION_ABSOLUTE_MAX_MS, 90 * DAY_MS)
  })
})

describe('clampExpiry', () => {
  it('grants the full lifetime to a fresh session', () => {
    const now = at('2026-06-01T00:00:00.000Z')

    assert.equal(
      clampExpiry(now, now, lifetimeForSignIn(false)).toISOString(),
      '2026-06-08T00:00:00.000Z',
    )
    assert.equal(
      clampExpiry(now, now, lifetimeForSignIn(true)).toISOString(),
      '2026-07-01T00:00:00.000Z',
    )
  })

  it('slides the expiry forward on later activity', () => {
    const createdAt = at('2026-06-01T00:00:00.000Z')
    const now = at('2026-06-05T00:00:00.000Z')

    // Four days in, a default session still gets a full week from now.
    assert.equal(
      clampExpiry(now, createdAt, lifetimeForSignIn(false)).toISOString(),
      '2026-06-12T00:00:00.000Z',
    )
  })

  it('refuses to slide past the absolute ceiling', () => {
    // THE point of the function. An 89-day-old remembered session asking for
    // another 30 days gets one more day, not thirty — otherwise a session that
    // is touched weekly never dies and a stolen cookie is permanent access.
    const createdAt = at('2026-01-01T00:00:00.000Z')
    const now = new Date(createdAt.getTime() + 89 * DAY_MS)

    const expiry = clampExpiry(now, createdAt, lifetimeForSignIn(true))

    assert.equal(
      expiry.getTime(),
      createdAt.getTime() + SESSION_ABSOLUTE_MAX_MS,
      'expiry must land exactly on the ceiling',
    )
    assert.equal(expiry.getTime() - now.getTime(), DAY_MS)
  })

  it('never returns an expiry beyond the ceiling, for any request', () => {
    const createdAt = at('2026-01-01T00:00:00.000Z')
    const ceiling = createdAt.getTime() + SESSION_ABSOLUTE_MAX_MS

    for (const dayOffset of [0, 1, 45, 89, 90, 120]) {
      const now = new Date(createdAt.getTime() + dayOffset * DAY_MS)
      const expiry = clampExpiry(now, createdAt, 365 * DAY_MS)

      assert.ok(
        expiry.getTime() <= ceiling,
        `day ${dayOffset}: ${expiry.toISOString()} exceeded the ceiling`,
      )
    }
  })
})

describe('isBeyondAbsoluteMax', () => {
  it('is false inside the window and true outside it', () => {
    const createdAt = at('2026-01-01T00:00:00.000Z')

    assert.equal(
      isBeyondAbsoluteMax(
        new Date(createdAt.getTime() + 89 * DAY_MS),
        createdAt,
      ),
      false,
    )
    assert.equal(
      isBeyondAbsoluteMax(
        new Date(createdAt.getTime() + 90 * DAY_MS),
        createdAt,
      ),
      true,
    )
    assert.equal(
      isBeyondAbsoluteMax(
        new Date(createdAt.getTime() + 400 * DAY_MS),
        createdAt,
      ),
      true,
    )
  })

  it('is checked on read as well as on refresh', () => {
    // A row written before the cap existed, or by a path that skipped the
    // clamp, still has to be refused. This is why the predicate exists
    // separately from clampExpiry.
    const createdAt = at('2020-01-01T00:00:00.000Z')

    assert.equal(isBeyondAbsoluteMax(new Date(), createdAt), true)
  })
})
