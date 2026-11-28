import Link from 'next/link'
import type { ReactNode } from 'react'

import { cn } from '@/components/ui/cn'

import type { FigureView, SampleState } from '../view-model'

/**
 * The public record, in one soft band.
 *
 * Four headline figures — settled tips, ROI, profit, and the worst drawdown
 * beside them (rule 50) — and one plain line with won, lost and void, in the
 * same type and the same colour (rule 47). Every figure states its date and
 * sample (rule 48) and links to the rows and the method (rules 49, 61).
 *
 * With nothing settled there are no figures at all: one sentence says so
 * (rule 52). A grid of dashes would look like a broken dashboard, and a
 * grid of zeros like a claim.
 */

const TONE = {
  default: 'text-ink',
  win: 'text-result-win',
  loss: 'text-result-loss',
} as const

export const RecordBand = ({
  headingId,
  heading,
  lead,
  asOf,
  asOfIso,
  sample,
  sampleSize,
  headline,
  counts,
  emptyNote,
  smallSampleNote,
  links,
  children,
}: {
  headingId: string
  heading: string
  lead: string
  asOf: string
  asOfIso: string
  sample: SampleState
  sampleSize: string
  /** Settled, ROI, profit, drawdown. */
  headline: readonly FigureView[]
  /** Won, lost, void: one line, equal weight. */
  counts: readonly FigureView[]
  emptyNote: string
  smallSampleNote: string
  links: readonly { href: string; label: string }[]
  /** The newest rows, when there are any. */
  children?: ReactNode
}) => (
  <section aria-labelledby={headingId} className="bg-surface-accent">
    <div className="page-shell page-gutter flex flex-col gap-10 py-16 md:py-20">
      <div className="flex max-w-reading flex-col gap-3">
        <h2 id={headingId} className="text-display-lg text-ink">
          {heading}
        </h2>
        <p className="text-lead text-ink-muted">{lead}</p>
      </div>

      {sample === 'empty' ? (
        <p className="max-w-reading text-heading font-normal text-ink">
          {emptyNote}
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-4">
            {headline.map((figure) => (
              <div key={figure.key} className="flex flex-col gap-1">
                <dt className="text-label text-ink-muted">{figure.label}</dt>
                <dd className={cn('text-data-xl', TONE[figure.tone])}>
                  {figure.value}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-body text-ink">
            {counts.map((figure, index) => (
              <span key={figure.key}>
                {index > 0 ? <span aria-hidden="true"> · </span> : null}
                {figure.label}{' '}
                <span className="text-data font-semibold">{figure.value}</span>
              </span>
            ))}
          </p>
          {sample === 'small' ? (
            <p className="max-w-reading text-body-sm text-result-pending">
              {smallSampleNote}
            </p>
          ) : null}
        </div>
      )}

      {children}

      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <p className="text-body-sm text-ink-muted">
          <time dateTime={asOfIso}>{asOf}</time>
          <span aria-hidden="true"> · </span>
          {sampleSize}
        </p>
        <ul className="flex flex-wrap gap-x-6">
          {links.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                prefetch={false}
                className="inline-flex min-h-11 items-center text-body font-medium text-brand-text underline underline-offset-4 hover:decoration-2"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  </section>
)
