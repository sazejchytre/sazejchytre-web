/**
 * Redis vocabulary with NO credentials attached.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THE ERROR AND THE BUCKET LIVE APART FROM THE TRANSPORT
 *
 * `client.ts` reads `UPSTASH_REDIS_REST_URL` and a token, so importing it
 * drags the whole validated server environment in. Anything that merely needs
 * to RECOGNISE an outage — a limiter's policy, and every test of one — would
 * then need a full environment to do it, and the pure test suite has none by
 * design.
 *
 * So the two halves split along the line that matters: this file is what a
 * policy needs, `client.ts` is what a request needs.
 */

/**
 * Any transport, timeout or protocol fault talking to Redis.
 *
 * Deliberately NOT an "allowed" or "denied" signal. Each policy decides what
 * an outage means for it, and the two in this codebase decide opposite
 * things: auth fails closed, public forms fail open. Baking either answer in
 * here would silently impose it on the other.
 */
export class RedisUnavailableError extends Error {
  readonly code = 'REDIS_UNAVAILABLE'

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'RedisUnavailableError'
  }
}

/**
 * The fixed-window bucket a moment falls into.
 *
 * A fixed window is slightly less smooth than a sliding log — a burst can
 * straddle a boundary and briefly get up to twice the budget. For the budgets
 * in this codebase that is irrelevant, and a fixed window costs one integer
 * per key instead of a sorted set.
 */
export const windowBucket = (now: number, windowSeconds: number): number =>
  Math.floor(now / 1000 / windowSeconds)
