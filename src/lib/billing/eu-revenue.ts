/**
 * Cross-border revenue aggregation.
 *
 * Purpose: watch how much we invoice to customers outside the home country,
 * so the EU distance-selling threshold (currently EUR 10 000 of cross-border
 * B2C supplies per calendar year, across all member states) is noticed before
 * it is crossed rather than after.
 *
 * THIS FILE CONTAINS NO TAX LOGIC and deliberately does not decide anything.
 * It reports a number. See `EXTENSION POINT` at the bottom for what has to
 * change when the operator registers for VAT or crosses the threshold.
 *
 * Pure: the invoice rows are passed in. Loading them is the caller's job.
 */
import type { Currency, InvoiceStatus } from './constants.ts'
import { CURRENCIES } from './constants.ts'
import { assertMinorAmount } from './money.ts'

/** The part of an issued invoice this aggregation needs. */
export type InvoiceRevenueSnapshot = {
  /**
   * The billing country recorded on the invoice at issue time — not the
   * customer's current country. Invoices are immutable, and so is the evidence
   * of where the supply was made.
   */
  billingCountry: string | null
  currency: Currency
  totalMinor: number
  issuedAt: Date | string | number
  status: InvoiceStatus
}

/** The part of a credit note this aggregation needs. */
export type CreditNoteRevenueSnapshot = {
  billingCountry: string | null
  currency: Currency
  amountMinor: number
  issuedAt: Date | string | number
}

export type EuRevenueOptions = {
  /** Supplies in this country are domestic and excluded. Defaults to CZ. */
  homeCountry?: string
  /**
   * Credit notes to net off. Omit and the figure is gross of refunds, which
   * overstates the threshold position.
   */
  creditNotes?: readonly CreditNoteRevenueSnapshot[]
}

const time = (value: Date | string | number): number => {
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime()

  if (Number.isNaN(ms)) {
    throw new TypeError(`Invalid issuedAt in revenue input: ${String(value)}`)
  }

  return ms
}

/**
 * Is this row a cross-border supply inside the reporting window?
 *
 * The window is half-open, `[from, to)`, so consecutive periods tile without
 * double-counting a document that lands exactly on a boundary.
 *
 * A row with no recorded country is NOT counted as cross-border. Treating
 * unknown as foreign would inflate the threshold position and trigger a false
 * alarm; such rows are a data defect to find, not a number to guess at.
 */
const isCrossBorderInWindow = (
  row: { billingCountry: string | null; issuedAt: Date | string | number },
  from: Date,
  to: Date,
  homeCountry: string,
): boolean => {
  if (!row.billingCountry) {
    return false
  }

  if (row.billingCountry.toUpperCase() === homeCountry.toUpperCase()) {
    return false
  }

  const issued = time(row.issuedAt)

  return issued >= from.getTime() && issued < to.getTime()
}

/**
 * Cross-border invoiced total, per currency, for `[from, to)`.
 *
 * Returns a map rather than one number because amounts in different currencies
 * cannot be added without an FX rate, and inventing one here would bury a
 * financial assumption in a helper. Every monetary figure in this system
 * carries its currency; a single blended integer would not.
 *
 * Fully credited invoices are excluded outright. Credit notes passed in
 * `options.creditNotes` are subtracted, which also covers partial credits.
 */
export const euRevenueTotalsMinor = (
  invoices: readonly InvoiceRevenueSnapshot[],
  from: Date,
  to: Date,
  options: EuRevenueOptions = {},
): Record<Currency, number> => {
  const homeCountry = options.homeCountry ?? 'CZ'

  const totals = Object.fromEntries(
    CURRENCIES.map((currency) => [currency, 0]),
  ) as Record<Currency, number>

  for (const invoice of invoices) {
    if (invoice.status === 'CREDITED') {
      continue
    }

    if (!isCrossBorderInWindow(invoice, from, to, homeCountry)) {
      continue
    }

    assertMinorAmount('totalMinor', invoice.totalMinor)
    totals[invoice.currency] += invoice.totalMinor
  }

  for (const note of options.creditNotes ?? []) {
    if (!isCrossBorderInWindow(note, from, to, homeCountry)) {
      continue
    }

    assertMinorAmount('amountMinor', note.amountMinor)
    totals[note.currency] -= note.amountMinor
  }

  return totals
}

/**
 * Cross-border invoiced total for one currency, for `[from, to)`.
 *
 * The currency is a required argument precisely so that no call site can
 * accidentally sum mixed currencies into one integer.
 */
export const euRevenueTotalMinor = (
  invoices: readonly InvoiceRevenueSnapshot[],
  from: Date,
  to: Date,
  currency: Currency,
  options: EuRevenueOptions = {},
): number => euRevenueTotalsMinor(invoices, from, to, options)[currency]

/* -------------------------------------------------------------------------- */
/* EXTENSION POINT — tax                                                      */
/* -------------------------------------------------------------------------- */

/**
 * WHAT IS NOT HERE, AND WHERE IT GOES WHEN IT IS NEEDED.
 *
 * The operator is a Czech sole trader who is not VAT registered and sells to
 * CZ only, so today every invoice carries `NONE_NOT_VAT_REGISTERED`, zero tax
 * and a zero rate. No code decides that; the caller states it.
 *
 * When that stops being true, the work is:
 *
 *  1. A rate resolver — `(taxableSupplyDate, treatment, country) => rate`.
 *     It must be keyed on the taxable supply date, not on "now", because a
 *     rate change applies from a date and old invoices keep their old rate.
 *  2. A treatment resolver deciding which `TAX_TREATMENTS` member applies,
 *     from: the operator's registration status, the customer's country, and
 *     whether the customer supplied a validated VAT id (B2B reverse charge).
 *  3. Tax computed on the invoice at issue time and frozen into
 *     `subtotalMinor` / `taxMinor` / `totalMinor` / `taxRatePercent`. Invoices
 *     are immutable, so this is computed once and never recomputed — a later
 *     rate change must not alter an issued document.
 *  4. `taxRatePercent` becomes insufficient the moment a fractional rate is
 *     needed; it is an integer column. Switch to basis points then.
 *
 * None of that belongs in this file: this one only reports the position that
 * tells you when to start.
 */
