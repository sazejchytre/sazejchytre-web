/**
 * An in-memory billing provider.
 *
 * Exists so the port's contract tests run with no network, no credentials and
 * no clock — and so the same suite can later be pointed at a real adapter. A
 * contract test is only worth having if the fake is a faithful model of the
 * contract, so this file enforces every rule the port promises:
 *
 *   - expected failures come back as values, never as exceptions;
 *   - currency and amount are checked against the price, never inferred;
 *   - a refund with a repeated idempotency key sends the money once;
 *   - `sequence` only ever increases, so out-of-order handling is testable;
 *   - there is nowhere to put a full card number.
 *
 * Test-only, but it lives in `src/` rather than a test folder because the
 * registry can install it (`setBillingPortForTesting`) and later steps will
 * want it for local development without provider keys.
 */
import type { BillingInterval, BillingProvider, Currency } from './constants.ts'
import {
  type BillingFailureCode,
  type BillingPort,
  BillingProviderUnreachableError,
  type BillingResult,
  type ChangePlanInput,
  type CheckoutIntent,
  type CreateCheckoutSessionInput,
  type CreateSubscriptionInput,
  type EnsureCustomerInput,
  type ListPaymentMethodsInput,
  type PaymentMethodSetupIntent,
  type PaymentMethodSummary,
  type PlanChangeOutcome,
  type ProviderCustomerRef,
  type ProviderSubscription,
  type RefundInput,
  type RefundOutcome,
  type SubscriptionRefInput,
  type UpdatePaymentMethodInput,
  billingFail,
  billingOk,
} from './port.ts'

/* -------------------------------------------------------------------------- */
/* Fixtures the fake knows about                                              */
/* -------------------------------------------------------------------------- */

export type FakePrice = {
  providerPriceId: string
  currency: Currency
  interval: BillingInterval
  unitAmountMinor: number
}

export type FakeCharge = {
  providerChargeId: string
  amountMinor: number
  currency: Currency
}

export type ScriptedFailure = {
  code: BillingFailureCode
  message?: string
  providerCode?: string
  clientSecret?: string
}

export type FakeBillingOptions = {
  /** Injected clock, so period arithmetic is deterministic. */
  now?: () => Date
  prices?: readonly FakePrice[]
  /** Which provider identity to report. Defaults to STRIPE. */
  provider?: BillingProvider
}

/** The handles a test uses to drive the fake. */
export type FakeBillingControls = {
  /** The next money-moving operation fails this way, once. */
  scriptFailure(failure: ScriptedFailure): void
  /** Every operation throws `BillingProviderUnreachableError` while set. */
  setUnreachable(unreachable: boolean): void
  addPrice(price: FakePrice): void
  seedCharge(charge: FakeCharge): void
  attachPaymentMethod(
    providerCustomerId: string,
    method: Omit<PaymentMethodSummary, 'isDefault'> & { isDefault?: boolean },
  ): void
  /** Roll a subscription over into its next period, as a renewal would. */
  renew(providerSubscriptionId: string): void
  /** Drive a subscription into a state the provider would report. */
  forceStatus(
    providerSubscriptionId: string,
    status: ProviderSubscription['status'],
  ): void
  snapshot(providerSubscriptionId: string): ProviderSubscription | undefined
  /** Every refund issued, for asserting money moved exactly once. */
  refunds(): readonly RefundOutcome[]
}

export type FakeBillingPort = BillingPort & {
  readonly fake: FakeBillingControls
}

/* -------------------------------------------------------------------------- */
/* Period arithmetic                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Add one billing interval to a date, in UTC.
 *
 * Clamps to the last day of the target month, so a subscription started on 31
 * January renews on 28 February rather than silently sliding into March — the
 * same thing a real provider does, and a difference the lifecycle tests would
 * otherwise paper over.
 */
const addInterval = (from: Date, interval: BillingInterval): Date => {
  const year = from.getUTCFullYear() + (interval === 'YEAR' ? 1 : 0)
  const month = from.getUTCMonth() + (interval === 'MONTH' ? 1 : 0)
  const day = from.getUTCDate()

  const target = new Date(from.getTime())
  target.setUTCFullYear(year, month, 1)

  const daysInTargetMonth = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate()

  target.setUTCDate(Math.min(day, daysInTargetMonth))

  return target
}

/* -------------------------------------------------------------------------- */
/* The fake                                                                   */
/* -------------------------------------------------------------------------- */

type StoredSubscription = ProviderSubscription & {
  providerCustomerId: string
  /** A price change queued for period end, i.e. a downgrade. */
  pendingPriceId: string | null
}

const DAY_MS = 86_400_000

export const createFakeBillingPort = (
  options: FakeBillingOptions = {},
): FakeBillingPort => {
  const provider: BillingProvider = options.provider ?? 'STRIPE'
  const now = options.now ?? (() => new Date())

  const prices = new Map<string, FakePrice>(
    (options.prices ?? []).map((price) => [price.providerPriceId, price]),
  )
  const customersByEmail = new Map<string, string>()
  const customers = new Map<string, EnsureCustomerInput>()
  const subscriptions = new Map<string, StoredSubscription>()
  const paymentMethods = new Map<string, PaymentMethodSummary[]>()
  const charges = new Map<string, FakeCharge & { refundedMinor: number }>()
  const refundsByKey = new Map<string, RefundOutcome>()
  const refundLog: RefundOutcome[] = []

  let counter = 0
  let sequence = 0
  let unreachable = false
  let scripted: ScriptedFailure | null = null

  const id = (prefix: string): string => `${prefix}_fake_${++counter}`
  const nextSequence = (): number => ++sequence

  const guardReachable = (): void => {
    if (unreachable) throw new BillingProviderUnreachableError(provider)
  }

  /** Consume a scripted failure, if one is queued. */
  const takeScripted = (): BillingResult<never> | null => {
    if (!scripted) return null

    const { code, message, providerCode, clientSecret } = scripted
    scripted = null

    return billingFail(code, message ?? `Scripted failure: ${code}`, {
      ...(providerCode ? { providerCode } : {}),
      ...(clientSecret ? { clientSecret } : {}),
    })
  }

  /**
   * Validate a price reference against what our own row says.
   *
   * The fake standing in for the guard every real adapter must have: the
   * currency and the amount come from OUR data, and if the provider's price
   * disagrees we refuse rather than charge whichever one is to hand.
   */
  const checkPrice = (input: {
    providerPriceId: string
    currency: Currency
    expectedAmountMinor: number
  }): BillingResult<FakePrice> => {
    const price = prices.get(input.providerPriceId)

    if (!price) {
      return billingFail(
        'PRICE_NOT_SYNCED',
        'Tento tarif není připraven k platbě. Zkuste to prosím později.',
      )
    }

    if (price.currency !== input.currency) {
      return billingFail(
        'CURRENCY_MISMATCH',
        'Platbu v této valutě nelze zpracovat.',
      )
    }

    if (price.unitAmountMinor !== input.expectedAmountMinor) {
      return billingFail(
        'AMOUNT_MISMATCH',
        'Cena tarifu se změnila. Načtěte prosím stránku znovu.',
      )
    }

    return billingOk(price)
  }

  /** Strip the fake's internal bookkeeping before handing a value out. */
  const publish = (stored: StoredSubscription): ProviderSubscription => {
    const {
      providerCustomerId: _customerId,
      pendingPriceId: _pendingPriceId,
      ...rest
    } = stored

    return { ...rest }
  }

  const openSubscription = (
    input: SubscriptionRefInput,
  ): BillingResult<StoredSubscription> => {
    const stored = subscriptions.get(input.providerSubscriptionId)

    if (!stored) {
      return billingFail(
        'SUBSCRIPTION_NOT_FOUND',
        'Předplatné nebylo nalezeno.',
      )
    }

    return billingOk(stored)
  }

  const createSubscriptionRecord = (
    input: CreateSubscriptionInput,
    price: FakePrice,
  ): StoredSubscription => {
    const start = now()
    const trialDays = input.trialDays ?? 0
    const hasDefaultMethod = (
      paymentMethods.get(input.providerCustomerId) ?? []
    ).some((method) => method.isDefault)

    const stored: StoredSubscription = {
      provider,
      providerSubscriptionId: id('sub'),
      // A trial, or a card already on file, starts paid-for. Otherwise the
      // subscription exists but grants nothing until the first payment lands —
      // exactly the state the "never trust the event type" rule is about.
      status: trialDays > 0 || hasDefaultMethod ? 'ACTIVE' : 'INCOMPLETE',
      currency: input.currency,
      interval: input.interval,
      priceMinor: price.unitAmountMinor,
      providerPriceId: price.providerPriceId,
      currentPeriodStart: start,
      currentPeriodEnd:
        trialDays > 0
          ? new Date(start.getTime() + trialDays * DAY_MS)
          : addInterval(start, input.interval),
      cancelAtPeriodEnd: false,
      canceledAt: null,
      endedAt: null,
      sequence: nextSequence(),
      providerCustomerId: input.providerCustomerId,
      pendingPriceId: null,
    }

    subscriptions.set(stored.providerSubscriptionId, stored)

    return stored
  }

  const port: FakeBillingPort = {
    provider,

    async ensureCustomer(
      input: EnsureCustomerInput,
    ): Promise<BillingResult<ProviderCustomerRef>> {
      guardReachable()

      // Idempotent on the explicit id first, then on email. A second call for
      // the same person must not produce a second provider customer, or their
      // payment methods and subscriptions end up split across two records.
      const byId =
        input.existingExternalId && customers.has(input.existingExternalId)
          ? input.existingExternalId
          : null
      const existing = byId ?? customersByEmail.get(input.email.toLowerCase())

      if (existing) {
        customers.set(existing, input)
        customersByEmail.set(input.email.toLowerCase(), existing)

        return billingOk({ provider, externalId: existing })
      }

      const externalId = id('cus')
      customers.set(externalId, input)
      customersByEmail.set(input.email.toLowerCase(), externalId)

      return billingOk({ provider, externalId })
    },

    async createCheckoutSession(
      input: CreateCheckoutSessionInput,
    ): Promise<BillingResult<CheckoutIntent>> {
      guardReachable()

      if (!customers.has(input.providerCustomerId)) {
        return billingFail('CUSTOMER_NOT_FOUND', 'Zákazník nebyl nalezen.')
      }

      const priced = checkPrice(input)
      if (!priced.ok) return priced

      const failure = takeScripted()
      if (failure) return failure

      const stored = createSubscriptionRecord(input, priced.value)

      return billingOk({
        provider,
        providerSubscriptionId: stored.providerSubscriptionId,
        clientSecret: `${stored.providerSubscriptionId}_secret_${id('cs')}`,
        // A trial has nothing to charge yet, so the form can only save a
        // card. Anything else has an invoice due now.
        secretType: (input.trialDays ?? 0) > 0 ? 'SETUP' : 'PAYMENT',
        status: stored.status,
        // From OUR input, not from the price row and not from the customer's
        // country. The check above has already proved the two agree.
        currency: input.currency,
        amountMinor: priced.value.unitAmountMinor,
      })
    },

    async createSubscription(
      input: CreateSubscriptionInput,
    ): Promise<BillingResult<ProviderSubscription>> {
      guardReachable()

      if (!customers.has(input.providerCustomerId)) {
        return billingFail('CUSTOMER_NOT_FOUND', 'Zákazník nebyl nalezen.')
      }

      const priced = checkPrice(input)
      if (!priced.ok) return priced

      const failure = takeScripted()
      if (failure) return failure

      return billingOk(publish(createSubscriptionRecord(input, priced.value)))
    },

    async changePlan(
      input: ChangePlanInput,
    ): Promise<BillingResult<PlanChangeOutcome>> {
      guardReachable()

      const opened = openSubscription(input)
      if (!opened.ok) return opened

      const stored = opened.value

      if (stored.status === 'CANCELED' || stored.status === 'EXPIRED') {
        return billingFail(
          'NOT_CANCELABLE',
          'U ukončeného předplatného nelze změnit tarif.',
        )
      }

      const priced = checkPrice(input)
      if (!priced.ok) return priced

      const failure = takeScripted()
      if (failure) return failure

      if (input.direction === 'DOWNGRADE') {
        // Queued, not applied. The customer paid for the better plan until the
        // period ends; taking it away early and refunding the difference is
        // worse for them and more work for us.
        stored.pendingPriceId = priced.value.providerPriceId
        stored.sequence = nextSequence()

        return billingOk({
          subscription: publish(stored),
          effect: 'AT_PERIOD_END',
          prorationMinor: 0,
        })
      }

      // Upgrade: effective now, with the unused remainder of the old plan
      // credited against the new one.
      const periodMs =
        stored.currentPeriodEnd.getTime() - stored.currentPeriodStart.getTime()
      const remainingMs = Math.max(
        0,
        stored.currentPeriodEnd.getTime() - now().getTime(),
      )
      const divisor = Math.max(periodMs, 1)
      const unusedMinor = Math.round(
        (stored.priceMinor * remainingMs) / divisor,
      )
      const newChargeMinor = Math.round(
        (priced.value.unitAmountMinor * remainingMs) / divisor,
      )

      stored.priceMinor = priced.value.unitAmountMinor
      stored.providerPriceId = priced.value.providerPriceId
      stored.interval = priced.value.interval
      stored.pendingPriceId = null
      stored.sequence = nextSequence()

      return billingOk({
        subscription: publish(stored),
        effect: 'IMMEDIATE',
        prorationMinor: newChargeMinor - unusedMinor,
      })
    },

    async cancelAtPeriodEnd(
      input: SubscriptionRefInput,
    ): Promise<BillingResult<ProviderSubscription>> {
      guardReachable()

      const opened = openSubscription(input)
      if (!opened.ok) return opened

      const stored = opened.value

      if (stored.status === 'CANCELED' || stored.status === 'EXPIRED') {
        return billingFail('ALREADY_CANCELED', 'Předplatné je již ukončeno.')
      }

      // Idempotent: asking twice is not an error, and the second call must not
      // move the period end or re-stamp `canceledAt`.
      if (!stored.cancelAtPeriodEnd) {
        stored.cancelAtPeriodEnd = true
        stored.canceledAt = now()
        stored.sequence = nextSequence()
      }

      return billingOk(publish(stored))
    },

    async cancelImmediately(
      input: SubscriptionRefInput,
    ): Promise<BillingResult<ProviderSubscription>> {
      guardReachable()

      const opened = openSubscription(input)
      if (!opened.ok) return opened

      const stored = opened.value

      if (stored.status === 'CANCELED' || stored.status === 'EXPIRED') {
        return billingFail('ALREADY_CANCELED', 'Předplatné je již ukončeno.')
      }

      stored.status = 'CANCELED'
      stored.cancelAtPeriodEnd = false
      stored.canceledAt = stored.canceledAt ?? now()
      stored.endedAt = now()
      stored.sequence = nextSequence()

      return billingOk(publish(stored))
    },

    async resumeSubscription(
      input: SubscriptionRefInput,
    ): Promise<BillingResult<ProviderSubscription>> {
      guardReachable()

      const opened = openSubscription(input)
      if (!opened.ok) return opened

      const stored = opened.value

      // A subscription that has actually ended cannot be resumed; that is a
      // new subscription, with a new period and a new payment.
      if (stored.status === 'CANCELED' || stored.status === 'EXPIRED') {
        return billingFail(
          'NOTHING_TO_RESUME',
          'Ukončené předplatné nelze obnovit. Sjednejte prosím nové.',
        )
      }

      if (!stored.cancelAtPeriodEnd) {
        return billingFail(
          'NOTHING_TO_RESUME',
          'Toto předplatné není naplánováno k ukončení.',
        )
      }

      stored.cancelAtPeriodEnd = false
      stored.canceledAt = null
      stored.sequence = nextSequence()

      return billingOk(publish(stored))
    },

    async updatePaymentMethod(
      input: UpdatePaymentMethodInput,
    ): Promise<BillingResult<PaymentMethodSetupIntent>> {
      guardReachable()

      if (!customers.has(input.providerCustomerId)) {
        return billingFail('CUSTOMER_NOT_FOUND', 'Zákazník nebyl nalezen.')
      }

      const failure = takeScripted()
      if (failure) return failure

      return billingOk({
        provider,
        clientSecret: `seti_${input.providerCustomerId}_secret_${id('si')}`,
      })
    },

    async listPaymentMethods(
      input: ListPaymentMethodsInput,
    ): Promise<BillingResult<PaymentMethodSummary[]>> {
      guardReachable()

      if (!customers.has(input.providerCustomerId)) {
        return billingFail('CUSTOMER_NOT_FOUND', 'Zákazník nebyl nalezen.')
      }

      return billingOk(
        (paymentMethods.get(input.providerCustomerId) ?? []).map((method) => ({
          ...method,
        })),
      )
    },

    async refund(input: RefundInput): Promise<BillingResult<RefundOutcome>> {
      guardReachable()

      // Idempotency BEFORE anything else, including validation. A retry of a
      // refund that succeeded must return the original outcome and never issue
      // a second one — this is the one operation where a duplicate is money
      // out of the door rather than a confusing log line.
      const replayed = refundsByKey.get(input.idempotencyKey)
      if (replayed) return billingOk({ ...replayed })

      const charge = charges.get(input.providerChargeId)

      if (!charge) {
        return billingFail('CHARGE_NOT_FOUND', 'Platba nebyla nalezena.')
      }

      if (charge.currency !== input.currency) {
        return billingFail(
          'CURRENCY_MISMATCH',
          'Valuta vratky nesouhlasí s valutou platby.',
        )
      }

      const remaining = charge.amountMinor - charge.refundedMinor

      if (remaining <= 0) {
        return billingFail('ALREADY_REFUNDED', 'Platba již byla vrácena.')
      }

      const amountMinor = input.amountMinor ?? remaining

      if (amountMinor <= 0 || amountMinor > remaining) {
        return billingFail(
          'REFUND_EXCEEDS_CHARGE',
          'Částka vratky přesahuje zbývající částku platby.',
        )
      }

      const failure = takeScripted()
      if (failure) return failure

      charge.refundedMinor += amountMinor

      const outcome: RefundOutcome = {
        provider,
        providerRefundId: id('re'),
        providerChargeId: charge.providerChargeId,
        amountMinor,
        currency: charge.currency,
        status: 'SUCCEEDED',
      }

      refundsByKey.set(input.idempotencyKey, outcome)
      refundLog.push(outcome)

      return billingOk({ ...outcome })
    },

    async getSubscription(
      input: SubscriptionRefInput,
    ): Promise<BillingResult<ProviderSubscription>> {
      guardReachable()

      const opened = openSubscription(input)
      if (!opened.ok) return opened

      return billingOk(publish(opened.value))
    },

    fake: {
      scriptFailure(failure) {
        scripted = failure
      },

      setUnreachable(value) {
        unreachable = value
      },

      addPrice(price) {
        prices.set(price.providerPriceId, price)
      },

      seedCharge(charge) {
        charges.set(charge.providerChargeId, { ...charge, refundedMinor: 0 })
      },

      attachPaymentMethod(providerCustomerId, method) {
        const list = paymentMethods.get(providerCustomerId) ?? []
        const isDefault = method.isDefault ?? list.length === 0

        if (isDefault) {
          for (const existing of list) existing.isDefault = false
        }

        list.push({ ...method, isDefault })
        paymentMethods.set(providerCustomerId, list)
      },

      renew(providerSubscriptionId) {
        const stored = subscriptions.get(providerSubscriptionId)
        if (!stored) return

        if (stored.cancelAtPeriodEnd) {
          stored.status = 'CANCELED'
          stored.endedAt = stored.currentPeriodEnd
          stored.sequence = nextSequence()

          return
        }

        if (stored.pendingPriceId) {
          const queued = prices.get(stored.pendingPriceId)

          if (queued) {
            stored.priceMinor = queued.unitAmountMinor
            stored.providerPriceId = queued.providerPriceId
            stored.interval = queued.interval
          }

          stored.pendingPriceId = null
        }

        stored.currentPeriodStart = stored.currentPeriodEnd
        stored.currentPeriodEnd = addInterval(
          stored.currentPeriodEnd,
          stored.interval,
        )
        stored.sequence = nextSequence()
      },

      forceStatus(providerSubscriptionId, status) {
        const stored = subscriptions.get(providerSubscriptionId)
        if (!stored) return

        stored.status = status
        stored.sequence = nextSequence()
      },

      snapshot(providerSubscriptionId) {
        const stored = subscriptions.get(providerSubscriptionId)

        return stored ? publish(stored) : undefined
      },

      refunds() {
        return refundLog.map((outcome) => ({ ...outcome }))
      },
    },
  }

  return port
}
