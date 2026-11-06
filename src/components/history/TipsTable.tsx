/**
 * The track record, as a table.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * A REAL `<table>`, SORTED ON THE SERVER
 *
 * Column headings are links that change the query string, so a sorted view is
 * linkable and the page needs no JavaScript to produce it. `aria-sort` on the
 * active heading is what tells a screen-reader user which column the table is
 * ordered by — without it the sort is visible only as an arrow glyph, which
 * is to say invisible.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * NINE COLUMNS, AND WHAT HAPPENS TO THEM ON A PHONE
 *
 * The row becomes a card and each cell grows its own label, through the
 * `.data-table` rules in `globals.css`. The labels come from `data-label`,
 * set here from the same strings the `<th>`s use, so a column cannot be
 * renamed in the heading and not in the card.
 *
 * Horizontal scrolling across nine columns is explicitly not acceptable: a
 * reader would have to scroll right to see whether a tip won and left again
 * for its date, and comparing two rows becomes impossible.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THERE IS NO "SORT BY RESULT"
 *
 * Sorting does not hide anything, so it is not the same risk as filtering.
 * But a result sort is one click from a screenshot that shows nothing but
 * wins, and the column already groups itself visually through its tone and
 * glyph. So the sortable columns are the measurable ones.
 */
import Link from 'next/link'

import { ResultIndicator } from '@/components/ui/ResultIndicator'
import {
  formatDate,
  formatDateIso,
  formatOdds,
  formatProfitUnits,
  formatStakeUnits,
} from '@/lib/format/czech'
import {
  type ArchiveQuery,
  type ArchiveRow,
  type SortDirection,
  type SortKey,
  archiveQueryString,
} from '@/lib/tips/archive'

export type TipsTableLabels = {
  caption: string
  columns: {
    date: string
    sport: string
    event: string
    selection: string
    odds: string
    stake: string
    result: string
    profit: string
    cumulative: string
  }
  sortAscending: string
  sortDescending: string
  legs: string
}

export type TipsTableProps = {
  rows: readonly ArchiveRow[]
  query: ArchiveQuery
  labels: TipsTableLabels
  /** Path the sort links point at, without a query string. */
  basePath: string
}

/** What `aria-sort` should say for a column. */
const ariaSort = (
  column: SortKey | null,
  query: ArchiveQuery,
): 'ascending' | 'descending' | 'none' | undefined => {
  if (column === null) return undefined
  if (query.sort !== column) return 'none'

  return query.direction === 'asc' ? 'ascending' : 'descending'
}

/** Clicking the active column flips it; clicking another starts descending. */
const nextDirection = (column: SortKey, query: ArchiveQuery): SortDirection => {
  if (query.sort !== column) return 'desc'

  return query.direction === 'desc' ? 'asc' : 'desc'
}

const SortableHeading = ({
  column,
  label,
  query,
  basePath,
  labels,
  align,
}: {
  column: SortKey
  label: string
  query: ArchiveQuery
  basePath: string
  labels: TipsTableLabels
  align?: 'end'
}) => {
  const direction = nextDirection(column, query)
  const href = `${basePath}${archiveQueryString({ ...query, sort: column, direction })}`
  const active = query.sort === column

  return (
    <th scope="col" aria-sort={ariaSort(column, query)} data-align={align}>
      <Link
        href={href}
        className="inline-flex min-h-11 items-center gap-1 text-label text-ink-muted underline-offset-4 hover:text-brand-text hover:underline"
        // Says what the link DOES, not what the column is — a screen reader
        // already read the column name from the heading.
        aria-label={`${label}: ${
          direction === 'asc' ? labels.sortAscending : labels.sortDescending
        }`}
      >
        {label}
        {/* The arrow is decoration; `aria-sort` above is the real signal. */}
        <span aria-hidden="true">
          {active ? (query.direction === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </Link>
    </th>
  )
}

/** The tone a profit figure takes. Zero is neutral, not a win. */
const profitTone = (hundredths: number): string => {
  if (hundredths > 0) return 'text-result-win'
  if (hundredths < 0) return 'text-result-loss'

  return 'text-ink-muted'
}

export const TipsTable = ({
  rows,
  query,
  labels,
  basePath,
}: TipsTableProps) => (
  <table className="data-table">
    <caption>{labels.caption}</caption>

    <thead>
      <tr>
        <SortableHeading
          column="date"
          label={labels.columns.date}
          query={query}
          basePath={basePath}
          labels={labels}
        />
        <SortableHeading
          column="sport"
          label={labels.columns.sport}
          query={query}
          basePath={basePath}
          labels={labels}
        />
        <th scope="col">{labels.columns.event}</th>
        <th scope="col">{labels.columns.selection}</th>
        <SortableHeading
          column="odds"
          label={labels.columns.odds}
          query={query}
          basePath={basePath}
          labels={labels}
          align="end"
        />
        <SortableHeading
          column="stake"
          label={labels.columns.stake}
          query={query}
          basePath={basePath}
          labels={labels}
          align="end"
        />
        <th scope="col">{labels.columns.result}</th>
        <SortableHeading
          column="profit"
          label={labels.columns.profit}
          query={query}
          basePath={basePath}
          labels={labels}
          align="end"
        />
        <SortableHeading
          column="cumulative"
          label={labels.columns.cumulative}
          query={query}
          basePath={basePath}
          labels={labels}
          align="end"
        />
      </tr>
    </thead>

    <tbody>
      {rows.map((row) => (
        <tr key={String(row.id)}>
          <td data-label={labels.columns.date}>
            {row.publishedAt ? (
              // `dateTime` so the date is machine-readable as well as
              // readable: a crawler and an assistant both get the ISO form.
              <time dateTime={formatDateIso(row.publishedAt)}>
                {formatDate(row.publishedAt)}
              </time>
            ) : null}
          </td>

          <td data-label={labels.columns.sport}>{row.sportName}</td>

          <td data-label={labels.columns.event}>
            {/* The tip page is where the analysis lives. A settled tip's
                result is public there too, in every state. */}
            {/*
              `min-h-11`: a tab-through measured these at 24px. They are the
              most-followed links on the site and the only way into a tip, so
              the 44px floor applies — they are the cell's whole content, not
              a link inside a sentence.

              `.data-table` gives the cell less vertical padding to
              compensate, so the row grows by 4px rather than by 20px and the
              table stays dense enough to scan.
            */}
            <Link
              href={`/tipy/${row.slug}`}
              className="inline-flex min-h-11 items-center text-brand-text underline underline-offset-4"
            >
              {row.eventName}
            </Link>
          </td>

          <td data-label={labels.columns.selection}>
            {row.selectionLabel}
            {row.legs > 1 ? (
              <span className="text-ink-muted">
                {' '}
                ({labels.legs}: {row.legs})
              </span>
            ) : null}
          </td>

          <td data-label={labels.columns.odds} data-align="end">
            <span className="text-data-sm">
              {formatOdds(row.oddsThousandths)}
            </span>
          </td>

          <td data-label={labels.columns.stake} data-align="end">
            <span className="text-data-sm">
              {formatStakeUnits(row.stakeUnits)}
            </span>
          </td>

          <td data-label={labels.columns.result}>
            <ResultIndicator outcome={row.result} compact />
          </td>

          <td data-label={labels.columns.profit} data-align="end">
            <span
              className={`text-data-sm ${profitTone(row.profitHundredths)}`}
            >
              {formatProfitUnits(row.profitHundredths)}
            </span>
          </td>

          <td data-label={labels.columns.cumulative} data-align="end">
            <span
              className={`text-data-sm ${profitTone(row.cumulativeHundredths)}`}
            >
              {formatProfitUnits(row.cumulativeHundredths)}
            </span>
          </td>
        </tr>
      ))}
    </tbody>
  </table>
)
