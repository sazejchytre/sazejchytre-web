/**
 * The public-form limiter, including the two things that distinguish it from
 * the auth one: it fails OPEN, and it never consults an account lockout.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { RedisUnavailableError } from '../redis/upstash.ts'
import {
  FORM_RATE_LIMITS,
  enforceFormRateLimit,
  type FormAction,
} from './rate-limit.ts'

/** A pipeline double that answers with the counts it is told to. */
const answering = (...counts: number[]) => {
  const seen: (readonly string[])[][] = []

  return {
    seen,
    pipeline: async (commands: readonly (readonly string[])[]) => {
      seen.push([...commands])

      // INCR, EXPIRE, INCR, EXPIRE — the EXPIREs answer with anything.
      return [counts[0] ?? 1, 1, counts[1] ?? 1, 1]
    },
  }
}

const unavailable = async (): Promise<unknown[]> => {
  throw new RedisUnavailableError('down for the test')
}

const NOW = new Date('2026-11-05T10:00:00.000Z')

// The key hash is salted with this. Set here rather than mocked: the hashing
// is the behaviour under test in two of the cases below, and a stub would
// prove nothing about it.
process.env.BETTER_AUTH_SECRET ??= 'test-only-salt-not-a-real-secret-000000'

describe('enforceFormRateLimit', () => {
  it('allows a submission inside both budgets', async () => {
    const { pipeline } = answering(1, 1)

    const outcome = await enforceFormRateLimit({
      action: 'contact',
      ip: '203.0.113.4',
      target: 'zakaznik@example.test',
      now: NOW,
      pipeline,
    })

    assert.deepEqual(outcome, { allowed: true, degraded: false })
  })

  it('refuses when the IP budget is exhausted', async () => {
    const { pipeline } = answering(FORM_RATE_LIMITS.contact.ip.limit + 1, 1)

    const outcome = await enforceFormRateLimit({
      action: 'contact',
      ip: '203.0.113.4',
      target: 'zakaznik@example.test',
      now: NOW,
      pipeline,
    })

    assert.deepEqual(outcome, {
      allowed: false,
      retryAfterSeconds: FORM_RATE_LIMITS.contact.ip.windowSeconds,
    })
  })

  it('refuses when the TARGET budget is exhausted', async () => {
    // Counting the target is what stops one address being used to mailbomb a
    // third party through our notification email.
    const { pipeline } = answering(1, FORM_RATE_LIMITS.contact.target.limit + 1)

    const outcome = await enforceFormRateLimit({
      action: 'contact',
      ip: '203.0.113.4',
      target: 'zakaznik@example.test',
      now: NOW,
      pipeline,
    })

    assert.deepEqual(outcome, {
      allowed: false,
      retryAfterSeconds: FORM_RATE_LIMITS.contact.target.windowSeconds,
    })
  })

  it('treats a missing IP as one shared bucket, not as unlimited', async () => {
    const { pipeline, seen } = answering(1, 1)

    await enforceFormRateLimit({
      action: 'contact',
      ip: null,
      target: null,
      now: NOW,
      pipeline,
    })

    const key = String(seen[0]?.[0]?.[1])

    // A key was still built and still counted. Behind a proxy that strips the
    // header, "no IP" must not mean "no limit".
    assert.match(key, /^sch:form:rl:contact:ip:/)
  })

  it('counts only the IP when there is no target yet', async () => {
    const { pipeline, seen } = answering(1)

    await enforceFormRateLimit({
      action: 'newsletter',
      ip: '203.0.113.4',
      target: null,
      now: NOW,
      pipeline,
    })

    assert.equal(seen[0]?.length, 2, 'INCR and EXPIRE for the IP only')
  })

  /* ---------------------------------------------------------------------- */

  it('FAILS OPEN when Redis is unreachable, and says it is degraded', async () => {
    const reported: unknown[] = []

    const outcome = await enforceFormRateLimit({
      action: 'contact',
      ip: '203.0.113.4',
      target: 'zakaznik@example.test',
      now: NOW,
      pipeline: unavailable,
      onDegraded: (error) => reported.push(error),
    })

    // The opposite of the auth limiter, on purpose. Failing closed here would
    // stop a customer reaching support during an outage, and Turnstile still
    // stands in front of the form.
    assert.deepEqual(outcome, { allowed: true, degraded: true })

    // Degraded, not silent. A limiter that is quietly off is worth knowing.
    assert.equal(reported.length, 1)
    assert.ok(reported[0] instanceof RedisUnavailableError)
  })

  it('rethrows a fault that is not a Redis outage', async () => {
    // A programming error must not be swallowed by the fail-open path, or a
    // bug in the key builder would read as "Redis is down" forever.
    await assert.rejects(
      () =>
        enforceFormRateLimit({
          action: 'contact',
          ip: '203.0.113.4',
          target: null,
          now: NOW,
          pipeline: async () => {
            throw new TypeError('a real bug')
          },
        }),
      TypeError,
    )
  })

  /* ---------------------------------------------------------------------- */

  it('keys under its own prefix, never the auth one', async () => {
    const { pipeline, seen } = answering(1, 1)

    await enforceFormRateLimit({
      action: 'contact',
      ip: '203.0.113.4',
      target: 'zakaznik@example.test',
      now: NOW,
      pipeline,
    })

    for (const command of seen[0] ?? []) {
      const key = String(command[1])

      assert.ok(
        key.startsWith('sch:form:'),
        `${key} is outside the form prefix`,
      )
      assert.ok(
        !key.startsWith('sch:auth:'),
        'a form submission must never touch an auth bucket',
      )
    }
  })

  it('never reads a lock key', async () => {
    // THE BUG THIS PREVENTS: the auth limiter reads the account's lock key, so
    // routing a contact form through it would mean somebody locked out of
    // their account could not ask for help with being locked out.
    const { pipeline, seen } = answering(1, 1)

    await enforceFormRateLimit({
      action: 'contact',
      ip: '203.0.113.4',
      target: 'zakaznik@example.test',
      now: NOW,
      pipeline,
    })

    for (const command of seen[0] ?? []) {
      assert.ok(
        !String(command[1]).includes(':lock:'),
        'the form limiter must not consult the auth lockout',
      )
      assert.ok(
        command[0] !== 'TTL',
        'a TTL read is how the auth limiter checks the lockout',
      )
    }
  })

  it('hashes the address rather than keying on it', async () => {
    const { pipeline, seen } = answering(1, 1)
    const email = 'zakaznik@example.test'

    await enforceFormRateLimit({
      action: 'contact',
      ip: '203.0.113.4',
      target: email,
      now: NOW,
      pipeline,
    })

    for (const command of seen[0] ?? []) {
      assert.ok(
        !String(command[1]).includes(email),
        'Redis must not hold readable customer addresses',
      )
      assert.ok(!String(command[1]).includes('203.0.113.4'))
    }
  })

  it('puts every action in the budget table', () => {
    // So that adding a form without a budget is a type error rather than an
    // unlimited endpoint.
    const actions: FormAction[] = ['contact', 'newsletter']

    for (const action of actions) {
      assert.ok(FORM_RATE_LIMITS[action], `${action} has no budget`)
      assert.ok(FORM_RATE_LIMITS[action].ip.limit > 0)
      assert.ok(FORM_RATE_LIMITS[action].target.limit > 0)
    }
  })
})
