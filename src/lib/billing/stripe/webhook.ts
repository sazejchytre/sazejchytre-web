/**
 * What we do when Stripe tells us something.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE RULE THAT MATTERS MOST: AN EVENT TYPE IS NOT A RECEIPT
 *
 * `invoice.paid` does not mean an invoice was paid. `payment_intent.succeeded`
 * does not mean money arrived. `charge.refunded` does not mean a refund
 * happened. Each of them means "here is an object, and something about it
 * changed" — and the object carries the actual state in its own `status`,
 * `payment_status`, `amount_remaining` or `refunded` field.
 *
 * This is not pedantry. Events are redelivered, replayed from the dashboard,
 * sent for objects that were later voided, and in some flows fire while the
 * object is still `open` or `requires_action`. Granting access on the strength
 * of the event *type* is how a subscription service ends up serving paid
 * content to somebody whose payment never completed, and it is the specific
 * bug this module is written to make impossible: every handler below that
 * could grant anything re-reads the object's own state field first, and the
 * tests assert that a `paid`-typed event for an unpaid object changes nothing.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * IDEMPOTENCY, TWICE OVER
 *
 * The route claims every event through `claimWebhookEvent` before calling
 * this, so a redelivery never gets here. That is not enough on its own: the
 * claim protects against the same event arriving twice, not against two
 * different events that describe the same change, nor against a replay issued
 * from the dashboard with a fresh event id, nor against our own retry after a
 * partial failure. So each handler is also idempotent by itself — audit rows
 * are keyed on the source event, credit notes on the provider refund id,
 * disputes on the provider dispute id, and subscription writes go through the
 * ordering guard.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * NEVER 500
 *
 * A 500 makes Stripe retry, with backoff, for days. If the cause is a bug in
 * our handler then every retry fails too, the event queue backs up behind it,
 * and the alert that fires is "webhook endpoint failing" rather than the
 * actual fault. So an unhandled event type is recorded and acknowledged, and
 * a handler that cannot do its job returns a reason rather than throwing.
 * The route turns anything that does escape into a recorded failure and still
 * answers 200 — see `route.ts` for why that is the right trade.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * FIELDS THIS API VERSION MOVED
 *
 * Code written against an older Stripe API reads these from the wrong place
 * and gets `undefined` rather than an error:
 *
 *   - `subscription.current_period_{start,end}` → on each subscription ITEM.
 *   - `invoice.subscription` → `invoice.parent.subscription_details.subscription`.
 *   - `invoice.payment_intent` → `invoice.payments[].payment.payment_intent`.
 *
 * Each is read below through a named helper, so there is one place to fix
 * when they move again.
 */
import type Stripe from 'stripe'
import type { Payload, PayloadRequest } from 'payload'

import type {
  Currency,
  DisputeStatus,
  SubscriptionEventType,
  SubscriptionStatus,
} from '../constants.ts'
import { CURRENCIES } from '../constants.ts'
import { allocateDocumentNumber } from '../document-number.ts'
import {
  type StoredSubscriptionState,
  decideSubscriptionWrite,
  sequenceFromEventCreated,
} from '../ordering.ts'
import { redactForLog } from '../redact.ts'
import { mapStripeSubscriptionStatus } from './status.ts'
import { isUnreadableReason, translateSubscription } from './translate.ts'
import {
  FIELD_RELOCATION_VERSION,
  isPreRelocationVersion,
} from './api-version.ts'

const PROVIDER = 'STRIPE' as const

/* -------------------------------------------------------------------------- */
/* Outcome                                                                    */
/* -------------------------------------------------------------------------- */

export type StripeEventOutcome = {
  eventId: string
  eventType: string
  /** False when no handler is registered for this type. */
  handled: boolean
  /** True only when something in our database changed. */
  applied: boolean
  /**
   * Why nothing was applied. Deliberately a short machine-ish string: it is
   * logged, asserted on in tests, and must never contain customer or payment
   * detail.
   */
  reason?: string
  /** What changed, for logs and tests. */
  changes: readonly string[]
  /** Structured specifics behind `reason`. See `HandlerResult.detail`. */
  detail?: Record<string, unknown>
  /**
   * True when the refusal was "we could not read this payload" rather than
   * "this is not ours". The route logs the two at different levels, because
   * only one of them is a fault.
   */
  unreadable?: boolean
}

type HandlerResult = {
  applied: boolean
  reason?: string
  changes?: readonly string[]
  /**
   * Structured specifics for the log line.
   *
   * A reason string says WHAT was refused; this says enough to act on it
   * without a second round trip to find out. Safe to log by construction —
   * statuses, versions, currencies and counts only.
   */
  detail?: Record<string, unknown>
}

const nothing = (reason: string): HandlerResult => ({ applied: false, reason })

/* -------------------------------------------------------------------------- */
/* Field accessors for the things that moved                                  */
/* -------------------------------------------------------------------------- */

/** An expandable field as an id, whether or not it was expanded. */
const idOf = (
  value: string | { id: string } | null | undefined,
): string | null => {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && typeof value.id === 'string') {
    return value.id
  }

  return null
}

/**
 * The subscription an invoice belongs to.
 *
 * MOVED: this was `invoice.subscription`. Reading that now yields undefined,
 * so every invoice would look like a one-off payment and no renewal would
 * ever be attributed to a subscription.
 */
export const subscriptionIdOfInvoice = (
  invoice: Stripe.Invoice,
): string | null => idOf(invoice.parent?.subscription_details?.subscription)

/**
 * The payment ids that settled an invoice.
 *
 * MOVED: this was `invoice.payment_intent`. Now an invoice can have several
 * payments, each naming either a payment intent or a bare charge.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * `invoice.payments` IS EXPANDABLE, SO A WEBHOOK PAYLOAD DOES NOT HAVE IT
 *
 * Verified against a real `invoice.paid` event: the list is absent entirely
 * unless the request asked for `expand: ['payments']`. On an event payload
 * this function therefore returns `[]` — not because the invoice had no
 * payments, but because nobody expanded them.
 *
 * That makes it useless for resolving a webhook invoice to its payment, and
 * it is deliberately NOT used for that. The payment-intent and charge
 * handlers match on ids taken from their OWN payload
 * (`intent.id`, `intent.latest_charge`, `charge.id`, `charge.payment_intent`)
 * against our `invoices.providerPaymentId` column, which needs no expansion.
 *
 * It is kept for step 5b, which has to populate `providerPaymentId` when it
 * starts issuing invoices — and which will have to retrieve the invoice with
 * `expand: ['payments']` to do it, or take the id from the payment event
 * instead. An empty result here means "not expanded", not "not paid".
 */
export const paymentIdsOfInvoice = (invoice: Stripe.Invoice): string[] => {
  const ids: string[] = []

  for (const entry of invoice.payments?.data ?? []) {
    const intentId = idOf(entry.payment?.payment_intent)
    const chargeId = idOf(entry.payment?.charge)

    if (intentId) ids.push(intentId)
    if (chargeId) ids.push(chargeId)
  }

  return ids
}

/* -------------------------------------------------------------------------- */
/* Lookups in our own data                                                    */
/* -------------------------------------------------------------------------- */

type Ctx = {
  payload: Payload
  req?: PayloadRequest
  event: Stripe.Event
  now: Date
  /** Passed through to `issueCreditNoteForRefund`. See its docs. */
  allocate?: DocumentNumberAllocator
}

/** `req` spread conditionally — exactOptionalPropertyTypes rejects undefined. */
const reqOpt = (ctx: Ctx) => (ctx.req ? { req: ctx.req } : {})

type SubscriptionRow = {
  id: number | string
  status: SubscriptionStatus
  currency: Currency
  priceMinor?: number | null
  providerUpdatedAt?: string | null
  cancelAtPeriodEnd?: boolean | null
  customer: unknown
}

/**
 * Our row in the shape the ordering rule wants.
 *
 * The column is a timestamp because a timestamp is readable in the admin
 * panel and has no 2038 problem; the rule compares milliseconds. One place
 * converts, so the two representations cannot drift.
 */
const storedStateOf = (row: SubscriptionRow): StoredSubscriptionState => ({
  status: row.status,
  providerSequence: row.providerUpdatedAt
    ? new Date(row.providerUpdatedAt).getTime()
    : null,
})

const findSubscriptionRow = async (
  ctx: Ctx,
  providerSubscriptionId: string,
): Promise<SubscriptionRow | null> => {
  const found = await ctx.payload.find({
    collection: 'subscriptions',
    depth: 0,
    limit: 1,
    pagination: false,
    overrideAccess: true,
    ...reqOpt(ctx),
    where: {
      and: [
        { provider: { equals: PROVIDER } },
        { providerSubscriptionId: { equals: providerSubscriptionId } },
      ],
    },
  })

  return (found.docs[0] as SubscriptionRow | undefined) ?? null
}

/**
 * Our Plan for a provider price id.
 *
 * Needed because entitlements come from `plan.features`, not from the amount.
 * A Stripe-side plan change that updated `priceMinor` and left `plan` alone
 * would leave a customer paying for PRO while being served START — which is
 * worse than either failing or doing nothing, because it looks correct in the
 * admin and only shows up as a complaint.
 */
const findPlanForProviderPrice = async (
  ctx: Ctx,
  providerPriceId: string | null,
): Promise<number | null> => {
  if (!providerPriceId) return null

  const found = await ctx.payload.find({
    collection: 'prices',
    depth: 0,
    limit: 1,
    pagination: false,
    overrideAccess: true,
    ...reqOpt(ctx),
    where: { providerPriceId: { equals: providerPriceId } },
  })

  const price = found.docs[0] as { plan?: unknown } | undefined

  if (!price?.plan) return null

  const plan =
    typeof price.plan === 'object' && price.plan !== null
      ? (price.plan as { id: unknown }).id
      : price.plan

  return typeof plan === 'number' ? plan : Number(plan)
}

/** The invoice a provider payment settled, if we have issued one. */
const findInvoiceByPayment = async (
  ctx: Ctx,
  providerPaymentIds: readonly string[],
): Promise<{
  id: number | string
  currency: Currency
  subscription: unknown
  customer: unknown
  billingCountry?: string | null
} | null> => {
  const ids = providerPaymentIds.filter((id) => id.length > 0)

  if (ids.length === 0) return null

  const found = await ctx.payload.find({
    collection: 'invoices',
    depth: 0,
    limit: 1,
    pagination: false,
    overrideAccess: true,
    ...reqOpt(ctx),
    where: { providerPaymentId: { in: ids } },
  })

  return (found.docs[0] as never) ?? null
}

/**
 * Write the audit row for an event.
 *
 * Self-idempotent: at most ONE row per (subscription, source event).
 *
 * Keyed on the event rather than on the event plus the type, which matters
 * because the type is derived from the before/after pair: processing the same
 * event twice sees a different "before" the second time and would classify it
 * differently, so a type-aware key would let a replay through as a second row
 * of a different kind. One provider event is one thing that happened, however
 * many times it is delivered.
 */
const recordSubscriptionEvent = async (
  ctx: Ctx,
  args: {
    subscriptionId: number | string
    type: SubscriptionEventType
    occurredAt: Date
    detail?: Record<string, unknown>
  },
): Promise<boolean> => {
  const existing = await ctx.payload.find({
    collection: 'subscription-events',
    depth: 0,
    limit: 1,
    pagination: false,
    overrideAccess: true,
    ...reqOpt(ctx),
    where: {
      and: [
        { subscription: { equals: args.subscriptionId } },
        { sourceEventId: { equals: ctx.event.id } },
      ],
    },
  })

  if (existing.docs.length > 0) return false

  await ctx.payload.create({
    collection: 'subscription-events',
    overrideAccess: true,
    ...reqOpt(ctx),
    data: {
      subscription: args.subscriptionId as number,
      type: args.type,
      occurredAt: args.occurredAt.toISOString(),
      sourceEventId: ctx.event.id,
      // Redacted even here. This column is access-controlled, but the same
      // object gets logged on the way past and a payload that is safe in one
      // place and not the other is a trap for whoever reads this next.
      payload: redactForLog(args.detail ?? {}) as never,
    },
  })

  return true
}

/* -------------------------------------------------------------------------- */
/* Which audit event does a status change deserve?                            */
/* -------------------------------------------------------------------------- */

/**
 * Classify a subscription transition.
 *
 * Returns our own event vocabulary from the before/after pair rather than
 * from the Stripe event type, because Stripe sends one `updated` event for
 * everything from a recovered payment to a scheduled cancellation, and the
 * audit log is only useful if those read differently.
 */
export const classifyTransition = (
  before: { status: SubscriptionStatus; cancelAtPeriodEnd: boolean },
  after: { status: SubscriptionStatus; cancelAtPeriodEnd: boolean },
  options: {
    created?: boolean
    deleted?: boolean
    priceChanged?: boolean
  } = {},
): SubscriptionEventType => {
  if (options.created) return 'CREATED'
  if (options.deleted) return 'CANCELED'

  if (after.status === 'CANCELED' && before.status !== 'CANCELED') {
    return 'CANCELED'
  }

  if (after.status === 'EXPIRED' && before.status !== 'EXPIRED') {
    return 'EXPIRED'
  }

  if (!before.cancelAtPeriodEnd && after.cancelAtPeriodEnd) {
    return 'CANCELLATION_SCHEDULED'
  }

  if (before.cancelAtPeriodEnd && !after.cancelAtPeriodEnd) {
    return 'CANCELLATION_REVOKED'
  }

  if (before.status === 'PAST_DUE' && after.status === 'ACTIVE') {
    return 'PAYMENT_RECOVERED'
  }

  if (before.status === 'ACTIVE' && after.status === 'PAST_DUE') {
    return 'PAYMENT_FAILED'
  }

  if (before.status === 'INCOMPLETE' && after.status === 'ACTIVE') {
    return 'ACTIVATED'
  }

  if (options.priceChanged) return 'PLAN_CHANGED'

  // Something changed that we do not model. Still worth a row: the audit log
  // should show that the provider spoke, even when the answer was "nothing
  // we care about".
  return 'PROVIDER_SYNC'
}

/* -------------------------------------------------------------------------- */
/* Handlers: subscriptions                                                    */
/* -------------------------------------------------------------------------- */

const handleSubscriptionChange = async (
  ctx: Ctx,
  options: { created?: boolean; deleted?: boolean },
): Promise<HandlerResult> => {
  const subscription = ctx.event.data.object as Stripe.Subscription

  const sequence = sequenceFromEventCreated(ctx.event.created)
  const translated = translateSubscription(subscription, sequence)

  if (!translated.ok) {
    // Two very different situations, and they get two different reasons.
    //
    // A `NOT_OURS_*` refusal is correct: somebody triggered a USD fixture, or
    // another integration shares this account. An `UNREADABLE_*` refusal means
    // we could not parse the payload at all, which is almost always that the
    // webhook endpoint or the account is rendering events at an API version
    // older than the one this code reads — and that breaks EVERY
    // subscription, not just this one.
    //
    // They shared a single reason string once. That cost a round trip to
    // diagnose, so the version is now reported alongside it.
    return {
      applied: false,
      reason: translated.reason,
      detail: {
        ...translated.detail,
        eventApiVersion: ctx.event.api_version ?? null,
        codeReadsVersion: FIELD_RELOCATION_VERSION + ' or newer',
        payloadPredatesFieldMove: isPreRelocationVersion(ctx.event.api_version),
      },
    }
  }

  const incoming = translated.value

  const row = await findSubscriptionRow(ctx, subscription.id)

  if (!row) {
    // We have no row for this subscription. Normal during checkout: Stripe can
    // deliver `subscription.created` before our own request has finished
    // writing the row. Creating one here from the event would mean inventing a
    // customer and a plan link we do not have, so the right answer is to let
    // reconciliation pick it up.
    return nothing('NO_LOCAL_SUBSCRIPTION')
  }

  const before = {
    status: row.status,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd ?? false,
  }
  const after = {
    status: incoming.status,
    cancelAtPeriodEnd: incoming.cancelAtPeriodEnd,
  }

  const decision = decideSubscriptionWrite(storedStateOf(row), {
    status: incoming.status,
    sequence,
  })

  // `priceMinor` is the only signal we have that the plan moved: our row does
  // not store the provider price id, and the amount is what changes when it
  // does.
  const priceChanged = (row.priceMinor ?? null) !== incoming.priceMinor

  const type = classifyTransition(before, after, { ...options, priceChanged })

  if (!decision.apply) {
    // Record what the provider said, change nothing. The audit trail should
    // show the stale event and the fact that we recognised it as stale.
    await recordSubscriptionEvent(ctx, {
      subscriptionId: row.id,
      type: 'PROVIDER_SYNC',
      occurredAt: new Date(ctx.event.created * 1000),
      detail: {
        skipped: decision.reason,
        detail: decision.detail,
        reportedStatus: incoming.status,
      },
    })

    return nothing(`ORDERING_${decision.reason}`)
  }

  // Currency is ours and immutable: the row was created with one and a
  // provider-side change cannot be honoured. Mismatch is a reconciliation
  // problem, not something to silently overwrite.
  if (incoming.currency !== row.currency) {
    return nothing('CURRENCY_MISMATCH')
  }

  // Follow the plan, not just the amount. If the provider's price is one we
  // do not have a row for, the plan is left alone deliberately: guessing it
  // from the amount would be worse than a divergence the reconciliation
  // script will report.
  const planId = priceChanged
    ? await findPlanForProviderPrice(ctx, incoming.providerPriceId)
    : null

  await ctx.payload.update({
    collection: 'subscriptions',
    id: row.id as number,
    overrideAccess: true,
    ...reqOpt(ctx),
    data: {
      status: incoming.status,
      currentPeriodStart: incoming.currentPeriodStart.toISOString(),
      currentPeriodEnd: incoming.currentPeriodEnd.toISOString(),
      cancelAtPeriodEnd: incoming.cancelAtPeriodEnd,
      canceledAt: incoming.canceledAt?.toISOString() ?? null,
      endedAt: incoming.endedAt?.toISOString() ?? null,
      priceMinor: incoming.priceMinor,
      ...(planId === null ? {} : { plan: planId }),
      // The ordering key. Written in the same update as the data it describes,
      // so a crash between the two cannot leave a row claiming to be newer
      // than it is.
      providerUpdatedAt: new Date(sequence).toISOString(),
    },
  })

  await recordSubscriptionEvent(ctx, {
    subscriptionId: row.id,
    type,
    occurredAt: new Date(ctx.event.created * 1000),
    detail: {
      from: before.status,
      to: after.status,
      cancelAtPeriodEnd: after.cancelAtPeriodEnd,
    },
  })

  const changes = [`subscription ${before.status} -> ${after.status} (${type})`]

  if (priceChanged) {
    changes.push(
      planId === null
        ? `price ${String(row.priceMinor)} -> ${String(incoming.priceMinor)}, plan UNRESOLVED`
        : `price ${String(row.priceMinor)} -> ${String(incoming.priceMinor)}, plan ${String(planId)}`,
    )
  }

  return { applied: true, changes }
}

/* -------------------------------------------------------------------------- */
/* Handlers: invoices                                                         */
/* -------------------------------------------------------------------------- */

const handleInvoicePaid = async (ctx: Ctx): Promise<HandlerResult> => {
  const invoice = ctx.event.data.object as Stripe.Invoice

  const providerSubscriptionId = subscriptionIdOfInvoice(invoice)

  if (!providerSubscriptionId) {
    return nothing('INVOICE_NOT_FROM_SUBSCRIPTION')
  }

  const row = await findSubscriptionRow(ctx, providerSubscriptionId)

  if (!row) return nothing('NO_LOCAL_SUBSCRIPTION')

  // ─────────── THE CHECK THE EVENT TYPE DOES NOT GIVE US ───────────
  // `invoice.paid` fires for an object whose own status may be anything by
  // the time we read it, and a dashboard replay can deliver it for an invoice
  // that was subsequently voided. Two conditions, because either alone can be
  // satisfied by an invoice that is not actually settled: a `paid` status with
  // a non-zero balance happens with partial payments.
  //
  // The subscription is resolved BEFORE this check so that a refusal can be
  // written to the audit log against the right subscription. "Stripe sent
  // invoice.paid for an invoice that was still open" is the single most
  // useful line this module can leave behind, and silence would make it
  // invisible.
  if (invoice.status !== 'paid' || (invoice.amount_remaining ?? 0) !== 0) {
    const reason = `NOT_ACTUALLY_PAID_status_${invoice.status ?? 'null'}_remaining_${invoice.amount_remaining ?? 'null'}`

    await recordSubscriptionEvent(ctx, {
      subscriptionId: row.id,
      type: 'PROVIDER_SYNC',
      occurredAt: new Date(ctx.event.created * 1000),
      detail: {
        declined: reason,
        eventType: ctx.event.type,
        invoiceStatus: invoice.status,
        amountRemainingMinor: invoice.amount_remaining,
      },
    })

    return nothing(reason)
  }

  // A paid invoice is the recovery signal for a dunned subscription. Stripe
  // also sends `subscription.updated`, but relying on a second event to
  // arrive — and to arrive in order — is how a customer stays locked out
  // after paying.
  const recovered = row.status === 'PAST_DUE'

  const written = await recordSubscriptionEvent(ctx, {
    subscriptionId: row.id,
    type: recovered ? 'PAYMENT_RECOVERED' : 'RENEWED',
    occurredAt: new Date(ctx.event.created * 1000),
    detail: {
      invoiceStatus: invoice.status,
      amountPaidMinor: invoice.amount_paid,
      currency: invoice.currency,
    },
  })

  if (!recovered) {
    return written
      ? { applied: true, changes: ['recorded renewal'] }
      : nothing('ALREADY_RECORDED')
  }

  const decision = decideSubscriptionWrite(storedStateOf(row), {
    status: 'ACTIVE',
    sequence: sequenceFromEventCreated(ctx.event.created),
  })

  if (!decision.apply) return nothing(`ORDERING_${decision.reason}`)

  await ctx.payload.update({
    collection: 'subscriptions',
    id: row.id as number,
    overrideAccess: true,
    ...reqOpt(ctx),
    data: {
      status: 'ACTIVE',
      providerUpdatedAt: new Date(
        sequenceFromEventCreated(ctx.event.created),
      ).toISOString(),
    },
  })

  return { applied: true, changes: ['PAST_DUE -> ACTIVE (payment recovered)'] }
}

const handleInvoicePaymentFailed = async (ctx: Ctx): Promise<HandlerResult> => {
  const invoice = ctx.event.data.object as Stripe.Invoice

  const providerSubscriptionId = subscriptionIdOfInvoice(invoice)

  if (!providerSubscriptionId) return nothing('INVOICE_NOT_FROM_SUBSCRIPTION')

  const row = await findSubscriptionRow(ctx, providerSubscriptionId)

  if (!row) return nothing('NO_LOCAL_SUBSCRIPTION')

  // The mirror of the check in `handleInvoicePaid`: do not act on a failure
  // for an invoice that has since been paid. Retried deliveries make this a
  // real sequence, and marking a paying customer PAST_DUE on a stale failure
  // is a support ticket at best.
  if (invoice.status === 'paid') {
    await recordSubscriptionEvent(ctx, {
      subscriptionId: row.id,
      type: 'PROVIDER_SYNC',
      occurredAt: new Date(ctx.event.created * 1000),
      detail: {
        declined: 'INVOICE_SINCE_PAID',
        eventType: ctx.event.type,
        invoiceStatus: invoice.status,
      },
    })

    return nothing('INVOICE_SINCE_PAID')
  }

  await recordSubscriptionEvent(ctx, {
    subscriptionId: row.id,
    type: 'PAYMENT_FAILED',
    occurredAt: new Date(ctx.event.created * 1000),
    detail: {
      invoiceStatus: invoice.status,
      amountRemainingMinor: invoice.amount_remaining,
      currency: invoice.currency,
    },
  })

  // Move to PAST_DUE ourselves rather than waiting for the subscription event.
  // PAST_DUE still grants access to the end of the paid period, so this is not
  // a punishment — it is what makes the dunning state visible in our admin and
  // in the customer's own account page.
  if (row.status !== 'ACTIVE') {
    return { applied: true, changes: ['recorded payment failure'] }
  }

  const sequence = sequenceFromEventCreated(ctx.event.created)
  const decision = decideSubscriptionWrite(storedStateOf(row), {
    status: 'PAST_DUE',
    sequence,
  })

  if (!decision.apply) return nothing(`ORDERING_${decision.reason}`)

  await ctx.payload.update({
    collection: 'subscriptions',
    id: row.id as number,
    overrideAccess: true,
    ...reqOpt(ctx),
    data: {
      status: 'PAST_DUE',
      providerUpdatedAt: new Date(sequence).toISOString(),
    },
  })

  return { applied: true, changes: ['ACTIVE -> PAST_DUE (payment failed)'] }
}

/* -------------------------------------------------------------------------- */
/* Handlers: payment intents                                                  */
/* -------------------------------------------------------------------------- */

const handlePaymentIntent = async (
  ctx: Ctx,
  expectation: 'SUCCEEDED' | 'FAILED',
): Promise<HandlerResult> => {
  const intent = ctx.event.data.object as Stripe.PaymentIntent

  // ─────────── AGAIN: READ THE OBJECT, NOT THE EVENT NAME ───────────
  // A `payment_intent.succeeded` event whose object is `requires_action` or
  // `processing` is exactly the case that grants access for a payment that
  // never completes.
  if (expectation === 'SUCCEEDED' && intent.status !== 'succeeded') {
    return nothing(`NOT_ACTUALLY_SUCCEEDED_status_${intent.status}`)
  }

  if (expectation === 'FAILED' && intent.status === 'succeeded') {
    return nothing('INTENT_SINCE_SUCCEEDED')
  }

  const chargeId = idOf(intent.latest_charge)
  const invoice = await findInvoiceByPayment(ctx, [
    intent.id,
    ...(chargeId ? [chargeId] : []),
  ])

  if (!invoice?.subscription) {
    // No invoice of ours names this payment. The subscription lifecycle is
    // driven by the invoice and subscription events; a payment intent on its
    // own has nothing to attach an audit row to.
    return nothing('NO_LOCAL_INVOICE_FOR_PAYMENT')
  }

  const written = await recordSubscriptionEvent(ctx, {
    subscriptionId: invoice.subscription as number,
    type: expectation === 'SUCCEEDED' ? 'RENEWED' : 'PAYMENT_FAILED',
    occurredAt: new Date(ctx.event.created * 1000),
    detail: {
      intentStatus: intent.status,
      amountMinor: intent.amount,
      currency: intent.currency,
    },
  })

  return written
    ? { applied: true, changes: [`recorded payment intent ${intent.status}`] }
    : nothing('ALREADY_RECORDED')
}

/* -------------------------------------------------------------------------- */
/* Handlers: refunds                                                          */
/* -------------------------------------------------------------------------- */

const handleChargeRefunded = async (ctx: Ctx): Promise<HandlerResult> => {
  const charge = ctx.event.data.object as Stripe.Charge

  // The object's own state, not the event name. A `charge.refunded` event can
  // be redelivered for a charge whose refund later failed.
  if (!charge.refunded && (charge.amount_refunded ?? 0) === 0) {
    return nothing('NOT_ACTUALLY_REFUNDED')
  }

  const refunds = charge.refunds?.data ?? []
  const refund = refunds.find((candidate) => candidate.status === 'succeeded')

  if (!refund) {
    // Pending or failed refunds are not money back yet. Credit notes are
    // accounting documents; issuing one for a refund that may still fail
    // would need a second document to undo it.
    return nothing('NO_SUCCEEDED_REFUND_ON_CHARGE')
  }

  const paymentIntentId = idOf(charge.payment_intent)
  const invoice = await findInvoiceByPayment(ctx, [
    charge.id,
    ...(paymentIntentId ? [paymentIntentId] : []),
  ])

  if (!invoice) {
    return nothing('NO_LOCAL_INVOICE_FOR_CHARGE')
  }

  const created = await issueCreditNoteForRefund({
    payload: ctx.payload,
    ...reqOpt(ctx),
    invoiceId: invoice.id,
    currency: invoice.currency,
    amountMinor: refund.amount,
    providerRefundId: refund.id,
    reason: `Refund of charge ${charge.id} (Stripe refund ${refund.id})`,
    now: new Date(ctx.event.created * 1000),
    ...(ctx.allocate ? { allocate: ctx.allocate } : {}),
    ...(invoice.billingCountry
      ? { billingCountry: invoice.billingCountry }
      : {}),
  })

  if (invoice.subscription) {
    // REFUNDED only when money actually went back, so the audit log can be
    // counted: one REFUNDED row is one refund. A redelivery carrying a fresh
    // event id — which is what a dashboard resend looks like — is recorded
    // as the provider-sync no-op it is, not as a second refund.
    await recordSubscriptionEvent(ctx, {
      subscriptionId: invoice.subscription as number,
      type: created.issued ? 'REFUNDED' : 'PROVIDER_SYNC',
      occurredAt: new Date(ctx.event.created * 1000),
      detail: created.issued
        ? {
            amountMinor: refund.amount,
            currency: refund.currency,
            creditNote: created.number,
          }
        : {
            declined: 'CREDIT_NOTE_ALREADY_EXISTS',
            eventType: ctx.event.type,
            existingCreditNote: created.number,
          },
    })
  }

  return created.issued
    ? { applied: true, changes: [`credit note ${created.number} issued`] }
    : nothing('CREDIT_NOTE_ALREADY_EXISTS')
}

export type DocumentNumberAllocator = typeof allocateDocumentNumber

export type IssueCreditNoteArgs = {
  payload: Payload
  req?: PayloadRequest
  invoiceId: number | string
  currency: Currency
  amountMinor: number
  providerRefundId: string
  reason: string
  now: Date
  billingCountry?: string
  /**
   * Overridable number allocator.
   *
   * The real one takes the next number in the series with an atomic SQL
   * upsert, which needs a database. Injecting it lets the webhook scenarios
   * run as pure tests, where the thing under test is the credit-note decision
   * rather than Postgres' ability to increment a counter — that part has its
   * own test against Neon. Same seam as the email transport in step 3.
   */
  allocate?: DocumentNumberAllocator
}

/**
 * Write a credit note for a refund.
 *
 * THE INVOICE IS NOT TOUCHED. An issued invoice is immutable — it has been
 * sent, it may already be in somebody's accounting, and in Czech VAT terms a
 * correction is a separate document (opravný daňový doklad), not an edit. So
 * a refund produces a new credit note that references the invoice, and the
 * invoice's own fields and total stay exactly as issued.
 *
 * Idempotent on `providerRefundId`, which carries a unique index: a replayed
 * refund event finds the existing note and issues nothing. That matters more
 * than usual here, because a duplicate credit note would understate revenue
 * in a VAT return.
 */
export const issueCreditNoteForRefund = async ({
  payload,
  req,
  invoiceId,
  currency,
  amountMinor,
  providerRefundId,
  reason,
  now,
  billingCountry,
  allocate = allocateDocumentNumber,
}: IssueCreditNoteArgs): Promise<{
  issued: boolean
  number: string | null
}> => {
  const reqOption = req ? { req } : {}

  const existing = await payload.find({
    collection: 'credit-notes',
    depth: 0,
    limit: 1,
    pagination: false,
    overrideAccess: true,
    ...reqOption,
    where: { providerRefundId: { equals: providerRefundId } },
  })

  const already = existing.docs[0] as { number?: string } | undefined

  if (already) {
    return { issued: false, number: already.number ?? null }
  }

  const allocated = await allocate({
    payload,
    series: 'CREDIT_NOTE',
    now,
    ...reqOption,
  })

  await payload.create({
    collection: 'credit-notes',
    overrideAccess: true,
    ...reqOption,
    data: {
      number: allocated.number,
      numberYear: allocated.year,
      numberSequence: allocated.sequence,
      invoice: invoiceId as number,
      currency,
      amountMinor,
      reason,
      issuedAt: now.toISOString(),
      providerRefundId,
      // Issued now; the PDF and the email follow and may fail without
      // unissuing the document.
      deliveryState: 'PENDING',
      deliveryAttempts: 0,
      ...(billingCountry ? { billingCountry } : {}),
    },
  })

  // The invoice's own status becomes CREDITED so the admin shows at a glance
  // that it has been corrected. This is the one permitted change to an issued
  // invoice: a status marker, never an amount. Totals stay as issued.
  await payload.update({
    collection: 'invoices',
    id: invoiceId as number,
    overrideAccess: true,
    ...reqOption,
    data: { status: 'CREDITED' },
  })

  return { issued: true, number: allocated.number }
}

/* -------------------------------------------------------------------------- */
/* Handlers: disputes                                                         */
/* -------------------------------------------------------------------------- */

/** Stripe dispute status → ours. */
const DISPUTE_STATUS_MAP: Readonly<Record<string, DisputeStatus>> = {
  warning_needs_response: 'OPEN',
  warning_under_review: 'UNDER_REVIEW',
  warning_closed: 'WON',
  needs_response: 'OPEN',
  under_review: 'UNDER_REVIEW',
  won: 'WON',
  lost: 'LOST',
}

const handleDisputeCreated = async (ctx: Ctx): Promise<HandlerResult> => {
  const dispute = ctx.event.data.object as Stripe.Dispute

  const chargeId = idOf(dispute.charge)
  const paymentIntentId = idOf(dispute.payment_intent)

  const invoice = await findInvoiceByPayment(ctx, [
    ...(chargeId ? [chargeId] : []),
    ...(paymentIntentId ? [paymentIntentId] : []),
  ])

  if (!invoice?.customer) {
    // We cannot attribute the chargeback, so we cannot suspend anybody. This
    // is logged at error level by the route: an unattributed dispute is money
    // leaving with an evidence deadline attached and nobody assigned to it.
    return nothing('DISPUTE_NOT_ATTRIBUTABLE')
  }

  const currency = CURRENCIES.includes(
    dispute.currency.toUpperCase() as Currency,
  )
    ? (dispute.currency.toUpperCase() as Currency)
    : null

  if (!currency) return nothing('DISPUTE_CURRENCY_UNKNOWN')

  // Idempotent on the provider dispute id, which carries a unique index.
  const existing = await ctx.payload.find({
    collection: 'disputes',
    depth: 0,
    limit: 1,
    pagination: false,
    overrideAccess: true,
    ...reqOpt(ctx),
    where: {
      and: [
        { provider: { equals: PROVIDER } },
        { providerDisputeId: { equals: dispute.id } },
      ],
    },
  })

  if (existing.docs.length > 0) {
    return nothing('DISPUTE_ALREADY_RECORDED')
  }

  const dueBy = dispute.evidence_details?.due_by ?? null

  await ctx.payload.create({
    collection: 'disputes',
    overrideAccess: true,
    ...reqOpt(ctx),
    data: {
      customer: invoice.customer as number,
      ...(invoice.subscription
        ? { subscription: invoice.subscription as number }
        : {}),
      invoice: invoice.id as number,
      status: DISPUTE_STATUS_MAP[dispute.status] ?? 'OPEN',
      reason: dispute.reason,
      amountMinor: dispute.amount,
      currency,
      // The issuer's time, not ours: a dispute webhook can arrive hours late
      // and access should not have been granted in the gap.
      openedAt: new Date(dispute.created * 1000).toISOString(),
      ...(dueBy ? { evidenceDueAt: new Date(dueBy * 1000).toISOString() } : {}),
      provider: PROVIDER,
      providerDisputeId: dispute.id,
      providerChargeId: chargeId ?? paymentIntentId ?? 'unknown',
    },
  })

  if (invoice.subscription) {
    await recordSubscriptionEvent(ctx, {
      subscriptionId: invoice.subscription as number,
      type: 'DISPUTE_OPENED',
      occurredAt: new Date(dispute.created * 1000),
      detail: {
        reason: dispute.reason,
        amountMinor: dispute.amount,
        currency,
      },
    })
  }

  // The suspension itself is not a field we write: `loadCustomerEntitlementState`
  // reads open disputes and the resolver vetoes everything. One source of
  // truth, so there is no window in which a row says suspended and the
  // resolver disagrees.
  return {
    applied: true,
    changes: [`dispute ${dispute.id} recorded; entitlements suspended`],
  }
}

/**
 * A chargeback closed, won or lost.
 *
 * Beyond the minimum set, and worth having: the suspension is driven by the
 * dispute's status, so without this handler a customer who wins us the
 * dispute stays locked out until somebody notices and edits the row by hand.
 * "Access is restored when a human remembers" is not an acceptable resting
 * state for a paying customer.
 *
 * Idempotent, and ordered: a row already resolved is not re-resolved, so a
 * redelivery cannot move the resolution date.
 */
const handleDisputeClosed = async (ctx: Ctx): Promise<HandlerResult> => {
  const dispute = ctx.event.data.object as Stripe.Dispute

  const existing = await ctx.payload.find({
    collection: 'disputes',
    depth: 0,
    limit: 1,
    pagination: false,
    overrideAccess: true,
    ...reqOpt(ctx),
    where: {
      and: [
        { provider: { equals: PROVIDER } },
        { providerDisputeId: { equals: dispute.id } },
      ],
    },
  })

  const row = existing.docs[0] as
    | { id: number | string; status: DisputeStatus; subscription?: unknown }
    | undefined

  if (!row) {
    // We never recorded the opening, so there is nothing to close. Recorded
    // and acknowledged rather than invented: a dispute row with no opening
    // would have no evidence deadline and no attributable charge.
    return nothing('DISPUTE_NOT_RECORDED')
  }

  const mapped = DISPUTE_STATUS_MAP[dispute.status] ?? 'LOST'

  if (row.status === mapped) {
    return nothing('DISPUTE_ALREADY_RESOLVED')
  }

  await ctx.payload.update({
    collection: 'disputes',
    id: row.id as number,
    overrideAccess: true,
    ...reqOpt(ctx),
    data: {
      status: mapped,
      resolvedAt: new Date(ctx.event.created * 1000).toISOString(),
    },
  })

  if (row.subscription) {
    await recordSubscriptionEvent(ctx, {
      subscriptionId: row.subscription as number,
      type: 'DISPUTE_RESOLVED',
      occurredAt: new Date(ctx.event.created * 1000),
      detail: {
        outcome: mapped,
        providerStatus: dispute.status,
        reason: dispute.reason,
      },
    })
  }

  // WON clears the suspension because `loadCustomerEntitlementState` only
  // treats OPEN and UNDER_REVIEW as suspending. LOST leaves access withdrawn
  // through the subscription's own status, which is Stripe's call to make.
  return {
    applied: true,
    changes: [
      `dispute ${dispute.id} ${row.status} -> ${mapped}` +
        (mapped === 'WON' ? '; entitlements restored' : ''),
    ],
  }
}

/* -------------------------------------------------------------------------- */
/* Dispatch                                                                   */
/* -------------------------------------------------------------------------- */

type Handler = (ctx: Ctx) => Promise<HandlerResult>

/**
 * The event types we act on.
 *
 * Anything absent is recorded and acknowledged. Being explicit about the list
 * is the point: Stripe sends over two hundred event types and a handler that
 * tried to be clever about unfamiliar ones would be guessing.
 */
export const STRIPE_HANDLERS: Readonly<Record<string, Handler>> = {
  'customer.subscription.created': (ctx) =>
    handleSubscriptionChange(ctx, { created: true }),
  'customer.subscription.updated': (ctx) => handleSubscriptionChange(ctx, {}),
  'customer.subscription.deleted': (ctx) =>
    handleSubscriptionChange(ctx, { deleted: true }),
  'invoice.paid': handleInvoicePaid,
  'invoice.payment_failed': handleInvoicePaymentFailed,
  'payment_intent.succeeded': (ctx) => handlePaymentIntent(ctx, 'SUCCEEDED'),
  'payment_intent.payment_failed': (ctx) => handlePaymentIntent(ctx, 'FAILED'),
  'charge.refunded': handleChargeRefunded,
  'charge.dispute.created': handleDisputeCreated,
  // Beyond the minimum set. See `handleDisputeClosed` for why.
  'charge.dispute.closed': handleDisputeClosed,
}

/** Every type we handle, for the report and for tests. */
export const HANDLED_STRIPE_EVENTS = Object.keys(STRIPE_HANDLERS)

export type HandleStripeEventArgs = {
  payload: Payload
  event: Stripe.Event
  req?: PayloadRequest
  /** Injected clock. */
  now?: Date
  /** Overridable document-number allocator. See `IssueCreditNoteArgs`. */
  allocate?: DocumentNumberAllocator
}

/**
 * Act on one verified, claimed Stripe event.
 *
 * Assumes the caller has already verified the signature and won the claim.
 * Does not catch: the route decides what a thrown handler means for the
 * response, and swallowing it here would hide a real bug behind a cheerful
 * "unhandled".
 */
export const handleStripeEvent = async ({
  payload,
  event,
  req,
  now = new Date(),
  allocate,
}: HandleStripeEventArgs): Promise<StripeEventOutcome> => {
  const handler = STRIPE_HANDLERS[event.type]

  if (!handler) {
    return {
      eventId: event.id,
      eventType: event.type,
      handled: false,
      applied: false,
      reason: 'NO_HANDLER',
      changes: [],
    }
  }

  const ctx: Ctx = {
    payload,
    event,
    now,
    ...(req ? { req } : {}),
    ...(allocate ? { allocate } : {}),
  }
  const result = await handler(ctx)

  const unreadable =
    result.reason !== undefined && isUnreadableReason(result.reason)

  return {
    eventId: event.id,
    eventType: event.type,
    handled: true,
    applied: result.applied,
    ...(result.reason ? { reason: result.reason } : {}),
    changes: result.changes ?? [],
    ...(result.detail ? { detail: result.detail } : {}),
    ...(unreadable ? { unreadable: true } : {}),
  }
}

/** The status mapping, re-exported so callers need one import. */
export { mapStripeSubscriptionStatus }
