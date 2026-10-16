/**
 * The port contract, run against the REAL Stripe adapter in test mode.
 *
 *     pnpm test:stripe
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS AND WHY IT IS OPT-IN
 *
 * The contract in `port-contract.ts` is only worth having if more than one
 * implementation has been held to it. The fake proves the contract is
 * self-consistent; this proves the contract describes Stripe.
 *
 * It is NOT in `pnpm test` (no network, no credentials there) and NOT in
 * `pnpm test:db` (which must be deterministic and must not depend on a third
 * party being up). It has its own script because every run creates real
 * objects in the Stripe test account and costs a few seconds of network.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT IT NEEDS
 *
 *   - `STRIPE_SECRET_KEY` in `.env`, a TEST key. The guard below refuses to
 *     run against a live key: the contract creates subscriptions, charges
 *     cards and issues refunds, and doing that to real customers would be
 *     unforgivable.
 *   - Prices synced into the account: `pnpm sync:prices:apply`. The harness
 *     reads them from our own `prices` table rather than hard-coding ids, so
 *     it exercises the same rows production would.
 *
 * Every customer it creates is deleted in teardown, which takes their
 * subscriptions with them.
 */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import Stripe from 'stripe'
import { getPayload, type Payload } from 'payload'

import config from '@/payload.config'
import { env } from '@/lib/env'
import {
  STRIPE_API_VERSION,
  isLiveStripeKey,
} from '@/lib/billing/stripe/client'
import { createStripeBillingPort } from '@/lib/billing/stripe/adapter'
import {
  type BillingContractHarness,
  type ContractPrice,
  runBillingPortContract,
} from '@/lib/billing/port-contract'
import type { BillingInterval, Currency } from '@/lib/billing/constants'

/* -------------------------------------------------------------------------- */
/* Guards                                                                     */
/* -------------------------------------------------------------------------- */

if (isLiveStripeKey(env.STRIPE_SECRET_KEY)) {
  // Not a warning. This suite charges cards and issues refunds.
  throw new Error(
    'REFUSING TO RUN: STRIPE_SECRET_KEY is a live key. This suite creates ' +
      'subscriptions, charges cards and issues refunds. Point it at a test key.',
  )
}

/* -------------------------------------------------------------------------- */
/* Shared setup                                                               */
/* -------------------------------------------------------------------------- */

const RUN = `contract-${Date.now()}`

const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: STRIPE_API_VERSION,
  maxNetworkRetries: 2,
  timeout: 20_000,
})

/**
 * A client pointed somewhere unroutable.
 *
 * The contract asserts that an unreachable provider THROWS rather than
 * returning a failure, and the only honest way to prove that against a real
 * adapter is to make the network genuinely fail. `.invalid` is reserved by
 * RFC 2606 precisely so it can never resolve.
 */
const unreachableStripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: STRIPE_API_VERSION,
  host: 'api.stripe.invalid',
  maxNetworkRetries: 0,
  timeout: 3_000,
})

const workingPort = createStripeBillingPort(stripe)
const brokenPort = createStripeBillingPort(unreachableStripe)

let payload: Payload
let basePrice: ContractPrice
let upgradePrice: ContractPrice
let downgradePrice: ContractPrice

/** Every Stripe customer this suite created, deleted in teardown. */
const createdCustomers = new Set<string>()

before(async () => {
  payload = await getPayload({ config })

  const prices = await payload.find({
    collection: 'prices',
    depth: 1,
    limit: 0,
    pagination: false,
    overrideAccess: true,
    where: { currency: { equals: 'CZK' }, interval: { equals: 'MONTH' } },
  })

  const synced = prices.docs
    .filter((doc) => typeof doc.providerPriceId === 'string')
    .map((doc): ContractPrice => ({
      providerPriceId: doc.providerPriceId as string,
      currency: doc.currency as Currency,
      interval: doc.interval as BillingInterval,
      unitAmountMinor: doc.amountMinor as number,
    }))
    .sort((a, b) => a.unitAmountMinor - b.unitAmountMinor)

  assert.ok(
    synced.length >= 3,
    `expected at least 3 synced monthly CZK prices, found ${String(synced.length)}. ` +
      'Run `pnpm sync:prices:apply` first.',
  )

  // Cheapest / middle / dearest, so "upgrade" and "downgrade" mean what the
  // contract expects without hard-coding any amount.
  downgradePrice = synced[0] as ContractPrice
  basePrice = synced[1] as ContractPrice
  upgradePrice = synced[synced.length - 1] as ContractPrice
})

after(async () => {
  // Deleting a test customer takes their subscriptions with them, which is
  // the only tidy way to avoid leaving a trail of test subscriptions behind.
  //
  // In batches rather than one at a time: the contract creates one or more
  // customers per test, and serial deletion made teardown take longer than
  // the tests did. Batched rather than all at once so a few dozen deletes do
  // not trip Stripe's rate limiter.
  const ids = [...createdCustomers]
  const BATCH = 10

  for (let index = 0; index < ids.length; index += BATCH) {
    await Promise.all(
      ids.slice(index, index + BATCH).map(async (customerId) => {
        try {
          await stripe.customers.del(customerId)
        } catch {
          // Already gone, or in a state that cannot be deleted. Cleanup
          // failing is not worth failing the suite over.
        }
      }),
    )
  }

  // Close the database pool.
  //
  // The suite reads prices through Payload, which opens a pg pool. An open
  // pool is a live handle, so without this the process sits there after every
  // test has passed and the runner never prints its summary — which looks
  // exactly like a hang and makes the exit code useless in CI.
  await payload.destroy()
})

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

/** Create a Stripe customer with the given test payment method as default. */
const customerWithCard = async (
  label: string,
  testPaymentMethod: string | null,
): Promise<string> => {
  const customer = await stripe.customers.create({
    email: `${RUN}-${label}@example.test`,
    name: `Contract ${label}`,
    address: { country: 'CZ' },
    metadata: { sazejchytreContractRun: RUN },
  })

  createdCustomers.add(customer.id)

  if (testPaymentMethod) {
    const method = await stripe.paymentMethods.attach(testPaymentMethod, {
      customer: customer.id,
    })

    await stripe.customers.update(customer.id, {
      invoice_settings: { default_payment_method: method.id },
    })
  }

  return customer.id
}

const createStripeHarness = async (): Promise<BillingContractHarness> => {
  let unreachable = false

  return {
    get port() {
      return unreachable ? brokenPort : workingPort
    },

    get basePrice() {
      return basePrice
    },
    get upgradePrice() {
      return upgradePrice
    },
    get downgradePrice() {
      return downgradePrice
    },

    // `pm_card_visa` is Stripe's test instrument that always succeeds.
    payingCustomerId: () =>
      customerWithCard(`pay-${String(createdCustomers.size)}`, 'pm_card_visa'),

    unbankedCustomerId: () =>
      customerWithCard(`bare-${String(createdCustomers.size)}`, null),

    // `pm_card_chargeCustomerFail`, NOT `pm_card_chargeDeclined`.
    //
    // The latter is refused by `paymentMethods.attach` itself, so the harness
    // would throw before the port was ever called and the test would "fail"
    // without testing anything. This one attaches cleanly and declines when
    // charged, which is the sequence a real customer produces: a card that
    // looked fine at signup and stops working at the till.
    decliningCustomerId: () =>
      customerWithCard(
        `decline-${String(createdCustomers.size)}`,
        'pm_card_chargeCustomerFail',
      ),

    async createCharge(amountMinor, currency) {
      // A settled off-session charge, so there is something real to refund.
      const intent = await stripe.paymentIntents.create({
        amount: amountMinor,
        currency: currency.toLowerCase(),
        payment_method: 'pm_card_visa',
        // RENAMED in this API version: `payment_method_types` on create is
        // now `allowed_payment_method_types`. The old name is rejected
        // outright rather than ignored, which at least fails loudly.
        allowed_payment_method_types: ['card'],
        confirm: true,
        off_session: true,
        customer: await customerWithCard(
          `charge-${String(createdCustomers.size)}`,
          'pm_card_visa',
        ),
      })

      const chargeId =
        typeof intent.latest_charge === 'string'
          ? intent.latest_charge
          : (intent.latest_charge?.id ?? null)

      assert.ok(chargeId, 'the test charge produced no charge id')

      return chargeId
    },

    setUnreachable(value) {
      unreachable = value
    },
  }
}

/* -------------------------------------------------------------------------- */
/* The contract                                                               */
/* -------------------------------------------------------------------------- */

runBillingPortContract('stripe (test mode)', createStripeHarness)

/* -------------------------------------------------------------------------- */
/* Stripe-specific checks the contract cannot express                         */
/* -------------------------------------------------------------------------- */

describe('Stripe specifics', () => {
  it('talks to the API version pinned in code', async () => {
    const response = await stripe.balance.retrieve()

    // Belt and braces on the guard at the top of this file.
    assert.equal(response.livemode, false, 'this is a LIVE account')
    assert.equal(
      response.lastResponse.apiVersion,
      STRIPE_API_VERSION,
      'Stripe answered on a different API version than the one pinned in client.ts',
    )
  })

  it('reads the subscription period from the item, not the subscription', async () => {
    // The field that moved. If the adapter read it off the subscription it
    // would get undefined here and the period would be an Invalid Date.
    const providerCustomerId = await customerWithCard(
      `period-${String(createdCustomers.size)}`,
      'pm_card_visa',
    )

    const created = await workingPort.createSubscription({
      providerCustomerId,
      providerPriceId: basePrice.providerPriceId,
      currency: basePrice.currency,
      interval: basePrice.interval,
      expectedAmountMinor: basePrice.unitAmountMinor,
    })

    assert.ok(created.ok, JSON.stringify(created))
    assert.ok(
      Number.isFinite(created.value.currentPeriodEnd.getTime()),
      'currentPeriodEnd is an Invalid Date — the period was read from the wrong place',
    )
    assert.ok(
      created.value.currentPeriodEnd > created.value.currentPeriodStart,
      'the period does not move forwards',
    )

    // Roughly a month, not a day and not a year.
    const days =
      (created.value.currentPeriodEnd.getTime() -
        created.value.currentPeriodStart.getTime()) /
      86_400_000
    assert.ok(days > 27 && days < 32, `period spans ${String(days)} days`)
  })

  it('returns a Payment Element secret, never a redirect URL', async () => {
    const providerCustomerId = await customerWithCard(
      `secret-${String(createdCustomers.size)}`,
      null,
    )

    const checkout = await workingPort.createCheckoutSession({
      providerCustomerId,
      providerPriceId: basePrice.providerPriceId,
      currency: basePrice.currency,
      interval: basePrice.interval,
      expectedAmountMinor: basePrice.unitAmountMinor,
    })

    assert.ok(checkout.ok, JSON.stringify(checkout))

    // The whole point of not using hosted Checkout: the customer never leaves
    // our domain. A `https://checkout.stripe.com/...` value here would mean
    // the adapter had quietly fallen back to a redirect.
    assert.equal(checkout.value.secretType, 'PAYMENT')
    assert.match(checkout.value.clientSecret, /_secret_/)
    assert.doesNotMatch(checkout.value.clientSecret, /^https?:\/\//)

    assert.equal(checkout.value.currency, basePrice.currency)
    assert.equal(checkout.value.status, 'INCOMPLETE')
  })

  it('passes our minor units through without conversion', async () => {
    const providerCustomerId = await customerWithCard(
      `amount-${String(createdCustomers.size)}`,
      'pm_card_visa',
    )

    const created = await workingPort.createSubscription({
      providerCustomerId,
      providerPriceId: basePrice.providerPriceId,
      currency: basePrice.currency,
      interval: basePrice.interval,
      expectedAmountMinor: basePrice.unitAmountMinor,
    })

    assert.ok(created.ok, JSON.stringify(created))

    // Identical integers on both sides. Any arithmetic in the adapter — a
    // divide by 100 and a multiply back — would show up here.
    assert.equal(created.value.priceMinor, basePrice.unitAmountMinor)
    assert.ok(Number.isInteger(created.value.priceMinor))
  })

  it('refuses an amount that has drifted from the Stripe price', async () => {
    const providerCustomerId = await customerWithCard(
      `drift-${String(createdCustomers.size)}`,
      'pm_card_visa',
    )

    // What a stale local Price row looks like. Charging either amount would
    // be wrong; the adapter must decline to pick one.
    const result = await workingPort.createSubscription({
      providerCustomerId,
      providerPriceId: basePrice.providerPriceId,
      currency: basePrice.currency,
      interval: basePrice.interval,
      expectedAmountMinor: basePrice.unitAmountMinor + 1_000,
    })

    assert.ok(!result.ok)
    assert.equal(result.code, 'AMOUNT_MISMATCH')
  })

  it('never infers a currency the caller did not ask for', async () => {
    const providerCustomerId = await customerWithCard(
      `currency-${String(createdCustomers.size)}`,
      'pm_card_visa',
    )

    // The price is CZK. Asking for EUR must fail rather than quietly
    // producing a EUR subscription we could not reconcile or invoice.
    const result = await workingPort.createSubscription({
      providerCustomerId,
      providerPriceId: basePrice.providerPriceId,
      currency: 'EUR',
      interval: basePrice.interval,
      expectedAmountMinor: basePrice.unitAmountMinor,
    })

    assert.ok(!result.ok)
    assert.equal(result.code, 'CURRENCY_MISMATCH')
  })
})
