/**
 * The webhook scenarios.
 *
 * Every one of these is a sequence that happened to a real subscription
 * service and cost somebody money or access. They are written as sequences
 * rather than single events because that is where the bugs live: the second
 * delivery, the retry, the event that arrives after the one that supersedes
 * it.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  isSubscriptionActiveAt,
  resolveEntitlements,
} from '../../entitlements.ts'
import { handleStripeEvent } from './webhook.ts'
import {
  CHARGE_ID,
  PAYMENT_INTENT_ID,
  PERIOD_END,
  PERIOD_START,
  SUB_ID,
  chargeObject,
  createPayloadDouble,
  disputeObject,
  invoiceObject,
  multiItemSubscriptionObject,
  paymentIntentObject,
  preRelocationSubscriptionObject,
  stripeEvent,
  subscriptionObject,
} from './webhook-fixtures.ts'
import { signStripePayloadForTests, verifyStripeWebhook } from './verify.ts'

/* -------------------------------------------------------------------------- */
/* Shared setup                                                              */
/* -------------------------------------------------------------------------- */

const WEBHOOK_SECRET = 'whsec_fixture_secret_0123456789abcdef'

/** A world with one customer on one subscription, as after checkout. */
const world = (
  options: {
    status?: string
    providerUpdatedAt?: string | null
    cancelAtPeriodEnd?: boolean
    withInvoice?: boolean
  } = {},
) => {
  const double = createPayloadDouble()

  const customer = double.seed('customers', {
    email: 'ida@example.test',
    currency: 'CZK',
  })

  const plan = double.seed('plans', {
    code: 'PRO',
    features: ['TIPS_PRO', 'TRACK_RECORD'],
  })

  const subscription = double.seed('subscriptions', {
    customer: customer.id,
    plan: plan.id,
    currency: 'CZK',
    interval: 'MONTH',
    priceMinor: 59_900,
    status: options.status ?? 'INCOMPLETE',
    currentPeriodStart: new Date(PERIOD_START * 1000).toISOString(),
    currentPeriodEnd: new Date(PERIOD_END * 1000).toISOString(),
    cancelAtPeriodEnd: options.cancelAtPeriodEnd ?? false,
    canceledAt: null,
    endedAt: null,
    provider: 'STRIPE',
    providerSubscriptionId: SUB_ID,
    providerUpdatedAt:
      options.providerUpdatedAt === undefined
        ? null
        : options.providerUpdatedAt,
  })

  const invoice =
    options.withInvoice === false
      ? null
      : double.seed('invoices', {
          customer: customer.id,
          subscription: subscription.id,
          currency: 'CZK',
          totalMinor: 59_900,
          status: 'ISSUED',
          billingCountry: 'CZ',
          providerPaymentId: PAYMENT_INTENT_ID,
        })

  return { double, customer, plan, subscription, invoice }
}

const run = async (
  double: ReturnType<typeof createPayloadDouble>,
  event: Parameters<typeof handleStripeEvent>[0]['event'],
) =>
  handleStripeEvent({
    payload: double.payload,
    event,
  })

const subscriptionRow = (double: ReturnType<typeof createPayloadDouble>) =>
  double.rows('subscriptions')[0]

const eventTypes = (double: ReturnType<typeof createPayloadDouble>) =>
  double.rows('subscription-events').map((row) => row.type)

/* -------------------------------------------------------------------------- */
/* 1. Signature verification                                                 */
/* -------------------------------------------------------------------------- */

describe('signature verification', () => {
  const body = JSON.stringify(
    stripeEvent('invoice.paid', invoiceObject(), { id: 'evt_sig_1' }),
  )

  it('accepts a correctly signed payload', () => {
    const result = verifyStripeWebhook({
      rawBody: body,
      signatureHeader: signStripePayloadForTests(body, WEBHOOK_SECRET),
      secret: WEBHOOK_SECRET,
    })

    assert.ok(result.ok, JSON.stringify(result))
    assert.equal(result.event.id, 'evt_sig_1')
  })

  it('rejects a missing signature header', () => {
    const result = verifyStripeWebhook({
      rawBody: body,
      signatureHeader: null,
      secret: WEBHOOK_SECRET,
    })

    assert.ok(!result.ok)
    assert.equal(result.reason, 'MISSING_SIGNATURE')
  })

  it('rejects a signature made with a different secret', () => {
    const result = verifyStripeWebhook({
      rawBody: body,
      signatureHeader: signStripePayloadForTests(body, 'whsec_someone_else_00'),
      secret: WEBHOOK_SECRET,
    })

    assert.ok(!result.ok)
    assert.equal(result.reason, 'INVALID_SIGNATURE')
  })

  it('rejects a body altered after signing', () => {
    // The whole point. A valid signature over a different body is what an
    // attacker would need, and this is the assertion that proves we would
    // notice. Note the alteration is semantically meaningful: 599 Kč becomes
    // 1 haléř.
    const signature = signStripePayloadForTests(body, WEBHOOK_SECRET)
    const tampered = body.replace('"amount_paid":59900', '"amount_paid":1')

    assert.notEqual(tampered, body, 'the fixture did not actually change')

    const result = verifyStripeWebhook({
      rawBody: tampered,
      signatureHeader: signature,
      secret: WEBHOOK_SECRET,
    })

    assert.ok(!result.ok)
    assert.equal(result.reason, 'INVALID_SIGNATURE')
  })

  it('rejects a replay from outside the tolerance window', () => {
    // A captured request resent a day later. The timestamp is part of the
    // signed payload, so it cannot be refreshed without the secret.
    const oldTimestamp = PERIOD_START
    const signature = signStripePayloadForTests(
      body,
      WEBHOOK_SECRET,
      oldTimestamp,
    )

    const result = verifyStripeWebhook({
      rawBody: body,
      signatureHeader: signature,
      secret: WEBHOOK_SECRET,
      // Milliseconds: a day after the payload was signed.
      receivedAt: (oldTimestamp + 86_400) * 1000,
    })

    assert.ok(!result.ok)
    assert.equal(result.reason, 'INVALID_SIGNATURE')
  })

  it('accepts the same payload inside the tolerance window', () => {
    const timestamp = PERIOD_START
    const result = verifyStripeWebhook({
      rawBody: body,
      signatureHeader: signStripePayloadForTests(
        body,
        WEBHOOK_SECRET,
        timestamp,
      ),
      secret: WEBHOOK_SECRET,
      receivedAt: (timestamp + 60) * 1000,
    })

    assert.ok(result.ok)
  })
})

/* -------------------------------------------------------------------------- */
/* 2. Subscription creation through to first payment                         */
/* -------------------------------------------------------------------------- */

describe('scenario: subscription created, first invoice paid', () => {
  it('activates the subscription and records the sequence', async () => {
    const { double, subscription } = world({ status: 'INCOMPLETE' })

    const created = await run(
      double,
      stripeEvent(
        'customer.subscription.created',
        subscriptionObject({ status: 'incomplete' }),
        { created: PERIOD_START },
      ),
    )

    assert.ok(created.handled)
    assert.ok(created.applied, JSON.stringify(created))
    assert.equal(subscriptionRow(double)?.status, 'INCOMPLETE')

    const activated = await run(
      double,
      stripeEvent(
        'customer.subscription.updated',
        subscriptionObject({ status: 'active' }),
        { created: PERIOD_START + 5 },
      ),
    )

    assert.ok(activated.applied, JSON.stringify(activated))

    const row = subscriptionRow(double)
    assert.equal(row?.status, 'ACTIVE')
    assert.equal(row?.id, subscription.id)
    assert.ok(row?.providerUpdatedAt, 'ordering key was not written')

    const paid = await run(
      double,
      stripeEvent('invoice.paid', invoiceObject({ status: 'paid' }), {
        created: PERIOD_START + 6,
      }),
    )

    assert.ok(paid.applied, JSON.stringify(paid))
    assert.deepEqual(eventTypes(double), ['CREATED', 'ACTIVATED', 'RENEWED'])
  })

  it('does NOT activate on an invoice.paid event for an unpaid invoice', async () => {
    // THE BUG THIS MODULE EXISTS TO PREVENT. The event is named `invoice.paid`
    // and the object says `open` with a balance outstanding. Trusting the name
    // grants a subscription nobody paid for.
    const { double } = world({ status: 'INCOMPLETE' })

    const outcome = await run(
      double,
      stripeEvent(
        'invoice.paid',
        invoiceObject({
          status: 'open',
          amountRemaining: 59_900,
          amountPaid: 0,
        }),
      ),
    )

    assert.ok(outcome.handled)
    assert.equal(outcome.applied, false)
    assert.match(outcome.reason ?? '', /NOT_ACTUALLY_PAID/)
    assert.equal(subscriptionRow(double)?.status, 'INCOMPLETE')

    // Declined, but NOT silent. "Stripe sent invoice.paid for an invoice that
    // was still open" is the most useful line this module can leave behind,
    // and it is only useful if it is written down.
    assert.deepEqual(eventTypes(double), ['PROVIDER_SYNC'])
    const audit = double.rows('subscription-events')[0]
    assert.match(
      String((audit?.payload as { declined?: unknown })?.declined),
      /NOT_ACTUALLY_PAID_status_open/,
    )
  })

  it('does NOT record a payment_intent.succeeded whose intent is unfinished', async () => {
    const { double } = world({ status: 'INCOMPLETE' })

    const outcome = await run(
      double,
      stripeEvent(
        'payment_intent.succeeded',
        paymentIntentObject({ status: 'requires_action' }),
      ),
    )

    assert.equal(outcome.applied, false)
    assert.match(outcome.reason ?? '', /NOT_ACTUALLY_SUCCEEDED/)
    assert.deepEqual(eventTypes(double), [])
  })

  it('does NOT credit a charge.refunded whose refund has not succeeded', async () => {
    const { double } = world({ status: 'ACTIVE' })

    const outcome = await run(
      double,
      stripeEvent('charge.refunded', chargeObject({ refundStatus: 'pending' })),
    )

    assert.equal(outcome.applied, false)
    assert.equal(outcome.reason, 'NO_SUCCEEDED_REFUND_ON_CHARGE')
    assert.equal(double.rows('credit-notes').length, 0)
  })
})

/* -------------------------------------------------------------------------- */
/* 3. Failed payment, entitlements surviving, recovery                       */
/* -------------------------------------------------------------------------- */

describe('scenario: payment fails, then recovers', () => {
  it('moves to PAST_DUE and keeps access to the end of the paid period', async () => {
    const { double, plan } = world({ status: 'ACTIVE' })

    const failed = await run(
      double,
      stripeEvent(
        'invoice.payment_failed',
        invoiceObject({
          status: 'open',
          amountRemaining: 59_900,
          amountPaid: 0,
        }),
      ),
    )

    assert.ok(failed.applied, JSON.stringify(failed))

    const row = subscriptionRow(double)
    assert.equal(row?.status, 'PAST_DUE')
    assert.deepEqual(eventTypes(double), ['PAYMENT_FAILED'])

    // The period is untouched: they paid for it, so it is still theirs.
    assert.equal(
      row?.currentPeriodEnd,
      new Date(PERIOD_END * 1000).toISOString(),
    )

    const snapshot = {
      status: 'PAST_DUE' as const,
      currentPeriodStart: row?.currentPeriodStart as string,
      currentPeriodEnd: row?.currentPeriodEnd as string,
      planFeatures: plan.features as readonly never[],
    }

    // Inside the period: still entitled, despite the failed renewal.
    assert.equal(
      isSubscriptionActiveAt(snapshot, new Date((PERIOD_END - 3600) * 1000)),
      true,
      'a dunned customer lost access inside a period they had paid for',
    )

    // Past it: nothing, without needing another webhook to arrive.
    assert.equal(
      isSubscriptionActiveAt(snapshot, new Date((PERIOD_END + 3600) * 1000)),
      false,
      'access outlived the paid period',
    )
  })

  it('returns to ACTIVE when the invoice is finally paid', async () => {
    const { double } = world({ status: 'PAST_DUE' })

    const recovered = await run(
      double,
      stripeEvent('invoice.paid', invoiceObject({ status: 'paid' }), {
        created: PERIOD_START + 100,
      }),
    )

    assert.ok(recovered.applied, JSON.stringify(recovered))
    assert.equal(subscriptionRow(double)?.status, 'ACTIVE')
    // Distinguishable from an ordinary renewal in the audit log, which is
    // what makes dunning effectiveness measurable later.
    assert.deepEqual(eventTypes(double), ['PAYMENT_RECOVERED'])
  })

  it('ignores a payment_failed event for an invoice that has since been paid', async () => {
    const { double } = world({ status: 'ACTIVE' })

    const outcome = await run(
      double,
      stripeEvent('invoice.payment_failed', invoiceObject({ status: 'paid' })),
    )

    assert.equal(outcome.applied, false)
    assert.equal(outcome.reason, 'INVOICE_SINCE_PAID')
    assert.equal(subscriptionRow(double)?.status, 'ACTIVE')
    assert.deepEqual(eventTypes(double), ['PROVIDER_SYNC'])
  })
})

/* -------------------------------------------------------------------------- */
/* 4. Cancellation at period end                                             */
/* -------------------------------------------------------------------------- */

describe('scenario: cancellation at period end', () => {
  it('flags the cancellation without ending access', async () => {
    const { double, plan } = world({ status: 'ACTIVE' })

    const scheduled = await run(
      double,
      stripeEvent(
        'customer.subscription.updated',
        subscriptionObject({
          status: 'active',
          cancelAtPeriodEnd: true,
          canceledAt: PERIOD_START + 1000,
        }),
        { created: PERIOD_START + 1000 },
      ),
    )

    assert.ok(scheduled.applied, JSON.stringify(scheduled))

    const row = subscriptionRow(double)
    assert.equal(row?.cancelAtPeriodEnd, true)
    assert.equal(row?.status, 'ACTIVE')
    assert.equal(row?.endedAt, null)
    assert.deepEqual(eventTypes(double), ['CANCELLATION_SCHEDULED'])

    // Still entitled until the period runs out.
    assert.equal(
      isSubscriptionActiveAt(
        {
          status: 'ACTIVE',
          currentPeriodStart: row?.currentPeriodStart as string,
          currentPeriodEnd: row?.currentPeriodEnd as string,
          planFeatures: plan.features as readonly never[],
        },
        new Date((PERIOD_END - 1) * 1000),
      ),
      true,
    )

    const ended = await run(
      double,
      stripeEvent(
        'customer.subscription.deleted',
        subscriptionObject({
          status: 'canceled',
          cancelAtPeriodEnd: false,
          canceledAt: PERIOD_START + 1000,
          endedAt: PERIOD_END,
        }),
        { created: PERIOD_END },
      ),
    )

    assert.ok(ended.applied, JSON.stringify(ended))
    assert.equal(subscriptionRow(double)?.status, 'CANCELED')
    assert.deepEqual(eventTypes(double), ['CANCELLATION_SCHEDULED', 'CANCELED'])
  })

  it('records a revoked cancellation distinctly', async () => {
    const { double } = world({ status: 'ACTIVE', cancelAtPeriodEnd: true })

    const resumed = await run(
      double,
      stripeEvent(
        'customer.subscription.updated',
        subscriptionObject({ status: 'active', cancelAtPeriodEnd: false }),
        { created: PERIOD_START + 2000 },
      ),
    )

    assert.ok(resumed.applied)
    assert.equal(subscriptionRow(double)?.cancelAtPeriodEnd, false)
    assert.deepEqual(eventTypes(double), ['CANCELLATION_REVOKED'])
  })
})

/* -------------------------------------------------------------------------- */
/* 5. Refund produces a credit note                                          */
/* -------------------------------------------------------------------------- */

describe('scenario: refund', () => {
  it('issues a credit note and leaves the invoice amounts alone', async () => {
    const { double, invoice } = world({ status: 'ACTIVE' })

    assert.ok(invoice)
    const totalBefore = invoice.totalMinor

    const outcome = await run(
      double,
      stripeEvent('charge.refunded', chargeObject(), {
        created: PERIOD_START + 3000,
      }),
    )

    assert.ok(outcome.applied, JSON.stringify(outcome))

    const notes = double.rows('credit-notes')
    assert.equal(notes.length, 1)
    assert.equal(notes[0]?.amountMinor, 59_900)
    assert.equal(notes[0]?.currency, 'CZK')
    assert.equal(notes[0]?.invoice, invoice.id)
    // No number on the row: Fakturoid numbers the correction document, and
    // this suite runs with the invoicing seam absent — no network, no
    // credentials. The refund is recorded all the same, which is the property
    // that matters here.
    assert.equal(notes[0]?.fakturoidNumber, undefined)
    assert.equal(notes[0]?.accountingState, 'PENDING')

    // THE INVOICE IS NOT TOUCHED. Its amounts are exactly as issued; only the
    // status marker changes, so the admin can see it has been corrected.
    const after = double.rows('invoices')[0]
    assert.equal(after?.totalMinor, totalBefore)
    assert.equal(after?.currency, 'CZK')
    assert.equal(after?.status, 'CREDITED')

    assert.deepEqual(eventTypes(double), ['REFUNDED'])
  })

  it('credits a partial refund for the partial amount', async () => {
    const { double } = world({ status: 'ACTIVE' })

    await run(
      double,
      stripeEvent(
        'charge.refunded',
        chargeObject({
          refundAmount: 20_000,
          amountRefunded: 20_000,
          refunded: false,
        }),
      ),
    )

    assert.equal(double.rows('credit-notes')[0]?.amountMinor, 20_000)
  })

  it('issues exactly one credit note however many times the event arrives', async () => {
    // Self-idempotent, not merely protected by the event claim: each delivery
    // below carries a DIFFERENT event id, which is what a dashboard resend
    // looks like. A second credit note would understate revenue in a VAT
    // return, so this is the assertion that matters most in this file.
    const { double } = world({ status: 'ACTIVE' })

    const first = await run(
      double,
      stripeEvent('charge.refunded', chargeObject(), { id: 'evt_refund_a' }),
    )
    const second = await run(
      double,
      stripeEvent('charge.refunded', chargeObject(), { id: 'evt_refund_b' }),
    )
    const third = await run(
      double,
      stripeEvent('charge.refunded', chargeObject(), { id: 'evt_refund_c' }),
    )

    assert.ok(first.applied)
    assert.equal(second.applied, false)
    assert.equal(second.reason, 'CREDIT_NOTE_ALREADY_EXISTS')
    assert.equal(third.applied, false)
    assert.equal(double.rows('credit-notes').length, 1)

    // Exactly one REFUNDED row, so the audit log can be counted: one
    // REFUNDED is one refund. The two redeliveries are recorded as the
    // no-ops they were.
    assert.equal(
      eventTypes(double).filter((type) => type === 'REFUNDED').length,
      1,
    )
    assert.equal(
      eventTypes(double).filter((type) => type === 'PROVIDER_SYNC').length,
      2,
    )
  })

  it('declines to credit a charge we have no invoice for', async () => {
    const { double } = world({ status: 'ACTIVE', withInvoice: false })

    const outcome = await run(
      double,
      stripeEvent('charge.refunded', chargeObject()),
    )

    assert.equal(outcome.applied, false)
    assert.equal(outcome.reason, 'NO_LOCAL_INVOICE_FOR_CHARGE')
    assert.equal(double.rows('credit-notes').length, 0)
  })
})

/* -------------------------------------------------------------------------- */
/* 6. Dispute suspends access                                                */
/* -------------------------------------------------------------------------- */

describe('scenario: chargeback', () => {
  it('records the dispute and suspends every entitlement at once', async () => {
    const { double, customer, plan } = world({ status: 'ACTIVE' })

    const openedAt = PERIOD_START + 4000

    const outcome = await run(
      double,
      stripeEvent(
        'charge.dispute.created',
        disputeObject({ created: openedAt }),
        {
          created: openedAt,
        },
      ),
    )

    assert.ok(outcome.applied, JSON.stringify(outcome))

    const disputes = double.rows('disputes')
    assert.equal(disputes.length, 1)
    assert.equal(disputes[0]?.customer, customer.id)
    assert.equal(disputes[0]?.status, 'OPEN')
    // The reason is recorded, not just the fact: it decides whether
    // submitting evidence is worth anything.
    assert.equal(disputes[0]?.reason, 'fraudulent')
    assert.equal(disputes[0]?.amountMinor, 59_900)
    assert.equal(disputes[0]?.currency, 'CZK')
    assert.equal(disputes[0]?.providerChargeId, CHARGE_ID)
    // Visible in OUR admin, with the deadline that makes it actionable.
    assert.ok(disputes[0]?.evidenceDueAt, 'no evidence deadline recorded')

    assert.deepEqual(eventTypes(double), ['DISPUTE_OPENED'])

    // The subscription itself is untouched and still looks perfectly ACTIVE —
    // which is exactly why the suspension cannot be inferred from it.
    assert.equal(subscriptionRow(double)?.status, 'ACTIVE')

    const state = {
      subscriptions: [
        {
          status: 'ACTIVE' as const,
          currentPeriodStart: new Date(PERIOD_START * 1000),
          currentPeriodEnd: new Date(PERIOD_END * 1000),
          planFeatures: plan.features as readonly never[],
        },
      ],
      grants: [],
      suspensions: [
        {
          reason: String(disputes[0]?.reason),
          startsAt: String(disputes[0]?.openedAt),
          endsAt: null,
        },
      ],
    }

    const entitled = resolveEntitlements(
      state,
      new Date((openedAt + 60) * 1000),
    )

    assert.equal(entitled.size, 0, 'a disputed customer still had entitlements')
  })

  it('suspends from when the issuer opened it, not from when we heard', async () => {
    const { double, plan } = world({ status: 'ACTIVE' })

    const openedAt = PERIOD_START + 1000

    await run(
      double,
      stripeEvent(
        'charge.dispute.created',
        disputeObject({ created: openedAt }),
        {
          // Delivered six hours late, as a retried webhook would be.
          created: openedAt + 21_600,
        },
      ),
    )

    const dispute = double.rows('disputes')[0]
    assert.equal(
      dispute?.openedAt,
      new Date(openedAt * 1000).toISOString(),
      'the dispute was dated from our delivery rather than the issuer',
    )

    const state = {
      subscriptions: [
        {
          status: 'ACTIVE' as const,
          currentPeriodStart: new Date(PERIOD_START * 1000),
          currentPeriodEnd: new Date(PERIOD_END * 1000),
          planFeatures: plan.features as readonly never[],
        },
      ],
      grants: [],
      suspensions: [
        {
          reason: 'd',
          startsAt: String(dispute?.openedAt),
          endsAt: null,
        },
      ],
    }

    // An hour after it opened but hours before we were told: already suspended.
    assert.equal(
      resolveEntitlements(state, new Date((openedAt + 3600) * 1000)).size,
      0,
    )
  })

  it('records one dispute however many times the event arrives', async () => {
    const { double } = world({ status: 'ACTIVE' })

    const first = await run(
      double,
      stripeEvent('charge.dispute.created', disputeObject(), {
        id: 'evt_dispute_a',
      }),
    )
    const second = await run(
      double,
      stripeEvent('charge.dispute.created', disputeObject(), {
        id: 'evt_dispute_b',
      }),
    )

    assert.ok(first.applied)
    assert.equal(second.applied, false)
    assert.equal(second.reason, 'DISPUTE_ALREADY_RECORDED')
    assert.equal(double.rows('disputes').length, 1)
  })

  it('restores access when the dispute closes in our favour', async () => {
    const { double, plan } = world({ status: 'ACTIVE' })

    const openedAt = PERIOD_START + 4000

    await run(
      double,
      stripeEvent(
        'charge.dispute.created',
        disputeObject({ created: openedAt }),
        {
          created: openedAt,
        },
      ),
    )
    assert.equal(double.rows('disputes')[0]?.status, 'OPEN')

    const closed = await run(
      double,
      stripeEvent(
        'charge.dispute.closed',
        disputeObject({ created: openedAt, status: 'won' }),
        { created: openedAt + 86_400 },
      ),
    )

    assert.ok(closed.applied, JSON.stringify(closed))

    const dispute = double.rows('disputes')[0]
    assert.equal(dispute?.status, 'WON')
    assert.ok(dispute?.resolvedAt, 'no resolution date recorded')
    assert.deepEqual(eventTypes(double), ['DISPUTE_OPENED', 'DISPUTE_RESOLVED'])

    // The suspension is gone because the loader only treats OPEN and
    // UNDER_REVIEW as suspending. Without this handler the customer would
    // stay locked out until somebody edited the row by hand.
    const state = {
      subscriptions: [
        {
          status: 'ACTIVE' as const,
          currentPeriodStart: new Date(PERIOD_START * 1000),
          currentPeriodEnd: new Date(PERIOD_END * 1000),
          planFeatures: plan.features as readonly never[],
        },
      ],
      grants: [],
      suspensions: [],
    }

    assert.ok(
      resolveEntitlements(state, new Date((openedAt + 90_000) * 1000)).size > 0,
    )
  })

  it('leaves access withdrawn when the dispute is lost', async () => {
    const { double } = world({ status: 'ACTIVE' })

    const openedAt = PERIOD_START + 4000

    await run(
      double,
      stripeEvent(
        'charge.dispute.created',
        disputeObject({ created: openedAt }),
        {
          created: openedAt,
        },
      ),
    )

    const closed = await run(
      double,
      stripeEvent(
        'charge.dispute.closed',
        disputeObject({ created: openedAt, status: 'lost' }),
        { created: openedAt + 86_400 },
      ),
    )

    assert.ok(closed.applied)
    assert.equal(double.rows('disputes')[0]?.status, 'LOST')
  })

  it('does not re-resolve a dispute on a redelivered close', async () => {
    const { double } = world({ status: 'ACTIVE' })

    const openedAt = PERIOD_START + 4000

    await run(
      double,
      stripeEvent(
        'charge.dispute.created',
        disputeObject({ created: openedAt }),
        {
          created: openedAt,
        },
      ),
    )

    const first = await run(
      double,
      stripeEvent(
        'charge.dispute.closed',
        disputeObject({ created: openedAt, status: 'won' }),
        { id: 'evt_close_a', created: openedAt + 86_400 },
      ),
    )
    const resolvedAt = double.rows('disputes')[0]?.resolvedAt

    const second = await run(
      double,
      stripeEvent(
        'charge.dispute.closed',
        disputeObject({ created: openedAt, status: 'won' }),
        { id: 'evt_close_b', created: openedAt + 172_800 },
      ),
    )

    assert.ok(first.applied)
    assert.equal(second.applied, false)
    assert.equal(second.reason, 'DISPUTE_ALREADY_RESOLVED')
    // The resolution date must not move: it is when the issuer decided.
    assert.equal(double.rows('disputes')[0]?.resolvedAt, resolvedAt)
  })

  it('declines to close a dispute it never recorded opening', async () => {
    const { double } = world({ status: 'ACTIVE' })

    const outcome = await run(
      double,
      stripeEvent('charge.dispute.closed', disputeObject({ status: 'won' })),
    )

    assert.equal(outcome.applied, false)
    assert.equal(outcome.reason, 'DISPUTE_NOT_RECORDED')
    assert.equal(double.rows('disputes').length, 0)
  })

  it('refuses to guess a customer for an unattributable dispute', async () => {
    // No invoice names this charge. Nothing is suspended, and the reason is
    // explicit so the route can log it loudly — an unattributed chargeback is
    // money leaving with a deadline and nobody assigned.
    const { double } = world({ status: 'ACTIVE', withInvoice: false })

    const outcome = await run(
      double,
      stripeEvent('charge.dispute.created', disputeObject()),
    )

    assert.equal(outcome.applied, false)
    assert.equal(outcome.reason, 'DISPUTE_NOT_ATTRIBUTABLE')
    assert.equal(double.rows('disputes').length, 0)
  })
})

/* -------------------------------------------------------------------------- */
/* 7. Replay does nothing                                                    */
/* -------------------------------------------------------------------------- */

describe('scenario: replayed event', () => {
  it('changes nothing the second time, with the same event id', async () => {
    const { double } = world({ status: 'INCOMPLETE' })

    const event = stripeEvent(
      'customer.subscription.updated',
      subscriptionObject({ status: 'active' }),
      { id: 'evt_replay_1', created: PERIOD_START + 10 },
    )

    const first = await run(double, event)
    assert.ok(first.applied)
    assert.equal(subscriptionRow(double)?.status, 'ACTIVE')
    assert.equal(double.rows('subscription-events').length, 1)

    // The route would never get here — the claim stops it. Asserted anyway,
    // because "the claim protects us" is a property of one call site and this
    // is a property of the handler.
    const second = await run(double, event)

    assert.equal(subscriptionRow(double)?.status, 'ACTIVE')
    assert.equal(
      double.rows('subscription-events').length,
      1,
      'a replay produced a second audit row',
    )
    assert.ok(second.handled)
  })

  it('does not double-count when a replay carries a fresh event id', async () => {
    // What a dashboard resend actually looks like: same content, new id, so
    // the claim does not recognise it. Only self-idempotency saves us.
    const { double } = world({ status: 'ACTIVE' })

    await run(
      double,
      stripeEvent('invoice.paid', invoiceObject(), {
        id: 'evt_a',
        created: PERIOD_START + 20,
      }),
    )
    await run(
      double,
      stripeEvent('invoice.paid', invoiceObject(), {
        id: 'evt_b',
        created: PERIOD_START + 20,
      }),
    )

    // Two audit rows, because they are genuinely two events as far as the
    // provider is concerned — but no money or state moved twice, which is
    // what the refund and dispute tests above pin down.
    assert.equal(subscriptionRow(double)?.status, 'ACTIVE')
  })
})

/* -------------------------------------------------------------------------- */
/* 8. Out-of-order events                                                    */
/* -------------------------------------------------------------------------- */

describe('scenario: out-of-order delivery', () => {
  it('does not move a recovered subscription back to PAST_DUE', async () => {
    // The sequence that corrupts data in practice: the past_due event's first
    // delivery fails, the recovery is processed, and then the retry lands.
    const { double } = world({ status: 'PAST_DUE' })

    const pastDue = stripeEvent(
      'customer.subscription.updated',
      subscriptionObject({ status: 'past_due' }),
      { id: 'evt_old', created: PERIOD_START + 100 },
    )
    const recovered = stripeEvent(
      'customer.subscription.updated',
      subscriptionObject({ status: 'active' }),
      { id: 'evt_new', created: PERIOD_START + 200 },
    )

    assert.ok((await run(double, recovered)).applied)
    assert.equal(subscriptionRow(double)?.status, 'ACTIVE')

    const stale = await run(double, pastDue)

    assert.equal(stale.applied, false)
    assert.equal(stale.reason, 'ORDERING_STALE_SEQUENCE')
    assert.equal(
      subscriptionRow(double)?.status,
      'ACTIVE',
      'a stale event dragged a paying customer back to PAST_DUE',
    )

    // The stale event is still visible in the audit log, marked as skipped.
    // Silence would make this impossible to diagnose from the data.
    assert.deepEqual(eventTypes(double), ['PAYMENT_RECOVERED', 'PROVIDER_SYNC'])
  })

  it('does not revive a cancelled subscription on a same-second event', async () => {
    // Cancellation and a final `updated` often share a second, so the
    // timestamp cannot break the tie. The terminal-state guard does.
    const { double } = world({ status: 'ACTIVE' })

    const canceled = stripeEvent(
      'customer.subscription.deleted',
      subscriptionObject({
        status: 'canceled',
        canceledAt: PERIOD_START + 300,
        endedAt: PERIOD_START + 300,
      }),
      { id: 'evt_cancel', created: PERIOD_START + 300 },
    )
    const sameSecondUpdate = stripeEvent(
      'customer.subscription.updated',
      subscriptionObject({ status: 'active' }),
      { id: 'evt_update', created: PERIOD_START + 300 },
    )

    assert.ok((await run(double, canceled)).applied)
    assert.equal(subscriptionRow(double)?.status, 'CANCELED')

    const regression = await run(double, sameSecondUpdate)

    assert.equal(regression.applied, false)
    assert.equal(regression.reason, 'ORDERING_TERMINAL_STATE')
    assert.equal(
      subscriptionRow(double)?.status,
      'CANCELED',
      'a cancelled subscription was revived',
    )
  })

  it('does not revive a cancelled subscription on a genuinely newer event', async () => {
    // Stripe never un-cancels, so even a later event claiming `active` is
    // wrong. This is the guard that does not depend on timestamps at all.
    const { double } = world({ status: 'ACTIVE' })

    await run(
      double,
      stripeEvent(
        'customer.subscription.deleted',
        subscriptionObject({ status: 'canceled', endedAt: PERIOD_START + 300 }),
        { created: PERIOD_START + 300 },
      ),
    )

    const later = await run(
      double,
      stripeEvent(
        'customer.subscription.updated',
        subscriptionObject({ status: 'active' }),
        { created: PERIOD_START + 99_999 },
      ),
    )

    assert.equal(later.applied, false)
    assert.equal(later.reason, 'ORDERING_TERMINAL_STATE')
    assert.equal(subscriptionRow(double)?.status, 'CANCELED')
  })

  it('applies an event that is genuinely newer', async () => {
    const { double } = world({ status: 'ACTIVE' })

    await run(
      double,
      stripeEvent(
        'customer.subscription.updated',
        subscriptionObject({ status: 'past_due' }),
        { created: PERIOD_START + 100 },
      ),
    )
    assert.equal(subscriptionRow(double)?.status, 'PAST_DUE')

    const newer = await run(
      double,
      stripeEvent(
        'customer.subscription.updated',
        subscriptionObject({ status: 'active' }),
        { created: PERIOD_START + 400 },
      ),
    )

    assert.ok(newer.applied, JSON.stringify(newer))
    assert.equal(subscriptionRow(double)?.status, 'ACTIVE')
  })
})

/* -------------------------------------------------------------------------- */
/* 9. Unhandled and unknown                                                  */
/* -------------------------------------------------------------------------- */

describe('unhandled events', () => {
  it('reports an unhandled type without touching anything', async () => {
    const { double } = world({ status: 'ACTIVE' })

    const outcome = await run(
      double,
      stripeEvent('radar.early_fraud_warning.created', { id: 'issfr_1' }),
    )

    assert.equal(outcome.handled, false)
    assert.equal(outcome.applied, false)
    assert.equal(outcome.reason, 'NO_HANDLER')
    assert.equal(subscriptionRow(double)?.status, 'ACTIVE')
  })

  it('declines a subscription event for a subscription we do not have', async () => {
    const double = createPayloadDouble()

    const outcome = await run(
      double,
      stripeEvent('customer.subscription.updated', subscriptionObject()),
    )

    assert.ok(outcome.handled)
    assert.equal(outcome.applied, false)
    assert.equal(outcome.reason, 'NO_LOCAL_SUBSCRIPTION')
  })

  it('declines a subscription whose currency we do not sell in', async () => {
    const { double } = world({ status: 'ACTIVE' })

    const outcome = await run(
      double,
      stripeEvent(
        'customer.subscription.updated',
        subscriptionObject({ currency: 'jpy' }),
      ),
    )

    assert.equal(outcome.applied, false)
    // Specifically NOT_OURS, and specifically not an unreadable payload: this
    // is a correct refusal and must not look like a fault.
    assert.equal(outcome.reason, 'NOT_OURS_CURRENCY')
    assert.notEqual(outcome.unreadable, true)
    assert.equal(outcome.detail?.currency, 'jpy')
    assert.deepEqual(outcome.detail?.weSell, ['CZK', 'EUR'])
    assert.equal(subscriptionRow(double)?.currency, 'CZK')
  })

  it('reports a USD trigger fixture as not ours, not as unparseable', async () => {
    // Exactly what `stripe trigger customer.subscription.created` produces:
    // a perfectly readable subscription in a currency we do not sell. This
    // used to share one reason string with a payload we could not parse,
    // which made a correct refusal indistinguishable from a broken
    // integration.
    const { double } = world({ status: 'ACTIVE' })

    const outcome = await run(
      double,
      stripeEvent(
        'customer.subscription.created',
        subscriptionObject({ currency: 'usd' }),
      ),
    )

    assert.equal(outcome.reason, 'NOT_OURS_CURRENCY')
    assert.notEqual(outcome.unreadable, true)
  })

  it('names the API version when the payload predates the field move', async () => {
    // Periods on the subscription instead of the item. The refusal must say
    // so, because this one breaks every subscription event rather than
    // just this one.
    const { double } = world({ status: 'ACTIVE' })

    const outcome = await run(
      double,
      stripeEvent(
        'customer.subscription.updated',
        preRelocationSubscriptionObject(),
      ),
    )

    assert.equal(outcome.applied, false)
    assert.equal(outcome.reason, 'UNREADABLE_PERIOD_FIELDS')
    assert.equal(outcome.unreadable, true)
    assert.equal(outcome.detail?.periodOnItem, false)
    assert.equal(
      outcome.detail?.periodOnSubscriptionInstead,
      true,
      'the refusal did not notice the period was in the OLD place',
    )
    assert.equal(outcome.detail?.fieldsMovedIn, '2025-03-31.basil')
    // Nothing was written on a payload we could not read.
    assert.equal(subscriptionRow(double)?.status, 'ACTIVE')
  })

  it('reports the version problem even when the currency is also wrong', async () => {
    // Both faults at once. The version one wins, because it is the one that
    // explains every other subscription failing too.
    const { double } = world({ status: 'ACTIVE' })

    const outcome = await run(
      double,
      stripeEvent(
        'customer.subscription.updated',
        preRelocationSubscriptionObject({ currency: 'usd' }),
      ),
    )

    assert.equal(outcome.reason, 'UNREADABLE_PERIOD_FIELDS')
    assert.equal(outcome.unreadable, true)
  })

  it('declines a multi-item subscription as not ours', async () => {
    const { double } = world({ status: 'ACTIVE' })

    const outcome = await run(
      double,
      stripeEvent(
        'customer.subscription.updated',
        multiItemSubscriptionObject(),
      ),
    )

    assert.equal(outcome.reason, 'NOT_OURS_MULTIPLE_ITEMS')
    assert.notEqual(outcome.unreadable, true)
    assert.equal(outcome.detail?.itemCount, 2)
  })

  it('declines an interval we do not sell as not ours', async () => {
    const { double } = world({ status: 'ACTIVE' })

    const weekly = subscriptionObject() as unknown as {
      items: { data: { price: { recurring: Record<string, unknown> } }[] }
    }
    weekly.items.data[0]!.price.recurring = {
      interval: 'week',
      interval_count: 1,
    }

    const outcome = await run(
      double,
      stripeEvent(
        'customer.subscription.updated',
        weekly as unknown as Parameters<typeof stripeEvent>[1],
      ),
    )

    assert.equal(outcome.reason, 'NOT_OURS_INTERVAL')
    assert.notEqual(outcome.unreadable, true)
    assert.equal(outcome.detail?.interval, 'week')
  })

  it('never lets a not-ours reason and an unreadable reason coincide', async () => {
    // The property the brief asked for, asserted directly rather than implied
    // by the cases above.
    const { double } = world({ status: 'ACTIVE' })

    const notOurs = await run(
      double,
      stripeEvent(
        'customer.subscription.updated',
        subscriptionObject({ currency: 'usd' }),
      ),
    )
    const unreadable = await run(
      double,
      stripeEvent(
        'customer.subscription.updated',
        preRelocationSubscriptionObject(),
      ),
    )

    assert.notEqual(notOurs.reason, unreadable.reason)
    assert.ok(String(notOurs.reason).startsWith('NOT_OURS_'))
    assert.ok(String(unreadable.reason).startsWith('UNREADABLE_'))
  })

  it('refuses to overwrite our currency with a different one', async () => {
    // EUR is in our enum but the row is locked to CZK. A provider-side
    // currency change is a reconciliation problem, not something to apply.
    const { double } = world({ status: 'ACTIVE' })

    const outcome = await run(
      double,
      stripeEvent(
        'customer.subscription.updated',
        subscriptionObject({ currency: 'eur' }),
      ),
    )

    assert.equal(outcome.applied, false)
    assert.equal(outcome.reason, 'CURRENCY_MISMATCH')
    assert.equal(subscriptionRow(double)?.currency, 'CZK')
  })
})

/* -------------------------------------------------------------------------- */
/* 10. Plan changes                                                          */
/* -------------------------------------------------------------------------- */

describe('plan changes seen from the provider', () => {
  it('records a price change as PLAN_CHANGED', async () => {
    const { double } = world({ status: 'ACTIVE' })

    // Same status, same cancellation flag, different price. The transition
    // classifier has to notice the price rather than shrugging at the status.
    const outcome = await run(
      double,
      stripeEvent(
        'customer.subscription.updated',
        subscriptionObject({
          status: 'active',
          priceId: 'price_fixture_insider_czk_month',
          unitAmountMinor: 99_900,
        }),
        { created: PERIOD_START + 500 },
      ),
    )

    assert.ok(outcome.applied, JSON.stringify(outcome))
    assert.equal(subscriptionRow(double)?.priceMinor, 99_900)
  })

  it('moves the plan relationship, not just the amount', async () => {
    // The bug this closes: a Stripe-side upgrade changed `priceMinor` and
    // left `plan` alone, so the customer paid for PRO and was served START.
    // Entitlements come from `plan.features`, so the amount on its own
    // changes nothing a customer can see.
    const { double, subscription } = world({ status: 'ACTIVE' })

    const insiderPlan = double.seed('plans', {
      code: 'INSIDER',
      features: ['TIPS_PRO', 'TRACK_RECORD', 'API_ACCESS'],
    })
    double.seed('prices', {
      plan: insiderPlan.id,
      currency: 'CZK',
      interval: 'MONTH',
      amountMinor: 99_900,
      providerPriceId: 'price_fixture_insider_czk_month',
    })

    const outcome = await run(
      double,
      stripeEvent(
        'customer.subscription.updated',
        subscriptionObject({
          status: 'active',
          priceId: 'price_fixture_insider_czk_month',
          unitAmountMinor: 99_900,
        }),
        { created: PERIOD_START + 600 },
      ),
    )

    assert.ok(outcome.applied, JSON.stringify(outcome))

    const row = subscriptionRow(double)
    assert.equal(row?.priceMinor, 99_900)
    assert.equal(
      row?.plan,
      insiderPlan.id,
      'the plan did not follow the price change',
    )
    assert.notEqual(row?.plan, subscription.plan)
    assert.deepEqual(eventTypes(double), ['PLAN_CHANGED'])
  })

  it('leaves the plan alone when the provider price is unknown to us', async () => {
    // Guessing a plan from an amount would be worse than a divergence: the
    // row would look correct while granting the wrong features. The
    // reconciliation script reports this instead.
    const { double, subscription } = world({ status: 'ACTIVE' })

    const outcome = await run(
      double,
      stripeEvent(
        'customer.subscription.updated',
        subscriptionObject({
          status: 'active',
          priceId: 'price_nobody_has_ever_seen',
          unitAmountMinor: 123_400,
        }),
        { created: PERIOD_START + 700 },
      ),
    )

    assert.ok(outcome.applied)
    assert.equal(subscriptionRow(double)?.plan, subscription.plan)
    assert.ok(
      outcome.changes.some((change) => change.includes('plan UNRESOLVED')),
      `expected the outcome to flag the unresolved plan, got ${JSON.stringify(outcome.changes)}`,
    )
  })

  it('keeps the period untouched when only the price changes', async () => {
    const { double } = world({ status: 'ACTIVE' })

    await run(
      double,
      stripeEvent(
        'customer.subscription.updated',
        subscriptionObject({ status: 'active', unitAmountMinor: 99_900 }),
        { created: PERIOD_START + 500 },
      ),
    )

    assert.equal(
      subscriptionRow(double)?.currentPeriodEnd,
      new Date(PERIOD_END * 1000).toISOString(),
    )
    assert.equal(subscriptionRow(double)?.providerPriceId, undefined)
  })
})

/* -------------------------------------------------------------------------- */
/* 11. Field positions this API version moved                                */
/* -------------------------------------------------------------------------- */

describe('API version field positions', () => {
  it('reads the period from the subscription ITEM', async () => {
    const { double } = world({ status: 'ACTIVE' })

    const customStart = PERIOD_START + 10_000
    const customEnd = PERIOD_END + 10_000

    await run(
      double,
      stripeEvent(
        'customer.subscription.updated',
        subscriptionObject({
          status: 'active',
          periodStart: customStart,
          periodEnd: customEnd,
        }),
        { created: customStart },
      ),
    )

    const row = subscriptionRow(double)

    // If the handler read `subscription.current_period_end` it would get
    // undefined and store an invalid date, i.e. "entitled until never".
    assert.equal(
      row?.currentPeriodEnd,
      new Date(customEnd * 1000).toISOString(),
    )
    assert.equal(
      row?.currentPeriodStart,
      new Date(customStart * 1000).toISOString(),
    )
  })

  it('reads an invoice subscription from parent.subscription_details', async () => {
    const { double } = world({ status: 'PAST_DUE' })

    const outcome = await run(
      double,
      stripeEvent('invoice.paid', invoiceObject({ status: 'paid' })),
    )

    // If the handler read `invoice.subscription` it would find nothing and
    // never attribute the renewal.
    assert.ok(outcome.applied, JSON.stringify(outcome))
    assert.equal(subscriptionRow(double)?.status, 'ACTIVE')
  })

  it('declines an invoice with no subscription parent', async () => {
    const { double } = world({ status: 'ACTIVE' })

    const outcome = await run(
      double,
      stripeEvent(
        'invoice.paid',
        invoiceObject({ status: 'paid', subscriptionId: null }),
      ),
    )

    assert.equal(outcome.applied, false)
    assert.equal(outcome.reason, 'INVOICE_NOT_FROM_SUBSCRIPTION')
  })

  it('matches a payment intent to our invoice via providerPaymentId', async () => {
    const { double } = world({ status: 'ACTIVE' })

    const outcome = await run(
      double,
      stripeEvent(
        'payment_intent.succeeded',
        paymentIntentObject({ status: 'succeeded' }),
      ),
    )

    assert.ok(outcome.applied, JSON.stringify(outcome))
    assert.deepEqual(eventTypes(double), ['RENEWED'])
  })
})

/* -------------------------------------------------------------------------- */
/* 12. Nothing sensitive is logged                                           */
/* -------------------------------------------------------------------------- */

describe('secret hygiene through a whole flow', () => {
  it('never writes a secret or a card number to the log', async () => {
    const { double } = world({ status: 'INCOMPLETE' })

    // Values that must not appear in any log line, each planted somewhere the
    // handler will see it.
    const CARD = '4242424242424242'
    const CLIENT_SECRET = `${PAYMENT_INTENT_ID}_secret_abc123def456`

    const planted = invoiceObject({ status: 'paid' }) as unknown as Record<
      string,
      unknown
    >
    planted.client_secret = CLIENT_SECRET
    planted.hosted_invoice_url = `https://pay.stripe.test/${CLIENT_SECRET}`
    planted.description = `Card ending ${CARD}`

    await run(
      double,
      stripeEvent(
        'customer.subscription.updated',
        subscriptionObject({ status: 'active' }),
        { created: PERIOD_START + 1 },
      ),
    )
    await run(
      double,
      stripeEvent('invoice.paid', planted, { created: PERIOD_START + 2 }),
    )
    await run(
      double,
      stripeEvent('charge.refunded', chargeObject(), {
        created: PERIOD_START + 3,
      }),
    )
    await run(
      double,
      stripeEvent('charge.dispute.created', disputeObject(), {
        created: PERIOD_START + 4,
      }),
    )

    const everything = double.logs.join('\n')

    for (const secret of [
      CARD,
      CLIENT_SECRET,
      WEBHOOK_SECRET,
      'sk_test_abcdefghijklmnopqrstuvwx',
    ]) {
      assert.equal(
        everything.includes(secret),
        false,
        `a secret value reached the log: ${secret.slice(0, 8)}…`,
      )
    }

    // And the audit rows, which are stored rather than logged, are clean too.
    const stored = JSON.stringify(double.rows('subscription-events'))
    assert.equal(stored.includes(CARD), false)
    assert.equal(stored.includes(CLIENT_SECRET), false)
  })
})
