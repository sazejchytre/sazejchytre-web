import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

import { fontVariables } from '@/lib/design/fonts'
import { HTML_LANG } from '@/i18n/config'
import { pageMetadata } from '@/lib/seo/metadata'

import './(frontend)/globals.css'

/**
 * The 404 for a URL that matches no route at all.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE IS NECESSARY, AND NOT JUST `not-found.tsx`
 *
 * This app has TWO root layouts: `(frontend)` and `(payload)`. When a request
 * matches no route, Next has no way to choose which root layout to render the
 * 404 inside — so it renders its own default page instead, the grey
 * "404 | This page could not be found". Verified by requesting a nonsense URL
 * and getting exactly that.
 *
 * `(frontend)/not-found.tsx` is still used, and still needed: it is what
 * `notFound()` renders, with the full header, footer and furniture around it.
 * That is the case for `/tipy/<unknown-slug>` — a route that exists, for a
 * tip that does not.
 *
 * This one is for the other case, and it is the only supported way to handle
 * it with multiple root layouts. It requires `experimental.globalNotFound`
 * in `next.config.ts`.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * IT BRINGS ITS OWN EVERYTHING, DELIBERATELY
 *
 * `global-not-found` bypasses the layout chain, so there is no stylesheet, no
 * font variable and no i18n provider unless this file provides them. Hence
 * the `globals.css` import and `fontVariables` on `<html>`.
 *
 * What it does NOT render is the `Footer`. The footer calls
 * `operatorForDisplay()`, which throws in production while the register data
 * is a placeholder — and a 404 page that 500s is worse than Next's grey
 * default. The same reasoning applies to `global-error.tsx`.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE FURNITURE IS STILL HERE
 *
 * Copy rule 5 says every page: an 18+ marker, the service statement and the
 * help line. A 404 is a page. It is rendered from the message catalogue
 * rather than from site settings, because the catalogue needs no database and
 * the copy test pins the values.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('errors.notFound')

  return pageMetadata({
    path: '/404',
    title: t('metaTitle'),
    description: t('body'),
    noindex: true,
  })
}

export default async function GlobalNotFound() {
  const t = await getTranslations('errors.notFound')
  const common = await getTranslations('common')

  return (
    <html lang={HTML_LANG.cs} className={fontVariables}>
      <body className="flex min-h-screen flex-col bg-surface-page text-ink">
        {/* A minimal header: the wordmark is the way home, and the 18+ marker
            belongs on every page. No navigation component, because this file
            deliberately depends on as little as possible. */}
        <header className="border-b border-border-subtle">
          <div className="page-shell page-gutter flex items-center gap-3 py-4">
            <Link
              href="/"
              className="inline-flex min-h-11 items-center font-display text-heading font-bold text-ink"
            >
              {common('brand')}
            </Link>
            <span className="inline-flex items-center rounded-pill border border-border-strong px-2 py-0.5 text-label text-ink-muted">
              {common('ageMarker')}
            </span>
          </div>
        </header>

        <main className="page-shell page-gutter flex-1 py-16">
          <div className="flex max-w-prose flex-col gap-4">
            <h1 className="text-display-lg text-ink">{t('heading')}</h1>
            <p className="text-body text-ink-muted">{t('body')}</p>

            <div className="flex flex-wrap gap-3">
              <Link
                href="/historie"
                className="inline-flex min-h-11 items-center rounded-button bg-brand px-6 py-3 text-body font-semibold text-ink-on-brand"
              >
                {t('historyCta')}
              </Link>
              <Link
                href="/"
                className="inline-flex min-h-11 items-center rounded-button border border-border-strong px-6 py-3 text-body font-semibold text-ink"
              >
                {t('homeCta')}
              </Link>
            </div>
          </div>
        </main>

        <footer className="border-t border-border-subtle bg-surface-raised">
          <div className="page-shell page-gutter flex flex-col gap-2 py-8 text-body-sm text-ink-muted">
            <p>
              <span className="text-ink">{common('ageMarker')}</span>{' '}
              {common('ageMarkerLong')}
            </p>
            <p className="max-w-prose">{common('serviceStatement')}</p>
            <p>
              {common('helpline.lead')}{' '}
              <a
                href={common('helpline.href')}
                className="font-semibold text-brand-text underline underline-offset-4"
              >
                {common('helpline.name')}, {common('helpline.phone')}
              </a>
            </p>
          </div>
        </footer>
      </body>
    </html>
  )
}
