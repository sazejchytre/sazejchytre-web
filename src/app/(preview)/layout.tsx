import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'

import { DEFAULT_LOCALE, HTML_LANG } from '@/i18n/config'
import { loadSiteSettings } from '@/lib/content/loaders'
import { fontVariables } from '@/lib/design/fonts'
import { designPreviewEnabled } from '@/lib/design/preview'

import { PreviewFooter } from './_components/PreviewFooter'
import { PreviewHeader } from './_components/PreviewHeader'

import { previewCopy } from './nahled/homepage/copy'

import '../(frontend)/globals.css'

/**
 * The root layout for design previews (`/nahled/*`). SC-005, for D-005.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY A ROUTE GROUP OF ITS OWN, AND NOT A FOLDER UNDER `(frontend)`
 *
 * Because the 404 has to be a real 404, decided before anything can render.
 * Under `(frontend)` two things get in the way:
 *
 *   - `(frontend)/loading.tsx` wraps every page in a Suspense boundary, so
 *     the shell has streamed — with a 200 — before a page's `notFound()`
 *     runs. Next documents that a not-found after streaming starts keeps the
 *     200.
 *   - `(frontend)/layout.tsx` renders the footer, which refuses to render in
 *     production while the operator's register data is a placeholder. The
 *     request would fail with that error before the page's gate mattered.
 *
 * Here the gate is the first statement of the ROOT layout: nothing is
 * rendered or streamed and no data is loaded. Verified against `next build`
 * + `next start`: status 404, Next's built-in not-found document (there is
 * no boundary above a root layout, so neither `not-found.tsx` nor the site
 * chrome is involved), `noindex`, and none of the prototype's text in the
 * HTML or the RSC payload — with or without a query string, cookie or
 * header. The page repeats the check, so neither file is the only thing
 * standing between production and the page.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT IT RENDERS WHEN ENABLED
 *
 * The PROPOSED site chrome for D-005: `PreviewHeader` and `PreviewFooter`
 * in `./_components`. The real `Header` and `Footer` in
 * `src/components/layout` belong to SC-017 and are not changed; the PR lists
 * the proposed changes for them. Neither preview component is a client
 * component, so the group needs no `NextIntlClientProvider`.
 */

export const metadata: Metadata = {
  // Never indexed, never cached by a crawler. The 404 outside development is
  // the real protection; this is for a preview server someone exposes.
  robots: { index: false, follow: false, nocache: true },
}

export const dynamic = 'force-dynamic'

export default async function PreviewLayout({
  children,
}: {
  children: ReactNode
}) {
  // FIRST. See the header: no bypass, no setting, NODE_ENV only.
  if (!designPreviewEnabled()) notFound()

  const common = await getTranslations('common')
  const home = await getTranslations('home')
  const settings = await loadSiteSettings(DEFAULT_LOCALE)

  return (
    <html lang={HTML_LANG[DEFAULT_LOCALE]} className={fontVariables}>
      <body className="flex min-h-screen flex-col bg-surface-page text-ink">
        {/* First focusable element: skips the header (DESIGN.md rule 8). */}
        <a
          href="#obsah"
          className="sr-only-focusable absolute start-4 top-4 z-10 inline-flex min-h-11 items-center rounded-button bg-brand px-4 py-2 text-body font-medium text-ink-on-brand"
        >
          {common('skipToContent')}
        </a>

        <PreviewHeader
          brand={common('brand')}
          ageMarker={common('ageMarker')}
          ageMarkerLong={common('ageMarkerLong')}
          navLabel={common('nav.label')}
          menuLabel={previewCopy.menu}
          items={[
            { href: '/historie', label: common('nav.history') },
            { href: '#jak-to-funguje', label: home('howItWorks.heading') },
            { href: '/metodika', label: common('footer.methodology') },
            { href: '/cenik', label: common('nav.pricing') },
            { href: '/kontakt', label: common('nav.contact') },
          ]}
        />

        <main id="obsah" tabIndex={-1} className="flex-1">
          {children}
        </main>

        <PreviewFooter settings={settings} />
      </body>
    </html>
  )
}
