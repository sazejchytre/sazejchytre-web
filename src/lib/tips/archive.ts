/**
 * Rows, filters and sorting for the public archive. PURE.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE FILTER CANNOT EXCLUDE A LOSS. BY CONSTRUCTION.
 *
 * `ArchiveFilter` has three fields — sport, from, to — and there is no fourth.
 * Not "there is no fourth in the UI": there is no fourth in the TYPE, so a
 * result filter cannot be added by a component, passed through a query string
 * or sneaked in as an option. A history from which the losses can be filtered
 * out proves nothing, and the only durable way to guarantee that is for the
 * capability to be absent rather than unused.
 *
 * Two consequences follow, and both are deliberate:
 *
 *   - A filter narrows WHICH ROWS ARE LISTED. It never touches the headline
 *     figures, which come from `publicTrackRecord` over the unfiltered set.
 *     So the ROI on the page is always the ROI of the whole record, and a
 *     filtered table is explicitly labelled as a selection.
 *
 *   - The CUMULATIVE column is computed over the unfiltered chronological
 *     series and then looked up per row. A cumulative total recomputed inside
 *     a filter would be a different number for the same tip depending on what
 *     else was on screen, which is the fastest way to make a reader distrust
 *     every figure on the page.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * SORTING IS A URL, NOT STATE
 *
 * The sort is read from the query string and applied on the server. That
 * makes a sorted view linkable, survivable across a reload, and free of
 * JavaScript — and it means the table is in the HTML, sorted, for a crawler
 * and for a reader on a slow connection. The cost is a round trip per click,
 * which for a page of static evidence is the right trade.
 */
import {
  type SelectionResult,
  type TipResult,
  combinedOddsThousandths,
  profitHundredths,
  tipResult,
} from './settlement.ts'
import type { TipStatus } from './constants.ts'
import { cumulativeSeries } from './series.ts'

/* -------------------------------------------------------------------------- */
/* Input shapes                                                               */
/* -------------------------------------------------------------------------- */

export type ArchiveSelection = SelectionResult & {
  market: string
  selection: string
  line: string | null
  eventName: string
}

/**
 * The part of a tip this module needs.
 *
 * Structural rather than importing `PublicTip` from the loader: that keeps
 * this module free of anything that reaches for a database, so it can be
 * tested without one.
 */
export type ArchiveTip = {
  id: string | number
  slug: string
  sportCode: string
  sportName: string
  title: string
  status: TipStatus
  publishedAt: Date | string | null
  stakeUnits: number
  selections: readonly ArchiveSelection[]
}

export type ArchiveRow = {
  id: string | number
  slug: string
  title: string
  sportCode: string
  sportName: string
  publishedAt: Date | string | null
  /** Event name, or the count of legs when there is more than one. */
  eventName: string
  selectionLabel: string
  legs: number
  oddsThousandths: number
  stakeUnits: number
  result: TipResult
  profitHundredths: number
  /** Running total after this tip, over the WHOLE record. See the header. */
  cumulativeHundredths: number
}

/* -------------------------------------------------------------------------- */
/* Row building                                                               */
/* -------------------------------------------------------------------------- */

const selectionLabel = (selections: readonly ArchiveSelection[]): string => {
  const first = selections[0]

  if (!first) return ''

  const base = first.line
    ? `${first.market} ${first.selection} ${first.line}`
    : `${first.market} ${first.selection}`

  return base.trim()
}

/**
 * Settled tips as table rows, newest first.
 *
 * Takes the unfiltered list. The cumulative column is built from the
 * chronological series over the same list, so a row's running total is a
 * property of the record rather than of the current view.
 */
export const buildArchiveRows = (
  tips: readonly ArchiveTip[],
): readonly ArchiveRow[] => {
  const cumulative = new Map<string, number>()

  for (const point of cumulativeSeries(
    tips.map((tip) => ({
      id: tip.id,
      sportCode: tip.sportCode,
      status: tip.status,
      publishedAt: tip.publishedAt,
      stakeUnits: tip.stakeUnits,
      selections: tip.selections,
    })),
  )) {
    cumulative.set(String(point.tipId), point.cumulativeHundredths)
  }

  return tips
    .filter((tip) => tip.status === 'SETTLED')
    .map((tip) => ({
      id: tip.id,
      slug: tip.slug,
      title: tip.title,
      sportCode: tip.sportCode,
      sportName: tip.sportName || tip.sportCode,
      publishedAt: tip.publishedAt,
      eventName: tip.selections[0]?.eventName ?? tip.title,
      selectionLabel: selectionLabel(tip.selections),
      legs: tip.selections.length,
      oddsThousandths: combinedOddsThousandths(tip.selections),
      stakeUnits: tip.stakeUnits,
      result: tipResult(tip.selections),
      profitHundredths: profitHundredths(tip.selections, tip.stakeUnits),
      cumulativeHundredths: cumulative.get(String(tip.id)) ?? 0,
    }))
    .sort((a, b) => timeOf(b.publishedAt) - timeOf(a.publishedAt))
}

const timeOf = (value: Date | string | null): number => {
  if (value === null) return 0

  const parsed = value instanceof Date ? value.getTime() : Date.parse(value)

  return Number.isNaN(parsed) ? 0 : parsed
}

/* -------------------------------------------------------------------------- */
/* Filtering                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * THE WHOLE FILTER. Sport and a date range. Nothing else, ever.
 *
 * If you are here to add `result`, read the module header first: the omission
 * is the feature.
 */
export type ArchiveFilter = {
  /** Sport code, or null for all sports. */
  sport: string | null
  /** Inclusive, `YYYY-MM-DD`. */
  from: string | null
  /** Inclusive, `YYYY-MM-DD`. */
  to: string | null
}

export const EMPTY_FILTER: ArchiveFilter = { sport: null, from: null, to: null }

const isDateOnly = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value)

/**
 * A `YYYY-MM-DD` boundary as a timestamp in PRAGUE, not UTC.
 *
 * `Date.parse('2026-11-05')` is midnight UTC, which is 01:00 in Prague in
 * winter and 02:00 in summer. Using it directly would silently drop tips
 * published in the first hour or two of the "from" day — a filter that
 * loses rows at the edges, for a reason nobody would find.
 *
 * `Intl` is used to discover the offset for that date rather than hard-coding
 * one or two hours, because which one applies depends on the date.
 */
const pragueBoundary = (date: string, end: boolean): number | null => {
  if (!isDateOnly(date)) return null

  const base = Date.parse(`${date}T${end ? '23:59:59.999' : '00:00:00.000'}Z`)

  if (Number.isNaN(base)) return null

  // What UTC time does Prague call `date`T00:00? Formatting the UTC instant
  // in Prague and comparing gives the offset for that day.
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Prague',
    hour: '2-digit',
    hour12: false,
  })

  const hourInPrague = Number(formatter.format(new Date(base)))
  const utcHour = new Date(base).getUTCHours()
  const offsetHours = (hourInPrague - utcHour + 24) % 24

  return base - offsetHours * 60 * 60 * 1000
}

/**
 * Apply the filter.
 *
 * Note what this function CANNOT do: it has no access to `row.result`, which
 * is not a discipline — the filter it is given has nowhere to express one.
 */
export const filterArchiveRows = (
  rows: readonly ArchiveRow[],
  filter: ArchiveFilter,
): readonly ArchiveRow[] => {
  const from = filter.from ? pragueBoundary(filter.from, false) : null
  const to = filter.to ? pragueBoundary(filter.to, true) : null

  return rows.filter((row) => {
    if (filter.sport && row.sportCode !== filter.sport) {
      return false
    }

    const published = timeOf(row.publishedAt)

    if (from !== null && published < from) return false
    if (to !== null && published > to) return false

    return true
  })
}

/* -------------------------------------------------------------------------- */
/* Sorting                                                                    */
/* -------------------------------------------------------------------------- */

export const SORT_KEYS = [
  'date',
  'sport',
  'odds',
  'stake',
  'profit',
  'cumulative',
] as const

export type SortKey = (typeof SORT_KEYS)[number]
export type SortDirection = 'asc' | 'desc'

export const DEFAULT_SORT: SortKey = 'date'
export const DEFAULT_DIRECTION: SortDirection = 'desc'

export const isSortKey = (value: unknown): value is SortKey =>
  typeof value === 'string' && (SORT_KEYS as readonly string[]).includes(value)

const comparators: Readonly<
  Record<SortKey, (a: ArchiveRow, b: ArchiveRow) => number>
> = {
  date: (a, b) => timeOf(a.publishedAt) - timeOf(b.publishedAt),
  sport: (a, b) => a.sportName.localeCompare(b.sportName, 'cs-CZ'),
  odds: (a, b) => a.oddsThousandths - b.oddsThousandths,
  stake: (a, b) => a.stakeUnits - b.stakeUnits,
  profit: (a, b) => a.profitHundredths - b.profitHundredths,
  cumulative: (a, b) => a.cumulativeHundredths - b.cumulativeHundredths,
}

/**
 * Sort, stably, with the date as the tie-break.
 *
 * `Array.prototype.sort` is stable in every engine that matters, so the
 * date tie-break is belt and braces — but a table where two equal stakes
 * swap places between renders looks like data changing under the reader.
 *
 * There is deliberately no `result` comparator. Sorting by result is not the
 * same as filtering by it — every row is still present — but it is one
 * keystroke from a screenshot showing nothing but wins, and the result column
 * is already grouped visually by its own colour and glyph.
 */
export const sortArchiveRows = (
  rows: readonly ArchiveRow[],
  key: SortKey = DEFAULT_SORT,
  direction: SortDirection = DEFAULT_DIRECTION,
): readonly ArchiveRow[] => {
  const compare = comparators[key]
  const sign = direction === 'asc' ? 1 : -1

  return rows.slice().sort((a, b) => {
    const primary = compare(a, b)

    if (primary !== 0) return primary * sign

    return (timeOf(a.publishedAt) - timeOf(b.publishedAt)) * sign
  })
}

/* -------------------------------------------------------------------------- */
/* Query parsing                                                              */
/* -------------------------------------------------------------------------- */

export type ArchiveQuery = {
  sort: SortKey
  direction: SortDirection
  filter: ArchiveFilter
}

/**
 * Read the view from untrusted search params.
 *
 * Everything unrecognised falls back to the default rather than erroring: a
 * hand-edited URL should show the table, not a 500. A malformed date is
 * dropped entirely — treating `?from=yesterday` as "today" would silently
 * show a different record from the one the URL asked for.
 */
export const parseArchiveQuery = (
  params: Record<string, string | string[] | undefined>,
): ArchiveQuery => {
  const first = (value: string | string[] | undefined): string | null => {
    if (Array.isArray(value)) return value[0] ?? null

    return typeof value === 'string' && value !== '' ? value : null
  }

  const sortParam = first(params.razeni)
  const directionParam = first(params.smer)
  const sportParam = first(params.sport)
  const fromParam = first(params.od)
  const toParam = first(params.do)

  return {
    sort: isSortKey(sortParam) ? sortParam : DEFAULT_SORT,
    direction: directionParam === 'asc' ? 'asc' : DEFAULT_DIRECTION,
    // Spread over EMPTY_FILTER rather than listing the three fields: if a
    // fourth ever appeared, this would carry its default instead of silently
    // dropping it.
    filter: {
      ...EMPTY_FILTER,
      sport: sportParam,
      from: fromParam && isDateOnly(fromParam) ? fromParam : null,
      to: toParam && isDateOnly(toParam) ? toParam : null,
    },
  }
}

/** Is any filter active? Drives the "showing X of Y" note. */
export const hasActiveFilter = (filter: ArchiveFilter): boolean =>
  filter.sport !== null || filter.from !== null || filter.to !== null

/**
 * A query string for a sort link, preserving the active filter.
 *
 * Built here rather than in the component so that a sort link cannot
 * accidentally drop the filter — which would look like the filter resetting
 * itself when a column is clicked.
 */
export const archiveQueryString = (query: ArchiveQuery): string => {
  const params = new URLSearchParams()

  if (query.sort !== DEFAULT_SORT) params.set('razeni', query.sort)
  if (query.direction !== DEFAULT_DIRECTION) params.set('smer', query.direction)
  if (query.filter.sport) params.set('sport', query.filter.sport)
  if (query.filter.from) params.set('od', query.filter.from)
  if (query.filter.to) params.set('do', query.filter.to)

  const encoded = params.toString()

  return encoded === '' ? '' : `?${encoded}`
}
