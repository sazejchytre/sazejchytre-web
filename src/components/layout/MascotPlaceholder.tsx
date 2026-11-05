/**
 * Where the mascot will go.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THERE IS NO MASCOT, AND THIS DOES NOT INVENT ONE
 *
 * A mascot is planned and does not exist. The two tempting shortcuts are both
 * wrong:
 *
 *   - drawing "something animal-ish" to fill the hole invents a character the
 *     brand will then have to either keep or explain away, and whoever
 *     commissions the real one inherits a competitor;
 *   - leaving the space empty makes the hero look like a layout bug and
 *     guarantees the gap is "fixed" by someone stretching the text into it,
 *     which has to be undone when the artwork arrives.
 *
 * So this is a deliberate, labelled frame of the right proportions. It
 * reserves the space — which keeps the layout honest and the CLS at zero when
 * the image lands — and says in words what belongs there.
 *
 * The frame is `surface-accent` with a dashed `border-strong` outline: it
 * reads as a placeholder at a glance rather than as a design element, which
 * is the point. `border-strong` reaches 3:1 on every surface, so the outline
 * is visible rather than a suggestion.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * IT IS NOT ANNOUNCED TO A SCREEN READER
 *
 * `aria-hidden`, with the label as ordinary visible text. A screen-reader
 * user does not need to be told that artwork is pending; the sighted reader
 * who can see a dashed box does.
 */
import { cn } from '../ui/cn'

export type MascotPlaceholderProps = {
  /** The visible note. Comes from the message catalogue. */
  label: string
  /** `hero` is large and square-ish; `inline` fits an empty state. */
  size?: 'hero' | 'inline'
  className?: string
}

const SIZES = {
  hero: 'aspect-square w-full max-w-72',
  inline: 'aspect-[4/3] w-full max-w-40',
} as const

export const MascotPlaceholder = ({
  label,
  size = 'hero',
  className,
}: MascotPlaceholderProps) => (
  <figure className={cn('flex flex-col gap-2', className)}>
    <div
      aria-hidden="true"
      className={cn(
        'flex items-center justify-center',
        'rounded-card border-2 border-dashed border-border-strong',
        'bg-surface-accent',
        SIZES[size],
      )}
    >
      {/* A plain glyph, not a character. Two shapes that say "a picture
          goes here" without being a drawing of anything. */}
      <span className="text-display-lg text-ink-muted" aria-hidden="true">
        ⬡
      </span>
    </div>
    <figcaption className="text-label text-ink-muted">{label}</figcaption>
  </figure>
)
