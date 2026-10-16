/**
 * The port contract, run against the in-memory fake, plus the handful of
 * assertions that are about the port's own helpers rather than any adapter.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  type BillingContractHarness,
  runBillingPortContract,
} from './port-contract.ts'
import { createFakeBillingPort } from './fake-adapter.ts'
import {
  BILLING_FAILURE_CODES,
  RETRYABLE_FAILURE_CODES,
  billingFail,
  billingOk,
} from './port.ts'

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

/** Fixed clock, so period arithmetic is the same on every machine. */
const FIXED_NOW = new Date('2026-03-15T10:00:00.000Z')

/** CZK, monthly, in haléře — the launch shape of a real plan. */
const BASE_PRICE = {
  providerPriceId: 'price_fake_start_czk_month',
  currency: 'CZK',
  interval: 'MONTH',
  unitAmountMinor: 29_900,
} as const

const UPGRADE_PRICE = {
  providerPriceId: 'price_fake_pro_czk_month',
  currency: 'CZK',
  interval: 'MONTH',
  unitAmountMinor: 59_900,
} as const

const DOWNGRADE_PRICE = {
  providerPriceId: 'price_fake_lite_czk_month',
  currency: 'CZK',
  interval: 'MONTH',
  unitAmountMinor: 14_900,
} as const

const createFakeHarness = async (): Promise<BillingContractHarness> => {
  const port = createFakeBillingPort({
    now: () => FIXED_NOW,
    prices: [BASE_PRICE, UPGRADE_PRICE, DOWNGRADE_PRICE],
  })

  let chargeCounter = 0

  return {
    port,
    basePrice: BASE_PRICE,
    upgradePrice: UPGRADE_PRICE,
    downgradePrice: DOWNGRADE_PRICE,

    async payingCustomerId() {
      const created = await port.ensureCustomer({
        customerId: 'harness-paying',
        email: 'paying@example.test',
        name: 'Platící Zákazník',
      })

      assert.ok(created.ok)

      port.fake.attachPaymentMethod(created.value.externalId, {
        providerPaymentMethodId: 'pm_fake_visa',
        brand: 'visa',
        last4: '4242',
        expiryMonth: 12,
        expiryYear: 2030,
      })

      return created.value.externalId
    },

    async unbankedCustomerId() {
      const created = await port.ensureCustomer({
        customerId: 'harness-unbanked',
        email: 'unbanked@example.test',
      })

      assert.ok(created.ok)

      return created.value.externalId
    },

    async createCharge(amountMinor, currency) {
      const providerChargeId = `ch_fake_${++chargeCounter}`
      port.fake.seedCharge({ providerChargeId, amountMinor, currency })

      return providerChargeId
    },

    async decliningCustomerId() {
      const created = await port.ensureCustomer({
        customerId: 'harness-declining',
        email: 'declining@example.test',
      })

      assert.ok(created.ok)

      // A card on file, so the subscription attempts a charge, plus a
      // scripted decline for that attempt — which is how the fake stands in
      // for an issuer saying no.
      port.fake.attachPaymentMethod(created.value.externalId, {
        providerPaymentMethodId: 'pm_fake_declines',
        brand: 'visa',
        last4: '0002',
        expiryMonth: 12,
        expiryYear: 2030,
      })

      port.fake.scriptFailure({
        code: 'CARD_DECLINED',
        message: 'Platba byla zamítnuta vydavatelem karty.',
        providerCode: 'card_declined',
      })

      return created.value.externalId
    },

    setUnreachable(unreachable) {
      port.fake.setUnreachable(unreachable)
    },
  }
}

/* -------------------------------------------------------------------------- */
/* The contract                                                               */
/* -------------------------------------------------------------------------- */

runBillingPortContract('fake', createFakeHarness)

/* -------------------------------------------------------------------------- */
/* Result helpers                                                             */
/* -------------------------------------------------------------------------- */

describe('billing result helpers', () => {
  it('narrows on ok', () => {
    const result = billingOk({ answer: 42 })

    assert.equal(result.ok, true)
    assert.equal(result.value.answer, 42)
  })

  it('marks only genuinely retryable codes as retryable', () => {
    for (const code of BILLING_FAILURE_CODES) {
      const expected = RETRYABLE_FAILURE_CODES.includes(code)

      assert.equal(
        billingFail(code, 'test').retryable,
        expected,
        `${code} retryable flag disagrees with RETRYABLE_FAILURE_CODES`,
      )
    }
  })

  it('never marks a decline as retryable', () => {
    // Retrying a decline is how a customer gets three identical charges on
    // their statement and a fraud flag from their bank.
    for (const code of [
      'CARD_DECLINED',
      'INSUFFICIENT_FUNDS',
      'EXPIRED_CARD',
      'INCORRECT_CVC',
    ] as const) {
      assert.equal(billingFail(code, 'test').retryable, false, code)
    }
  })

  it('omits optional fields rather than setting them undefined', () => {
    const failure = billingFail('CARD_DECLINED', 'test')

    // `exactOptionalPropertyTypes` is on, and an explicit `undefined` would
    // also serialise into a JSON body as a missing-but-present key.
    assert.equal('providerCode' in failure, false)
    assert.equal('clientSecret' in failure, false)
  })

  it('carries a client secret for authentication-required', () => {
    const failure = billingFail(
      'AUTHENTICATION_REQUIRED',
      'Banka vyžaduje potvrzení platby.',
      { clientSecret: 'pi_123_secret_456' },
    )

    assert.equal(failure.clientSecret, 'pi_123_secret_456')
  })
})

/* -------------------------------------------------------------------------- */
/* Fake-specific behaviour the contract cannot express                        */
/* -------------------------------------------------------------------------- */

describe('fake adapter', () => {
  it('clamps a month-end renewal instead of skipping a month', async () => {
    // 31 January + one month is 28 February, not 3 March. A naive
    // `setUTCMonth(+1)` rolls over and the subscription silently skips a
    // billing period.
    const port = createFakeBillingPort({
      now: () => new Date('2026-01-31T12:00:00.000Z'),
      prices: [BASE_PRICE],
    })

    const customer = await port.ensureCustomer({
      customerId: 'c',
      email: 'month-end@example.test',
    })
    assert.ok(customer.ok)

    port.fake.attachPaymentMethod(customer.value.externalId, {
      providerPaymentMethodId: 'pm',
      brand: 'visa',
      last4: '4242',
      expiryMonth: 1,
      expiryYear: 2031,
    })

    const created = await port.createSubscription({
      providerCustomerId: customer.value.externalId,
      providerPriceId: BASE_PRICE.providerPriceId,
      currency: BASE_PRICE.currency,
      interval: BASE_PRICE.interval,
      expectedAmountMinor: BASE_PRICE.unitAmountMinor,
    })

    assert.ok(created.ok)
    assert.equal(
      created.value.currentPeriodEnd.toISOString(),
      '2026-02-28T12:00:00.000Z',
    )
  })

  it('applies a queued downgrade when the period rolls over', async () => {
    const port = createFakeBillingPort({
      now: () => FIXED_NOW,
      prices: [BASE_PRICE, DOWNGRADE_PRICE],
    })

    const customer = await port.ensureCustomer({
      customerId: 'c',
      email: 'downgrade@example.test',
    })
    assert.ok(customer.ok)

    port.fake.attachPaymentMethod(customer.value.externalId, {
      providerPaymentMethodId: 'pm',
      brand: 'visa',
      last4: '4242',
      expiryMonth: 1,
      expiryYear: 2031,
    })

    const created = await port.createSubscription({
      providerCustomerId: customer.value.externalId,
      providerPriceId: BASE_PRICE.providerPriceId,
      currency: BASE_PRICE.currency,
      interval: BASE_PRICE.interval,
      expectedAmountMinor: BASE_PRICE.unitAmountMinor,
    })
    assert.ok(created.ok)

    const changed = await port.changePlan({
      providerSubscriptionId: created.value.providerSubscriptionId,
      providerPriceId: DOWNGRADE_PRICE.providerPriceId,
      currency: DOWNGRADE_PRICE.currency,
      expectedAmountMinor: DOWNGRADE_PRICE.unitAmountMinor,
      direction: 'DOWNGRADE',
    })
    assert.ok(changed.ok)
    assert.equal(changed.value.effect, 'AT_PERIOD_END')

    port.fake.renew(created.value.providerSubscriptionId)

    const after = port.fake.snapshot(created.value.providerSubscriptionId)
    assert.ok(after)
    assert.equal(after.priceMinor, DOWNGRADE_PRICE.unitAmountMinor)
    assert.equal(
      after.currentPeriodStart.getTime(),
      created.value.currentPeriodEnd.getTime(),
    )
  })

  it('ends a cancel-at-period-end subscription when the period rolls over', async () => {
    const port = createFakeBillingPort({
      now: () => FIXED_NOW,
      prices: [BASE_PRICE],
    })

    const customer = await port.ensureCustomer({
      customerId: 'c',
      email: 'cancel@example.test',
    })
    assert.ok(customer.ok)

    port.fake.attachPaymentMethod(customer.value.externalId, {
      providerPaymentMethodId: 'pm',
      brand: 'visa',
      last4: '4242',
      expiryMonth: 1,
      expiryYear: 2031,
    })

    const created = await port.createSubscription({
      providerCustomerId: customer.value.externalId,
      providerPriceId: BASE_PRICE.providerPriceId,
      currency: BASE_PRICE.currency,
      interval: BASE_PRICE.interval,
      expectedAmountMinor: BASE_PRICE.unitAmountMinor,
    })
    assert.ok(created.ok)

    assert.ok(
      (
        await port.cancelAtPeriodEnd({
          providerSubscriptionId: created.value.providerSubscriptionId,
        })
      ).ok,
    )

    port.fake.renew(created.value.providerSubscriptionId)

    const after = port.fake.snapshot(created.value.providerSubscriptionId)
    assert.ok(after)
    assert.equal(after.status, 'CANCELED')
    assert.equal(
      after.endedAt?.getTime(),
      created.value.currentPeriodEnd.getTime(),
    )
  })

  it('issues exactly one refund per idempotency key', async () => {
    const port = createFakeBillingPort({ now: () => FIXED_NOW })
    port.fake.seedCharge({
      providerChargeId: 'ch_1',
      amountMinor: 29_900,
      currency: 'CZK',
    })

    const input = {
      providerChargeId: 'ch_1',
      currency: 'CZK',
      reason: 'Duplicate delivery of the same job',
      idempotencyKey: 'once-only',
    } as const

    await port.refund(input)
    await port.refund(input)
    await port.refund(input)

    assert.equal(port.fake.refunds().length, 1)
    assert.equal(port.fake.refunds()[0]?.amountMinor, 29_900)
  })
})
