/**
 * Minor-unit money helpers.
 *
 * Every monetary amount in this system is an integer count of the currency's
 * minor unit (haléře for CZK, cents for EUR) and always travels with its
 * currency code. There is deliberately no function here that produces a float
 * for storage, and no "parse a decimal string into an amount" helper — those
 * are where rounding bugs get in.
 *
 * Pure and dependency-free apart from the domain error types.
 */
import {
  CURRENCIES,
  type Currency,
  MINOR_UNITS_PER_MAJOR,
} from './constants.ts'
import { CurrencyNotEnabledError, InvalidMoneyAmountError } from './errors.ts'

/** True when the value is safe to store in an `integer` money column. */
export const isValidMinorAmount = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  // Money columns are Postgres `integer`. Reject anything that would overflow
  // rather than letting the database do it at 2am.
  value <= 2_147_483_647

/**
 * Assert a money amount is a storable non-negative integer of minor units.
 *
 * @throws {InvalidMoneyAmountError}
 */
export const assertMinorAmount = (field: string, value: unknown): number => {
  if (!isValidMinorAmount(value)) {
    throw new InvalidMoneyAmountError(field, value)
  }

  return value
}

/** Narrow an arbitrary string to a known currency code. */
export const isCurrency = (value: unknown): value is Currency =>
  typeof value === 'string' && (CURRENCIES as readonly string[]).includes(value)

/**
 * Assert a currency is switched on for writing.
 *
 * The schema knows more currencies than we accept, so that enabling one is a
 * config change rather than a migration. This is the gate that keeps the
 * difference honest.
 *
 * @throws {CurrencyNotEnabledError}
 */
export const assertCurrencyEnabled = (
  currency: string,
  enabled: readonly Currency[],
): Currency => {
  if (!isCurrency(currency) || !enabled.includes(currency)) {
    throw new CurrencyNotEnabledError(String(currency), enabled)
  }

  return currency
}

/**
 * Format an amount for display.
 *
 * Division happens here and nowhere else, at the very edge of the system,
 * because the result is a string for a human and is never read back.
 */
export const formatMinorAmount = (
  amountMinor: number,
  currency: Currency,
  locale = 'cs-CZ',
): string => {
  assertMinorAmount('amountMinor', amountMinor)

  const per = MINOR_UNITS_PER_MAJOR[currency]

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(amountMinor / per)
}

/**
 * Sum minor amounts that are already known to share one currency.
 *
 * Takes the currency only to make the shared-currency assumption explicit at
 * every call site; mixing currencies is a caller bug this cannot detect.
 */
export const sumMinor = (amounts: readonly number[]): number => {
  let total = 0

  for (const amount of amounts) {
    total += assertMinorAmount('amount', amount)
  }

  return assertMinorAmount('total', total)
}
