/**
 * Text input, textarea, select and checkbox, with their labels and errors.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ONE BORDER COLOUR, ON EVERY SURFACE
 *
 * `border-strong` reaches 3:1 against all three surfaces — 4.26 / 4.04 / 3.93
 * on raised / page / accent in light, 3.92 / 4.26 / 3.62 in dark — so a
 * control looks the same wherever it sits and there is nothing for a caller
 * to get wrong. The field itself is the white `surface-raised` (DESIGN.md:
 * inputs sit on `surface`), so it reads as a place to type on either the
 * page or a panel.
 *
 * These components briefly took an `on="page" | "raised"` prop, because an
 * earlier `border-strong` was under 3:1 on two of the three surfaces and a
 * control inside a card had to step up to `ink-muted`. The token was fixed
 * instead, and the prop went with it: a conditional border is a decision at
 * every call site, and the one thing worse than a wrong border is a border
 * that is right only when somebody remembers an argument.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ERRORS ARE WIRED, NOT JUST COLOURED
 *
 * `aria-invalid` and `aria-describedby` point at the message, so a screen
 * reader announces WHY the field was rejected rather than only that it was.
 * Colour alone would say nothing to a screen reader and nothing to a
 * colour-blind reader either, which is why the message is always text.
 */
import type { ComponentProps, ReactNode } from 'react'

import { cn } from './cn'

const CONTROL_BASE = cn(
  'w-full rounded-input border bg-surface-raised text-ink',
  'px-3 py-2 text-body',
  'placeholder:text-ink-muted',
  'min-h-11',
  'transition-colors duration-150',
  'disabled:cursor-not-allowed disabled:bg-surface-page disabled:opacity-60',
)

/**
 * The border, by state. Exactly one border colour per state, so `cn` (which
 * joins rather than merges) never has two utilities for one property and
 * stylesheet order never decides which wins.
 *
 * Hover darkens the edge to full ink. Focus is the global 2px ring in
 * `brand-text`, outside the border. Invalid is the loss red, and is never
 * the only signal: the message under the field says what is wrong.
 */
const BORDER_DEFAULT = 'border-border-strong hover:border-ink'
const INVALID = 'border-result-loss'

/* -------------------------------------------------------------------------- */
/* Field wrapper                                                              */
/* -------------------------------------------------------------------------- */

export type FieldProps = {
  /** The control's `id`. Required: a label without one labels nothing. */
  id: string
  label: string
  /** Rendered under the control, and announced via aria-describedby. */
  hint?: ReactNode
  error?: string | undefined
  required?: boolean
  children: (ids: { id: string; describedBy: string | undefined }) => ReactNode
}

/**
 * Label, control and message, with the aria wiring done once.
 *
 * A render prop rather than cloning the child: cloning would silently drop
 * props a caller had set, and this way the control keeps full control of
 * itself while still being handed the ids it must use.
 */
export const Field = ({
  id,
  label,
  hint,
  error,
  required = false,
  children,
}: FieldProps) => {
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-label text-ink">
        {label}
        {required ? (
          <>
            {' '}
            <span className="text-result-loss" aria-hidden="true">
              *
            </span>
            {/* The asterisk is decoration; this is what a screen reader
                hears. `required` on the control carries it too, but a visible
                convention needs a spoken equivalent. */}
            <span className="sr-only-focusable">(povinné)</span>
          </>
        ) : null}
      </label>

      {children({ id, describedBy })}

      {hint ? (
        <p id={hintId} className="text-body-sm text-ink-muted">
          {hint}
        </p>
      ) : null}

      {error ? (
        // `role="alert"` so a message that appears after submission is
        // announced without the user having to go looking for it.
        <p id={errorId} role="alert" className="text-body-sm text-result-loss">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Controls                                                                   */
/* -------------------------------------------------------------------------- */

export type InputProps = Omit<ComponentProps<'input'>, 'className'> & {
  invalid?: boolean
  className?: string
}

export const Input = ({ invalid = false, className, ...rest }: InputProps) => (
  <input
    className={cn(CONTROL_BASE, invalid ? INVALID : BORDER_DEFAULT, className)}
    aria-invalid={invalid || undefined}
    {...rest}
  />
)

export type TextareaProps = Omit<ComponentProps<'textarea'>, 'className'> & {
  invalid?: boolean
  className?: string
}

export const Textarea = ({
  invalid = false,
  className,
  rows = 6,
  ...rest
}: TextareaProps) => (
  <textarea
    rows={rows}
    className={cn(
      CONTROL_BASE,
      invalid ? INVALID : BORDER_DEFAULT,
      // A textarea with a fixed height fights the user; vertical only, so it
      // cannot be dragged out of the layout sideways.
      'resize-y',
      className,
    )}
    aria-invalid={invalid || undefined}
    {...rest}
  />
)

export type SelectProps = Omit<ComponentProps<'select'>, 'className'> & {
  invalid?: boolean
  className?: string
}

export const Select = ({
  invalid = false,
  className,
  ...rest
}: SelectProps) => (
  <select
    className={cn(CONTROL_BASE, invalid ? INVALID : BORDER_DEFAULT, className)}
    aria-invalid={invalid || undefined}
    {...rest}
  />
)

export type CheckboxProps = Omit<
  ComponentProps<'input'>,
  'className' | 'type'
> & {
  id: string
  /** The full consent sentence. Never truncated — it is the record. */
  label: ReactNode
  error?: string | undefined
  className?: string
}

/**
 * A checkbox with its label beside it.
 *
 * The box itself stays 20px because a 44px checkbox looks broken — the 44px
 * target is met by the padding on the surrounding label, which is what the
 * pointer actually hits.
 */
export const Checkbox = ({
  id,
  label,
  error,
  className,
  ...rest
}: CheckboxProps) => {
  const errorId = error ? `${id}-error` : undefined

  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={id}
        className="flex min-h-11 items-start gap-3 py-2 text-body-sm text-ink"
      >
        <input
          id={id}
          type="checkbox"
          className={cn(
            'mt-0.5 size-5 shrink-0 rounded-input border border-border-strong',
            'accent-brand',
            className,
          )}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          {...rest}
        />
        <span>{label}</span>
      </label>

      {error ? (
        <p id={errorId} role="alert" className="text-body-sm text-result-loss">
          {error}
        </p>
      ) : null}
    </div>
  )
}
