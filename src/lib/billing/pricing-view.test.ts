import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { TierView } from './pricing-view.ts'
import {
  RECOMMENDED_PLAN,
  isRecommended,
  yearlyPerMonthMinor,
  yearlySavingMinor,
} from './pricing-view.ts'

const tier = (
  monthlyMinor: number | null,
  yearlyMinor: number | null,
  currencies: [string, string] = ['CZK', 'CZK'],
): TierView => ({
  code: 'PRO',
  name: 'Pro',
  description: null,
  sortOrder: 1,
  features: [],
  monthly:
    monthlyMinor === null
      ? null
      : {
          interval: 'MONTH',
          amountMinor: monthlyMinor,
          currency: currencies[0] as 'CZK',
          providerPriceId: 'price_m',
        },
  yearly:
    yearlyMinor === null
      ? null
      : {
          interval: 'YEAR',
          amountMinor: yearlyMinor,
          currency: currencies[1] as 'CZK',
          providerPriceId: 'price_y',
        },
})

describe('yearlySavingMinor', () => {
  it('is twelve monthlies minus the yearly price', () => {
    // 499 Kč a month, 4 990 Kč a year: 12 × 49 900 − 499 000 = 99 800 haléřů.
    assert.equal(yearlySavingMinor(tier(49_900, 499_000)), 99_800)
  })

  it('is null rather than zero when a price is missing', () => {
    // "Ušetříte 0 Kč" is worse than saying nothing.
    assert.equal(yearlySavingMinor(tier(49_900, null)), null)
    assert.equal(yearlySavingMinor(tier(null, 499_000)), null)
  })

  it('is null when the two prices are in different currencies', () => {
    assert.equal(yearlySavingMinor(tier(49_900, 499_000, ['CZK', 'EUR'])), null)
  })

  it('reports a NEGATIVE saving rather than hiding it', () => {
    // A yearly price above twelve monthlies is a pricing mistake. Showing it
    // is how it gets found; clamping to zero keeps selling the worse deal as
    // a discount.
    assert.equal(yearlySavingMinor(tier(49_900, 700_000)), -101_200)
  })

  it('stays an integer count of minor units', () => {
    const saving = yearlySavingMinor(tier(33_300, 333_000))

    assert.equal(Number.isInteger(saving), true)
  })
})

describe('yearlyPerMonthMinor', () => {
  it('divides the yearly price by twelve, rounding half away from zero', () => {
    // 499 000 / 12 = 41 583.33 → 41 583
    assert.equal(yearlyPerMonthMinor(tier(49_900, 499_000)), 41_583)
    // 60 / 12 is exact.
    assert.equal(yearlyPerMonthMinor(tier(null, 60)), 5)
    // 66 / 12 = 5.5 → 6, away from zero rather than to even.
    assert.equal(yearlyPerMonthMinor(tier(null, 66)), 6)
  })

  it('is null without a yearly price', () => {
    assert.equal(yearlyPerMonthMinor(tier(49_900, null)), null)
  })

  it('rounds a negative amount away from zero too', () => {
    assert.equal(yearlyPerMonthMinor(tier(null, -66)), -6)
  })
})

describe('the recommended tier', () => {
  it('is Pro', () => {
    assert.equal(RECOMMENDED_PLAN, 'PRO')
    assert.equal(isRecommended('PRO'), true)
    assert.equal(isRecommended('START'), false)
    assert.equal(isRecommended('INSIDER'), false)
  })
})
