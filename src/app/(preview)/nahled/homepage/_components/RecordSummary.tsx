import Link from 'next/link'

import { cn } from '@/components/ui/cn'

import type { FigureView, SampleState } from '../view-model'

/**
 * The record at a glance: the "scoreboard" beside the hero.
 *
 * A white sheet on the off-white page, figures in a two-column definition
 * list. Counts are real numbers (zero included); rates that cannot exist yet
 * show the no-value mark with a spoken equivalent, so a screen reader says
 * "zatím bez hodnoty" instead of "dash".
 *
 * Won and lost are the same size, weight and tone (rule 47). Profit, ROI and
 * the drawdown take their sign's colour — and the sign itself is always
 * printed, so colour is never the only signal.
 */

export type RecordSummaryProps = {
  headingId: string
  heading: string
  /** `Stav k 27. 11. 2026`. */
  asOf: string
  asOfIso: string
  figures: readonly FigureView[]
  sample: SampleState
  /** `Vzorek: 0 vyhodnocených tipů`. */
  sampleSize: string
  emptyNote: string
  smallSampleNote: string
  noValueLabel: string
  links: readonly { href: string; label: string }[]
}

const TONE = {
  default: 'text-ink',
  win: 'text-result-win',
  loss: 'text-result-loss',
} as const

export const RecordSummary = ({
  headingId,
  heading,
  asOf,
  asOfIso,
  figures,
  sample,
  sampleSize,
  emptyNote,
  smallSampleNote,
  noValueLabel,
  links,
}: RecordSummaryProps) => (
  <section
    aria-labelledby={headingId}
    className="flex flex-col rounded-card border border-border-subtle bg-surface-raised"
  >
    <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border-subtle px-4 py-3 sm:px-6">
      <h2 id={headingId} className="text-heading text-ink">
        {heading}
      </h2>
      <p className="text-data-sm text-ink-muted">
        <time dateTime={asOfIso}>{asOf}</time>
      </p>
    </header>

    {/* Hairlines between cells come from the 1px gap over the border colour.
        The four counts share one row from 640px, the four rates sit 2×2
        beneath, so the panel stays close to the height of the hero text. */}
    <dl className="grid grid-cols-2 gap-px bg-border-subtle sm:grid-cols-4">
      {figures.map((figure, index) => (
        <div
          key={figure.key}
          className={cn(
            // `justify-between`: a label that wraps to two lines must not
            // push its number below its neighbours' — the values line up.
            'flex flex-col justify-between gap-1 bg-surface-raised px-4 py-3',
            index >= 4 && 'sm:col-span-2 sm:px-6',
          )}
        >
          <dt className="text-label text-ink-muted">{figure.label}</dt>
          <dd className={cn('text-data-xl', TONE[figure.tone])}>
            {figure.empty ? (
              <>
                <span aria-hidden="true" className="text-ink-muted">
                  {figure.value}
                </span>
                <span className="sr-only-focusable">{noValueLabel}</span>
              </>
            ) : (
              figure.value
            )}
          </dd>
        </div>
      ))}
    </dl>

    <footer className="flex flex-col gap-3 border-t border-border-subtle px-4 py-4 sm:px-6">
      <p className="text-data-sm text-ink">{sampleSize}</p>
      {sample === 'empty' ? (
        <p className="text-body-sm text-ink-muted">{emptyNote}</p>
      ) : null}
      {sample === 'small' ? (
        // The attention tone, as text with its own words: not a warning
        // banner, a sentence.
        <p className="text-body-sm text-result-pending">{smallSampleNote}</p>
      ) : null}
      <ul className="flex flex-wrap gap-x-6">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="inline-flex min-h-11 items-center text-label text-brand-text underline underline-offset-4 hover:decoration-2"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </footer>
  </section>
)
