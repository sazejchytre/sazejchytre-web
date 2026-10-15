import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  FAILURE_WINDOW_SECONDS,
  LOCKOUT_STEPS,
  RATE_LIMITS,
  lockSecondsForFailures,
} from './rate-limit-policy.ts'

describe('budgets', () => {
  it('covers every endpoint the brief names', () => {
    for (const action of [
      'signIn',
      'signUp',
      'passwordResetRequest',
      'verificationResend',
      'totpVerify',
      'backupCodeVerify',
    ] as const) {
      assert.ok(RATE_LIMITS[action], `${action} has no budget`)
    }
  })

  it('limits by IP and by account separately for every endpoint', () => {
    // Either dimension alone is broken: IP-only lets a botnet grind one
    // account, account-only lets an attacker lock a victim out of their own.
    for (const [action, rule] of Object.entries(RATE_LIMITS)) {
      assert.ok(rule.ip.limit > 0, `${action} has no IP budget`)
      assert.ok(rule.account.limit > 0, `${action} has no account budget`)
      assert.ok(rule.ip.windowSeconds > 0, `${action} IP window`)
      assert.ok(rule.account.windowSeconds > 0, `${action} account window`)
    }
  })

  it('gives the account a budget no looser than the IP', () => {
    // One address legitimately serves many people (a household, an office),
    // so the IP budget is the looser of the two.
    for (const [action, rule] of Object.entries(RATE_LIMITS)) {
      assert.ok(
        rule.account.limit <= rule.ip.limit,
        `${action}: account ${rule.account.limit} exceeds IP ${rule.ip.limit}`,
      )
    }
  })

  it('keeps the TOTP budget tightest — the code is only ~20 bits', () => {
    assert.ok(RATE_LIMITS.totpVerify.account.limit <= 5)
    assert.ok(RATE_LIMITS.totpVerify.account.windowSeconds <= 10 * 60)
  })

  it('leaves room for someone who mistypes a password', () => {
    assert.ok(RATE_LIMITS.signIn.account.limit >= 3)
  })
})

describe('progressive lockout', () => {
  it('does not lock before the first threshold', () => {
    assert.equal(lockSecondsForFailures(0), 0)
    assert.equal(lockSecondsForFailures(4), 0)
  })

  it('escalates at each threshold', () => {
    assert.equal(lockSecondsForFailures(5), 60)
    assert.equal(lockSecondsForFailures(8), 5 * 60)
    assert.equal(lockSecondsForFailures(12), 30 * 60)
    assert.equal(lockSecondsForFailures(20), 4 * 60 * 60)
  })

  it('is monotonic — more failures never means a shorter lock', () => {
    let previous = 0

    for (let failures = 0; failures <= 40; failures += 1) {
      const current = lockSecondsForFailures(failures)

      assert.ok(
        current >= previous,
        `lock shortened at ${failures}: ${current} < ${previous}`,
      )
      previous = current
    }
  })

  it('holds the longest lock beyond the last threshold', () => {
    const last = LOCKOUT_STEPS[LOCKOUT_STEPS.length - 1]

    assert.ok(last)
    assert.equal(lockSecondsForFailures(1000), last.lockSeconds)
  })

  it('forgets failures after a day of quiet', () => {
    // Otherwise someone who mistypes five times across a year is locked out.
    assert.equal(FAILURE_WINDOW_SECONDS, 24 * 60 * 60)
  })
})
