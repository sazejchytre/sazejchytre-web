/**
 * The cumulative profit curve and its drawdowns. PURE.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE DRAWDOWN IS THE POINT OF THE CHART
 *
 * A cumulative profit line that only goes up is the easiest chart in the
 * world to draw and the least informative one to read. What a reader needs
 * in order to judge a record is how far it fell on the way: a +40% record
 * that was −25% for two months is a different product from one that never
 * dipped, and the ROI figure alone cannot tell them apart.
 *
 * So three rules are enforced here rather than left to the component:
 *
 *   1. NO SMOOTHING. One point per settled tip, joined by straight lines. A
 *      moving average would turn exactly the dips a reader is looking for
 *      into gentle slopes.
 *
 *   2. NO CROPPING. `seriesBounds` always includes zero, so the axis cannot
 *      start at the series minimum and make a recovery from −12 units look
 *      like a rise from the floor.
 *
 *   3. THE DRAWDOWN STARTS AT ZERO. The running peak begins at 0, before any
 *      tip has settled, so a record that went straight down from the first
 *      tip has its real depth measured rather than an eventual peak's.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHERE VOID TIPS SIT
 *
 * A void tip's profit is exactly zero, so it appears as a flat step. It is
 * NOT dropped: it happened, it is in the table, and a chart with fewer points
 * than the table has rows invites the reader to wonder what was removed. This
 * is consistent with the ROI rule — a void leaves the ROI *denominator*,
 * which is a different operation from leaving the profit series, where it
 * contributes zero either way. See the header of `settlement.ts`.
 */
import { PROFIT_SCALE } from './constants.ts'
import {
  type SelectionResult,
  type TipResult,
  type TrackRecordTip,
  profitHundredths,
  tipResult,
} from './settlement.ts'

export type SeriesTip = TrackRecordTip & {
  selections: readonly SelectionResult[]
}

export type CumulativePoint = {
  /** 1-based position in the settled sequence. The chart's x axis. */
  index: number
  tipId: string | number
  publishedAt: Date | string | null
  result: TipResult
  /** This tip's own contribution, in hundredths of a unit. */
  profitHundredths: number
  /** Running total after this tip, in hundredths of a unit. */
  cumulativeHundredths: number
}

const time = (value: Date | string | null): number => {
  if (value === null) return 0

  const parsed = value instanceof Date ? value.getTime() : Date.parse(value)

  return Number.isNaN(parsed) ? 0 : parsed
}

/**
 * Oldest first, deterministically.
 *
 * Tie-broken by id because two tips published in the same second would
 * otherwise order differently between two renders, and a chart that redraws
 * its own shape on reload is a chart nobody believes.
 */
const chronologically = (a: SeriesTip, b: SeriesTip): number => {
  const difference = time(a.publishedAt) - time(b.publishedAt)

  if (difference !== 0) return difference

  return String(a.id).localeCompare(String(b.id))
}

/**
 * The cumulative series over every SETTLED tip.
 *
 * Takes the whole array and filters here rather than trusting a caller to
 * have filtered: the figures and the chart must cover the same tips, and the
 * one way to guarantee that is for both to start from the same unfiltered
 * list.
 */
export const cumulativeSeries = (
  tips: readonly SeriesTip[],
): CumulativePoint[] => {
  const settled = tips
    .filter((tip) => tip.status === 'SETTLED')
    .slice()
    .sort(chronologically)

  let running = 0

  return settled.map((tip, position) => {
    const profit = profitHundredths(tip.selections, tip.stakeUnits)
    running += profit

    return {
      index: position + 1,
      tipId: tip.id,
      publishedAt: tip.publishedAt,
      result: tipResult(tip.selections),
      profitHundredths: profit,
      cumulativeHundredths: running,
    }
  })
}

export type Drawdown = {
  /** Index of the peak the fall started from. 0 means "before any tip". */
  peakIndex: number
  /** Index of the lowest point of the fall. */
  troughIndex: number
  /** Depth, in hundredths of a unit. Always ≥ 0. */
  depthHundredths: number
  /** The running total at the peak, in hundredths. */
  peakHundredths: number
  /** The running total at the trough, in hundredths. */
  troughHundredths: number
}

/**
 * The deepest peak-to-trough fall in the series.
 *
 * Returns null only for an empty series. A series that never fell returns a
 * zero-depth drawdown rather than null, because "no drawdown yet" is a real
 * and reportable state — and a caller that treated null as "no data" would
 * hide it.
 */
export const maxDrawdown = (
  points: readonly CumulativePoint[],
): Drawdown | null => {
  if (points.length === 0) {
    return null
  }

  // The peak starts at zero, before the first tip. A record that lost its
  // first five tips has a real drawdown from its starting capital, and
  // seeding the peak with the first point's value would report it as zero.
  let peak = 0
  let peakIndex = 0

  let worst: Drawdown = {
    peakIndex: 0,
    troughIndex: 0,
    depthHundredths: 0,
    peakHundredths: 0,
    troughHundredths: 0,
  }

  for (const point of points) {
    if (point.cumulativeHundredths > peak) {
      peak = point.cumulativeHundredths
      peakIndex = point.index
      continue
    }

    const depth = peak - point.cumulativeHundredths

    if (depth > worst.depthHundredths) {
      worst = {
        peakIndex,
        troughIndex: point.index,
        depthHundredths: depth,
        peakHundredths: peak,
        troughHundredths: point.cumulativeHundredths,
      }
    }
  }

  return worst
}

export type SeriesBounds = {
  /** Lowest value on the axis, in hundredths. Never above zero. */
  minHundredths: number
  /** Highest value on the axis, in hundredths. Never below zero. */
  maxHundredths: number
}

/**
 * The y-axis range, always including zero.
 *
 * This is the no-cropping rule in code. An axis fitted to the data alone
 * would put the series minimum at the bottom of the frame, so a record that
 * spent a month under water would look like one that rose from the floor.
 */
export const seriesBounds = (
  points: readonly CumulativePoint[],
): SeriesBounds => {
  let min = 0
  let max = 0

  for (const point of points) {
    if (point.cumulativeHundredths < min) min = point.cumulativeHundredths
    if (point.cumulativeHundredths > max) max = point.cumulativeHundredths
  }

  // A completely flat series (every tip void, or none settled) would give a
  // zero-height frame and divide by zero in the component. One unit of air
  // keeps the baseline drawable without implying a value that is not there.
  if (min === max) {
    return { minHundredths: min, maxHundredths: max + PROFIT_SCALE }
  }

  return { minHundredths: min, maxHundredths: max }
}
