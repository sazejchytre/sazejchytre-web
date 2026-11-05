/**
 * Czech formatting for the scaled integers the domain stores.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY FORMATTING IS ITS OWN MODULE
 *
 * Every figure on the public site arrives as a scaled integer: odds in
 * thousandths, profit in hundredths, ROI in basis points. That is deliberate
 * — see the header of `src/lib/tips/settlement.ts` — and it means the
 * division happens at the very last moment, in exactly one place.
 *
 * Put it in a component and the division gets copied, and the copy rounds
 * differently. A track record that shows 38.33% in one place and 38.3% in
 * another has two numbers for one fact, and a reader is right to distrust
 * both.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * CZECH CONVENTIONS THAT ARE EASY TO GET WRONG
 *
 *   - the decimal separator is a COMMA: 2,35 not 2.35;
 *   - the thousands separator is a NARROW NO-BREAK SPACE, which is what
 *     `Intl` emits for cs-CZ — not a comma, and not an ordinary space that
 *     could wrap mid-number;
 *   - a date is `5. 11. 2026`, with spaces after the dots;
 *   - the currency goes AFTER the amount: `799 Kč`.
 *
 * `Intl` knows all of this. The job here is to hand it the right number.
 */
import {
  BASIS_POINTS_SCALE,
  ODDS_SCALE,
  PROFIT_SCALE,
} from '../tips/constants.ts'

const LOCALE = 'cs-CZ'

/* -------------------------------------------------------------------------- */
/* Odds                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Thousandths to a decimal price. `2345` → `"2,35"`.
 *
 * Two decimals always, because a column of prices where some have one and
 * some two is a column that does not line up even with tabular figures.
 */
export const formatOdds = (thousandths: number): string =>
  new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(thousandths / ODDS_SCALE)

/* -------------------------------------------------------------------------- */
/* Units of stake and profit                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Hundredths of a unit to a signed figure. `575` → `"+5,75"`.
 *
 * The sign is always shown for profit, including the plus. A column where
 * gains have no sign and losses do reads as though the gains were neutral,
 * and the eye stops finding the minus signs.
 */
export const formatProfitUnits = (hundredths: number): string => {
  const formatted = new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: 'exceptZero',
  }).format(hundredths / PROFIT_SCALE)

  return formatted
}

/** Whole units, unsigned. For a stake, which is never negative. */
export const formatStakeUnits = (units: number): string =>
  new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(units)

/* -------------------------------------------------------------------------- */
/* ROI                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Basis points to a signed percentage. `3833` → `"+38,33 %"`.
 *
 * Czech puts a space before the percent sign. `Intl`'s `style: 'percent'`
 * does that correctly, which is why the value is divided by 10 000 and handed
 * over as a ratio rather than formatted as a number with a `%` appended.
 *
 * Returns null for a null ROI rather than `"0 %"`. A record with nothing
 * staked — every tip void — has no return, and printing zero would be a claim
 * about money that was never at risk.
 */
export const formatRoi = (basisPoints: number | null): string | null => {
  if (basisPoints === null) return null

  return new Intl.NumberFormat(LOCALE, {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: 'exceptZero',
  }).format(basisPoints / BASIS_POINTS_SCALE)
}

/* -------------------------------------------------------------------------- */
/* Dates                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Europe/Prague, always.
 *
 * Not the server's zone and not the viewer's: a tip published at 23:30 CET
 * must read as that day for everyone, or the history table and the analysis
 * text disagree about when something happened. The operator, the accountant
 * and the reader are all in one country.
 */
const TIME_ZONE = 'Europe/Prague'

const asDate = (value: Date | string): Date =>
  value instanceof Date ? value : new Date(value)

/** `5. 11. 2026` */
export const formatDate = (value: Date | string): string =>
  new Intl.DateTimeFormat(LOCALE, {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    timeZone: TIME_ZONE,
  }).format(asDate(value))

/** `5. listopadu 2026` — for prose, not for tables. */
export const formatDateLong = (value: Date | string): string =>
  new Intl.DateTimeFormat(LOCALE, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: TIME_ZONE,
  }).format(asDate(value))

/** `5. 11. 2026 20:45` */
export const formatDateTime = (value: Date | string): string =>
  new Intl.DateTimeFormat(LOCALE, {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TIME_ZONE,
  }).format(asDate(value))

/**
 * `2026-11-05`, for a `<time dateTime>` attribute and for form inputs.
 *
 * Computed from the Prague calendar date rather than `toISOString()`, which
 * would give the UTC date and be a day out for anything after 23:00 local.
 */
export const formatDateIso = (value: Date | string): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: TIME_ZONE,
  }).format(asDate(value))

  return parts
}

/* -------------------------------------------------------------------------- */
/* Counts                                                                     */
/* -------------------------------------------------------------------------- */

/** A plain integer with Czech grouping. `1234` → `"1 234"`. */
export const formatCount = (value: number): string =>
  new Intl.NumberFormat(LOCALE).format(value)

/**
 * Czech plurals for a count of tips.
 *
 * Czech has three forms and `Intl.PluralRules` knows which is which: 1 tip,
 * 2–4 tipy, 5+ tipů, and a decimal takes the "many" form. Hard-coding
 * `${n} tipů` reads as broken Czech for exactly the counts a new site has.
 */
const TIP_FORMS: Readonly<Record<Intl.LDMLPluralRule, string>> = {
  one: 'tip',
  few: 'tipy',
  many: 'tipu',
  other: 'tipů',
  two: 'tipy',
  zero: 'tipů',
}

export const formatTipCount = (count: number): string => {
  const rule = new Intl.PluralRules(LOCALE).select(count)

  return `${formatCount(count)} ${TIP_FORMS[rule]}`
}
