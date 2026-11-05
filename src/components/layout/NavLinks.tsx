'use client'

/**
 * The navigation links, with the current page marked.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE ONLY REASON THIS IS A CLIENT COMPONENT
 *
 * `aria-current="page"`. A layout cannot know which route rendered inside it,
 * so the current path has to come from `usePathname`. That is the whole
 * client-side cost of the header: a list of links and a string comparison.
 *
 * It matters more than it looks. `aria-current` is what tells a screen-reader
 * user where they are in a list of four identical-sounding links, and the
 * visual treatment hangs off the same attribute rather than off a second
 * source of truth.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * NO HAMBURGER MENU
 *
 * Four links. A toggle button, an open/closed state, a focus trap and an
 * escape handler to hide four links behind a tap is a worse experience and
 * more code than letting them wrap onto a second row. The nav is a `flex-wrap`
 * list; on a narrow screen it becomes two rows and stays entirely usable with
 * no JavaScript beyond the `aria-current` above.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { cn } from '../ui/cn'

export type NavItem = { href: string; label: string }

/**
 * Is this link the page we are on?
 *
 * Exact match, except that `/tipy/...` counts as `/historie` — a tip page is
 * reached from the history and belongs to it as far as orientation goes.
 * Prefix-matching everything would light up `/` for every page on the site.
 */
const isCurrent = (pathname: string, href: string): boolean => {
  if (href === '/') {
    return pathname === '/'
  }

  if (href === '/historie') {
    return pathname === '/historie' || pathname.startsWith('/tipy/')
  }

  return pathname === href || pathname.startsWith(`${href}/`)
}

export const NavLinks = ({ items }: { items: readonly NavItem[] }) => {
  const pathname = usePathname()

  return (
    <ul className="flex flex-wrap items-center gap-x-6 gap-y-1">
      {items.map((item) => {
        const current = isCurrent(pathname, item.href)

        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={current ? 'page' : undefined}
              className={cn(
                // 44px tall so the tap target is met without the link
                // looking like a button.
                'inline-flex min-h-11 items-center text-body',
                current
                  ? // Underlined as well as coloured: colour alone is not a
                    // signal a colour-blind reader can use.
                    'font-semibold text-brand-text underline decoration-2 underline-offset-8'
                  : 'text-ink hover:text-brand-text hover:underline hover:underline-offset-8',
              )}
            >
              {item.label}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
