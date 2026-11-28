/**
 * What the homepage prototype shows, computed from real records. PURE.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * NO NEW DATA PATH
 *
 * Everything here takes the output of the loaders and projections the live
 * pages already use — `publicTrackRecord` over `loadAllSettledTips`, and
 * `buildArchiveRows` over the same tips, exactly as `/historie` does — and
 * only FORMATS it. Nothing is filtered, nothing is selected and no tip field
 * that `/historie` does not already render is read. If SC-024 changes the
 * public projection, this page follows it without an edit.
 *
 * Relative `.ts` imports, not `@/`, so `node --test` can load this file
 * directly (Node's type stripping does not read tsconfig paths).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE RULES THIS ENCODES (DESIGN.md)
 *
 *   47  Losses are listed like wins: same row, same weight, same position.
 *       `latestResultRows` sorts by date and nothing else.
 *   48  Figures carry their period and sample size (rendered by the page).
 *   50  The worst stretch (max drawdown) sits beside the totals.
 *   51  Under ~30 settled tips the sample is called too small.
 *   52  With nothing settled, a rate is shown as "no value", never as 0 %.
 */
import type { ArchiveRow } from '../../../../lib/tips/archive.ts'
import { sortArchiveRows } from '../../../../lib/tips/archive.ts'
import type { Drawdown } from '../../../../lib/tips/series.ts'
import type { TipResult, TrackRecord } from '../../../../lib/tips/settlement.ts'
import {
  formatCount,
  formatDate,
  formatDateIso,
  formatOdds,
  formatProfitUnits,
  formatRoi,
} from '../../../../lib/format/czech.ts'

/** DESIGN.md rule 51's "~30". Below it the sample is called too small. */
export const SMALL_SAMPLE_THRESHOLD = 30

/** How many rows the homepage excerpt shows. The full list is one click away. */
export const LATEST_RESULTS_LIMIT = 8

export type FigureTone = 'default' | 'win' | 'loss'

export type FigureView = {
  key:
    | 'settled'
    | 'won'
    | 'lost'
    | 'void'
    | 'profit'
    | 'roi'
    | 'averageOdds'
    | 'drawdown'
  label: string
  value: string
  tone: FigureTone
  /** True when `value` is the "no value" mark rather than a number. */
  empty: boolean
}

export type FigureLabels = {
  settled: string
  won: string
  lost: string
  void: string
  profit: string
  roi: string
  averageOdds: string
  drawdown: string
  unitsShort: string
  /** The mark for "nothing to compute from yet", e.g. an em dash. */
  noValue: string
}

/** The sign of a figure as a tone. Zero is neutral, not a win. */
export const signTone = (value: number): FigureTone =>
  value > 0 ? 'win' : value < 0 ? 'loss' : 'default'

/**
 * The eight headline figures, in reading order.
 *
 * Counts are always real numbers, zero included: "0 vyhodnocených tipů" is
 * a true statement about the database. Rates and sums over nothing (profit,
 * ROI, average odds, drawdown with no settled tip) are not zero — they do
 * not exist yet — so they get the "no value" mark instead of a 0 that would
 * read as a result.
 */
export const recordFigures = (
  record: TrackRecord,
  drawdown: Drawdown | null,
  labels: FigureLabels,
): readonly FigureView[] => {
  const hasSettled = record.settled > 0
  const units = (hundredths: number): string =>
    `${formatProfitUnits(hundredths)} ${labels.unitsShort}`

  const roi = hasSettled ? formatRoi(record.roiBasisPoints) : null
  const averageOdds =
    hasSettled && record.averageOddsThousandths !== null
      ? formatOdds(record.averageOddsThousandths)
      : null
  const drawdownValue =
    hasSettled && drawdown !== null
      ? // A fall, so it is written as the negative it was.
        units(-drawdown.depthHundredths)
      : null

  const valued = (
    key: FigureView['key'],
    label: string,
    value: string | null,
    tone: FigureTone,
  ): FigureView =>
    value === null
      ? { key, label, value: labels.noValue, tone: 'default', empty: true }
      : { key, label, value, tone, empty: false }

  return [
    valued('settled', labels.settled, formatCount(record.settled), 'default'),
    // Won and lost in the SAME tone. Rule 47: a loss count does not get to
    // be quieter than a win count.
    valued('won', labels.won, formatCount(record.won), 'default'),
    valued('lost', labels.lost, formatCount(record.lost), 'default'),
    valued('void', labels.void, formatCount(record.void), 'default'),
    valued(
      'profit',
      labels.profit,
      hasSettled ? units(record.profitHundredths) : null,
      signTone(record.profitHundredths),
    ),
    valued('roi', labels.roi, roi, signTone(record.roiBasisPoints ?? 0)),
    valued('averageOdds', labels.averageOdds, averageOdds, 'default'),
    valued(
      'drawdown',
      labels.drawdown,
      drawdownValue,
      drawdown && drawdown.depthHundredths > 0 ? 'loss' : 'default',
    ),
  ]
}

export type SampleState = 'empty' | 'small' | 'sufficient'

/** Which note the sample size needs (rules 51 and 52). */
export const sampleState = (settled: number): SampleState =>
  settled === 0
    ? 'empty'
    : settled < SMALL_SAMPLE_THRESHOLD
      ? 'small'
      : 'sufficient'

export type ResultRowView = {
  id: string | number
  href: string
  /** `27. 11. 2026` for the eye, `2026-11-27` for `<time dateTime>`. */
  date: string | null
  dateIso: string | null
  sport: string
  event: string
  selection: string
  odds: string
  result: TipResult
  profit: string
  profitTone: FigureTone
}

/**
 * The newest settled tips, as table rows.
 *
 * Takes rows built from the WHOLE record and sorts them by date, newest
 * first — the same default as `/historie`. There is no parameter that could
 * select by result, and the function never looks at `result` except to pass
 * it through, so the excerpt is the most recent N, losses included.
 */
export const latestResultRows = (
  rows: readonly ArchiveRow[],
  unitsShort: string,
  limit: number = LATEST_RESULTS_LIMIT,
): readonly ResultRowView[] =>
  sortArchiveRows(rows, 'date', 'desc')
    .slice(0, Math.max(0, limit))
    .map((row) => ({
      id: row.id,
      href: `/tipy/${row.slug}`,
      date: row.publishedAt ? formatDate(row.publishedAt) : null,
      dateIso: row.publishedAt ? formatDateIso(row.publishedAt) : null,
      sport: row.sportName || row.sportCode,
      event: row.eventName,
      selection: row.selectionLabel,
      odds: formatOdds(row.oddsThousandths),
      result: row.result,
      profit: `${formatProfitUnits(row.profitHundredths)} ${unitsShort}`,
      profitTone: signTone(row.profitHundredths),
    }))
