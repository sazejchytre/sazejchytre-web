/**
 * The win / loss / void / pending indicator.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * COLOUR IS NEVER THE ONLY SIGNAL
 *
 * Red-green is the common form of colour blindness, and win/loss is exactly
 * a red-green pair. So every indicator carries THREE signals (DESIGN.md
 * rule 3):
 *
 *   1. the colour,
 *   2. a mark whose SHAPE differs — a tick, a cross, a bar, a ring — not
 *      just its colour,
 *   3. the word itself, in Czech.
 *
 * The word is the one that cannot be missed, which is why it is not optional
 * on the compact variant either — `compact` shrinks the type, it does not
 * drop the label. A component with a `showLabel={false}` prop is a component
 * that will be used that way.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THE MARKS ARE SVG NOW
 *
 * They were the text glyphs ✓ ✕ – ·. Geist, the SC-005 typeface, does not
 * contain ✓ or ✕ (checked against its `cmap`), so those two would render
 * from whatever fallback face the reader's system has — a different weight,
 * a different baseline, and on some systems an emoji. Inline SVG draws the
 * same shape everywhere, inherits `currentColor`, and stays out of the
 * accessibility tree. Copying a table cell still copies the word.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ONE LABEL AND ONE COLOUR PER STATE (rule 56)
 *
 * Pending is the `result-pending` ochre here and in `Badge tone="accent"`,
 * and nowhere else. Void is neutral grey: the stake came back and nothing
 * happened, which is not a result to colour.
 *
 * The labels are unchanged from before SC-005; wording is out of this
 * package's scope.
 */
import type { ReactNode } from 'react'

import { cn } from './cn'

/** Matches `tipResult` in `src/lib/tips/settlement.ts`. */
export type TipOutcome = 'WON' | 'LOST' | 'VOID' | 'PENDING'

/** 12×12 marks on a 12-unit grid, stroked in the current colour. */
const MARKS: Readonly<Record<TipOutcome, ReactNode>> = {
  // A tick. Distinct in shape from the cross, not only in colour.
  WON: <path d="M2.5 6.5 5 9l4.5-6" />,
  // A cross.
  LOST: <path d="m3 3 6 6M9 3 3 9" />,
  // A level bar: nothing happened either way, which is what void means.
  VOID: <path d="M2.5 6h7" />,
  // An open ring: not decided yet.
  PENDING: <circle cx="6" cy="6" r="3.25" />,
}

const PRESENTATION: Readonly<
  Record<TipOutcome, { label: string; outlined: string; filled: string }>
> = {
  WON: {
    label: 'Vyhráno',
    outlined: 'text-result-win border-result-win bg-surface-raised',
    filled: 'bg-result-win text-ink-on-result border-transparent',
  },
  LOST: {
    label: 'Prohráno',
    outlined: 'text-result-loss border-result-loss bg-surface-raised',
    filled: 'bg-result-loss text-ink-on-result border-transparent',
  },
  VOID: {
    label: 'Zrušeno',
    outlined: 'text-result-void border-result-void bg-surface-raised',
    filled: 'bg-result-void text-ink-on-result border-transparent',
  },
  PENDING: {
    label: 'Čeká na výsledek',
    outlined: 'text-result-pending border-result-pending bg-surface-raised',
    filled: 'bg-result-pending text-ink-on-result border-transparent',
  },
}

export type ResultIndicatorProps = {
  outcome: TipOutcome
  /** Smaller type for dense table rows. Still shows the word. */
  compact?: boolean
  /**
   * Filled rather than outlined, for the one place a result is the headline.
   *
   * Outlined by default: a dense table of filled chips is a wall of colour,
   * and the table is where most of these live.
   */
  filled?: boolean
  className?: string
}

export const ResultIndicator = ({
  outcome,
  compact = false,
  filled = false,
  className,
}: ResultIndicatorProps) => {
  const presentation = PRESENTATION[outcome]

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-badge border px-2 font-medium',
        compact ? 'text-label' : 'text-body-sm',
        // Each variant brings its own background, which is what keeps a
        // result tone off the accent surface: it never inherits one. That
        // matters because `result-pending` measures 4.47:1 on
        // `surface-accent`, under the floor.
        filled ? presentation.filled : presentation.outlined,
        className,
      )}
    >
      {/* Decorative: the word next to it is the accessible name, so a screen
          reader would otherwise announce an image before "Vyhráno". */}
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 12 12"
        width="12"
        height="12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0"
      >
        {MARKS[outcome]}
      </svg>
      <span>{presentation.label}</span>
    </span>
  )
}

/**
 * The void rule, as a one-line note beside a void row.
 *
 * Void tips stay fully visible in the history but leave the ROI, and a reader
 * doing the arithmetic by hand will notice the stake column not summing to
 * the denominator. This is what answers that before they conclude the numbers
 * are wrong.
 */
export const VoidRoiNote = ({ className }: { className?: string }) => (
  <span className={cn('text-body-sm text-ink-muted', className)}>
    Do ROI nevstupuje — sázka se vrátila.
  </span>
)
