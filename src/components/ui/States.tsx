/**
 * Empty, loading and error states.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THEY ARE COMPONENTS AND NOT AN AFTERTHOUGHT PER PAGE
 *
 * Because every one of them is a page a real visitor will see, and the
 * version that gets written at the end of an afternoon is a centred "Nic tu
 * není" with no explanation and no way out. Three rules are built in here
 * instead of being remembered:
 *
 *   1. AN EMPTY STATE SAYS WHY IT IS EMPTY. "Zatím nemáme vyhodnocený ani
 *      jeden tip" is a different sentence from "Pro zvolený filtr nejsou
 *      žádné tipy", and a reader who gets the wrong one concludes the site is
 *      broken.
 *
 *   2. AN ERROR STATE OFFERS A WAY FORWARD. A retry, a link, or an address.
 *
 *   3. A LOADING STATE RESERVES THE SPACE IT WILL FILL. A skeleton that is
 *      the wrong height is a layout shift, which is a Core Web Vitals
 *      failure and, more to the point, makes the page jump under the reader's
 *      eye at the moment they start reading.
 *
 * `aria-hidden` on the skeletons, with one live region announcing "Načítání…"
 * for a screen reader: forty announced grey rectangles are worse than
 * silence.
 */
import type { ReactNode } from 'react'

import { Card } from './Card'
import { cn } from './cn'

/* -------------------------------------------------------------------------- */
/* Empty                                                                      */
/* -------------------------------------------------------------------------- */

export type EmptyStateProps = {
  /** One sentence saying why there is nothing here. */
  children: ReactNode
  /** A heading, when the empty state stands in for a whole section. */
  title?: string
  /** A link or button out. */
  action?: ReactNode
  /** The mascot placeholder, where a page wants one. */
  illustration?: ReactNode
  className?: string
}

export const EmptyState = ({
  children,
  title,
  action,
  illustration,
  className,
}: EmptyStateProps) => (
  <Card
    tone="raised"
    className={cn('flex flex-col items-start gap-4', className)}
  >
    {illustration}
    {title ? <h3 className="text-heading text-ink">{title}</h3> : null}
    <p className="max-w-prose text-body text-ink-muted">{children}</p>
    {action}
  </Card>
)

/* -------------------------------------------------------------------------- */
/* Loading                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One grey block.
 *
 * No pulse animation by default: `prefers-reduced-motion` is honoured
 * globally, but a page of pulsing rectangles is visual noise even for
 * somebody who has not asked for less motion. The block is enough to say
 * "something is coming".
 */
export const Skeleton = ({
  className,
  rounded = 'input',
}: {
  className?: string
  rounded?: 'input' | 'card' | 'pill'
}) => (
  <div
    aria-hidden="true"
    className={cn(
      'bg-surface-accent',
      rounded === 'card' && 'rounded-card',
      rounded === 'pill' && 'rounded-pill',
      rounded === 'input' && 'rounded-input',
      className,
    )}
  />
)

/**
 * The one thing a screen reader hears while a page loads.
 *
 * `role="status"` with `aria-live="polite"` so it is announced without
 * interrupting, and the visible skeletons stay `aria-hidden`.
 */
export const LoadingAnnouncement = ({ label }: { label: string }) => (
  <p role="status" aria-live="polite" className="sr-only-focusable">
    {label}
  </p>
)

/* -------------------------------------------------------------------------- */
/* Error                                                                      */
/* -------------------------------------------------------------------------- */

export type ErrorStateProps = {
  title: string
  children: ReactNode
  /** A retry button, a link, or both. Never nothing. */
  action: ReactNode
  className?: string
}

export const ErrorState = ({
  title,
  children,
  action,
  className,
}: ErrorStateProps) => (
  <Card
    tone="raised"
    className={cn('flex flex-col items-start gap-4', className)}
  >
    {/*
      `role="alert"` rather than a plain heading: this appears after a failed
      render, so it has to be announced rather than waited for.
    */}
    <div role="alert" className="flex flex-col gap-2">
      <h2 className="text-heading text-ink">{title}</h2>
      <p className="max-w-prose text-body text-ink-muted">{children}</p>
    </div>
    {action}
  </Card>
)
