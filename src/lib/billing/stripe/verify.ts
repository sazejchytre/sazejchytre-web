/**
 * Webhook signature verification.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE RAW BODY, AND ONLY THE RAW BODY
 *
 * The signature is an HMAC over the exact bytes Stripe sent. Parsing the body
 * to JSON and re-serialising it produces a different byte string — different
 * key order, different whitespace, different unicode escaping — and the
 * signature then fails for every single event. This is the classic way to
 * break a webhook endpoint, and the symptom is indistinguishable from a wrong
 * secret, so it costs an afternoon to find.
 *
 * In the App Router that means `await request.text()` BEFORE anything else
 * touches the body, and never `request.json()`. A `Request` body can only be
 * consumed once, so the order is not a style preference.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY VERIFY AT ALL
 *
 * The endpoint is a public URL that grants subscriptions. Without
 * verification, anyone who learns the path can POST a handcrafted
 * `invoice.paid` and give themselves a free subscription — or post a
 * `charge.dispute.created` and suspend somebody else's. The signature is the
 * only thing that makes the payload trustworthy; everything downstream treats
 * it as authenticated, so there is no safe path that skips this.
 *
 * There is deliberately no "skip verification in development" branch. A
 * `stripe listen` secret works locally, so the escape hatch would buy nothing
 * and would eventually ship.
 */
import Stripe from 'stripe'

export type SignatureFailureReason =
  'MISSING_SIGNATURE' | 'INVALID_SIGNATURE' | 'MALFORMED_EVENT'

export type SignatureVerification =
  | { ok: true; event: Stripe.Event }
  | { ok: false; reason: SignatureFailureReason; detail: string }

/**
 * How much clock skew to tolerate, in seconds.
 *
 * Stripe's own default. The timestamp is part of the signed payload, so this
 * is what stops a captured request being replayed days later — which matters
 * because an attacker who records one legitimate `invoice.paid` could
 * otherwise resend it forever. Five minutes is long enough for real clock
 * drift between Stripe and a serverless host and short enough that a captured
 * body is stale almost immediately.
 *
 * Note that the event claim gives a second, independent layer here: even a
 * replay inside the tolerance window is a no-op.
 */
export const SIGNATURE_TOLERANCE_SECONDS = 300

export type VerifyStripeWebhookArgs = {
  /** The exact bytes received. Never a re-serialised object. */
  rawBody: string
  /** The `stripe-signature` request header. */
  signatureHeader: string | null
  secret: string
  toleranceSeconds?: number
  /**
   * Injected clock for the tolerance check, in epoch MILLISECONDS.
   *
   * Milliseconds, not seconds: the SDK divides this by 1000 before comparing
   * it with the signed timestamp, so passing seconds makes every request look
   * like it arrived in 1970 and the tolerance check silently never fires.
   */
  receivedAt?: number
}

/**
 * Verify and parse an event.
 *
 * Returns a result rather than throwing: the caller has to answer the HTTP
 * request either way, and an unverified request is an expected condition on a
 * public endpoint — scanners find it — not an exceptional one.
 */
export const verifyStripeWebhook = ({
  rawBody,
  signatureHeader,
  secret,
  toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS,
  receivedAt,
}: VerifyStripeWebhookArgs): SignatureVerification => {
  if (!signatureHeader) {
    return {
      ok: false,
      reason: 'MISSING_SIGNATURE',
      detail: 'no stripe-signature header',
    }
  }

  try {
    // `Stripe.webhooks` is a static on the SDK: verification needs the
    // endpoint secret, not an API key. Which is useful beyond tidiness — it
    // means this function, and the tests that drive it, work with no
    // credentials configured at all.
    const event = Stripe.webhooks.constructEvent(
      rawBody,
      signatureHeader,
      secret,
      toleranceSeconds,
      undefined,
      receivedAt,
    )

    // A verified payload is authentic but not necessarily shaped as expected.
    // Everything downstream indexes `event.type` and `event.data.object`, so
    // check them here rather than letting a handler read undefined.
    if (
      typeof event.id !== 'string' ||
      typeof event.type !== 'string' ||
      typeof event.created !== 'number' ||
      typeof event.data?.object !== 'object'
    ) {
      return {
        ok: false,
        reason: 'MALFORMED_EVENT',
        detail: 'verified payload is not a Stripe event',
      }
    }

    return { ok: true, event }
  } catch (error) {
    // The message names the signature scheme and timestamps, never the
    // secret, so it is safe to carry. It is still only logged, never returned
    // to the caller: telling an attacker whether the timestamp or the digest
    // was wrong is free help.
    return {
      ok: false,
      reason: 'INVALID_SIGNATURE',
      detail: error instanceof Error ? error.message : 'verification failed',
    }
  }
}

/**
 * Sign a payload the way Stripe would.
 *
 * For tests and local fixtures only. Exported from here rather than
 * duplicated in a test helper so that fixtures are signed by exactly the code
 * path that verifies them — a hand-rolled HMAC in a test can agree with
 * itself while disagreeing with Stripe.
 */
export const signStripePayloadForTests = (
  rawBody: string,
  secret: string,
  timestampSeconds?: number,
): string =>
  Stripe.webhooks.generateTestHeaderString({
    payload: rawBody,
    secret,
    ...(timestampSeconds === undefined ? {} : { timestamp: timestampSeconds }),
  })
