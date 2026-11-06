/**
 * The site header: wordmark, navigation, sign-in, and the 18+ marker.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE 18+ MARKER LIVES HERE AS WELL AS IN THE FOOTER
 *
 * Copy rule 5 requires it on every page. A footer-only marker satisfies that
 * literally and not in spirit: on the history page the footer is several
 * thousand pixels down, so a reader can spend a long time with the content
 * before meeting it. In the header it is present the moment the page is.
 *
 * It is a quiet badge, not a warning: a bordered `18+` next to the wordmark,
 * with the full sentence available to a screen reader. A dismissible banner
 * is explicitly not wanted — a warning the reader can close is a warning the
 * reader closes.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * NOT STICKY
 *
 * The history page is a long table, and a sticky header would eat 64px of a
 * phone screen for the whole scroll. The `--sc-header-h` token exists for the
 * day a sticky header is wanted; nothing depends on it today.
 */
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

import { Monogram, Wordmark } from '../brand/Marks'
import { Button } from '../ui/Button'
import { NavLinks, type NavItem } from './NavLinks'

export const Header = async () => {
  const t = await getTranslations('common')

  const items: readonly NavItem[] = [
    { href: '/', label: t('nav.home') },
    { href: '/historie', label: t('nav.history') },
    { href: '/cenik', label: t('nav.pricing') },
    { href: '/kontakt', label: t('nav.contact') },
  ]

  return (
    <header className="border-b border-border-subtle bg-surface-page">
      <div className="page-shell page-gutter flex flex-wrap items-center gap-x-8 gap-y-2 py-4">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            // `min-h-11`: measured at 28px in a tab-through — the mark itself
            // is 24px tall and this is the most-tapped link on the site.
            className="inline-flex min-h-11 items-center text-ink"
          >
            {/*
              Outlines, not live text — see `brand/Marks.tsx`.

              The monogram below 480px is a COMFORT decision, not a fit
              necessity, and it is worth being precise about that because the
              first version of this comment claimed otherwise. Measured at
              360px: the brand block is 189px with the wordmark against 109px
              with the monogram, the sign-in button is 98px, and the row has
              312px of space — so the wordmark does fit, with about 25px to
              spare. What the monogram buys is slack rather than rescue.
              There is no horizontal overflow at any width either way.

              (The navigation taking its own row below 768px is deliberate —
              `order-last w-full` — and has nothing to do with the mark.)

              Only one mark is in the accessibility tree at a time, because
              `display: none` removes the other: verified via CDP, the link's
              accessible name is exactly "Sázej chytře" at 360px and at
              768px, and the whole tree holds one image node, not two.
            */}
            <Wordmark label={t('brand')} className="hidden min-[480px]:block" />
            <Monogram label={t('brand')} className="min-[480px]:hidden" />
          </Link>

          {/* The marker. `title`-free on purpose — a tooltip is not an
              accessible equivalent, so the sentence is in the DOM. */}
          <span className="inline-flex items-center rounded-pill border border-border-strong px-2 py-0.5 text-label text-ink-muted">
            <span aria-hidden="true">{t('ageMarker')}</span>
            <span className="sr-only-focusable">{t('ageMarkerLong')}</span>
          </span>
        </div>

        <nav
          aria-label={t('nav.label')}
          className="order-last w-full md:order-none md:w-auto"
        >
          <NavLinks items={items} />
        </nav>

        <div className="ms-auto flex items-center gap-3">
          <Button href="/prihlaseni" variant="secondary" size="md">
            {t('nav.signIn')}
          </Button>
        </div>
      </div>
    </header>
  )
}
