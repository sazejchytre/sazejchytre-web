/**
 * `POST /webhooks/stripe`
 *
 * The one public endpoint that can grant a subscription. Everything it does
 * is in service of two questions: did Stripe really send this, and have we
 * already acted on it.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ORDER OF OPERATIONS, AND WHY IT IS THIS ORDER
 *
 *   1. Read the RAW body. `request.text()`, never `request.json()` — the
 *      signature is an HMAC over the exact bytes, and a body can only be
 *      consumed once, so parsing first makes verification impossible rather
 *      than merely inconvenient.
 *   2. Verify the signature. Unverified requests get 400 and nothing else
 *      happens; the payload is not parsed, logged or stored.
 *   3. Claim the event. One row per provider event id, inserted before any
 *      work, so a redelivery cannot be processed twice.
 *   4. Handle it.
 *   5. Mark the claim processed.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT STATUS CODE, AND WHY
 *
 *   400 — bad or missing signature. Stripe does not retry a 400, which is
 *         right: a signature that does not verify will not verify on a
 *         retry either.
 *   200 — verified, including events we have no handler for and events we
 *         deliberately declined to act on (stale, unattributable, not
 *         actually paid). These are all final answers. Returning 500 for an
 *         event type we simply do not handle would have Stripe retrying it
 *         with backoff for three days and then disabling the endpoint,
 *         while the real signal — "we got an event we do not understand" —
 *         sat in a log nobody was reading.
 *   500 — the handler threw. This one IS worth a retry, because the usual
 *         cause is transient: a database blip, a lock timeout, a cold start
 *         that timed out. The claim logic below deliberately allows a
 *         previously-failed event to be processed again, so Stripe's retry
 *         can actually succeed. The failure is recorded on the event row
 *         either way, so a permanently failing event is queryable rather
 *         than invisible.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * NOTHING SENSITIVE IS LOGGED
 *
 * Not the raw body, not a client secret, not the signing secret. Every log
 * line here is built from the event id, the type and our own outcome strings,
 * and anything richer goes through `redactForLog`.
 */
import type { Stripe } from 'stripe'
import configPromise from '@payload-config'
import { getPayload } from 'payload'

import { env } from '@/lib/env'
import { redactForLog } from '@/lib/billing/redact'
import { handleStripeEvent } from '@/lib/billing/stripe/webhook'
import { verifyStripeWebhook } from '@/lib/billing/stripe/verify'
import { FIELD_RELOCATION_VERSION } from '@/lib/billing/stripe/api-version'
import {
  claimWebhookEvent,
  markWebhookEventProcessed,
} from '@/lib/billing/webhook-events'

/**
 * Never cached, never prerendered.
 *
 * A cached webhook endpoint would answer the second event with the first
 * event's response and never run the handler.
 */
export const dynamic = 'force-dynamic'

/**
 * Node, not Edge.
 *
 * Signature verification uses Node's crypto synchronously. On Edge it would
 * need `constructEventAsync` and a SubtleCrypto provider, and Payload's
 * postgres adapter does not run there at all.
 */
export const runtime = 'nodejs'

/** A deliberately uninformative body: the caller is either Stripe or hostile. */
const plain = (body: string, status: number): Response =>
  new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })

export async function POST(request: Request): Promise<Response> {
  // 1. RAW BODY FIRST. Nothing above this line may touch `request.body`.
  const rawBody = await request.text()
  const signatureHeader = request.headers.get('stripe-signature')

  // 2. Verify before parsing, storing or logging any of it.
  const verification = verifyStripeWebhook({
    rawBody,
    signatureHeader,
    secret: env.STRIPE_WEBHOOK_SECRET,
  })

  const payload = await getPayload({ config: configPromise })

  if (!verification.ok) {
    // Logged with the reason but WITHOUT the body: an unverified payload is
    // attacker-controlled, and writing it to our logs is how a log viewer
    // ends up rendering someone else's content.
    payload.logger.warn(
      {
        scope: 'billing',
        event: 'webhook.signature_rejected',
        provider: 'STRIPE',
        reason: verification.reason,
        detail: verification.detail,
        bodyBytes: rawBody.length,
      },
      `Rejected an unverified Stripe webhook (${verification.reason}).`,
    )

    return plain('Invalid signature', 400)
  }

  const event: Stripe.Event = verification.event

  // 3. Claim it. The insert is the lock: exactly one caller gets `claimed`.
  const claim = await claimWebhookEvent({
    payload,
    provider: 'STRIPE',
    externalEventId: event.id,
    type: event.type,
    // Stored, not logged. The WebhookEvents collection is admin-only and this
    // is the record a later dispute gets read against.
    rawPayload: event,
  })

  if (!claim.claimed && claim.alreadyProcessed) {
    // A redelivery of an event we have already finished. THE NO-OP: no
    // handler runs, no row changes, and Stripe gets the 200 it is waiting for.
    payload.logger.info(
      {
        scope: 'billing',
        event: 'webhook.replay_ignored',
        provider: 'STRIPE',
        eventId: event.id,
        eventType: event.type,
      },
      `Ignored a replayed Stripe event (${event.type}).`,
    )

    return Response.json({ received: true, status: 'duplicate' })
  }

  // Not claimed and not processed: a previous attempt failed, or one is still
  // in flight. Processing again is the right call — Stripe's retry is the only
  // thing that will ever finish this event — and it is safe because every
  // handler is idempotent in itself, not merely protected by this claim.
  if (!claim.claimed) {
    payload.logger.warn(
      {
        scope: 'billing',
        event: 'webhook.reprocessing_failed_event',
        provider: 'STRIPE',
        eventId: event.id,
        eventType: event.type,
      },
      `Re-processing a Stripe event whose previous attempt did not finish (${event.type}).`,
    )
  }

  // 4. Handle it.
  try {
    const outcome = await handleStripeEvent({ payload, event })

    await markWebhookEventProcessed({ payload, id: claim.id })

    if (!outcome.handled) {
      // Recorded above and acknowledged here. Stripe sends hundreds of event
      // types; the ones we do not handle are not errors.
      payload.logger.info(
        {
          scope: 'billing',
          event: 'webhook.unhandled_type',
          provider: 'STRIPE',
          eventId: event.id,
          eventType: event.type,
        },
        `Recorded an unhandled Stripe event type (${event.type}).`,
      )

      return Response.json({ received: true, status: 'unhandled' })
    }

    const logLine = {
      scope: 'billing',
      event: 'webhook.handled',
      provider: 'STRIPE',
      eventId: event.id,
      eventType: event.type,
      // On EVERY event, not just failures. The version a payload was rendered
      // at is the first thing anybody asks when a handler refuses, and it is
      // not knowable from this repository — it comes from the webhook
      // endpoint or the account default, both of which live in a dashboard.
      apiVersion: event.api_version ?? null,
      applied: outcome.applied,
      ...(outcome.reason ? { reason: outcome.reason } : {}),
      ...(outcome.detail ? { detail: redactForLog(outcome.detail) } : {}),
      changes: outcome.changes,
    }

    if (outcome.unreadable) {
      // We could not READ the payload, as distinct from reading it and
      // deciding it is not ours. Almost always an API version mismatch, and
      // it affects every subscription rather than this one, so it is an alert
      // and the message says exactly what to check.
      payload.logger.error(
        logLine,
        `Could not parse a Stripe ${event.type} payload (${outcome.reason}). ` +
          `The event was rendered at API version ${event.api_version ?? 'unknown'}; ` +
          `this code reads the post-${FIELD_RELOCATION_VERSION} field layout. ` +
          'Pin the webhook endpoint to a version at or after that, or raise ' +
          "the account's default. This affects EVERY subscription event, not " +
          'just this one.',
      )
    } else if (outcome.reason === 'DISPUTE_NOT_ATTRIBUTABLE') {
      // Louder than the rest on purpose. An unattributed chargeback is money
      // on its way out with an evidence deadline attached and nobody assigned
      // to it; that deserves an alert, not an info line.
      payload.logger.error(
        logLine,
        'A Stripe chargeback could not be attributed to a customer. ' +
          'Entitlements were NOT suspended. Find the charge in the Stripe ' +
          'dashboard and record the dispute by hand.',
      )
    } else if (outcome.reason === 'DISPUTE_NOT_RECORDED') {
      // A dispute closed that we never saw open. Also an alert: it means the
      // opening event was missed, so that customer was never suspended and
      // the evidence window passed with nobody looking at it.
      payload.logger.error(
        logLine,
        'A Stripe chargeback closed that we never recorded opening. The ' +
          'customer was never suspended. Check the Stripe dashboard for the ' +
          'outcome and whether the webhook endpoint missed events.',
      )
    } else {
      payload.logger.info(
        logLine,
        `Handled Stripe event ${event.type} (applied=${String(outcome.applied)}).`,
      )
    }

    return Response.json({
      received: true,
      status: outcome.applied ? 'applied' : 'acknowledged',
      ...(outcome.reason ? { reason: outcome.reason } : {}),
    })
  } catch (error) {
    // Record the failure against the claim so the event is not silently stuck,
    // and so the next delivery is allowed to try again.
    await markWebhookEventProcessed({
      payload,
      id: claim.id,
      error: error instanceof Error ? error.message.slice(0, 500) : 'unknown',
    }).catch(() => {
      // If even this fails the database is gone; the 500 below is the signal.
    })

    payload.logger.error(
      {
        scope: 'billing',
        event: 'webhook.handler_failed',
        provider: 'STRIPE',
        eventId: event.id,
        eventType: event.type,
        error: redactForLog(error),
      },
      `Stripe webhook handler threw for ${event.type}. Returning 500 so Stripe retries.`,
    )

    return plain('Handler error', 500)
  }
}

/**
 * Anything other than POST.
 *
 * 405 rather than 404: the route exists and Stripe only ever POSTs, so a GET
 * here is a browser or a scanner and there is nothing to hide about the
 * method.
 */
export function GET(): Response {
  return plain('Method not allowed', 405)
}
