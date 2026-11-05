import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { pageMetadata } from '@/lib/seo/metadata'

/**
 * The checkout route — a STUB, owned by the step that adds payments.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY A PAGE AND NOT A DISABLED BUTTON
 *
 * The price list's buy buttons have to go somewhere. The alternatives were:
 *
 *   - a disabled button, which reads as a broken page and gives a visitor who
 *     wants to buy nothing to do;
 *   - a link to a route that does not exist, which 404s — and a 404 reached
 *     by clicking "ZÍSKAT PŘÍSTUP" looks like the business has folded;
 *   - this: a real page that says payment is not switched on yet and points
 *     at the contact form.
 *
 * It is `noindex`, because a stub has no business in a search index, and it
 * carries no price — the price list is the one place prices appear.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE QUERY PARAMETERS ARE DELIBERATELY NOT READ
 *
 * The buy buttons pass `?plan=PRO&obdobi=mesicne`. This page ignores them,
 * because echoing "you chose Pro" would be the beginning of a checkout flow
 * that does not exist, and the step that builds the real one should not
 * inherit a half-made contract about what those parameters mean.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('pricing.checkoutStub')

  return pageMetadata({
    path: '/predplatne',
    title: t('metaTitle'),
    description: t('body'),
    noindex: true,
  })
}

export default async function CheckoutStubPage() {
  const t = await getTranslations('pricing.checkoutStub')

  return (
    <div className="page-shell page-gutter py-16">
      <Card className="flex max-w-xl flex-col gap-4">
        <h1 className="text-display-lg text-ink">{t('heading')}</h1>
        <p className="text-body text-ink-muted">{t('body')}</p>
        <div className="flex flex-wrap gap-3">
          <Button href="/kontakt" variant="primary">
            {t('cta')}
          </Button>
          <Button href="/cenik" variant="secondary">
            {/* Back where they came from. */}
            {t('metaTitle')}
          </Button>
        </div>
      </Card>
    </div>
  )
}
