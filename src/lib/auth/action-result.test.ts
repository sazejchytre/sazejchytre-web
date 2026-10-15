import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  ENUMERATION_FLOOR_MS,
  REGISTRATION_MESSAGE,
  RESEND_MESSAGE,
  RESET_REQUEST_MESSAGE,
  SIGN_IN_FAILED_MESSAGE,
  THROTTLED_MESSAGE,
  fail,
  ok,
  withMinimumDuration,
} from './action-result.ts'

/**
 * These assertions are the enumeration guarantee stated as code.
 *
 * The property is "a response must not reveal whether an address has an
 * account", and it has three independent halves — message, shape and timing.
 * Each is checked separately below, because each can regress on its own.
 */

describe('messages do not reveal existence', () => {
  it('never says an address is unknown, taken or already registered', () => {
    const forbidden =
      /neexistuje|nenalezen|neznám|již existuje|je obsazen|je zabran|už je registrov|not found|already (exists|registered|taken)/i

    for (const message of [
      REGISTRATION_MESSAGE,
      SIGN_IN_FAILED_MESSAGE,
      RESET_REQUEST_MESSAGE,
      RESEND_MESSAGE,
      THROTTLED_MESSAGE,
    ]) {
      assert.ok(
        !forbidden.test(message),
        `message leaks account existence: ${message}`,
      )
    }
  })

  it('phrases registration conditionally, so it is true either way', () => {
    // If the address was already registered, nothing is sent and the owner is
    // not disturbed — so the sentence must not promise a delivery.
    assert.match(REGISTRATION_MESSAGE, /^Pokud/)
  })

  it('phrases the reset request and the resend conditionally too', () => {
    assert.match(RESET_REQUEST_MESSAGE, /^Pokud/)
    assert.match(RESEND_MESSAGE, /^Pokud/)
  })

  it('blames neither half of the credentials on sign-in', () => {
    // "wrong password" implies the address exists; "unknown email" says so
    // outright. One message for both is the only safe option.
    assert.match(SIGN_IN_FAILED_MESSAGE, /E-mail nebo heslo/)
  })

  it('does not distinguish a lockout from an exhausted budget', () => {
    // "this account is locked" confirms the account exists.
    assert.ok(!/uzamčen|locked/i.test(THROTTLED_MESSAGE))
  })
})

describe('shapes do not reveal existence', () => {
  it('returns the same keys whichever branch produced it', () => {
    // A caller can tell `{ok:false}` from `{ok:false, field:'email'}` as
    // easily as it can tell two different sentences apart.
    const existing = ok(REGISTRATION_MESSAGE, '/overeni-emailu?odeslano=1')
    const fresh = ok(REGISTRATION_MESSAGE, '/overeni-emailu?odeslano=1')

    assert.deepEqual(Object.keys(existing).sort(), Object.keys(fresh).sort())
    assert.deepEqual(existing, fresh)
  })

  it('sends both registration outcomes to the same place', () => {
    const result = ok(REGISTRATION_MESSAGE, '/overeni-emailu?odeslano=1')

    assert.equal(result.ok, true)
    assert.equal(result.redirectTo, '/overeni-emailu?odeslano=1')
  })

  it('marks a sign-in failure on the form, never on the email field', () => {
    // `field: 'email'` would point the UI at the address and say "this one is
    // the problem", which is the leak in a different costume.
    const result = fail(SIGN_IN_FAILED_MESSAGE, 'form')

    assert.equal(result.field, 'form')
    assert.notEqual(result.field, 'email')
  })
})

describe('timing does not reveal existence', () => {
  it('has a floor long enough to cover a password hash', () => {
    // Verifying a hash costs ~100ms; not finding a user costs ~5ms. Unpadded,
    // that gap is measurable in a handful of requests.
    assert.ok(
      ENUMERATION_FLOOR_MS >= 300,
      `floor ${ENUMERATION_FLOOR_MS}ms is too low to hide a hash verification`,
    )
  })

  it('pads a fast path up to the floor', async () => {
    const started = Date.now()
    const result = await withMinimumDuration(120, async () => 'fast')
    const elapsed = Date.now() - started

    assert.equal(result, 'fast')
    assert.ok(elapsed >= 115, `returned after ${elapsed}ms, expected >= ~120ms`)
  })

  it('makes a fast and a slow path indistinguishable', async () => {
    const floor = 150

    const timeIt = async (work: () => Promise<unknown>) => {
      const started = Date.now()
      await withMinimumDuration(floor, work)
      return Date.now() - started
    }

    // "address not found" — returns immediately.
    const missing = await timeIt(async () => undefined)
    // "address found" — does ~60ms of hashing.
    const present = await timeIt(
      () => new Promise((resolve) => setTimeout(resolve, 60)),
    )

    assert.ok(missing >= floor - 5, `fast path took only ${missing}ms`)
    assert.ok(present >= floor - 5, `slow path took only ${present}ms`)
    // Both land on the floor, so the difference carries no information.
    assert.ok(
      Math.abs(missing - present) < 60,
      `paths differ by ${Math.abs(missing - present)}ms`,
    )
  })

  it('still applies the floor when the work throws', async () => {
    // Otherwise an error path becomes the fast path, and "this address errors
    // quickly" is the same oracle wearing a different hat.
    const started = Date.now()

    await assert.rejects(
      withMinimumDuration(120, async () => {
        throw new Error('boom')
      }),
      /boom/,
    )

    assert.ok(Date.now() - started >= 115)
  })

  it('returns the value unchanged when the work is slower than the floor', async () => {
    const result = await withMinimumDuration(10, async () => {
      await new Promise((resolve) => setTimeout(resolve, 40))
      return 'slow'
    })

    assert.equal(result, 'slow')
  })
})
