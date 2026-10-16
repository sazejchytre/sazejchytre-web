/**
 * Authorisation for scheduled (cron) route handlers.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT OPTIONAL
 *
 * A cron route is an ordinary HTTP endpoint. Vercel does not make it private;
 * it simply calls it on a schedule. So without a check, `/api/cron/...` is a
 * public URL that anybody who guesses it can invoke — and the first one of
 * ours deletes audit history. "Nobody knows the path" is not a control.
 *
 * Vercel presents a shared secret as `Authorization: Bearer $CRON_SECRET` on
 * scheduled invocations. That is what this verifies.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THE COMPARISON IS CONSTANT TIME
 *
 * A plain `===` on a secret leaks its length and, in principle, its content
 * through timing. The cost of doing it properly is one function call, so there
 * is no reason to compare a bearer token any other way.
 *
 * FAILS CLOSED: a missing header, a malformed header or a mismatch all deny.
 * There is no "allow in development" branch — a route that is open locally is
 * one bad deploy away from being open everywhere, and the secret is in `.env`
 * anyway so the local case costs nothing.
 */
import { timingSafeEqual } from 'node:crypto'

import { env } from '../env.ts'

export type CronAuthorization =
  | { authorized: true }
  | { authorized: false; reason: 'MISSING_HEADER' | 'MALFORMED' | 'MISMATCH' }

/** Constant-time string comparison that tolerates differing lengths. */
const safeEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')

  if (left.length !== right.length) {
    // Comparing buffers of different lengths throws, and the length is already
    // observable from the request anyway.
    return false
  }

  return timingSafeEqual(left, right)
}

/**
 * Was this request made by Vercel Cron?
 *
 * Pure apart from reading the configured secret, so the decision is testable.
 */
export const authorizeCronRequest = (
  headers: Headers,
  expectedSecret: string = env.CRON_SECRET,
): CronAuthorization => {
  const header = headers.get('authorization')

  if (!header) {
    return { authorized: false, reason: 'MISSING_HEADER' }
  }

  const [scheme, token] = header.split(' ')

  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return { authorized: false, reason: 'MALFORMED' }
  }

  return safeEqual(token, expectedSecret)
    ? { authorized: true }
    : { authorized: false, reason: 'MISMATCH' }
}

/**
 * The response for a request that is not from Vercel Cron.
 *
 * 404 rather than 401: an unauthenticated caller learns nothing about whether
 * the route exists, and a scanner gets the same answer as for any other
 * unknown path. The real caller never sees this.
 */
export const cronForbiddenResponse = (): Response =>
  new Response('Not found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
