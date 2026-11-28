import Link from 'next/link'

import { Monogram, Wordmark } from '@/components/brand/Marks'

/**
 * The site header, as PROPOSED for D-005. Preview-only.
 *
 * `src/components/layout/Header.tsx` belongs to SC-017 and is not changed by
 * this branch; this component shows what it would become, and the PR lists
 * the change for whoever owns that file.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * CONVENTIONAL ON PURPOSE
 *
 * Logo left, at most five links right, nothing to learn. Sticky, 56px on a
 * phone and 64px from 768px (DESIGN.md rule 95); `scroll-padding-top` in
 * globals.css keeps a focused element from hiding under it (WCAG 2.4.11).
 *
 * No "Přihlásit se" and no "Získat přístup": customer accounts and payments
 * are not part of the first public phase (D-008, D-012).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE MOBILE MENU NEEDS NO JAVASCRIPT
 *
 * A `<details>` disclosure: it opens with a tap, Enter or Space, it is
 * announced as expandable, and it works before hydration. The summary says
 * "Menu" in words beside the icon, so it is not an icon-only control.
 */

export type NavItem = { href: string; label: string }

const LINK =
  'inline-flex min-h-11 items-center text-body font-medium text-ink hover:text-brand-text'

export const PreviewHeader = ({
  brand,
  ageMarker,
  ageMarkerLong,
  navLabel,
  menuLabel,
  items,
}: {
  brand: string
  ageMarker: string
  ageMarkerLong: string
  navLabel: string
  menuLabel: string
  items: readonly NavItem[]
}) => (
  <header className="sticky top-0 z-20 border-b border-border-subtle bg-surface-page">
    <div className="page-shell page-gutter flex h-14 items-center justify-between gap-6 md:h-16">
      <div className="flex items-center gap-3">
        <Link
          href="/"
          prefetch={false}
          className="inline-flex min-h-11 items-center text-ink"
        >
          <Wordmark label={brand} className="hidden h-6 w-auto sm:block" />
          <Monogram label={brand} className="h-6 w-auto sm:hidden" />
        </Link>
        <span className="inline-flex items-center rounded-badge border border-border-strong px-1.5 text-label text-ink-muted">
          <span aria-hidden="true">{ageMarker}</span>
          <span className="sr-only">{ageMarkerLong}</span>
        </span>
      </div>

      {/* Desktop: the links in a row. */}
      <nav aria-label={navLabel} className="hidden md:block">
        <ul className="flex items-center gap-8">
          {items.map((item) => (
            <li key={item.href}>
              <Link href={item.href} prefetch={false} className={LINK}>
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {/* Phone: the same links behind a disclosure. */}
      <details className="group md:hidden">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-button px-2 text-body font-medium text-ink [&::-webkit-details-marker]:hidden">
          <svg
            aria-hidden="true"
            focusable="false"
            viewBox="0 0 20 20"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          >
            <path
              className="group-open:hidden"
              d="M3 5.5h14M3 10h14M3 14.5h14"
            />
            <path
              className="hidden group-open:block"
              d="m5 5 10 10M15 5 5 15"
            />
          </svg>
          {menuLabel}
        </summary>
        <nav
          aria-label={navLabel}
          className="absolute inset-x-0 top-full border-b border-border-subtle bg-surface-page"
        >
          <ul className="page-gutter flex flex-col py-2">
            {items.map((item) => (
              <li
                key={item.href}
                className="border-b border-border-subtle last:border-b-0"
              >
                <Link
                  href={item.href}
                  prefetch={false}
                  className={`${LINK} w-full py-2`}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </details>
    </div>
  </header>
)
