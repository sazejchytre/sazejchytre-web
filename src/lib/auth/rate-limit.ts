/**
 * Rate limiting for the authentication endpoints.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY TWO KEYS PER REQUEST
 *
 * Every limited action is counted twice: once against the client IP and once
 * against the target account. Limiting by only one of them is broken in a
 * different way each time:
 *
 *   - IP only: a botnet with a thousand addresses gets a thousand times the
 *     budget against one victim's password.
 *   - ACCOUNT only: an attacker who knows your email can burn your budget
 *     from anywhere and lock you out of your own account. That turns a rate
 *     limit into a denial-of-service tool pointed at the customer.
 *
 * Counting both, with separate budgets, means neither attack works: the IP
 * budget stops distributed guessing against one account, and the account
 * budget stops one address grinding through many accounts — while a legitimate
 * customer who mistypes a password three times is nowhere near either.
 *
 * The account key is a HASH of the identifier, never the address itself, so
 * Redis never holds a list of our customers' email addresses.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * FAIL CLOSED
 *
 * If Redis is unreachable, authentication endpoints DENY. This is a real
 * decision with a real cost, and it is the right way round:
 *
 *   - Failing open turns one Redis outage into an unlimited, unmonitored
 *     password-guessing window. An attacker who can cause or simply wait for
 *     an outage gets exactly the conditions they want.
 *   - Failing closed makes sign-in unavailable during an outage. That is
 *     visible, loud, and recoverable — and it is the same blast radius as the
 *     database being down, which already takes sign-in with it.
 *
 * So the cost of failing closed is bounded by an outage we would notice
 * anyway, and the cost of failing open is unbounded and silent. Non-auth
 * paths are not rate limited through this module and are unaffected.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * IMPLEMENTATION
 *
 * A fixed-window counter in Redis via the Upstash REST API: `INCR` the window
 * key, and `EXPIRE` it on first use. Two round trips are avoided by pipelining
 * them into one request.
 *
 * A fixed window is slightly less smooth than a sliding log — a burst can
 * straddle a boundary and briefly get up to twice the budget. For credential
 * stuffing that difference is irrelevant (the budgets are single digits) and a
 * fixed window costs one integer per key instead of a sorted set, so it is
 * what we use. No extra dependency either: the Upstash REST endpoint is plain
 * HTTP.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

import { env } from '../env.ts'
import {
  FAILURE_WINDOW_SECONDS,
  RATE_LIMITS,
  type RateLimitedAction,
  lockSecondsForFailures,
} from './rate-limit-policy.ts'

export {
  FAILURE_WINDOW_SECONDS,
  LOCKOUT_STEPS,
  RATE_LIMITS,
  type RateLimitRule,
  type RateLimitedAction,
  lockSecondsForFailures,
} from './rate-limit-policy.ts'

/* -------------------------------------------------------------------------- */
/* Budgets                                                                    */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

/** Thrown when a limit is hit, or when the limiter itself is unavailable. */
export class RateLimitedError extends Error {
  readonly code = 'RATE_LIMITED'
  /** Seconds until the caller may retry. */
  readonly retryAfterSeconds: number
  /** True when the limiter was unreachable and we denied rather than guessed. */
  readonly failedClosed: boolean

  constructor(retryAfterSeconds: number, failedClosed = false) {
    super(
      failedClosed
        ? 'Ověřovací služba je momentálně nedostupná. Zkuste to prosím za chvíli.'
        : 'Příliš mnoho pokusů. Zkuste to prosím později.',
    )
    this.name = 'RateLimitedError'
    this.retryAfterSeconds = retryAfterSeconds
    this.failedClosed = failedClosed
  }
}

/** Thrown when the account is in a lockout window. */
export class AccountLockedError extends Error {
  readonly code = 'ACCOUNT_LOCKED'
  readonly retryAfterSeconds: number

  constructor(retryAfterSeconds: number) {
    super('Účet je po opakovaných neúspěšných pokusech dočasně uzamčen.')
    this.name = 'AccountLockedError'
    this.retryAfterSeconds = retryAfterSeconds
  }
}

/* -------------------------------------------------------------------------- */
/* Keys                                                                       */
/* -------------------------------------------------------------------------- */

const KEY_PREFIX = 'sch:auth'

/**
 * Hash an account identifier before it becomes a Redis key.
 *
 * Redis is a separate service with its own access surface; there is no reason
 * for it to hold readable customer email addresses.
 */
export const accountKeyHash = (identifier: string): string =>
  createHmac('sha256', env.BETTER_AUTH_SECRET)
    .update(identifier.trim().toLowerCase())
    .digest('base64url')
    .slice(0, 24)

const windowKey = (
  action: string,
  dimension: 'ip' | 'account',
  value: string,
  windowSeconds: number,
  now: number,
): string => {
  const bucket = Math.floor(now / 1000 / windowSeconds)

  return `${KEY_PREFIX}:rl:${action}:${dimension}:${value}:${bucket}`
}

const failureKey = (value: string): string => `${KEY_PREFIX}:fail:${value}`
const lockKey = (value: string): string => `${KEY_PREFIX}:lock:${value}`

/* -------------------------------------------------------------------------- */
/* Upstash REST transport                                                     */
/* -------------------------------------------------------------------------- */

/** How long we wait on Redis before treating it as unreachable. */
const REDIS_TIMEOUT_MS = 2_000

class RedisUnavailableError extends Error {}

/**
 * Run a pipeline of Redis commands.
 *
 * @throws {RedisUnavailableError} on any transport, timeout or protocol fault.
 *   Callers translate that into a closed door, never into "allowed".
 */
const pipeline = async (commands: string[][]): Promise<unknown[]> => {
  let response: Response

  try {
    response = await fetch(`${env.UPSTASH_REDIS_REST_URL}/pipeline`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(REDIS_TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch (cause) {
    throw new RedisUnavailableError('Upstash request failed', { cause })
  }

  if (!response.ok) {
    throw new RedisUnavailableError(`Upstash responded ${response.status}`)
  }

  let body: unknown

  try {
    body = await response.json()
  } catch (cause) {
    throw new RedisUnavailableError('Upstash returned invalid JSON', { cause })
  }

  if (!Array.isArray(body)) {
    throw new RedisUnavailableError('Upstash returned an unexpected shape')
  }

  return body.map((entry) => {
    const item = entry as { result?: unknown; error?: unknown }

    if (item?.error) {
      throw new RedisUnavailableError(String(item.error))
    }

    return item?.result
  })
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

export type RateLimitContext = {
  action: RateLimitedAction
  /** Client address, already extracted from the request. */
  ip: string | null
  /** The account being acted on — an email address, or null when unknown. */
  identifier: string | null
  /** Injected clock, for tests. */
  now?: Date
}

/**
 * Count this attempt against both budgets and the lockout, or refuse.
 *
 * Call BEFORE doing the work. On refusal nothing has been attempted, so a
 * refusal is safe to surface directly to the caller.
 *
 * @throws {AccountLockedError} the account is in a lockout window.
 * @throws {RateLimitedError} a budget is exhausted, or Redis is unreachable.
 */
export const enforceRateLimit = async ({
  action,
  ip,
  identifier,
  now = new Date(),
}: RateLimitContext): Promise<void> => {
  const rules = RATE_LIMITS[action]
  const millis = now.getTime()

  // An absent IP is treated as one shared bucket rather than as "unlimited".
  // Behind a proxy that strips the header, that is the safe reading.
  const ipValue = ip ? accountKeyHash(ip) : 'unknown'
  const accountValue = identifier ? accountKeyHash(identifier) : null

  const commands: string[][] = [
    ['INCR', windowKey(action, 'ip', ipValue, rules.ip.windowSeconds, millis)],
    [
      'EXPIRE',
      windowKey(action, 'ip', ipValue, rules.ip.windowSeconds, millis),
      String(rules.ip.windowSeconds),
      'NX',
    ],
  ]

  if (accountValue) {
    commands.push(
      [
        'INCR',
        windowKey(
          action,
          'account',
          accountValue,
          rules.account.windowSeconds,
          millis,
        ),
      ],
      [
        'EXPIRE',
        windowKey(
          action,
          'account',
          accountValue,
          rules.account.windowSeconds,
          millis,
        ),
        String(rules.account.windowSeconds),
        'NX',
      ],
      ['TTL', lockKey(accountValue)],
    )
  }

  let results: unknown[]

  try {
    results = await pipeline(commands)
  } catch (error) {
    if (error instanceof RedisUnavailableError) {
      // FAIL CLOSED. See the note at the top of this file.
      throw new RateLimitedError(30, true)
    }

    throw error
  }

  const ipCount = Number(results[0] ?? 0)

  if (ipCount > rules.ip.limit) {
    throw new RateLimitedError(rules.ip.windowSeconds)
  }

  if (accountValue) {
    const accountCount = Number(results[2] ?? 0)
    const lockTtl = Number(results[4] ?? -2)

    // A positive TTL on the lock key means the account is locked right now.
    if (lockTtl > 0) {
      throw new AccountLockedError(lockTtl)
    }

    if (accountCount > rules.account.limit) {
      throw new RateLimitedError(rules.account.windowSeconds)
    }
  }
}

export type FailureOutcome = {
  /** Consecutive failures recorded for this account. */
  failures: number
  /** Seconds the account is now locked for, or 0 if not locked. */
  lockedForSeconds: number
}

/**
 * Record a failed attempt and apply the escalating lock.
 *
 * Returns what happened so the caller can persist a support-visible record.
 * Unlike `enforceRateLimit` this does NOT fail closed: a Redis outage must not
 * turn a wrong password into an error that looks like a locked account, and
 * the door is already closed by `enforceRateLimit` in that case.
 */
export const recordAuthFailure = async (
  identifier: string,
): Promise<FailureOutcome> => {
  const account = accountKeyHash(identifier)

  try {
    const [failuresRaw] = await pipeline([
      ['INCR', failureKey(account)],
      ['EXPIRE', failureKey(account), String(FAILURE_WINDOW_SECONDS)],
    ])

    const failures = Number(failuresRaw ?? 0)
    const lockSeconds = lockSecondsForFailures(failures)

    if (lockSeconds > 0) {
      await pipeline([
        ['SET', lockKey(account), String(failures), 'EX', String(lockSeconds)],
      ])
    }

    return { failures, lockedForSeconds: lockSeconds }
  } catch (error) {
    if (error instanceof RedisUnavailableError) {
      return { failures: 0, lockedForSeconds: 0 }
    }

    throw error
  }
}

/** Clear the failure counter and any lock. Called after a successful auth. */
export const clearAuthFailures = async (identifier: string): Promise<void> => {
  const account = accountKeyHash(identifier)

  try {
    await pipeline([
      ['DEL', failureKey(account)],
      ['DEL', lockKey(account)],
    ])
  } catch (error) {
    if (!(error instanceof RedisUnavailableError)) {
      throw error
    }
  }
}

/** Current lock state, for the support view. */
export const lockoutStatus = async (
  identifier: string,
): Promise<{
  locked: boolean
  retryAfterSeconds: number
  failures: number
}> => {
  const account = accountKeyHash(identifier)

  try {
    const [ttl, failures] = await pipeline([
      ['TTL', lockKey(account)],
      ['GET', failureKey(account)],
    ])

    const retryAfterSeconds = Number(ttl ?? -2)

    return {
      locked: retryAfterSeconds > 0,
      retryAfterSeconds: retryAfterSeconds > 0 ? retryAfterSeconds : 0,
      failures: Number(failures ?? 0),
    }
  } catch (error) {
    if (error instanceof RedisUnavailableError) {
      return { locked: false, retryAfterSeconds: 0, failures: 0 }
    }

    throw error
  }
}

/**
 * Constant-time string comparison, for comparing tokens we hold both sides of.
 *
 * Re-exported from here so call sites in the auth flow do not reach for `===`
 * on a secret.
 */
export const safeEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a)
  const right = Buffer.from(b)

  if (left.length !== right.length) {
    return false
  }

  return timingSafeEqual(left, right)
}

/* -------------------------------------------------------------------------- */
/* Single-use guard for TOTP codes                                            */
/* -------------------------------------------------------------------------- */

/**
 * Claim a TOTP code so it cannot be replayed inside its validity window.
 *
 * TOTP accepts a code for its whole period plus the skew window, so the same
 * six digits are valid for roughly 90 seconds. Without this, an attacker who
 * observes one code — over someone's shoulder, from a phished page, from a
 * logged request — can reuse it until the window closes.
 *
 * `SET key NX EX` is the claim: the first caller gets `OK`, every later one
 * gets nil. Keyed on the user and the code, with a TTL that covers the window.
 *
 * Fails CLOSED: if Redis is unreachable we cannot prove the code is unused, so
 * the verification is refused.
 *
 * @returns true when this caller owns the code.
 */
export const claimTotpCode = async (
  userId: string,
  code: string,
  windowSeconds = 120,
): Promise<boolean> => {
  const key = `${KEY_PREFIX}:totp:${accountKeyHash(`${userId}:${code}`)}`

  try {
    const [result] = await pipeline([
      ['SET', key, '1', 'NX', 'EX', String(windowSeconds)],
    ])

    return result === 'OK'
  } catch (error) {
    if (error instanceof RedisUnavailableError) {
      return false
    }

    throw error
  }
}
