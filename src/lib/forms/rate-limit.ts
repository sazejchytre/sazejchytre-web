/**
 * Rate limiting for the PUBLIC forms. Not the auth limiter.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT `enforceRateLimit`
 *
 * Two reasons, and the first is a bug waiting to happen.
 *
 * 1. THE AUTH LIMITER CONSULTS THE ACCOUNT LOCKOUT. It reads the lock key for
 *    the identifier it is given and refuses if the account is locked. Pass a
 *    contact form's submitted email through it and somebody who has just
 *    locked themselves out by mistyping a password three times would also be
 *    unable to use the contact form — unable to ask for help with the exact
 *    problem they have. The two systems share a key space and must not share
 *    a decision.
 *
 * 2. THEY WANT OPPOSITE BEHAVIOUR WHEN REDIS IS DOWN. See below.
 *
 * Keys live under a separate prefix (`sch:form`) so the buckets cannot
 * collide with auth's even by accident.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THIS ONE FAILS OPEN, AND THAT IS DELIBERATE
 *
 * The auth limiter fails closed, because a Redis outage there is an
 * unlimited, unmonitored password-guessing window and a denied sign-in is the
 * cheaper mistake.
 *
 * Here the arithmetic runs the other way:
 *
 *   - failing closed means a customer cannot reach support during an outage.
 *     The contact form IS the support channel, and the person most likely to
 *     be using it is the person something has already gone wrong for.
 *   - failing open means some spam gets through during an outage — and only
 *     spam that has already solved a Turnstile challenge, because Turnstile
 *     is verified server-side and is NOT optional. The rate limit here is
 *     defence in depth against a flood from a solved challenge, not the
 *     primary bot defence.
 *
 * So an outage degrades to "Turnstile only", which is still a real control.
 * It is logged at error level, because a limiter that is quietly off is worth
 * knowing about.
 */
import { createHmac } from 'node:crypto'

// Only the vocabulary, never the credentials. `redisPipeline` reads the
// environment, so it is imported lazily inside the default below — which is
// what keeps this module, and its test, loadable with no environment at all.
import { RedisUnavailableError, windowBucket } from '../redis/upstash.ts'

const KEY_PREFIX = 'sch:form'

export type FormRateLimitRule = {
  /** Submissions permitted per window. */
  limit: number
  /** Window length in seconds. */
  windowSeconds: number
}

/**
 * Budgets for the public forms, by IP and by target.
 *
 * Deliberately looser than the auth budgets. A rate limit on a contact form
 * is not doing cryptographic work — nothing is being guessed — so the only
 * job is to stop a flood. A number low enough to catch a real person who
 * sends two messages and then spots a typo would cost more than it saves.
 *
 * "Target" means the address being written about: the submitted email for the
 * contact form, the subscribed address for the newsletter. Counting it stops
 * one address being used to mailbomb a third party through our notification.
 */
export const FORM_RATE_LIMITS = {
  contact: {
    ip: { limit: 5, windowSeconds: 60 * 60 },
    target: { limit: 3, windowSeconds: 60 * 60 },
  },
  newsletter: {
    ip: { limit: 5, windowSeconds: 60 * 60 },
    target: { limit: 2, windowSeconds: 24 * 60 * 60 },
  },
} as const satisfies Record<
  string,
  { ip: FormRateLimitRule; target: FormRateLimitRule }
>

export type FormAction = keyof typeof FORM_RATE_LIMITS

/**
 * Hash a value before it becomes a Redis key.
 *
 * Redis is a separate service with its own access surface; there is no reason
 * for it to hold readable email addresses or client IPs. Same reasoning and
 * same secret as the auth limiter, but a different prefix is mixed in so the
 * two never produce the same digest for the same address — a form bucket must
 * not be inferable from an auth bucket or the other way round.
 */
const keyHash = (value: string): string => {
  // Read at call time, not at import time. A bare `process.env` rather than
  // the validated `env` module for the same reason: this module has to be
  // loadable without a full environment so the pure tests can exercise the
  // key shape and the fail-open path, neither of which needs a real Redis.
  const secret = process.env.BETTER_AUTH_SECRET

  if (!secret) {
    // Not a silent fallback. A constant salt would still produce working
    // keys, so nothing would look broken — while Redis quietly held buckets
    // that anyone with the source could map back to an email address.
    throw new Error(
      'BETTER_AUTH_SECRET is not set; refusing to hash form rate-limit keys ' +
        'with a guessable salt.',
    )
  }

  return createHmac('sha256', secret)
    .update(`${KEY_PREFIX}:${value.trim().toLowerCase()}`)
    .digest('base64url')
    .slice(0, 24)
}

const windowKey = (
  action: string,
  dimension: 'ip' | 'target',
  value: string,
  windowSeconds: number,
  now: number,
): string =>
  `${KEY_PREFIX}:rl:${action}:${dimension}:${value}:${String(windowBucket(now, windowSeconds))}`

export type FormLimitOutcome =
  | { allowed: true; degraded: boolean }
  | { allowed: false; retryAfterSeconds: number }

/** The transport, narrowed to what this module uses. */
export type RedisPipeline = (
  commands: readonly (readonly string[])[],
) => Promise<unknown[]>

export type FormLimitContext = {
  action: FormAction
  /** Client address, already extracted from the request headers. */
  ip: string | null
  /** The address being written about, or null when there is none yet. */
  target: string | null
  now?: Date
  /** Injected so a test can observe the degraded path without a Redis. */
  pipeline?: RedisPipeline
  /** Injected so a test can assert the outage is reported. */
  onDegraded?: (error: unknown) => void
}

/**
 * The real transport, imported on first use.
 *
 * Dynamic because `client.ts` reads credentials at module scope and this
 * module must stay loadable without them.
 */
const defaultPipeline: RedisPipeline = async (commands) => {
  const { redisPipeline } = await import('../redis/client.ts')

  return redisPipeline(commands)
}

/**
 * Count this submission against both budgets.
 *
 * Returns rather than throws: a form action has to render a message either
 * way, and an exception for an expected outcome would mean every call site
 * wrapping it in a try block to do the same thing.
 *
 * `degraded: true` means the limit could not be applied and the submission is
 * being allowed on Turnstile alone. Call BEFORE doing the work.
 */
export const enforceFormRateLimit = async ({
  action,
  ip,
  target,
  now = new Date(),
  pipeline = defaultPipeline,
  onDegraded,
}: FormLimitContext): Promise<FormLimitOutcome> => {
  const rules = FORM_RATE_LIMITS[action]
  const millis = now.getTime()

  // An absent IP is one shared bucket rather than "unlimited". Behind a proxy
  // that strips the header, that is the safe reading.
  const ipValue = keyHash(ip ?? 'unknown')
  const ipKey = windowKey(action, 'ip', ipValue, rules.ip.windowSeconds, millis)

  const commands: string[][] = [
    ['INCR', ipKey],
    ['EXPIRE', ipKey, String(rules.ip.windowSeconds), 'NX'],
  ]

  const targetValue = target ? keyHash(target) : null

  if (targetValue) {
    const targetKey = windowKey(
      action,
      'target',
      targetValue,
      rules.target.windowSeconds,
      millis,
    )

    commands.push(
      ['INCR', targetKey],
      ['EXPIRE', targetKey, String(rules.target.windowSeconds), 'NX'],
    )
  }

  let results: unknown[]

  try {
    results = await pipeline(commands)
  } catch (error) {
    if (error instanceof RedisUnavailableError) {
      // FAIL OPEN. See the note at the top — Turnstile still stands, and the
      // alternative is a customer who cannot reach support.
      onDegraded?.(error)

      return { allowed: true, degraded: true }
    }

    throw error
  }

  if (Number(results[0] ?? 0) > rules.ip.limit) {
    return { allowed: false, retryAfterSeconds: rules.ip.windowSeconds }
  }

  if (targetValue && Number(results[2] ?? 0) > rules.target.limit) {
    return { allowed: false, retryAfterSeconds: rules.target.windowSeconds }
  }

  return { allowed: true, degraded: false }
}
