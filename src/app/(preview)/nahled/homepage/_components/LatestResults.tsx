import Link from 'next/link'

import { cn } from '@/components/ui/cn'
import { ResultIndicator } from '@/components/ui/ResultIndicator'

import type { ResultRowView } from '../view-model'

/**
 * The newest settled tips: the history table, in miniature, on the home page.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ONE `<table>`, TWO LAYOUTS (DESIGN.md rules 10 and 60)
 *
 * From 768px it is an ordinary table: caption, `th scope="col"`, numbers
 * right-aligned in Geist Mono. Below 768px each row becomes TWO LINES rather
 * than a sideways-scrolling six-column table or a stack of labelled cards:
 *
 *     27. 11. 2026 · Fotbal                     [✕ Prohráno]
 *     Sparta – Slavia · Výsledek 1 @ 2,10         −1,00 j.
 *
 * The header row stays in the accessibility tree, so a screen reader still
 * hears a table with its column names. The explicit `role`s look redundant
 * and are not: changing `display` on table elements makes some browsers
 * (WebKit in particular) drop their table semantics, and the roles put them
 * back.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE EMPTY STATE IS A ROW, NOT A MISSING TABLE
 *
 * With nothing settled the table still renders its caption and headings,
 * and one row says so in words. That shows where every result will go,
 * wins and losses alike, without inventing one (rule 52).
 */

export type LatestResultsLabels = {
  caption: string
  timeZone: string
  date: string
  event: string
  selection: string
  odds: string
  result: string
  profit: string
  empty: string
}

const PROFIT_TONE = {
  default: 'text-ink',
  win: 'text-result-win',
  loss: 'text-result-loss',
} as const

/** The two-line mobile grid, as areas. `md:` restores the table layout. */
const ROW = cn(
  'grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-4 py-3',
  "[grid-template-areas:'meta_result'_'event_profit']",
  'md:table-row md:p-0',
  'border-b border-border-subtle last:border-b-0',
  'hover:bg-[color-mix(in_srgb,var(--color-ink)_4%,transparent)]',
)

const CELL = 'md:table-cell md:px-4 md:py-3 md:align-baseline'

export const LatestResults = ({
  rows,
  labels,
}: {
  rows: readonly ResultRowView[]
  labels: LatestResultsLabels
}) => (
  <div className="overflow-hidden rounded-card border border-border-subtle bg-surface-raised">
    <table role="table" className="block w-full border-collapse md:table">
      <caption className="block border-b border-border-subtle px-4 py-3 text-start text-body-sm text-ink-muted md:table-caption">
        {labels.caption} {labels.timeZone}
      </caption>

      <thead
        role="rowgroup"
        className="sr-only md:not-sr-only md:table-header-group"
      >
        <tr role="row" className="border-b border-ink">
          <th
            scope="col"
            role="columnheader"
            className="px-4 py-2 text-start text-label text-ink-muted"
          >
            {labels.date}
          </th>
          <th
            scope="col"
            role="columnheader"
            className="px-4 py-2 text-start text-label text-ink-muted"
          >
            {labels.event}
          </th>
          <th
            scope="col"
            role="columnheader"
            className="px-4 py-2 text-start text-label text-ink-muted"
          >
            {labels.selection}
          </th>
          <th
            scope="col"
            role="columnheader"
            className="px-4 py-2 text-end text-label text-ink-muted"
          >
            {labels.odds}
          </th>
          <th
            scope="col"
            role="columnheader"
            className="px-4 py-2 text-start text-label text-ink-muted"
          >
            {labels.result}
          </th>
          <th
            scope="col"
            role="columnheader"
            className="px-4 py-2 text-end text-label text-ink-muted"
          >
            {labels.profit}
          </th>
        </tr>
      </thead>

      <tbody role="rowgroup" className="block md:table-row-group">
        {rows.length === 0 ? (
          <tr role="row" className="block md:table-row">
            <td
              role="cell"
              colSpan={6}
              className="block px-4 py-8 text-body text-ink-muted md:table-cell md:px-4"
            >
              {labels.empty}
            </td>
          </tr>
        ) : (
          rows.map((row) => (
            <tr key={row.id} role="row" className={ROW}>
              {/* Line 1, left: date and sport. */}
              <td
                role="cell"
                className={cn(
                  CELL,
                  '[grid-area:meta] text-data-sm text-ink-muted md:text-ink',
                )}
              >
                {row.dateIso && row.date ? (
                  <time dateTime={row.dateIso}>{row.date}</time>
                ) : null}
                <span className="md:hidden">
                  {' · '}
                  {row.sport}
                </span>
              </td>

              {/* Line 2, left: the event (linked) and, on mobile, the pick. */}
              <td
                role="cell"
                className={cn(CELL, '[grid-area:event] text-body-sm')}
              >
                <Link
                  href={row.href}
                  className="font-medium text-ink underline decoration-border-strong underline-offset-4 hover:text-brand-text hover:decoration-current"
                >
                  {row.event}
                </Link>
                <span className="block text-ink-muted md:text-label">
                  <span className="hidden md:inline">{row.sport}</span>
                  <span className="md:hidden">
                    {row.selection} @{' '}
                    <span className="text-data-sm">{row.odds}</span>
                  </span>
                </span>
              </td>

              <td
                role="cell"
                className={cn(
                  CELL,
                  'hidden text-body-sm text-ink md:table-cell',
                )}
              >
                {row.selection}
              </td>

              <td
                role="cell"
                className={cn(
                  CELL,
                  'hidden text-end text-data-sm text-ink md:table-cell',
                )}
              >
                {row.odds}
              </td>

              {/* Line 1, right. */}
              <td
                role="cell"
                className={cn(CELL, '[grid-area:result] justify-self-end')}
              >
                <ResultIndicator outcome={row.result} compact />
              </td>

              {/* Line 2, right. The sign is printed, so colour is not alone. */}
              <td
                role="cell"
                className={cn(
                  CELL,
                  '[grid-area:profit] justify-self-end text-end text-data-sm',
                  PROFIT_TONE[row.profitTone],
                )}
              >
                {row.profit}
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  </div>
)
