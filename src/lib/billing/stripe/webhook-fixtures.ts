/**
 * Recorded Stripe event shapes, and a database double to run them against.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY FIXTURES AND NOT THE STRIPE CLI
 *
 * Both are allowed. Fixtures win here for three reasons:
 *
 *   - They run in CI with no credentials, no network and no Stripe account.
 *     A test that only runs on a developer's machine with `stripe listen`
 *     attached is a test that stops running.
 *   - They can express states the CLI cannot easily produce on demand: an
 *     `invoice.paid` event for an invoice that is still `open`, an event
 *     delivered out of order, a replay.
 *   - Signature verification is not weakened by using them. The fixtures are
 *     signed with `Stripe.webhooks.generateTestHeaderString` and verified by
 *     `Stripe.webhooks.constructEvent` — the same HMAC either way. HMAC does
 *     not care who holds the secret, so a locally generated `whsec_` proves
 *     exactly as much as Stripe's would.
 *
 * What fixtures CANNOT prove is that the shapes below match what Stripe
 * actually sends. They were written against the type definitions of the
 * pinned API version (`2026-09-30.endive`), which is the best available check
 * short of live keys, and they deliberately use the POST-migration field
 * positions — periods on the item, `parent.subscription_details`,
 * `payments[].payment` — so a regression to the old positions fails here.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE PAYLOAD DOUBLE
 *
 * Supports the handful of query shapes the handlers use: `and`, `equals`,
 * `in`. It is a double, not a mock — it stores documents and answers queries
 * about them, so a handler that writes the wrong thing fails the assertion
 * rather than merely failing to call a spy.
 */
import type { Payload } from 'payload'
import type Stripe from 'stripe'

/* -------------------------------------------------------------------------- */
/* Event fixtures                                                             */
/* -------------------------------------------------------------------------- */

export const SUB_ID = 'sub_fixture_1'
export const CUSTOMER_ID = 'cus_fixture_1'
export const PRICE_ID = 'price_fixture_pro_czk_month'
export const INVOICE_ID = 'in_fixture_1'
export const PAYMENT_INTENT_ID = 'pi_fixture_1'
export const CHARGE_ID = 'ch_fixture_1'
export const REFUND_ID = 're_fixture_1'
export const DISPUTE_ID = 'dp_fixture_1'

/** 2026-03-15T10:00:00Z, in whole seconds, as Stripe reports times. */
export const PERIOD_START = 1_773_568_800
/** One month later. */
export const PERIOD_END = 1_776_160_800

const PRICE = {
  id: PRICE_ID,
  object: 'price',
  active: true,
  currency: 'czk',
  unit_amount: 59_900,
  recurring: { interval: 'month', interval_count: 1 },
} as const

export type SubscriptionFixtureOptions = {
  status?: Stripe.Subscription.Status
  cancelAtPeriodEnd?: boolean
  canceledAt?: number | null
  endedAt?: number | null
  periodStart?: number
  periodEnd?: number
  priceId?: string
  unitAmountMinor?: number
  currency?: string
}

/** A Stripe subscription as this API version shapes it. */
export const subscriptionObject = (
  options: SubscriptionFixtureOptions = {},
): Stripe.Subscription =>
  ({
    id: SUB_ID,
    object: 'subscription',
    customer: CUSTOMER_ID,
    currency: options.currency ?? 'czk',
    status: options.status ?? 'active',
    cancel_at: null,
    cancel_at_period_end: options.cancelAtPeriodEnd ?? false,
    canceled_at: options.canceledAt ?? null,
    ended_at: options.endedAt ?? null,
    schedule: null,
    latest_invoice: INVOICE_ID,
    items: {
      object: 'list',
      has_more: false,
      url: '',
      data: [
        {
          id: 'si_fixture_1',
          object: 'subscription_item',
          quantity: 1,
          // MOVED FIELDS. On the item in this API version, not on the
          // subscription. A fixture that put them on the subscription would
          // let a regression to the old field positions pass.
          current_period_start: options.periodStart ?? PERIOD_START,
          current_period_end: options.periodEnd ?? PERIOD_END,
          price: {
            ...PRICE,
            id: options.priceId ?? PRICE_ID,
            unit_amount: options.unitAmountMinor ?? PRICE.unit_amount,
            currency: options.currency ?? 'czk',
          },
        },
      ],
    },
  }) as unknown as Stripe.Subscription

export type InvoiceFixtureOptions = {
  status?: Stripe.Invoice.Status
  amountRemaining?: number
  amountPaid?: number
  subscriptionId?: string | null
  paymentIntentId?: string | null
  chargeId?: string | null
}

/** A Stripe invoice as this API version shapes it. */
export const invoiceObject = (
  options: InvoiceFixtureOptions = {},
): Stripe.Invoice =>
  ({
    id: INVOICE_ID,
    object: 'invoice',
    customer: CUSTOMER_ID,
    currency: 'czk',
    status: options.status ?? 'paid',
    amount_paid: options.amountPaid ?? 59_900,
    amount_remaining: options.amountRemaining ?? 0,
    total: 59_900,
    // MOVED: this was `invoice.subscription`.
    parent:
      options.subscriptionId === null
        ? { type: 'manual', quote_details: null, subscription_details: null }
        : {
            type: 'subscription_details',
            quote_details: null,
            subscription_details: {
              metadata: null,
              subscription: options.subscriptionId ?? SUB_ID,
            },
          },
    // MOVED: this was `invoice.payment_intent`.
    payments: {
      object: 'list',
      has_more: false,
      url: '',
      data: [
        {
          id: 'inpay_fixture_1',
          object: 'invoice_payment',
          payment: {
            type: 'payment_intent',
            payment_intent:
              options.paymentIntentId === null
                ? undefined
                : (options.paymentIntentId ?? PAYMENT_INTENT_ID),
            ...(options.chargeId ? { charge: options.chargeId } : {}),
          },
        },
      ],
    },
  }) as unknown as Stripe.Invoice

export const paymentIntentObject = (
  options: { status?: Stripe.PaymentIntent.Status; amount?: number } = {},
): Stripe.PaymentIntent =>
  ({
    id: PAYMENT_INTENT_ID,
    object: 'payment_intent',
    customer: CUSTOMER_ID,
    currency: 'czk',
    amount: options.amount ?? 59_900,
    status: options.status ?? 'succeeded',
    latest_charge: CHARGE_ID,
  }) as unknown as Stripe.PaymentIntent

export const chargeObject = (
  options: {
    refunded?: boolean
    amountRefunded?: number
    refundStatus?: string
    refundAmount?: number
    includeRefund?: boolean
  } = {},
): Stripe.Charge =>
  ({
    id: CHARGE_ID,
    object: 'charge',
    customer: CUSTOMER_ID,
    currency: 'czk',
    amount: 59_900,
    amount_refunded: options.amountRefunded ?? 59_900,
    refunded: options.refunded ?? true,
    payment_intent: PAYMENT_INTENT_ID,
    refunds:
      options.includeRefund === false
        ? { object: 'list', has_more: false, url: '', data: [] }
        : {
            object: 'list',
            has_more: false,
            url: '',
            data: [
              {
                id: REFUND_ID,
                object: 'refund',
                amount: options.refundAmount ?? 59_900,
                currency: 'czk',
                charge: CHARGE_ID,
                status: options.refundStatus ?? 'succeeded',
              },
            ],
          },
  }) as unknown as Stripe.Charge

export const disputeObject = (
  options: {
    status?: Stripe.Dispute.Status
    amount?: number
    reason?: string
    dueBy?: number | null
    created?: number
  } = {},
): Stripe.Dispute =>
  ({
    id: DISPUTE_ID,
    object: 'dispute',
    charge: CHARGE_ID,
    payment_intent: PAYMENT_INTENT_ID,
    amount: options.amount ?? 59_900,
    currency: 'czk',
    reason: options.reason ?? 'fraudulent',
    status: options.status ?? 'needs_response',
    created: options.created ?? PERIOD_START + 86_400,
    evidence_details: {
      due_by: options.dueBy === null ? null : (options.dueBy ?? PERIOD_END),
      has_evidence: false,
    },
  }) as unknown as Stripe.Dispute

/**
 * A subscription as a PRE-`2025-03-31.basil` payload would arrive.
 *
 * Periods on the SUBSCRIPTION, absent from the item. This is what the account
 * or endpoint rendering events at an older version actually looks like, and
 * the only way to test that the refusal names the version rather than
 * shrugging.
 */
export const preRelocationSubscriptionObject = (
  options: SubscriptionFixtureOptions = {},
): Stripe.Subscription => {
  const modern = subscriptionObject(options) as unknown as Record<
    string,
    unknown
  >
  const items = modern.items as { data: Record<string, unknown>[] }
  const item = items.data[0] as Record<string, unknown>

  modern.current_period_start = item.current_period_start
  modern.current_period_end = item.current_period_end
  delete item.current_period_start
  delete item.current_period_end

  return modern as unknown as Stripe.Subscription
}

/** A subscription with two items, as only a hand-built one would be. */
export const multiItemSubscriptionObject = (): Stripe.Subscription => {
  const base = subscriptionObject() as unknown as Record<string, unknown>
  const items = base.items as { data: unknown[] }
  items.data = [items.data[0], { ...(items.data[0] as object), id: 'si_two' }]

  return base as unknown as Stripe.Subscription
}

let eventCounter = 0

/** Wrap an object in a Stripe event envelope. */
export const stripeEvent = <T>(
  type: string,
  object: T,
  options: { created?: number; id?: string } = {},
): Stripe.Event =>
  ({
    id: options.id ?? `evt_fixture_${++eventCounter}`,
    object: 'event',
    api_version: '2026-09-30.endive',
    created: options.created ?? PERIOD_START,
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type,
    data: { object },
  }) as unknown as Stripe.Event

/* -------------------------------------------------------------------------- */
/* Payload double                                                             */
/* -------------------------------------------------------------------------- */

type Doc = Record<string, unknown> & { id: number }

type WhereClause = Record<string, unknown>

/** Evaluate the subset of Payload's query language the handlers use. */
const matches = (doc: Doc, where: WhereClause | undefined): boolean => {
  if (!where) return true

  for (const [key, condition] of Object.entries(where)) {
    if (key === 'and') {
      const clauses = condition as WhereClause[]

      if (!clauses.every((clause) => matches(doc, clause))) return false

      continue
    }

    if (key === 'or') {
      const clauses = condition as WhereClause[]

      if (!clauses.some((clause) => matches(doc, clause))) return false

      continue
    }

    const operators = condition as Record<string, unknown>
    const actual = doc[key]

    if ('equals' in operators) {
      // Loose on purpose: a relationship is stored as a number and queried
      // with a number or a string depending on the caller, and Payload itself
      // coerces. Being stricter here would make the double reject queries the
      // real thing answers.
      if (String(actual) !== String(operators.equals)) return false
    }

    if ('in' in operators) {
      const candidates = (operators.in as unknown[]).map(String)

      if (!candidates.includes(String(actual))) return false
    }
  }

  return true
}

export type PayloadDouble = {
  payload: Payload
  /** Every stored document, by collection slug. */
  store: Map<string, Doc[]>
  /** Everything written to the logger, for the secret-leak test. */
  logs: string[]
  /** Seed a document and get its id. */
  seed(collection: string, data: Record<string, unknown>): Doc
  rows(collection: string): Doc[]
}

export const createPayloadDouble = (): PayloadDouble => {
  const store = new Map<string, Doc[]>()
  const logs: string[] = []
  let nextId = 1

  const rows = (collection: string): Doc[] => {
    const existing = store.get(collection)

    if (existing) return existing

    const created: Doc[] = []
    store.set(collection, created)

    return created
  }

  const seed = (collection: string, data: Record<string, unknown>): Doc => {
    const doc = { ...data, id: nextId++ } as Doc
    rows(collection).push(doc)

    // A copy here too, so a test that keeps the seeded document is reading
    // what it seeded rather than whatever the handler has done since.
    return { ...doc }
  }

  const record = (line: unknown, message?: unknown): void => {
    // Both arguments, serialised the way a structured logger would. The
    // secret-leak test greps this.
    logs.push(JSON.stringify(line))
    if (message !== undefined) logs.push(String(message))
  }

  const logger = {
    info: record,
    warn: record,
    error: record,
    debug: record,
    trace: record,
    fatal: record,
    silent: () => {},
    level: 'info',
  }

  const payload = {
    logger,

    async find({
      collection,
      where,
      limit,
    }: {
      collection: string
      where?: WhereClause
      limit?: number
    }) {
      const matching = rows(collection).filter((doc) => matches(doc, where))
      const page = limit && limit > 0 ? matching.slice(0, limit) : matching

      // COPIES, not the stored objects. Real Payload returns freshly
      // deserialised documents, so a caller holding one does not silently
      // observe a later write. Returning live references made a test pass
      // that should have failed, and would hide a handler that mutated a
      // document it had only read.
      return {
        docs: page.map((doc) => ({ ...doc })),
        totalDocs: matching.length,
      }
    },

    async create({
      collection,
      data,
    }: {
      collection: string
      data: Record<string, unknown>
    }) {
      return seed(collection, data)
    },

    async findByID({
      collection,
      id,
    }: {
      collection: string
      id: number | string
    }) {
      const doc = rows(collection).find((row) => String(row.id) === String(id))

      if (!doc) throw new Error(`No ${collection} with id ${String(id)}`)

      return { ...doc }
    },

    async update({
      collection,
      id,
      data,
    }: {
      collection: string
      id: number | string
      data: Record<string, unknown>
    }) {
      const doc = rows(collection).find((row) => String(row.id) === String(id))

      if (!doc) throw new Error(`No ${collection} with id ${String(id)}`)

      Object.assign(doc, data)

      return { ...doc }
    },
  } as unknown as Payload

  return {
    payload,
    store,
    logs,
    seed,
    rows,
  }
}
