import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { getPayload } from 'payload'

import { TierCards } from '@/components/pricing/TierCards'
import { Section } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/States'
import type { FeatureKey } from '@/lib/billing/constants'
import { loadPublicTiers } from '@/lib/billing/pricing-loader'
import { pageMetadata } from '@/lib/seo/metadata'
import { cn } from '@/components/ui/cn'
import config from '@/payload.config'

/**
 * The price list.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE MONTHLY/YEARLY TOGGLE IS TWO LINKS, NOT A SWITCH
 *
 * `?obdobi=rocne` and nothing else. A real `<input type="checkbox">` with a
 * click handler would need JavaScript to do anything, and it would make the
 * yearly view unlinkable — which matters, because "here are the yearly
 * prices" is a URL somebody will want to send.
 *
 * It is marked up as a tab list so the current choice is announced:
 * `aria-current="page"` on the active link, which is what a screen reader
 * uses to say which of the two is showing.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE SAVING IS COMPUTED FROM THE PRICES CHARGED
 *
 * See `pricing-view.ts`. It is twelve monthly payments minus one yearly
 * payment, in minor units, and it is omitted entirely when it cannot be
 * computed. A hard-coded "ušetříte dva měsíce" is a claim about money that
 * stops being true the first time a price is edited.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('pricing')

  return pageMetadata({
    path: '/cenik',
    title: t('metaTitle'),
    description: t('metaDescription'),
  })
}

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const t = await getTranslations('pricing')
  const params = await searchParams

  // Anything other than the yearly marker is monthly. An unrecognised value
  // shows the price list rather than a 400.
  const interval = params.obdobi === 'rocne' ? 'YEAR' : 'MONTH'

  const payload = await getPayload({ config })
  const tiers = await loadPublicTiers(payload, 'CZK')

  const tabClass = (active: boolean) =>
    cn(
      'inline-flex min-h-11 items-center rounded-pill px-4 py-2 text-body',
      active
        ? 'bg-brand text-ink-on-brand font-semibold'
        : 'border border-border-strong text-ink hover:bg-surface-raised',
    )

  return (
    <div className="page-shell page-gutter flex flex-col gap-10 py-10">
      <header className="flex flex-col gap-4">
        <h1 className="text-display-lg text-ink">{t('heading')}</h1>
        <p className="max-w-prose text-body text-ink-muted">{t('lead')}</p>
      </header>

      <nav aria-label={t('heading')} className="flex flex-wrap gap-3">
        <Link
          href="/cenik"
          aria-current={interval === 'MONTH' ? 'page' : undefined}
          className={tabClass(interval === 'MONTH')}
        >
          {t('monthly')}
        </Link>
        <Link
          href="/cenik?obdobi=rocne"
          aria-current={interval === 'YEAR' ? 'page' : undefined}
          className={tabClass(interval === 'YEAR')}
        >
          {t('yearly')}
        </Link>
      </nav>

      <Section title={t('featuresHeading')} as="h2">
        {tiers.length === 0 ? (
          <EmptyState>{t('empty')}</EmptyState>
        ) : (
          <TierCards
            tiers={tiers}
            interval={interval}
            labels={{
              recommended: t('recommended'),
              perMonth: t('perMonth'),
              perYear: t('perYear'),
              yearlySaving: (amount) => t('yearlySaving', { amount }),
              yearlyEquivalent: (amount) => t('yearlyEquivalent', { amount }),
              featuresHeading: t('featuresHeading'),
              cta: t('cta'),
              vatNote: t('vatNote'),
              unavailable: t('unavailable'),
              featureLabel: (key: FeatureKey) => t(`features.${key}`),
            }}
          />
        )}
      </Section>
    </div>
  )
}
