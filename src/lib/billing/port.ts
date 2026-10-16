/**
 * The billing port: everything the application is allowed to know about taking
 * money.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * NO PROVIDER TYPE APPEARS IN THIS FILE
 *
 * Not `Stripe.Subscription`, not a Stripe status string, not a Stripe price id
 * under a generic name. Only our own domain types. That is the whole point: if
 * a provider type leaked in here it would spread outward through every caller,
 * and "swap the provider" would stop being a file and become a refactor.
 *
 * The rule has a practical test. If `grep -i stripe` over this file returns
 * anything but prose, the abstraction has already failed.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * RESULTS, NOT EXCEPTIONS, FOR EXPECTED FAILURES
 *
 * A declined card is not an error in the programming sense. It is one of the
 * ordinary outcomes of asking for money, it happens to a few percent of real
 * customers, and the caller has to show them something useful. Modelling it as
 * a thrown exception means every call site needs a `try`/`catch` that is easy
 * to forget — and a forgotten one turns "your card was declined" into a 500.
 *
 * So every operation returns a `BillingResult`. Exceptions are reserved for
 * two things the caller genuinely cannot handle:
 *
 *   - `BillingConfigurationError` — we are misconfigured. A programming or
 *     deployment fault; retrying will not help.
 *   - `BillingProviderUnreachableError` — the provider is down or unreachable.
 *     Not the customer's fault and not an outcome of their payment.
 *
 * Everything else — declined, insufficient funds, authentication required,
 * expired card, no such subscription — is a typed failure value.
 */
import type {
  BillingInterval,
  BillingProvider,
  Currency,
  SubscriptionStatus,
} from './constants.ts'

/* -------------------------------------------------------------------------- */
/* Failure vocabulary                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Every expected way an operation can fail.
 *
 * Deliberately OUR codes, not the provider's. A provider's decline codes
 * change, differ between providers, and are not safe to show a customer
 * verbatim. The provider's own code travels alongside in `providerCode` for
 * support to look up.
 */
export const BILLING_FAILURE_CODES = [
  /* --- the customer's payment instrument --------------------------------- */
  /** Generic decline. The issuer said no and will not say why. */
  'CARD_DECLINED',
  'INSUFFICIENT_FUNDS',
  'EXPIRED_CARD',
  'INCORRECT_CVC',
  'INCORRECT_NUMBER',
  /** 3-D Secure or equivalent. NOT a failure — the customer must act. */
  'AUTHENTICATION_REQUIRED',
  /** The provider could not process it; usually worth one retry. */
  'PROCESSING_ERROR',

  /* --- our data vs theirs ------------------------------------------------- */
  'CUSTOMER_NOT_FOUND',
  'SUBSCRIPTION_NOT_FOUND',
  'PAYMENT_METHOD_NOT_FOUND',
  'CHARGE_NOT_FOUND',
  /** The plan exists here but has never been reconciled into the provider. */
  'PRICE_NOT_SYNCED',
  /** Our currency and the provider's price disagree. Never guess; refuse. */
  'CURRENCY_MISMATCH',
  /**
   * Our amount and the provider's price disagree.
   *
   * Means the two sides have drifted. Refuse rather than charge whichever one
   * happens to be loaded: charging the wrong amount is a refund, an apology
   * and a corrected invoice, all of which cost more than a failed request.
   */
  'AMOUNT_MISMATCH',

  /* --- lifecycle --------------------------------------------------------- */
  'ALREADY_CANCELED',
  'NOT_CANCELABLE',
  'NOTHING_TO_RESUME',
  'REFUND_EXCEEDS_CHARGE',
  'ALREADY_REFUNDED',

  /* --- the request itself ------------------------------------------------- */
  'RATE_LIMITED',
  /** We asked for something the provider considers invalid. Likely our bug. */
  'INVALID_REQUEST',
] as const

export type BillingFailureCode = (typeof BILLING_FAILURE_CODES)[number]

/** Failures where trying the same thing again could plausibly work. */
export const RETRYABLE_FAILURE_CODES: readonly BillingFailureCode[] = [
  'PROCESSING_ERROR',
  'RATE_LIMITED',
] as const

export type BillingFailure = {
  ok: false
  code: BillingFailureCode
  /**
   * Czech, safe to show the customer.
   *
   * Never the provider's raw message: those are English, change without
   * notice, and occasionally mention internal detail.
   */
  message: string
  /** Whether retrying the identical call could succeed. */
  retryable: boolean
  /** The provider's own code, for support. Not shown to the customer. */
  providerCode?: string
  /**
   * For AUTHENTICATION_REQUIRED: the secret the front end needs to finish 3-D
   * Secure. A BEARER CREDENTIAL — never log it, never put it in an error
   * report. See `src/lib/billing/redact.ts`.
   */
  clientSecret?: string
}

export type BillingSuccess<T> = { ok: true; value: T }

export type BillingResult<T> = BillingSuccess<T> | BillingFailure

export const billingOk = <T>(value: T): BillingSuccess<T> => ({
  ok: true,
  value,
})

export const billingFail = (
  code: BillingFailureCode,
  message: string,
  extra: { providerCode?: string; clientSecret?: string } = {},
): BillingFailure => ({
  ok: false,
  code,
  message,
  retryable: RETRYABLE_FAILURE_CODES.includes(code),
  ...(extra.providerCode ? { providerCode: extra.providerCode } : {}),
  ...(extra.clientSecret ? { clientSecret: extra.clientSecret } : {}),
})

/* -------------------------------------------------------------------------- */
/* Exceptions — only for what a caller cannot handle                          */
/* -------------------------------------------------------------------------- */

/** We are misconfigured. A deployment or programming fault. */
export class BillingConfigurationError extends Error {
  readonly code = 'BILLING_MISCONFIGURED'

  constructor(message: string) {
    super(message)
    this.name = 'BillingConfigurationError'
  }
}

/**
 * The provider could not be reached at all.
 *
 * Distinct from `PROCESSING_ERROR`, which is the provider answering "no". This
 * is the provider not answering — a different operational problem, and not
 * something to tell the customer about their card.
 */
export class BillingProviderUnreachableError extends Error {
  readonly code = 'BILLING_PROVIDER_UNREACHABLE'
  readonly provider: BillingProvider

  constructor(provider: BillingProvider, options?: ErrorOptions) {
    super(`Billing provider ${provider} is unreachable.`, options)
    this.name = 'BillingProviderUnreachableError'
    this.provider = provider
  }
}

/* -------------------------------------------------------------------------- */
/* Domain shapes crossing the port                                            */
/* -------------------------------------------------------------------------- */

/** Our side of the seam: a customer as the provider knows them. */
export type ProviderCustomerRef = {
  provider: BillingProvider
  externalId: string
}

/**
 * A subscription as the provider currently reports it, translated into our
 * vocabulary.
 *
 * `status` is OUR enum. The adapter maps the provider's string; nothing
 * downstream ever sees a provider status.
 */
export type ProviderSubscription = {
  provider: BillingProvider
  providerSubscriptionId: string
  status: SubscriptionStatus
  currency: Currency
  interval: BillingInterval
  /** Unit price in minor units, as the provider has it. */
  priceMinor: number
  providerPriceId: string | null
  currentPeriodStart: Date
  currentPeriodEnd: Date
  cancelAtPeriodEnd: boolean
  canceledAt: Date | null
  endedAt: Date | null
  /**
   * When this snapshot was true, in provider-side epoch MILLISECONDS.
   *
   * For ORDERING, not for display. Webhooks arrive out of order, and this is
   * what lets us refuse to apply a stale one — see
   * `src/lib/billing/ordering.ts`.
   *
   * A fresh read from the provider is, by definition, as-of now; a snapshot
   * built from a webhook is as-of that event's creation time. Comparing the
   * two is then meaningful, which is the whole point.
   *
   * Providers do not generally expose an object version — Stripe does not —
   * so a timestamp is the best available ordering key. Two events created in
   * the same provider-side second are indistinguishable here; the ordering
   * rules handle that case explicitly rather than pretending it cannot
   * happen. An adapter must never return a constant, and must never let this
   * go backwards for a given subscription.
   */
  sequence: number
}

/**
 * What the front end needs to collect a payment on our own domain.
 *
 * Deliberately NOT a redirect URL. A hosted checkout page would be less work
 * and would take the customer to someone else's domain mid-purchase, which
 * costs conversions and hands the most sensitive moment of the funnel to a
 * third party's styling.
 */
export type CheckoutIntent = {
  provider: BillingProvider
  providerSubscriptionId: string
  /**
   * BEARER CREDENTIAL for the payment form. Anybody holding it can complete
   * or inspect this payment. Never logged, never stored, never put in a URL.
   */
  clientSecret: string
  /**
   * What the secret is for, because the front end has to confirm it
   * differently.
   *
   * `PAYMENT` — there is money due now; confirming it charges the card.
   * `SETUP`   — nothing is due yet (a trial), so the form only saves a card
   *             for the first real renewal.
   *
   * Without this the client has to guess from the secret's prefix, which is
   * provider-specific knowledge leaking into our own UI.
   */
  secretType: 'PAYMENT' | 'SETUP'
  /** Where the subscription starts out — usually INCOMPLETE. */
  status: SubscriptionStatus
  currency: Currency
  /** What is due now, in minor units. Zero during a trial. */
  amountMinor: number
}

/** A saved payment instrument, reduced to what we may keep and show. */
export type PaymentMethodSummary = {
  providerPaymentMethodId: string
  /** `visa`, `mastercard`, … as the provider classifies it. */
  brand: string
  /**
   * LAST FOUR DIGITS ONLY.
   *
   * There is no field here for a full card number, and there must never be
   * one: storing a PAN puts this application inside PCI-DSS scope, which is a
   * different project. The provider holds the instrument; we hold a label.
   */
  last4: string
  expiryMonth: number
  expiryYear: number
  isDefault: boolean
}

/** A setup intent for attaching or replacing a payment method. */
export type PaymentMethodSetupIntent = {
  provider: BillingProvider
  /** BEARER CREDENTIAL, as above. */
  clientSecret: string
}

export type PlanChangeEffect = 'IMMEDIATE' | 'AT_PERIOD_END'

export type PlanChangeOutcome = {
  subscription: ProviderSubscription
  /**
   * When the change takes effect.
   *
   * Upgrades are IMMEDIATE with proration; downgrades are AT_PERIOD_END. See
   * `changePlan` for why.
   */
  effect: PlanChangeEffect
  /**
   * Proration charged or credited now, in minor units. Positive is a charge,
   * negative a credit, zero when nothing is prorated. Null when the provider
   * cannot tell us before the fact.
   */
  prorationMinor: number | null
}

export type RefundOutcome = {
  provider: BillingProvider
  providerRefundId: string
  providerChargeId: string
  amountMinor: number
  currency: Currency
  /** `SUCCEEDED` once the money is on its way back. */
  status: 'SUCCEEDED' | 'PENDING' | 'FAILED'
}

/* -------------------------------------------------------------------------- */
/* Operation inputs                                                           */
/* -------------------------------------------------------------------------- */

export type EnsureCustomerInput = {
  /** Our customer id, carried into the provider as metadata for support. */
  customerId: string | number
  email: string
  name?: string | null
  /** ISO 3166-1 alpha-2. */
  billingCountry?: string | null
  /** An existing provider id, when we already have one. */
  existingExternalId?: string | null
}

/**
 * Everything needed to start a subscription.
 *
 * `currency` IS REQUIRED AND IS OURS. The adapter must not infer it from the
 * price, the customer's country or the provider's account default: a customer
 * is locked to one settlement currency by the billing model, and a provider
 * that silently picked a different one would produce a subscription we cannot
 * reconcile and invoices we cannot sum.
 */
export type CreateSubscriptionInput = {
  providerCustomerId: string
  /** The provider's price id, from `Price.providerPriceId`. */
  providerPriceId: string
  currency: Currency
  interval: BillingInterval
  /** Expected unit amount, in our minor units. Checked against the provider. */
  expectedAmountMinor: number
  /** Our subscription or customer reference, for the provider's metadata. */
  metadata?: Record<string, string>
  /** Trial length in days, when one applies. */
  trialDays?: number
}

export type CreateCheckoutSessionInput = CreateSubscriptionInput

export type ChangePlanInput = {
  providerSubscriptionId: string
  /** The price to move to. */
  providerPriceId: string
  currency: Currency
  /** Expected unit amount of the NEW price, in our minor units. */
  expectedAmountMinor: number
  /**
   * Which direction this is.
   *
   * Supplied by the caller rather than inferred from the amounts, because the
   * business rule is about plan rank, not price: a yearly START costs more
   * than a monthly PRO but is not an upgrade.
   */
  direction: 'UPGRADE' | 'DOWNGRADE'
}

export type SubscriptionRefInput = { providerSubscriptionId: string }

export type UpdatePaymentMethodInput = { providerCustomerId: string }

export type ListPaymentMethodsInput = { providerCustomerId: string }

export type RefundInput = {
  /** The charge to refund. */
  providerChargeId: string
  /**
   * How much to send back, in minor units. Omit for a full refund.
   *
   * Explicit rather than defaulted to the full amount: a partial refund is
   * common, and a bug that refunds everything is much worse than one that
   * refunds nothing.
   */
  amountMinor?: number
  currency: Currency
  /** Recorded on the credit note. */
  reason: string
  /**
   * Idempotency key, so a retried refund does not send the money twice.
   * REQUIRED — a refund is the one operation where a duplicate is a real loss.
   */
  idempotencyKey: string
}

/* -------------------------------------------------------------------------- */
/* The port                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * What a payment provider must do for us.
 *
 * An adapter implements this and nothing else. Nothing in the application
 * imports a provider SDK; it imports this.
 */
export type BillingPort = {
  readonly provider: BillingProvider

  /** Find or create the provider-side customer. Idempotent. */
  ensureCustomer(
    input: EnsureCustomerInput,
  ): Promise<BillingResult<ProviderCustomerRef>>

  /**
   * Begin a subscription and return what the payment form needs.
   *
   * Named for the concept rather than the mechanism: it does NOT create a
   * hosted checkout page or a redirect.
   */
  createCheckoutSession(
    input: CreateCheckoutSessionInput,
  ): Promise<BillingResult<CheckoutIntent>>

  /** Create a subscription that does not need an immediate payment form. */
  createSubscription(
    input: CreateSubscriptionInput,
  ): Promise<BillingResult<ProviderSubscription>>

  /** Move a subscription to another price. */
  changePlan(input: ChangePlanInput): Promise<BillingResult<PlanChangeOutcome>>

  /** Stop at the end of the paid period. The default, customer-facing path. */
  cancelAtPeriodEnd(
    input: SubscriptionRefInput,
  ): Promise<BillingResult<ProviderSubscription>>

  /** Stop now, forfeiting the rest of the paid period. Admin only. */
  cancelImmediately(
    input: SubscriptionRefInput,
  ): Promise<BillingResult<ProviderSubscription>>

  /** Undo a pending end-of-period cancellation. */
  resumeSubscription(
    input: SubscriptionRefInput,
  ): Promise<BillingResult<ProviderSubscription>>

  /** Start the flow for attaching or replacing a card. */
  updatePaymentMethod(
    input: UpdatePaymentMethodInput,
  ): Promise<BillingResult<PaymentMethodSetupIntent>>

  listPaymentMethods(
    input: ListPaymentMethodsInput,
  ): Promise<BillingResult<PaymentMethodSummary[]>>

  /** Send money back. Writes no credit note — that is the caller's job. */
  refund(input: RefundInput): Promise<BillingResult<RefundOutcome>>

  /** The provider's current view, for reconciliation. */
  getSubscription(
    input: SubscriptionRefInput,
  ): Promise<BillingResult<ProviderSubscription>>
}

/** Every operation name, for the contract tests to iterate over. */
export const BILLING_PORT_OPERATIONS = [
  'ensureCustomer',
  'createCheckoutSession',
  'createSubscription',
  'changePlan',
  'cancelAtPeriodEnd',
  'cancelImmediately',
  'resumeSubscription',
  'updatePaymentMethod',
  'listPaymentMethods',
  'refund',
  'getSubscription',
] as const satisfies readonly (keyof BillingPort)[]
