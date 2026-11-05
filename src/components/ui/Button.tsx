/**
 * The button, in four variants.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE CONTRAST RULE IS BUILT IN
 *
 * The `primary` variant is `bg-brand text-ink-on-brand`. It is not possible
 * to get a white-on-green button out of this component, because the
 * foreground is not a prop. White on `#5bc894` measures 2.07:1 — far below
 * the 4.5:1 floor — and it is the first thing anyone reaches for on a
 * saturated fill. Making it unreachable is the only reliable fix.
 *
 * Same for `accent`: `text-ink-on-accent`, never white (1.38:1).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY IT RENDERS AN ANCHOR WHEN GIVEN AN href
 *
 * Because a link that looks like a button is still a link, and the difference
 * is not cosmetic: a real `<a>` is reachable with Tab, opens in a new tab
 * with the middle button, is announced as a link, and works before any
 * JavaScript has run. A `<button onClick={router.push}>` has none of that.
 *
 * So `href` switches the element rather than being handled by the caller,
 * which means a caller cannot get it wrong by accident.
 */
import Link from 'next/link'
import type { ComponentProps, ReactNode } from 'react'

import { cn } from './cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'accent'
export type ButtonSize = 'md' | 'lg'

/**
 * Shared geometry.
 *
 * `min-h-11` is 44px, the minimum touch target. Declared here as well as in
 * the base layer because this is the component most likely to be given a
 * smaller padding by a caller.
 */
const BASE = cn(
  'inline-flex items-center justify-center gap-2',
  'rounded-button font-semibold text-center',
  'min-h-11 whitespace-nowrap',
  'transition-colors duration-150',
  // The ring is declared globally; this makes sure nothing here removes it.
  'focus-visible:outline-2 focus-visible:outline-offset-2',
  'disabled:cursor-not-allowed disabled:opacity-60',
)

const VARIANTS: Readonly<Record<ButtonVariant, string>> = {
  /** The filled green. Dark ink, never white — see the header. */
  primary: cn(
    'bg-brand text-ink-on-brand',
    'hover:bg-brand/90',
    'active:bg-brand/80',
  ),
  /** Outlined. `border-strong` reaches 3:1 as a non-text boundary. */
  secondary: cn(
    'border border-strong bg-surface-page text-ink',
    'hover:bg-surface-raised',
  ),
  /** No chrome until hovered. For tertiary actions inside dense UI. */
  ghost: cn('text-brand-text', 'hover:bg-surface-raised'),
  /** The yellow. Used sparingly, and with dark ink (1.38:1 on white). */
  accent: cn(
    'bg-accent text-ink-on-accent',
    'hover:brightness-95',
    'active:brightness-90',
  ),
}

const SIZES: Readonly<Record<ButtonSize, string>> = {
  md: 'px-4 py-2 text-label',
  lg: 'px-6 py-3 text-body',
}

type CommonProps = {
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
  children: ReactNode
}

type AsButton = CommonProps &
  Omit<ComponentProps<'button'>, 'className' | 'children'> & {
    href?: undefined
  }

type AsLink = CommonProps &
  Omit<ComponentProps<typeof Link>, 'className' | 'children' | 'href'> & {
    href: string
  }

export type ButtonProps = AsButton | AsLink

export const Button = ({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...rest
}: ButtonProps) => {
  const classes = cn(BASE, VARIANTS[variant], SIZES[size], className)

  if ('href' in rest && rest.href !== undefined) {
    const { href, ...anchorProps } = rest

    return (
      <Link href={href} className={classes} {...anchorProps}>
        {children}
      </Link>
    )
  }

  const buttonProps = rest as Omit<ComponentProps<'button'>, 'className'>

  return (
    // `type` defaults to "submit" inside a form, which fires the form when a
    // caller only wanted a plain button. Defaulted here so every caller does
    // not have to remember.
    <button
      type={buttonProps.type ?? 'button'}
      className={classes}
      {...buttonProps}
    >
      {children}
    </button>
  )
}
