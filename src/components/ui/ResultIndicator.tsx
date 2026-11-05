/**
 * The win / loss / void / pending indicator.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * COLOUR IS NEVER THE ONLY SIGNAL
 *
 * Red-green is the common form of colour blindness, and win/loss is exactly
 * a red-green pair. So every indicator carries THREE signals:
 *
 *   1. the colour,
 *   2. a glyph whose SHAPE differs (✓ ✕ – ·), not just its colour,
 *   3. the word itself, in Czech.
 *
 * The word is the one that cannot be missed, which is why it is not optional
 * on the compact variant either — `compact` shrinks the type, it does not
 * drop the label. A component with a `showLabel={false}` prop is a component
 * that will be used that way.
 *
 * The glyphs are plain text rather than icons so they survive with no icon
 * font, inside a copied table cell, and in a plain-text email.
 */
import { cn } from './cn'

/** Matches `tipResult` in `src/lib/tips/settlement.ts`. */
export type TipOutcome = 'WON' | 'LOST' | 'VOID' | 'PENDING'

const PRESENTATION: Readonly<
  Record<
    TipOutcome,
    { glyph: string; label: string; outlined: string; filled: string }
  >
> = {
  WON: {
    // A tick. Distinct in shape from the cross, not only in colour.
    glyph: '✓',
    label: 'Vyhráno',
    outlined: 'text-result-win border-result-win bg-surface-page',
    filled: 'bg-result-win text-ink-on-result border-transparent',
  },
  LOST: {
    glyph: '✕',
    label: 'Prohráno',
    outlined: 'text-result-loss border-result-loss bg-surface-page',
    filled: 'bg-result-loss text-ink-on-result border-transparent',
  },
  VOID: {
    // An en dash: nothing happened either way, which is what void means.
    glyph: '–',
    label: 'Zrušeno',
    outlined: 'text-result-void border-result-void bg-surface-page',
    filled: 'bg-result-void text-ink-on-result border-transparent',
  },
  PENDING: {
    glyph: '·',
    label: 'Čeká na výsledek',
    outlined: 'text-ink-muted border-border-strong bg-surface-page',
    // No filled pending: `border-strong` is a border colour, and filling a
    // chip with it would be a grey block competing with real results for
    // attention it does not deserve.
    filled: 'text-ink-muted border-border-strong bg-surface-page',
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
        'inline-flex items-center gap-1.5 rounded-badge border px-2 py-0.5',
        compact ? 'text-label' : 'text-body-sm',
        // Each variant brings its own background, which is what keeps a
        // result tone off an accent surface: it never inherits one. That
        // matters because result tones measure 4.27 / 4.43 / 4.52 against
        // `surface-accent` — two failures and a two-hundredths pass.
        filled ? presentation.filled : presentation.outlined,
        className,
      )}
    >
      {/* Decorative: the word next to it is the accessible name, so a screen
          reader would otherwise read "tick Vyhráno". */}
      <span aria-hidden="true">{presentation.glyph}</span>
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
