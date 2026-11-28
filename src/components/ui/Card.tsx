/**
 * Card, badge, section heading and headline figure.
 *
 * Small, boring components whose only job is to stop the same six utility
 * strings being retyped on twelve pages — which is how a design system drifts
 * one `rounded-xl` at a time.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * A "CARD" IS A QUIET PANEL
 *
 * Flat, 12px corners, a hairline edge or a soft tint — no shadow, no
 * gradient, no glow. Whether a page should use one at all is the page's
 * decision: in the SC-005 direction most content sits directly on the page,
 * and sections are separated by space and the soft band rather than boxes.
 */
import type { ComponentProps, ReactNode } from 'react'

import { cn } from './cn'

/* -------------------------------------------------------------------------- */
/* Card                                                                       */
/* -------------------------------------------------------------------------- */

export type CardProps = Omit<ComponentProps<'div'>, 'className'> & {
  /**
   * `raised` is the default: a white panel with a hairline. `accent` is the
   * soft-tinted panel for a callout, with no border at all. `page` matches
   * the canvas, for a panel that should read as part of it.
   */
  tone?: 'raised' | 'accent' | 'page'
  /** Removes the padding, for a card whose child owns its own edges (a table). */
  flush?: boolean
  className?: string
  children: ReactNode
}

const TONES = {
  raised: 'bg-surface-raised border-border-subtle',
  accent: 'bg-surface-accent border-transparent',
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
      // 12px radius. `overflow-hidden` so a flush child (a table, an image)
      // cannot square off the corners.
      'rounded-card border overflow-hidden',
      TONES[tone],
      // 20px on a phone, 32px from 640px.
      !flush && 'p-5 sm:p-8',
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
 * A 6px chip, not a pill (rule 44), with a hairline or a tone-coloured edge.
 *
 * `accent` was the yellow attention fill. Its successor is the `pending`
 * ochre as an outline: the same "look at this" job, now at AA as text
 * (4.85:1 on white), and its one caller in the codebase marks an unsettled
 * result — which is exactly what that colour means everywhere else
 * (rule 56: one colour per state).
 *
 * Every tone brings its own background, so a result tone never inherits the
 * accent surface, where `result-pending` measures under 4.5:1.
 *
 * A FILLED result chip comes from `ResultIndicator`, which also carries the
 * shape and the Czech word; it is not duplicated here.
 */
const BADGE_TONES: Readonly<Record<BadgeTone, string>> = {
  neutral: 'bg-surface-page text-ink-muted border-border-subtle',
  brand: 'bg-brand text-ink-on-brand border-transparent',
  accent: 'bg-surface-raised text-result-pending border-result-pending',

  // Outlined: the result colour as text, on its own white.
  win: 'bg-surface-raised text-result-win border-result-win',
  loss: 'bg-surface-raised text-result-loss border-result-loss',
  void: 'bg-surface-raised text-result-void border-result-void',
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
      'inline-flex items-center gap-1 rounded-badge border px-2 text-label',
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
 * The heading style for each level — DESIGN.md's H1 / H2 / H3.
 *
 * H1 48/56 (32/40 on mobile), H2 32/40 (24/32), H3 20/28. Before SC-005 a
 * Section's h2 used the H3 size, which flattened every page into one level.
 */
const HEADING_STYLES = {
  h1: 'text-display-xl',
  h2: 'text-display-lg',
  h3: 'text-heading',
} as const

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
        <Heading className={cn(HEADING_STYLES[Heading], 'text-ink')}>
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
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE FOOTNOTE LIVES INSIDE THE `<dd>`
 *
 * A `<dl>` may contain only `<dt>`, `<dd>`, `<div>`, `<script>` and
 * `<template>`, and a `<div>` wrapper may hold only dt/dd groups. A stray
 * `<p>` in there breaks the association between the term and its
 * description — caught by Lighthouse's `definition-list` audit. Inside the
 * `<dd>` the note is announced as part of the value, which is where it
 * belongs: "Vsazeno — 15 jednotek, bez zrušených tipů" is one fact.
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
    <dd className="flex flex-col gap-1">
      <span className={cn('text-data-xl', FIGURE_TONES[tone])}>{value}</span>
      {foot ? (
        <span className="text-body-sm text-ink-muted">{foot}</span>
      ) : null}
    </dd>
  </div>
)
