/**
 * The button, in four variants.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE CONTRAST RULE IS BUILT IN
 *
 * The `primary` variant is `bg-brand text-ink-on-brand`. The brand green is
 * dark (#236344), so its ink is white: 7.14:1. Dark ink on it would be
 * 2.46:1. The foreground is not a prop, so neither mistake is reachable from
 * a call site.
 *
 * `accent` used to be a yellow fill. The SC-005 palette has no yellow, so it
 * is now the INVERTED button — ink fill, surface text — for the one action in
 * a dark band or a dense panel that must out-rank a primary. Its API is
 * unchanged; nothing in the codebase calls it today.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * STATES (DESIGN.md rule 99)
 *
 *   default · hover · focus-visible (global ring) · active · disabled ·
 *   loading (`aria-busy="true"`, set by a form while it submits) — and error,
 *   which belongs to the form message rather than to the button.
 *
 * Motion is a 150ms colour transition only (rule 98), and the global
 * reduced-motion rule collapses it.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY IT RENDERS AN ANCHOR WHEN GIVEN AN href
 *
 * Because a link that looks like a button is still a link: reachable with
 * Tab, opens in a new tab with the middle button, announced as a link, and
 * works before any JavaScript has run. `href` switches the element rather
 * than being handled by the caller, so a caller cannot get it wrong.
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
 * smaller padding by a caller. 6px radius, no pills (rule 44). Sentence-case
 * labels come from the catalogue; nothing here transforms case.
 */
const BASE = cn(
  'inline-flex items-center justify-center gap-2',
  'rounded-button border font-medium text-center',
  'whitespace-nowrap select-none',
  'transition-colors duration-150',
  // The ring is declared globally; this makes sure nothing here removes it.
  'focus-visible:outline-2 focus-visible:outline-offset-2',
  'disabled:cursor-not-allowed disabled:opacity-50',
  'aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
  'aria-busy:cursor-progress aria-busy:opacity-70',
)

const VARIANTS: Readonly<Record<ButtonVariant, string>> = {
  /** The filled green. White ink — see the header. */
  primary: cn(
    'border-transparent bg-brand text-ink-on-brand',
    'hover:bg-brand-strong active:bg-brand-strong',
  ),
  /**
   * Outlined. `border-strong` reaches 3:1 as a non-text boundary on every
   * surface; on hover the edge goes to full ink rather than the fill
   * changing, which reads the same on a white panel and on the page.
   */
  secondary: cn(
    'border-border-strong bg-surface-raised text-ink',
    'hover:border-ink active:bg-surface-page',
  ),
  /** No chrome. For tertiary actions in dense UI: a link with a target. */
  ghost: cn(
    'border-transparent text-brand-text',
    'underline-offset-4 hover:underline active:underline',
  ),
  /** Inverted: ink fill, surface ink. Both flip with the theme. */
  accent: cn(
    'border-transparent bg-ink text-surface-raised',
    'hover:bg-ink/85 active:bg-ink/85',
  ),
}

/**
 * Size, including the touch-target floor (44px md, 48px lg).
 *
 * `cn` joins rather than merges, so two utilities for one property would be
 * settled by stylesheet order, not by intent. Every property is therefore
 * set exactly once: the ghost variant gets its own, tighter padding table
 * instead of overriding this one.
 */
const SIZES: Readonly<Record<ButtonSize, string>> = {
  md: 'min-h-11 px-4 py-2 text-label',
  lg: 'min-h-12 px-5 py-3 text-body',
}

const GHOST_SIZES: Readonly<Record<ButtonSize, string>> = {
  md: 'min-h-11 px-2 py-2 text-label',
  lg: 'min-h-12 px-3 py-3 text-body',
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
  // A ghost link sits closer to the text it follows, so it has its own
  // padding table rather than an override (see SIZES).
  const sizing = variant === 'ghost' ? GHOST_SIZES[size] : SIZES[size]
  const classes = cn(BASE, sizing, VARIANTS[variant], className)

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
