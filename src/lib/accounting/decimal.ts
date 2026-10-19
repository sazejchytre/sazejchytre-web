/**
 * Converting between our integer minor units and the provider's decimals.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE ONE PLACE DIVISION IS ALLOWED
 *
 * Everything in this codebase holds money as integer minor units — haléře —
 * precisely so that no arithmetic ever touches a float. Accounting providers
 * take decimals. So there has to be exactly one conversion, at the boundary,
 * and this is it.
 *
 * It is done with integer arithmetic and string assembly, NOT by dividing.
 * `79900 / 100` happens to be exactly `799` in binary floating point, but
 * `(amount / 100).toFixed(2)` is a habit that produces `798.99999999999999`
 * the first time somebody feeds it a number that is not so lucky — and a
 * one-haléř discrepancy in an accounting export is a discrepancy an
 * accountant has to reconcile by hand.
 *
 * The inverse exists because the provider echoes totals back as decimal
 * strings and we store integers. Parsing them with `parseFloat` would
 * reintroduce exactly the error this file exists to avoid.
 */
import { MINOR_UNITS_PER_MAJOR, type Currency } from '../billing/constants.ts'

/**
 * Integer minor units to a decimal string.
 *
 * `79900` CZK becomes `"799.00"`. Negative amounts keep their sign in front
 * of the whole number, which is what a correction document needs.
 *
 * @throws {RangeError} for a non-integer, which is a bug upstream.
 */
export const minorToDecimalString = (
  amountMinor: number,
  currency: Currency,
): string => {
  if (!Number.isInteger(amountMinor)) {
    throw new RangeError(
      `Amounts are integer minor units; got ${String(amountMinor)}.`,
    )
  }

  const per = MINOR_UNITS_PER_MAJOR[currency]
  const digits = String(per).length - 1

  const negative = amountMinor < 0
  const absolute = Math.abs(amountMinor)

  const major = Math.trunc(absolute / per)
  const minor = absolute % per

  const fraction = digits > 0 ? `.${String(minor).padStart(digits, '0')}` : ''

  return `${negative ? '-' : ''}${String(major)}${fraction}`
}

/**
 * A decimal string back to integer minor units.
 *
 * Parsed digit by digit rather than through `Number`, so a value the provider
 * sends with more precision than the currency has — or with a thousands
 * separator, or in exponent form — is refused instead of silently rounded.
 *
 * @throws {RangeError} when the value is not a plain decimal this currency can
 *   represent exactly.
 */
export const decimalStringToMinor = (
  value: string,
  currency: Currency,
): number => {
  const per = MINOR_UNITS_PER_MAJOR[currency]
  const digits = String(per).length - 1

  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim())

  if (!match) {
    throw new RangeError(`Not a plain decimal amount: ${JSON.stringify(value)}`)
  }

  const [, sign, whole, fraction = ''] = match

  if (fraction.length > digits) {
    // More precision than the currency has. Rounding here would invent a
    // number nobody agreed to; refusing surfaces a real disagreement between
    // us and the provider.
    const trimmed = fraction.replace(/0+$/, '')

    if (trimmed.length > digits) {
      throw new RangeError(
        `${value} has more decimal places than ${currency} can represent exactly.`,
      )
    }
  }

  const padded = fraction.slice(0, digits).padEnd(digits, '0')
  const minor = Number(whole) * per + (digits > 0 ? Number(padded) : 0)

  return sign === '-' ? -minor : minor
}
