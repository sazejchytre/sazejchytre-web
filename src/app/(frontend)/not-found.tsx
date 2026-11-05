import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'

import { MascotPlaceholder } from '@/components/layout/MascotPlaceholder'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { pageMetadata } from '@/lib/seo/metadata'

/**
 * The 404, in the site's design.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * IT OFFERS THE TWO PAGES A LOST READER ACTUALLY WANTS
 *
 * The home page, and the history. Not a search box — there is no site search
 * — and not a list of "popular pages", which on a site with eight of them is
 * a navigation menu with extra steps. A 404 whose only exit is the logo is a
 * dead end with branding on it.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * `noindex`
 *
 * A 404 page that is indexable is a page that can rank. The status code
 * normally prevents that, but a crawler that reaches this UI through a
 * streamed response sees a 200, so the meta tag is the belt to that braces.
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

export default async function NotFound() {
  const t = await getTranslations('errors.notFound')
  const common = await getTranslations('common')

  return (
    <div className="page-shell page-gutter py-16">
      <Card className="flex flex-col gap-6 md:flex-row md:items-start md:gap-10">
        <MascotPlaceholder label={common('mascotPlaceholder')} size="inline" />

        <div className="flex flex-col gap-4">
          <h1 className="text-display-lg text-ink">{t('heading')}</h1>
          <p className="max-w-prose text-body text-ink-muted">{t('body')}</p>

          <div className="flex flex-wrap gap-3">
            <Button href="/historie" variant="primary">
              {t('historyCta')}
            </Button>
            <Button href="/" variant="secondary">
              {t('homeCta')}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
