import type { Metadata } from 'next'
import { RichText } from '@payloadcms/richtext-lexical/react'
import { getTranslations } from 'next-intl/server'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/States'
import type { LegalPageSlug } from '@/collections/content/LegalPages'
import { DEFAULT_LOCALE } from '@/i18n/config'
import { loadLegalPage, loadSiteSettings } from '@/lib/content/loaders'
import { formatDateLong } from '@/lib/format/czech'
import { pageMetadata } from '@/lib/seo/metadata'

/**
 * One legal document, rendered from Payload.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE VERSION AND THE EFFECTIVE DATE ARE PART OF THE DOCUMENT
 *
 * Shown at the top, not buried at the bottom. A `ConsentRecord` stores the
 * version a customer agreed to, and that reference means something only
 * while the reader can see which version they are looking at. "Obchodní
 * podmínky, verze 2026-01, účinné od 5. listopadu 2026" is what makes a
 * consent defensible years later.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * AN UNPUBLISHED DOCUMENT IS AN EMPTY STATE, NOT A 404
 *
 * These four URLs are linked from the footer of every page, and they will be
 * linked from emails and from Stripe's own metadata. A 404 on
 * `/obchodni-podminky` reads as "this business has no terms", which is worse
 * than "the document is being prepared, write to us and we will send it".
 * The page is `noindex` in that state, because an empty legal page has no
 * business in an index.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * `RichText`, NOT `dangerouslySetInnerHTML`
 *
 * Payload's React converter turns the Lexical tree into JSX. The HTML
 * converter would mean injecting a string built from editor content into the
 * DOM, and the only thing standing between that and a stored XSS would be
 * trust in the editor — which is exactly the kind of trust that turns into an
 * incident when an admin account is compromised.
 */

export const legalPageMetadata = async (
  slug: LegalPageSlug,
): Promise<Metadata> => {
  const t = await getTranslations('legal')
  const document = await loadLegalPage(DEFAULT_LOCALE, slug)

  if (!document) {
    return pageMetadata({
      path: `/${slug}`,
      title: t('missing.heading'),
      description: t('missing.body'),
      // Nothing to index yet.
      noindex: true,
    })
  }

  return pageMetadata({
    path: `/${slug}`,
    title: document.title,
    description:
      document.summary ??
      `${document.title} — ${t('version', { version: document.version })}`,
    ogType: 'article',
    publishedTime: document.effectiveFrom,
  })
}

export const LegalPageView = async ({ slug }: { slug: LegalPageSlug }) => {
  const t = await getTranslations('legal')
  const common = await getTranslations('common')

  const document = await loadLegalPage(DEFAULT_LOCALE, slug)

  if (!document) {
    const settings = await loadSiteSettings(DEFAULT_LOCALE)

    return (
      <div className="page-shell page-gutter py-16">
        <EmptyState
          title={t('missing.heading')}
          action={
            <Button href="/kontakt" variant="primary">
              {common('nav.contact')}
            </Button>
          }
        >
          {t('missing.body')} {settings.contactEmail}
        </EmptyState>
      </div>
    )
  }

  return (
    <article className="page-shell page-gutter flex flex-col gap-8 py-10">
      <header className="flex flex-col gap-3">
        <h1 className="text-display-lg text-ink">{document.title}</h1>

        <p className="flex flex-wrap gap-x-4 gap-y-1 text-body-sm text-ink-muted">
          <span className="text-data-sm">
            {t('version', { version: document.version })}
          </span>
          {document.effectiveFrom ? (
            <span>
              {t('effectiveFrom', {
                date: formatDateLong(document.effectiveFrom),
              })}
            </span>
          ) : null}
        </p>
      </header>

      <Card>
        {/* The measure is capped by `.prose-sc` — see globals.css. */}
        <RichText data={document.body} className="prose-sc" />
      </Card>
    </article>
  )
}
