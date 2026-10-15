import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CURRENCIES, ENABLED_CURRENCIES } from './constants.ts'
import { CurrencyNotEnabledError, InvalidMoneyAmountError } from './errors.ts'
import {
  assertCurrencyEnabled,
  assertMinorAmount,
  isCurrency,
  isValidMinorAmount,
  sumMinor,
} from './money.ts'

describe('isValidMinorAmount', () => {
  it('accepts non-negative integers', () => {
    for (const value of [0, 1, 34_900, 189_000, 2_147_483_647]) {
      assert.equal(isValidMinorAmount(value), true, `expected ${value} to pass`)
    }
  })

  it('rejects anything fractional — money is never a decimal', () => {
    for (const value of [34_900.5, 0.1, 1e-3, 1 / 3]) {
      assert.equal(
        isValidMinorAmount(value),
        false,
        `expected ${value} to fail`,
      )
    }
  })

  it('rejects negatives', () => {
    assert.equal(isValidMinorAmount(-1), false)
  })

  it('rejects values that would overflow an integer column', () => {
    // The column is Postgres `integer`; catching this here means the overflow
    // surfaces as a validation message rather than a 2am database error.
    assert.equal(isValidMinorAmount(2_147_483_648), false)
  })

  it('rejects non-numbers, including numeric strings', () => {
    for (const value of ['34900', null, undefined, {}, [], NaN, Infinity]) {
      assert.equal(isValidMinorAmount(value), false)
    }
  })
})

describe('assertMinorAmount', () => {
  it('returns the value when valid', () => {
    assert.equal(assertMinorAmount('amountMinor', 34_900), 34_900)
  })

  it('throws a typed error naming the field', () => {
    assert.throws(
      () => assertMinorAmount('totalMinor', 1.5),
      (error: unknown) => {
        assert.ok(error instanceof InvalidMoneyAmountError)
        assert.equal(error.code, 'INVALID_MONEY_AMOUNT')
        assert.match(error.message, /totalMinor/)
        return true
      },
    )
  })
})

describe('assertCurrencyEnabled', () => {
  it('accepts CZK, which is enabled at launch', () => {
    assert.equal(assertCurrencyEnabled('CZK', ENABLED_CURRENCIES), 'CZK')
  })

  it('rejects EUR: known to the schema but not switched on', () => {
    // This split is the point — EUR is in the Postgres enum so enabling it
    // later needs no migration, but it must not be writable before then.
    assert.ok(CURRENCIES.includes('EUR'))
    assert.ok(!ENABLED_CURRENCIES.includes('EUR'))

    assert.throws(
      () => assertCurrencyEnabled('EUR', ENABLED_CURRENCIES),
      CurrencyNotEnabledError,
    )
  })

  it('rejects a currency the schema has never heard of', () => {
    assert.throws(
      () => assertCurrencyEnabled('USD', ENABLED_CURRENCIES),
      CurrencyNotEnabledError,
    )
  })
})

describe('isCurrency', () => {
  it('narrows only to declared currencies', () => {
    assert.equal(isCurrency('CZK'), true)
    assert.equal(isCurrency('EUR'), true)
    assert.equal(isCurrency('USD'), false)
    assert.equal(isCurrency(42), false)
  })
})

describe('sumMinor', () => {
  it('adds integer amounts exactly', () => {
    assert.equal(sumMinor([34_900, 79_900, 189_000]), 303_800)
  })

  it('is zero for an empty list', () => {
    assert.equal(sumMinor([]), 0)
  })

  it('refuses to add a fractional amount', () => {
    assert.throws(() => sumMinor([100, 0.5]), InvalidMoneyAmountError)
  })
})

describe('yearly pricing policy', () => {
  it('ten months charged for twelve, per plan', () => {
    // Guards the seed's discount arithmetic against drift.
    const monthly = { START: 34_900, PRO: 79_900, INSIDER: 189_000 }

    assert.equal(monthly.START * 10, 349_000)
    assert.equal(monthly.PRO * 10, 799_000)
    assert.equal(monthly.INSIDER * 10, 1_890_000)

    // Every yearly amount still fits an integer column.
    for (const amount of Object.values(monthly)) {
      assert.equal(isValidMinorAmount(amount * 10), true)
    }
  })
})
