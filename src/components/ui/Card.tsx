/**
 * Card, badge and section heading.
 *
 * Small, boring components whose only job is to stop the same six utility
 * strings being retyped on twelve pages — which is how a design system drifts
 * one `rounded-xl` at a time.
 */
import type { ComponentProps, ReactNode } from 'react'

import { cn } from './cn'

/* -------------------------------------------------------------------------- */
/* Card                                                                       */
/* -------------------------------------------------------------------------- */

export type CardProps = Omit<ComponentProps<'div'>, 'className'> & {
  /**
   * `raised` is the default. `accent` is the pale green, used for the
   * recommended tier and for callouts — not for decoration.
   */
  tone?: 'raised' | 'accent' | 'page'
  /** Removes the padding, for a card whose child owns its own edges (a table). */
  flush?: boolean
  className?: string
  children: ReactNode
}

const TONES = {
  raised: 'bg-surface-raised border-border-subtle',
  accent: 'bg-surface-accent border-border-subtle',
  page: 'bg-surface-page border-border-subtle',
} as const

export const Card = ({
  tone = 'raised',
  flush = false,
  className,
  children,
  ...rest
}: CardProps) => (
  <div
    className={cn(
      // 16px radius, per the geometry. `overflow-hidden` so a flush child
      // (a table, an image) cannot square off the corners.
      'rounded-card border overflow-hidden',
      TONES[tone],
      !flush && 'p-6',
      className,
    )}
    {...rest}
  >
    {children}
  </div>
)

/* -------------------------------------------------------------------------- */
/* Badge                                                                      */
/* -------------------------------------------------------------------------- */

export type BadgeTone = 'neutral' | 'brand' | 'accent' | 'win' | 'loss' | 'void'

/**
 * Badge tones.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHERE "NEVER WHITE" APPLIES AND WHERE IT DOES NOT
 *
 * On `brand` and `accent` the foreground is always dark ink: white measures
 * 2.07:1 and 1.38:1 on them. That rule is scoped to those two fills.
 *
 * On a RESULT fill white is fine — 5.33:1 on win, 7.30:1 on loss, 5.63:1 on
 * void — and that treatment exists, in `ResultIndicator`'s `filled` variant.
 * It is NOT duplicated here: this component had three `*-filled` result tones
 * that nothing ever used, which is worse than no API at all, because the
 * second implementation is the one that drifts. A filled result chip comes
 * from `ResultIndicator`, which also carries the glyph and the Czech word.
 *
 * The result tones below are therefore outlined only. That is also the right
 * default for the place most of them live: a dense table of filled chips is a
 * wall of colour.
 */
const BADGE_TONES: Readonly<Record<BadgeTone, string>> = {
  neutral: 'bg-surface-raised text-ink-muted border-border-subtle',
  brand: 'bg-brand text-ink-on-brand border-transparent',
  accent: 'bg-accent text-ink-on-accent border-transparent',

  // Outlined: the result colour as text, on the page surface.
  win: 'bg-surface-page text-result-win border-result-win',
  loss: 'bg-surface-page text-result-loss border-result-loss',
  void: 'bg-surface-page text-result-void border-result-void',
}

export type BadgeProps = {
  tone?: BadgeTone
  className?: string
  children: ReactNode
}

export const Badge = ({
  tone = 'neutral',
  className,
  children,
}: BadgeProps) => (
  <span
    className={cn(
      'inline-flex items-center gap-1 rounded-badge border px-2 py-0.5 text-label',
      BADGE_TONES[tone],
      className,
    )}
  >
    {children}
  </span>
)

/* -------------------------------------------------------------------------- */
/* Section                                                                    */
/* -------------------------------------------------------------------------- */

export type SectionProps = {
  /** The heading. Rendered as h2 by default — pages own their single h1. */
  title: string
  as?: 'h1' | 'h2' | 'h3'
  /** One sentence under the heading. No eyebrow labels above it. */
  lead?: ReactNode
  /** Rendered at the end of the heading row, for a "see all" link. */
  action?: ReactNode
  id?: string
  className?: string
  children: ReactNode
}

/**
 * A titled block of page.
 *
 * The vertical rhythm lives here rather than in each page, which is what
 * stops the 96px-of-air-between-everything problem: a section's spacing is
 * one decision made once, not a judgement call per page.
 */
export const Section = ({
  title,
  as: Heading = 'h2',
  lead,
  action,
  id,
  className,
  children,
}: SectionProps) => (
  <section id={id} className={cn('flex flex-col gap-6', className)}>
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <div className="flex flex-col gap-2">
        <Heading
          className={cn(
            Heading === 'h1' ? 'text-display-lg' : 'text-heading',
            'text-ink',
          )}
        >
          {title}
        </Heading>
        {lead ? (
          <p className="max-w-prose text-body text-ink-muted">{lead}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>

    {children}
  </section>
)

/* -------------------------------------------------------------------------- */
/* Figure                                                                     */
/* -------------------------------------------------------------------------- */

export type FigureProps = {
  label: string
  /** Pre-formatted. Formatting lives in `src/lib/format`, not here. */
  value: string
  /** A result tone, when the figure carries one (profit, ROI). */
  tone?: 'default' | 'win' | 'loss' | 'void'
  /** Smaller print under the value — a sample size, a unit. */
  foot?: ReactNode
  className?: string
}

const FIGURE_TONES = {
  default: 'text-ink',
  win: 'text-result-win',
  loss: 'text-result-loss',
  void: 'text-result-void',
} as const

/**
 * One headline number.
 *
 * The value uses `text-data-xl`, which carries tabular figures — so a row of
 * these lines up rather than wobbling by a digit width.
 */
export const Figure = ({
  label,
  value,
  tone = 'default',
  foot,
  className,
}: FigureProps) => (
  <div className={cn('flex flex-col gap-1', className)}>
    <dt className="text-label text-ink-muted">{label}</dt>
    <dd className={cn('text-data-xl', FIGURE_TONES[tone])}>{value}</dd>
    {foot ? <p className="text-body-sm text-ink-muted">{foot}</p> : null}
  </div>
)
