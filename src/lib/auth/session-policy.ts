/**
 * Session lifetime policy.
 *
 * THREE DURATIONS, THREE DIFFERENT JOBS
 *
 *  - DEFAULT (7 days) and REMEMBERED (30 days) are the initial lifetime. Which
 *    one applies is decided per sign-in by the "zapamatovat si mě" checkbox,
 *    NOT by an account setting. That distinction matters: the choice belongs to
 *    the device, so ticking it on a phone must not silently extend the session
 *    on a shared desktop.
 *
 *  - SLIDING (`REFRESH_AFTER`) is how often activity pushes the expiry out.
 *    Without it an active customer is signed out mid-use; with it a session
 *    that keeps being used keeps living.
 *
 *  - ABSOLUTE MAXIMUM (90 days from creation) is the backstop. Sliding expiry
 *    on its own means a session that is touched once a week never dies, which
 *    turns a stolen cookie into permanent access. The absolute cap guarantees
 *    every session ends, so re-authentication eventually happens whatever the
 *    activity pattern.
 *
 * `clampExpiry` is the function that reconciles the last two, and it is pure
 * so the interaction is testable without a database or a clock.
 */

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Default session lifetime, in seconds (better-auth works in seconds). */
export const SESSION_DEFAULT_SECONDS = 7 * 24 * 60 * 60

/** Lifetime when "zapamatovat si mě" is ticked, in seconds. */
export const SESSION_REMEMBERED_SECONDS = 30 * 24 * 60 * 60

/**
 * How often an active session's expiry is pushed out, in seconds.
 *
 * One day: frequent enough that a daily visitor never gets logged out, rare
 * enough that we are not writing to the session row on every request.
 */
export const SESSION_REFRESH_AFTER_SECONDS = 24 * 60 * 60

/**
 * Hard ceiling on the age of any session, in milliseconds.
 *
 * Measured from creation, never extended. A session is dead at
 * `createdAt + SESSION_ABSOLUTE_MAX_MS` no matter how recently it was used.
 */
export const SESSION_ABSOLUTE_MAX_MS = 90 * DAY

/** How long a 2FA challenge may sit unfinished, in seconds. */
export const TWO_FACTOR_CHALLENGE_SECONDS = 10 * 60

/** How long a freshly-proved password stays "fresh" for sensitive actions. */
export const FRESH_AGE_SECONDS = 10 * 60

/**
 * Decide the expiry a session may actually have.
 *
 * Takes the lifetime the caller wants and the moment the session was created,
 * and returns the earlier of "now + requested" and the absolute ceiling. This
 * is what stops sliding expiry from producing an immortal session.
 *
 * @param now current time
 * @param createdAt when the session was first created
 * @param requestedLifetimeMs how far out the caller wants to push expiry
 * @returns the expiry to store
 */
export const clampExpiry = (
  now: Date,
  createdAt: Date,
  requestedLifetimeMs: number,
): Date => {
  const requested = now.getTime() + requestedLifetimeMs
  const ceiling = createdAt.getTime() + SESSION_ABSOLUTE_MAX_MS

  return new Date(Math.min(requested, ceiling))
}

/**
 * Has this session outlived the absolute maximum?
 *
 * Checked on read as well as on refresh. A row whose `expiresAt` was written
 * before the cap existed, or by a code path that bypassed the clamp, must
 * still be refused.
 */
export const isBeyondAbsoluteMax = (now: Date, createdAt: Date): boolean =>
  now.getTime() >= createdAt.getTime() + SESSION_ABSOLUTE_MAX_MS

/** Lifetime in milliseconds for a sign-in, by remember-me choice. */
export const lifetimeForSignIn = (rememberMe: boolean): number =>
  (rememberMe ? SESSION_REMEMBERED_SECONDS : SESSION_DEFAULT_SECONDS) * SECOND
