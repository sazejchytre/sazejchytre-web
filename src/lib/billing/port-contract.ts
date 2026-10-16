/**
 * The billing port's contract, as an executable suite.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS IS PARAMETERISED RATHER THAN WRITTEN AGAINST THE FAKE
 *
 * A port is a promise, and a promise that only one implementation has ever
 * been held to is a guess. This file is the promise; a harness supplies the
 * implementation. The same assertions run against the in-memory fake (fast,
 * every commit) and can be pointed at the Stripe adapter against test keys
 * without rewriting a line.
 *
 * It also stops the fake drifting into fiction. If an assertion here only
 * passes because the fake is lenient, running it against a real provider is
 * what finds out.
 *
 * NOT a `*.test.ts` file on purpose: `pnpm test` globs those, and this one has
 * no adapter of its own to run against. `port.test.ts` supplies the fake.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import type { BillingInterval, Currency } from './constants.ts'
import {
  BILLING_PORT_OPERATIONS,
  type BillingPort,
  BillingProviderUnreachableError,
} from './port.ts'

export type ContractPrice = {
  providerPriceId: string
  currency: Currency
  interval: BillingInterval
  unitAmountMinor: number
}

/**
 * What an implementation must provide for the contract to be runnable.
 *
 * Everything here is setup the contract cannot do through the port itself —
 * creating a price, putting a card on file, producing a settled charge. A real
 * provider needs API calls or a test clock for these; the fake needs a map
 * write. The contract does not care which.
 */
export type BillingContractHarness = {
  readonly port: BillingPort

  /** A provider customer with a usable default payment method on file. */
  payingCustomerId(): Promise<string>
  /** A provider customer with no payment method at all. */
  unbankedCustomerId(): Promise<string>

  /** A price that exists at the provider. */
  readonly basePrice: ContractPrice
  /** Dearer than `basePrice`, same currency and interval. */
  readonly upgradePrice: ContractPrice
  /** Cheaper than `basePrice`, same currency and interval. */
  readonly downgradePrice: ContractPrice

  /** A settled charge, ready to refund. Returns the provider's charge id. */
  createCharge(amountMinor: number, currency: Currency): Promise<string>

  /**
   * A provider customer whose default payment method will be declined.
   *
   * A harness cannot generally make an arbitrary call fail on demand — a
   * real provider declines because of the instrument, not because a test
   * asked it to — so the contract forces a decline the way production gets
   * one.
   */
  decliningCustomerId(): Promise<string>
  /** Arrange for every call to fail as if the provider were offline. */
  setUnreachable(unreachable: boolean): void

  teardown?(): Promise<void>
}

/**
 * A nonce making every idempotency key in this suite unique per run.
 *
 * Hard-coded keys work against a fake and fail against a real provider, which
 * is exactly the kind of thing running the contract against Stripe is for: an
 * idempotency key is remembered ACCOUNT-WIDE for 24 hours, so a second run
 * reusing `refund-full-1` against a different charge is a reuse of one key
 * with different parameters — which the provider correctly rejects. The suite
 * was unrepeatable, and against the fake it looked fine.
 *
 * It also states the production rule: a key identifies one logical operation,
 * not one kind of operation.
 */
const RUN_NONCE = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/** An idempotency key unique to this run. */
const idempotencyKey = (label: string): string => `${RUN_NONCE}:${label}`

/** A currency the given one is not, for mismatch assertions. */
const otherCurrency = (currency: Currency): Currency =>
  currency === 'CZK' ? 'EUR' : 'CZK'

/**
 * Run the contract against one implementation.
 *
 * @param label  Appears in test names, e.g. 'fake' or 'stripe'.
 * @param create Fresh harness per test. Shared state between tests in a suite
 *               about money is how you get a passing suite and a broken ledger.
 */
export const runBillingPortContract = (
  label: string,
  create: () => Promise<BillingContractHarness>,
): void => {
  /** Set up, run, tear down. */
  const withHarness = async (
    body: (harness: BillingContractHarness) => Promise<void>,
  ): Promise<void> => {
    const harness = await create()

    try {
      await body(harness)
    } finally {
      await harness.teardown?.()
    }
  }

  /** The common case: a paying customer on the base price. */
  const activeSubscription = async (harness: BillingContractHarness) => {
    const providerCustomerId = await harness.payingCustomerId()

    const created = await harness.port.createSubscription({
      providerCustomerId,
      providerPriceId: harness.basePrice.providerPriceId,
      currency: harness.basePrice.currency,
      interval: harness.basePrice.interval,
      expectedAmountMinor: harness.basePrice.unitAmountMinor,
    })

    assert.ok(
      created.ok,
      `createSubscription failed: ${JSON.stringify(created)}`,
    )

    return { providerCustomerId, subscription: created.value }
  }

  describe(`billing port contract (${label})`, () => {
    /* ---------------------------------------------------------------- shape */

    describe('shape', () => {
      it('implements every operation in the port', async () => {
        await withHarness(async ({ port }) => {
          for (const operation of BILLING_PORT_OPERATIONS) {
            assert.equal(
              typeof port[operation],
              'function',
              `missing operation: ${operation}`,
            )
          }
        })
      })

      it('reports a provider from our own enum', async () => {
        await withHarness(async ({ port }) => {
          assert.equal(typeof port.provider, 'string')
          assert.match(port.provider, /^[A-Z_]+$/)
        })
      })
    })

    /* ------------------------------------------------------------ customers */

    describe('ensureCustomer', () => {
      it('is idempotent for the same person', async () => {
        await withHarness(async ({ port }) => {
          const input = {
            customerId: 'local-1',
            email: 'ida@example.test',
            name: 'Ida Testová',
          }

          const first = await port.ensureCustomer(input)
          assert.ok(first.ok)

          const second = await port.ensureCustomer({
            ...input,
            existingExternalId: first.value.externalId,
          })
          assert.ok(second.ok)

          // Two provider customers for one person splits their payment methods
          // and subscriptions across records nothing joins back together.
          assert.equal(second.value.externalId, first.value.externalId)
        })
      })

      it('tags the ref with the provider', async () => {
        await withHarness(async ({ port }) => {
          const result = await port.ensureCustomer({
            customerId: 'local-2',
            email: 'jan@example.test',
          })

          assert.ok(result.ok)
          assert.equal(result.value.provider, port.provider)
          assert.ok(result.value.externalId.length > 0)
        })
      })
    })

    /* --------------------------------------------------------- subscription */

    describe('createCheckoutSession', () => {
      it('returns a client secret and the currency we asked for', async () => {
        await withHarness(async (harness) => {
          const providerCustomerId = await harness.unbankedCustomerId()

          const result = await harness.port.createCheckoutSession({
            providerCustomerId,
            providerPriceId: harness.basePrice.providerPriceId,
            currency: harness.basePrice.currency,
            interval: harness.basePrice.interval,
            expectedAmountMinor: harness.basePrice.unitAmountMinor,
          })

          assert.ok(result.ok, JSON.stringify(result))
          assert.ok(result.value.clientSecret.length > 0)
          // Money is due now, so the form must charge rather than only save.
          assert.equal(result.value.secretType, 'PAYMENT')
          assert.equal(result.value.currency, harness.basePrice.currency)
          assert.equal(
            result.value.amountMinor,
            harness.basePrice.unitAmountMinor,
          )
          // No card on file and nothing paid yet: it must NOT come back as a
          // state that grants anything.
          assert.equal(result.value.status, 'INCOMPLETE')
        })
      })

      it('refuses a currency the price is not in', async () => {
        await withHarness(async (harness) => {
          const providerCustomerId = await harness.unbankedCustomerId()

          const result = await harness.port.createCheckoutSession({
            providerCustomerId,
            providerPriceId: harness.basePrice.providerPriceId,
            currency: otherCurrency(harness.basePrice.currency),
            interval: harness.basePrice.interval,
            expectedAmountMinor: harness.basePrice.unitAmountMinor,
          })

          assert.equal(result.ok, false)
          assert.ok(!result.ok)
          assert.equal(result.code, 'CURRENCY_MISMATCH')
        })
      })

      it('refuses an amount the price does not match', async () => {
        await withHarness(async (harness) => {
          const providerCustomerId = await harness.unbankedCustomerId()

          const result = await harness.port.createCheckoutSession({
            providerCustomerId,
            providerPriceId: harness.basePrice.providerPriceId,
            currency: harness.basePrice.currency,
            interval: harness.basePrice.interval,
            expectedAmountMinor: harness.basePrice.unitAmountMinor + 100,
          })

          assert.ok(!result.ok)
          assert.equal(result.code, 'AMOUNT_MISMATCH')
        })
      })

      it('refuses a price the provider has never heard of', async () => {
        await withHarness(async (harness) => {
          const providerCustomerId = await harness.unbankedCustomerId()

          const result = await harness.port.createCheckoutSession({
            providerCustomerId,
            providerPriceId: 'price_does_not_exist_anywhere',
            currency: harness.basePrice.currency,
            interval: harness.basePrice.interval,
            expectedAmountMinor: harness.basePrice.unitAmountMinor,
          })

          assert.ok(!result.ok)
          assert.equal(result.code, 'PRICE_NOT_SYNCED')
        })
      })
    })

    describe('createSubscription', () => {
      it('starts a subscription in a state our enum knows', async () => {
        await withHarness(async (harness) => {
          const { subscription } = await activeSubscription(harness)

          assert.equal(subscription.provider, harness.port.provider)
          assert.equal(subscription.currency, harness.basePrice.currency)
          assert.equal(subscription.interval, harness.basePrice.interval)
          assert.equal(
            subscription.priceMinor,
            harness.basePrice.unitAmountMinor,
          )
          assert.ok(Number.isInteger(subscription.priceMinor))
          assert.ok(
            subscription.currentPeriodEnd > subscription.currentPeriodStart,
          )
          assert.equal(subscription.cancelAtPeriodEnd, false)
          assert.equal(subscription.endedAt, null)
        })
      })

      it('returns a failure, not an exception, when the card declines', async () => {
        await withHarness(async (harness) => {
          const providerCustomerId = await harness.decliningCustomerId()

          // `createSubscription` is the operation that charges immediately, so
          // it is the one that can decline. `createCheckoutSession`
          // deliberately does NOT charge — it hands a secret to the payment
          // form — so asserting a decline there would be asserting something
          // the design rules out.
          //
          // The assertion is as much that this does not throw as what it
          // returns: a decline reaching a caller as an exception is a 500 on
          // the checkout page instead of a message the customer can act on.
          const result = await harness.port.createSubscription({
            providerCustomerId,
            providerPriceId: harness.basePrice.providerPriceId,
            currency: harness.basePrice.currency,
            interval: harness.basePrice.interval,
            expectedAmountMinor: harness.basePrice.unitAmountMinor,
          })

          assert.ok(!result.ok, 'a declined card did not produce a failure')

          // Which instrument failure is the issuer's business, not ours; what
          // the contract requires is that it is one of them and not a crash.
          assert.ok(
            [
              'CARD_DECLINED',
              'INSUFFICIENT_FUNDS',
              'EXPIRED_CARD',
              'INCORRECT_CVC',
              'INCORRECT_NUMBER',
              'PROCESSING_ERROR',
              'AUTHENTICATION_REQUIRED',
            ].includes(result.code),
            `expected a payment-instrument failure, got ${result.code}`,
          )
          assert.ok(result.message.length > 0, 'no message for the customer')
        })
      })

      it('fails cleanly for a customer the provider does not have', async () => {
        await withHarness(async (harness) => {
          const result = await harness.port.createSubscription({
            providerCustomerId: 'cus_not_a_real_customer',
            providerPriceId: harness.basePrice.providerPriceId,
            currency: harness.basePrice.currency,
            interval: harness.basePrice.interval,
            expectedAmountMinor: harness.basePrice.unitAmountMinor,
          })

          assert.ok(!result.ok)
          assert.equal(result.code, 'CUSTOMER_NOT_FOUND')
        })
      })
    })

    describe('getSubscription', () => {
      it('round-trips what was created', async () => {
        await withHarness(async (harness) => {
          const { subscription } = await activeSubscription(harness)

          const fetched = await harness.port.getSubscription({
            providerSubscriptionId: subscription.providerSubscriptionId,
          })

          assert.ok(fetched.ok)
          assert.equal(
            fetched.value.providerSubscriptionId,
            subscription.providerSubscriptionId,
          )
          assert.equal(fetched.value.status, subscription.status)
          assert.equal(fetched.value.currency, subscription.currency)
        })
      })

      it('reports a missing subscription as a failure', async () => {
        await withHarness(async ({ port }) => {
          const result = await port.getSubscription({
            providerSubscriptionId: 'sub_definitely_not_real',
          })

          assert.ok(!result.ok)
          assert.equal(result.code, 'SUBSCRIPTION_NOT_FOUND')
        })
      })
    })

    /* --------------------------------------------------------- plan changes */

    describe('changePlan', () => {
      it('applies an upgrade immediately, with proration', async () => {
        await withHarness(async (harness) => {
          const { subscription } = await activeSubscription(harness)

          const result = await harness.port.changePlan({
            providerSubscriptionId: subscription.providerSubscriptionId,
            providerPriceId: harness.upgradePrice.providerPriceId,
            currency: harness.upgradePrice.currency,
            expectedAmountMinor: harness.upgradePrice.unitAmountMinor,
            direction: 'UPGRADE',
          })

          assert.ok(result.ok, JSON.stringify(result))
          assert.equal(result.value.effect, 'IMMEDIATE')
          assert.equal(
            result.value.subscription.priceMinor,
            harness.upgradePrice.unitAmountMinor,
          )

          if (result.value.prorationMinor !== null) {
            assert.ok(Number.isInteger(result.value.prorationMinor))
          }

          // Someone who paid more must get the better plan now, not next month.
          const fetched = await harness.port.getSubscription({
            providerSubscriptionId: subscription.providerSubscriptionId,
          })
          assert.ok(fetched.ok)
          assert.equal(
            fetched.value.providerPriceId,
            harness.upgradePrice.providerPriceId,
          )
        })
      })

      it('defers a downgrade to the end of the paid period', async () => {
        await withHarness(async (harness) => {
          const { subscription } = await activeSubscription(harness)

          const result = await harness.port.changePlan({
            providerSubscriptionId: subscription.providerSubscriptionId,
            providerPriceId: harness.downgradePrice.providerPriceId,
            currency: harness.downgradePrice.currency,
            expectedAmountMinor: harness.downgradePrice.unitAmountMinor,
            direction: 'DOWNGRADE',
          })

          assert.ok(result.ok, JSON.stringify(result))
          assert.equal(result.value.effect, 'AT_PERIOD_END')

          // The customer has paid for the dearer plan until the period ends.
          // Taking it away now and refunding the difference is worse for them.
          const fetched = await harness.port.getSubscription({
            providerSubscriptionId: subscription.providerSubscriptionId,
          })
          assert.ok(fetched.ok)
          assert.equal(
            fetched.value.providerPriceId,
            harness.basePrice.providerPriceId,
          )
          assert.equal(
            fetched.value.priceMinor,
            harness.basePrice.unitAmountMinor,
          )
        })
      })

      it('refuses a price in the wrong currency', async () => {
        await withHarness(async (harness) => {
          const { subscription } = await activeSubscription(harness)

          const result = await harness.port.changePlan({
            providerSubscriptionId: subscription.providerSubscriptionId,
            providerPriceId: harness.upgradePrice.providerPriceId,
            currency: otherCurrency(harness.upgradePrice.currency),
            expectedAmountMinor: harness.upgradePrice.unitAmountMinor,
            direction: 'UPGRADE',
          })

          assert.ok(!result.ok)
          assert.equal(result.code, 'CURRENCY_MISMATCH')
        })
      })
    })

    /* -------------------------------------------------------- cancel/resume */

    describe('cancelAtPeriodEnd', () => {
      it('flags the cancellation without ending access', async () => {
        await withHarness(async (harness) => {
          const { subscription } = await activeSubscription(harness)

          const result = await harness.port.cancelAtPeriodEnd({
            providerSubscriptionId: subscription.providerSubscriptionId,
          })

          assert.ok(result.ok, JSON.stringify(result))
          assert.equal(result.value.cancelAtPeriodEnd, true)
          assert.notEqual(result.value.status, 'CANCELED')
          assert.equal(result.value.endedAt, null)
          // They paid for this period; it does not move.
          assert.deepEqual(
            result.value.currentPeriodEnd,
            subscription.currentPeriodEnd,
          )
        })
      })

      it('is idempotent', async () => {
        await withHarness(async (harness) => {
          const { subscription } = await activeSubscription(harness)
          const ref = {
            providerSubscriptionId: subscription.providerSubscriptionId,
          }

          const first = await harness.port.cancelAtPeriodEnd(ref)
          const second = await harness.port.cancelAtPeriodEnd(ref)

          assert.ok(first.ok)
          assert.ok(second.ok, JSON.stringify(second))
          assert.equal(second.value.cancelAtPeriodEnd, true)
          assert.deepEqual(second.value.canceledAt, first.value.canceledAt)
          assert.deepEqual(
            second.value.currentPeriodEnd,
            first.value.currentPeriodEnd,
          )
        })
      })
    })

    describe('cancelImmediately', () => {
      it('ends the subscription now', async () => {
        await withHarness(async (harness) => {
          const { subscription } = await activeSubscription(harness)

          const result = await harness.port.cancelImmediately({
            providerSubscriptionId: subscription.providerSubscriptionId,
          })

          assert.ok(result.ok, JSON.stringify(result))
          assert.equal(result.value.status, 'CANCELED')
          assert.notEqual(result.value.endedAt, null)
        })
      })

      it('reports a second attempt as already canceled', async () => {
        await withHarness(async (harness) => {
          const { subscription } = await activeSubscription(harness)
          const ref = {
            providerSubscriptionId: subscription.providerSubscriptionId,
          }

          assert.ok((await harness.port.cancelImmediately(ref)).ok)

          const second = await harness.port.cancelImmediately(ref)
          assert.ok(!second.ok)
          assert.equal(second.code, 'ALREADY_CANCELED')
        })
      })
    })

    describe('resumeSubscription', () => {
      it('clears a pending cancellation', async () => {
        await withHarness(async (harness) => {
          const { subscription } = await activeSubscription(harness)
          const ref = {
            providerSubscriptionId: subscription.providerSubscriptionId,
          }

          assert.ok((await harness.port.cancelAtPeriodEnd(ref)).ok)

          const resumed = await harness.port.resumeSubscription(ref)
          assert.ok(resumed.ok, JSON.stringify(resumed))
          assert.equal(resumed.value.cancelAtPeriodEnd, false)
          assert.equal(resumed.value.canceledAt, null)
        })
      })

      it('refuses when there is nothing pending', async () => {
        await withHarness(async (harness) => {
          const { subscription } = await activeSubscription(harness)

          const result = await harness.port.resumeSubscription({
            providerSubscriptionId: subscription.providerSubscriptionId,
          })

          assert.ok(!result.ok)
          assert.equal(result.code, 'NOTHING_TO_RESUME')
        })
      })

      it('refuses to resurrect an ended subscription', async () => {
        await withHarness(async (harness) => {
          const { subscription } = await activeSubscription(harness)
          const ref = {
            providerSubscriptionId: subscription.providerSubscriptionId,
          }

          assert.ok((await harness.port.cancelImmediately(ref)).ok)

          const result = await harness.port.resumeSubscription(ref)
          assert.ok(!result.ok)
          assert.equal(result.code, 'NOTHING_TO_RESUME')
        })
      })
    })

    /* ------------------------------------------------------ payment methods */

    describe('payment methods', () => {
      it('offers a setup secret for attaching a card', async () => {
        await withHarness(async (harness) => {
          const providerCustomerId = await harness.unbankedCustomerId()

          const result = await harness.port.updatePaymentMethod({
            providerCustomerId,
          })

          assert.ok(result.ok, JSON.stringify(result))
          assert.ok(result.value.clientSecret.length > 0)
          assert.equal(result.value.provider, harness.port.provider)
        })
      })

      it('summarises a card without ever exposing the number', async () => {
        await withHarness(async (harness) => {
          const providerCustomerId = await harness.payingCustomerId()

          const result = await harness.port.listPaymentMethods({
            providerCustomerId,
          })

          assert.ok(result.ok, JSON.stringify(result))
          assert.ok(result.value.length > 0, 'expected a card on file')

          for (const method of result.value) {
            assert.match(method.last4, /^\d{4}$/)
            assert.ok(method.brand.length > 0)
            assert.ok(method.expiryMonth >= 1 && method.expiryMonth <= 12)
            assert.ok(method.expiryYear >= 2000)
          }

          // There is no field for a PAN, and there must never be one: holding
          // a card number drags this application into PCI-DSS scope.
          const serialised = JSON.stringify(result.value)
          assert.doesNotMatch(
            serialised,
            /\d{12,}/,
            'a payment method summary contained a card-number-length digit run',
          )
        })
      })

      it('reports a missing customer as a failure', async () => {
        await withHarness(async ({ port }) => {
          const result = await port.listPaymentMethods({
            providerCustomerId: 'cus_not_a_real_customer',
          })

          assert.ok(!result.ok)
          assert.equal(result.code, 'CUSTOMER_NOT_FOUND')
        })
      })
    })

    /* ---------------------------------------------------------------- money */

    describe('refund', () => {
      it('refunds in full by default', async () => {
        await withHarness(async (harness) => {
          const { currency } = harness.basePrice
          const chargeId = await harness.createCharge(50_000, currency)

          const result = await harness.port.refund({
            providerChargeId: chargeId,
            currency,
            reason: 'Customer request',
            idempotencyKey: idempotencyKey('refund-full'),
          })

          assert.ok(result.ok, JSON.stringify(result))
          assert.equal(result.value.amountMinor, 50_000)
          assert.equal(result.value.currency, currency)
          assert.equal(result.value.status, 'SUCCEEDED')
        })
      })

      it('refunds a part when asked', async () => {
        await withHarness(async (harness) => {
          const { currency } = harness.basePrice
          const chargeId = await harness.createCharge(50_000, currency)

          const result = await harness.port.refund({
            providerChargeId: chargeId,
            amountMinor: 12_500,
            currency,
            reason: 'Partial goodwill',
            idempotencyKey: idempotencyKey('refund-part'),
          })

          assert.ok(result.ok, JSON.stringify(result))
          assert.equal(result.value.amountMinor, 12_500)
        })
      })

      it('sends the money once for a repeated idempotency key', async () => {
        await withHarness(async (harness) => {
          const { currency } = harness.basePrice
          const chargeId = await harness.createCharge(50_000, currency)
          const input = {
            providerChargeId: chargeId,
            amountMinor: 20_000,
            currency,
            reason: 'Retried by our own queue',
            idempotencyKey: idempotencyKey('refund-retry'),
          }

          const first = await harness.port.refund(input)
          const second = await harness.port.refund(input)

          assert.ok(first.ok, JSON.stringify(first))
          assert.ok(second.ok, JSON.stringify(second))

          // Same refund, not a second one. A duplicated refund is real money
          // gone, and unlike a duplicated charge nobody complains about it.
          assert.equal(
            second.value.providerRefundId,
            first.value.providerRefundId,
          )

          const remaining = await harness.port.refund({
            ...input,
            amountMinor: 30_001,
            idempotencyKey: idempotencyKey('refund-retry-probe'),
          })
          assert.ok(!remaining.ok)
          assert.equal(remaining.code, 'REFUND_EXCEEDS_CHARGE')
        })
      })

      it('refuses to refund more than was charged', async () => {
        await withHarness(async (harness) => {
          const { currency } = harness.basePrice
          const chargeId = await harness.createCharge(50_000, currency)

          const result = await harness.port.refund({
            providerChargeId: chargeId,
            amountMinor: 50_001,
            currency,
            reason: 'Fat-fingered',
            idempotencyKey: idempotencyKey('refund-over'),
          })

          assert.ok(!result.ok)
          assert.equal(result.code, 'REFUND_EXCEEDS_CHARGE')
        })
      })

      it('refuses a currency that is not the charge currency', async () => {
        await withHarness(async (harness) => {
          const { currency } = harness.basePrice
          const chargeId = await harness.createCharge(50_000, currency)

          const result = await harness.port.refund({
            providerChargeId: chargeId,
            currency: otherCurrency(currency),
            reason: 'Wrong currency',
            idempotencyKey: idempotencyKey('refund-currency'),
          })

          assert.ok(!result.ok)
          assert.equal(result.code, 'CURRENCY_MISMATCH')
        })
      })

      it('reports a missing charge as a failure', async () => {
        await withHarness(async (harness) => {
          const result = await harness.port.refund({
            providerChargeId: 'ch_not_a_real_charge',
            currency: harness.basePrice.currency,
            reason: 'Nothing to refund',
            idempotencyKey: idempotencyKey('refund-missing'),
          })

          assert.ok(!result.ok)
          assert.equal(result.code, 'CHARGE_NOT_FOUND')
        })
      })
    })

    /* -------------------------------------------------------------ordering */

    describe('sequence', () => {
      it('only ever increases for a subscription', async () => {
        await withHarness(async (harness) => {
          const { subscription } = await activeSubscription(harness)
          const ref = {
            providerSubscriptionId: subscription.providerSubscriptionId,
          }

          const cancelled = await harness.port.cancelAtPeriodEnd(ref)
          assert.ok(cancelled.ok)
          const resumed = await harness.port.resumeSubscription(ref)
          assert.ok(resumed.ok)

          // This is what makes out-of-order webhooks survivable: a stale
          // event can be recognised as stale. An adapter that returned a
          // constant here would make every event look current.
          assert.ok(
            cancelled.value.sequence > subscription.sequence,
            'sequence did not advance on cancellation',
          )
          assert.ok(
            resumed.value.sequence > cancelled.value.sequence,
            'sequence did not advance on resume',
          )
        })
      })
    })

    /* ------------------------------------------------------- the exceptions */

    describe('unreachable provider', () => {
      it('throws rather than returning a failure', async () => {
        await withHarness(async (harness) => {
          harness.setUnreachable(true)

          // The one case that is NOT a Result. A customer-facing "your card
          // was declined" would be a lie, and a caller cannot do anything
          // useful with it — this has to reach the error handler and the
          // alerting that goes with it.
          await assert.rejects(
            () =>
              harness.port.getSubscription({
                providerSubscriptionId: 'sub_anything',
              }),
            BillingProviderUnreachableError,
          )

          harness.setUnreachable(false)
        })
      })
    })
  })
}
