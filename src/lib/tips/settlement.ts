/**
 * Settlement and track-record mathematics. PURE — no database, no clock.
 *
 * This module decides the published ROI. Everything about it is built around
 * that one fact:
 *
 *  - NO FLOATS, not even intermediately. Decimal odds like 2.1 are not
 *    representable in binary floating point, so a few hundred of them summed
 *    in a different order give a different last digit. A track record that
 *    answers differently depending on how it was computed proves nothing.
 *    Exact arithmetic is done in `BigInt`, which is integer arithmetic, and
 *    only the final rounded result becomes a `number`.
 *
 *  - ONE ROUNDING, AT THE END. Intermediate values are kept as exact
 *    fractions (numerator and denominator), so rounding happens once per
 *    reported figure rather than accumulating at every step.
 *
 *  - ROUND HALF AWAY FROM ZERO, everywhere, via one helper. "Half up" would
 *    be biased: it rounds +0.5 up but −0.5 toward zero, so a long record of
 *    small wins and losses drifts in our favour. Away-from-zero is symmetric,
 *    which is the only defensible choice for a number we publish as evidence.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE ACCUMULATOR MATHS
 *
 * The non-obvious part is how half-outcomes behave in an accumulator. An
 * Asian-handicap quarter line splits the stake in two: half runs with the leg
 * at its full price, half runs with the leg void. The rest of the accumulator
 * applies to BOTH halves identically, which means the split FACTORISES — it
 * does not need the 2^k enumeration of branches it first appears to:
 *
 *     WON        multiplier ×= odds / 1000
 *     VOID       multiplier ×= 1                (the leg is removed)
 *     HALF_WON   multiplier ×= (odds + 1000) / 2000
 *     HALF_LOST  multiplier ×= 1 / 2
 *     LOST       the whole accumulator is lost, whatever the other legs did
 *
 * `HALF_WON` is the average of "leg at full odds" and "leg void", which is
 * exactly what splitting the stake in half produces. `HALF_LOST` is the
 * average of "that half lost" (zero) and "leg void" (one).
 *
 * A VOID leg therefore does NOT void the accumulator — it drops out at 1.000
 * and the remaining legs still decide it. A LOST leg loses the whole thing
 * regardless of the others, because the legs are an AND.
 */
import {
  BASIS_POINTS_SCALE,
  EVEN_ODDS,
  ODDS_SCALE,
  PROFIT_SCALE,
  type SelectionOutcome,
  type TipStatus,
} from './constants.ts'

/* -------------------------------------------------------------------------- */
/* Exact rational helpers                                                     */
/* -------------------------------------------------------------------------- */

/** An exact value, numerator over denominator. Denominator is always > 0. */
type Fraction = { num: bigint; den: bigint }

const ZERO: Fraction = { num: 0n, den: 1n }

/**
 * Round a fraction to the nearest integer, halves away from zero.
 *
 * The single rounding primitive in this module. Implemented as
 * `floor((2|num| + den) / (2den))` with the sign reapplied, which is exact in
 * integers and needs no comparison against 0.5.
 */
export const roundHalfAwayFromZero = ({ num, den }: Fraction): bigint => {
  if (den <= 0n) {
    throw new RangeError('denominator must be positive')
  }

  const negative = num < 0n
  const magnitude = negative ? -num : num
  const rounded = (2n * magnitude + den) / (2n * den)

  return negative ? -rounded : rounded
}

/** Narrow a BigInt back to a JS number, refusing silent precision loss. */
const toNumber = (value: bigint): number => {
  if (
    value > BigInt(Number.MAX_SAFE_INTEGER) ||
    value < BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    throw new RangeError(
      `result ${value.toString()} exceeds the safe integer range; ` +
        'the inputs are implausible for a sports tip',
    )
  }

  return Number(value)
}

const round = (fraction: Fraction): number =>
  toNumber(roundHalfAwayFromZero(fraction))

/* -------------------------------------------------------------------------- */
/* Inputs                                                                    */
/* -------------------------------------------------------------------------- */

/** The part of a selection that decides money. */
export type SelectionResult = {
  outcome: SelectionOutcome
  /** Decimal odds at publication, in thousandths. 2.100 → 2100. */
  oddsAtPublication: number
  /** Decimal odds at kick-off, in thousandths. Null until recorded. */
  closingOdds?: number | null
}

/** A tip, as far as the mathematics is concerned. */
export type TipResultInput = {
  stakeUnits: number
  selections: readonly SelectionResult[]
}

/** The tip-level verdict derived from its legs. */
export type TipResult = 'PENDING' | 'WON' | 'LOST' | 'VOID'

const assertInteger = (name: string, value: unknown): number => {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new TypeError(
      `${name} must be an integer, received ${String(value)}. ` +
        'Odds are in thousandths and profit in hundredths — never a decimal.',
    )
  }

  return value
}

/* -------------------------------------------------------------------------- */
/* Combined odds                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Exact product of the legs' odds, as a fraction in units of 1 (not scaled).
 *
 * For n legs with odds in thousandths, the product is `Πodds / 1000^n`.
 */
const oddsProduct = (odds: readonly number[]): Fraction => {
  let num = 1n
  let den = 1n

  for (const value of odds) {
    num *= BigInt(assertInteger('odds', value))
    den *= BigInt(ODDS_SCALE)
  }

  return { num, den }
}

/**
 * Combined decimal odds of a tip, in thousandths.
 *
 * One selection is a single and returns its own price. Several make an
 * accumulator, whose price is the product. Rounded once, at the end.
 */
export const combinedOddsThousandths = (
  selections: readonly { oddsAtPublication: number }[],
): number => {
  if (selections.length === 0) {
    throw new RangeError('a tip must have at least one selection')
  }

  const product = oddsProduct(selections.map((s) => s.oddsAtPublication))

  // Scale back into thousandths.
  return round({ num: product.num * BigInt(ODDS_SCALE), den: product.den })
}

/**
 * Combined closing odds, in thousandths, or `null` if any leg lacks them.
 *
 * Null rather than a partial product on purpose: an accumulator's closing
 * price is only meaningful if every leg has one, and silently dropping a leg
 * would flatter the closing-line figure.
 */
export const combinedClosingOddsThousandths = (
  selections: readonly { closingOdds?: number | null }[],
): number | null => {
  if (selections.length === 0) {
    return null
  }

  const closing: number[] = []

  for (const selection of selections) {
    if (selection.closingOdds === null || selection.closingOdds === undefined) {
      return null
    }

    closing.push(selection.closingOdds)
  }

  const product = oddsProduct(closing)

  return round({ num: product.num * BigInt(ODDS_SCALE), den: product.den })
}

/* -------------------------------------------------------------------------- */
/* Profit                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The exact payout multiplier of a settled set of legs.
 *
 * See the factorisation table at the top of this file. Returns `null` when the
 * accumulator is lost outright.
 */
const payoutMultiplier = (
  selections: readonly SelectionResult[],
): Fraction | null => {
  let num = 1n
  let den = 1n

  for (const selection of selections) {
    const odds = BigInt(
      assertInteger('oddsAtPublication', selection.oddsAtPublication),
    )

    switch (selection.outcome) {
      case 'WON':
        num *= odds
        den *= BigInt(ODDS_SCALE)
        break

      case 'VOID':
        // The leg drops out at 1.000. It does NOT void the accumulator.
        break

      case 'HALF_WON':
        // Half at full price, half void: the average of the two.
        num *= odds + BigInt(EVEN_ODDS)
        den *= 2n * BigInt(ODDS_SCALE)
        break

      case 'HALF_LOST':
        // Half lost outright, half void.
        den *= 2n
        break

      case 'LOST':
        // One failed leg loses the accumulator, whatever the rest did.
        return null

      case 'PENDING':
        throw new RangeError(
          'cannot settle a tip while a selection is still PENDING',
        )

      default: {
        const exhaustive: never = selection.outcome
        throw new RangeError(`unhandled outcome ${String(exhaustive)}`)
      }
    }
  }

  return { num, den }
}

/**
 * Profit in hundredths of a unit.
 *
 * Positive is a win, negative a loss, zero a push. The stake is returned on a
 * void, so a fully-void tip is exactly zero — not a loss.
 *
 * @param selections every leg, each already settled
 * @param stakeUnits the recommended stake, in whole units
 */
export const profitHundredths = (
  selections: readonly SelectionResult[],
  stakeUnits: number,
): number => {
  if (selections.length === 0) {
    throw new RangeError('a tip must have at least one selection')
  }

  assertInteger('stakeUnits', stakeUnits)

  if (stakeUnits <= 0) {
    throw new RangeError(`stakeUnits must be positive, received ${stakeUnits}`)
  }

  const multiplier = payoutMultiplier(selections)
  const stake = BigInt(stakeUnits) * BigInt(PROFIT_SCALE)

  // Lost outright: the whole stake is gone.
  if (multiplier === null) {
    return -toNumber(stake)
  }

  // profit = stake × (multiplier − 1)
  return round({
    num: stake * (multiplier.num - multiplier.den),
    den: multiplier.den,
  })
}

/**
 * Alias matching the name in the brief.
 *
 * The brief writes `profitUnits(selectionOutcomes, stakeUnits, odds)`. The
 * odds cannot be a separate argument: a VOID leg has to be recalculated at
 * 1.000 and a HALF_WON leg at half its own price, so the per-leg prices are
 * needed, not just the combined figure. They therefore travel with the
 * outcomes, and the combined price is available from
 * `combinedOddsThousandths` when it is wanted for display.
 *
 * The unit is hundredths of a unit, as the name says — a profit of 1.5 units
 * is 150. Returning whole units would mean either a float or a lost half.
 */
export const profitUnits = profitHundredths

/* -------------------------------------------------------------------------- */
/* Tip-level verdict                                                          */
/* -------------------------------------------------------------------------- */

/**
 * What happened to the tip as a whole.
 *
 * A single selection's outcome does not decide this: the tip is PENDING until
 * every leg has one. Half-outcomes are classified by the money — a HALF_LOST
 * single lost money, so it counts as a loss.
 */
export const tipResult = (
  selections: readonly SelectionResult[],
): TipResult => {
  if (selections.length === 0) {
    return 'PENDING'
  }

  if (selections.some((s) => s.outcome === 'PENDING')) {
    return 'PENDING'
  }

  if (selections.some((s) => s.outcome === 'LOST')) {
    return 'LOST'
  }

  if (selections.every((s) => s.outcome === 'VOID')) {
    return 'VOID'
  }

  // Stake is irrelevant to the sign, so any positive stake answers it.
  const profit = profitHundredths(selections, 1)

  if (profit > 0) {
    return 'WON'
  }

  if (profit < 0) {
    return 'LOST'
  }

  return 'VOID'
}

/** Is every leg decided? This is what allows a tip to move to SETTLED. */
export const isFullySettled = (
  selections: readonly SelectionResult[],
): boolean =>
  selections.length > 0 && selections.every((s) => s.outcome !== 'PENDING')

/* -------------------------------------------------------------------------- */
/* Track record                                                               */
/* -------------------------------------------------------------------------- */

/** A tip as the track record sees it. */
export type TrackRecordTip = {
  id: string | number
  sportCode: string
  status: TipStatus
  /** When the claim was made. The date a record is filtered on. */
  publishedAt: Date | string | null
  settledAt?: Date | string | null
  stakeUnits: number
  selections: readonly SelectionResult[]
}

export type TrackRecordFilter = {
  /** Restrict to one or more sports, by code. */
  sportCodes?: readonly string[]
  /** Inclusive lower bound on `publishedAt`. */
  from?: Date
  /** EXCLUSIVE upper bound on `publishedAt`, so periods tile without overlap. */
  to?: Date
  /** Restrict to particular tip statuses. */
  statuses?: readonly TipStatus[]
}

export type TrackRecord = {
  /** Tips counted — those that are SETTLED and pass the filter. */
  settled: number
  won: number
  lost: number
  void: number
  /** Total staked, in whole units. */
  stakedUnits: number
  /** Net profit, in HUNDREDTHS of a unit. 150 = 1.5 units. */
  profitHundredths: number
  /** Return on investment, in basis points. 425 = +4.25%. Null if nothing staked. */
  roiBasisPoints: number | null
  /** Mean combined odds, in thousandths. Null if nothing counted. */
  averageOddsThousandths: number | null
  /**
   * Closing line value, in basis points, over the tips that have closing odds
   * on every leg. Positive means we took a better price than the close.
   */
  closingLineValueBasisPoints: number | null
  /** How many tips contributed to the CLV figure. */
  closingLineSampleSize: number
}

const asTime = (value: Date | string | null | undefined): number | null => {
  if (value === null || value === undefined) {
    return null
  }

  const time =
    value instanceof Date ? value.getTime() : new Date(value).getTime()

  return Number.isNaN(time) ? null : time
}

const matchesFilter = (
  tip: TrackRecordTip,
  filter: TrackRecordFilter,
): boolean => {
  if (filter.sportCodes && !filter.sportCodes.includes(tip.sportCode)) {
    return false
  }

  if (filter.statuses && !filter.statuses.includes(tip.status)) {
    return false
  }

  if (filter.from || filter.to) {
    const published = asTime(tip.publishedAt)

    // A tip with no publication date cannot be placed in a window. It is
    // excluded rather than guessed at.
    if (published === null) {
      return false
    }

    if (filter.from && published < filter.from.getTime()) {
      return false
    }

    if (filter.to && published >= filter.to.getTime()) {
      return false
    }
  }

  return true
}

/**
 * Aggregate a set of tips into a track record.
 *
 * Only SETTLED tips contribute to the money figures: a pending tip has no
 * result, and a voided one has no stake at risk. Statuses can still be
 * filtered, so a caller can ask "how many drafts are there" — but the
 * arithmetic always ignores anything unsettled, because including it would
 * mean publishing a return on bets that have not finished.
 */
export const trackRecord = (
  tips: readonly TrackRecordTip[],
  filter: TrackRecordFilter = {},
): TrackRecord => {
  const counted = tips.filter(
    (tip) => tip.status === 'SETTLED' && matchesFilter(tip, filter),
  )

  let won = 0
  let lost = 0
  let voided = 0
  let stakedUnits = 0
  let profitTotal = 0n

  // Exact running sums, rounded once at the end. Combined odds are already
  // integers (thousandths) so they sum as a plain BigInt; CLV is a sum of
  // fractions and needs the exact form.
  let oddsSumThousandths = 0n
  let clvSum: Fraction = ZERO
  let clvSample = 0

  for (const tip of counted) {
    const result = tipResult(tip.selections)

    if (result === 'WON') {
      won += 1
    } else if (result === 'LOST') {
      lost += 1
    } else if (result === 'VOID') {
      voided += 1
    }

    stakedUnits += tip.stakeUnits
    profitTotal += BigInt(profitHundredths(tip.selections, tip.stakeUnits))

    const taken = combinedOddsThousandths(tip.selections)
    oddsSumThousandths += BigInt(taken)

    const closing = combinedClosingOddsThousandths(tip.selections)

    if (closing !== null && closing > 0) {
      // CLV = taken/closing − 1, in basis points. Accumulated exactly:
      // Σ (taken − closing) / closing.
      const term: Fraction = {
        num: BigInt(taken - closing),
        den: BigInt(closing),
      }

      clvSum = {
        num: clvSum.num * term.den + term.num * clvSum.den,
        den: clvSum.den * term.den,
      }
      clvSample += 1
    }
  }

  const settled = counted.length

  return {
    settled,
    won,
    lost,
    void: voided,
    stakedUnits,
    profitHundredths: toNumber(profitTotal),
    // ROI = profit / staked. Profit is in hundredths, so ×100 converts the
    // ratio straight into basis points.
    roiBasisPoints:
      stakedUnits > 0
        ? round({
            num: profitTotal * BigInt(BASIS_POINTS_SCALE),
            den: BigInt(stakedUnits) * BigInt(PROFIT_SCALE),
          })
        : null,
    averageOddsThousandths:
      settled > 0
        ? round({ num: oddsSumThousandths, den: BigInt(settled) })
        : null,
    closingLineValueBasisPoints:
      clvSample > 0
        ? round({
            num: clvSum.num * BigInt(BASIS_POINTS_SCALE),
            den: clvSum.den * BigInt(clvSample),
          })
        : null,
    closingLineSampleSize: clvSample,
  }
}
