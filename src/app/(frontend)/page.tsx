import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { getPayload } from 'payload'

import { NewsletterForm } from '@/components/forms/NewsletterForm'
import { MascotPlaceholder } from '@/components/layout/MascotPlaceholder'
import { TrackRecordFigures } from '@/components/history/TrackRecordFigures'
import { TierCards } from '@/components/pricing/TierCards'
import { Button } from '@/components/ui/Button'
import { Badge, Card, Section } from '@/components/ui/Card'
import { JsonLd } from '@/components/ui/JsonLd'
import { ResultIndicator } from '@/components/ui/ResultIndicator'
import { EmptyState } from '@/components/ui/States'
import { DEFAULT_LOCALE } from '@/i18n/config'
import type { FeatureKey } from '@/lib/billing/constants'
import { loadPublicTiers } from '@/lib/billing/pricing-loader'
import { loadFaqEntries, loadSiteSettings } from '@/lib/content/loaders'
import { turnstileSiteKey } from '@/lib/forms/site-key'
import { formatDate, formatOdds } from '@/lib/format/czech'
import { operatorForDisplay } from '@/lib/legal/operator-display'
import {
  faqPageJsonLd,
  jsonLdGraph,
  organisationJsonLd,
  webSiteJsonLd,
} from '@/lib/seo/jsonld'
import { pageMetadata } from '@/lib/seo/metadata'
import { loadAllSettledTips, loadLatestPublicTip } from '@/lib/tips/loader'
import { tipResult } from '@/lib/tips/settlement'
import { publicTrackRecord, tipDisclosure } from '@/lib/tips/visibility'
import config from '@/payload.config'

/**
 * The home page.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE TRACK RECORD IS HIGH ON THE PAGE, AND IT INCLUDES THE LOSSES
 *
 * Second block, above "how it works" and above the prices. The loss count is
 * the same size as the ROI. That ordering is the argument the whole site
 * makes: the evidence comes before the offer, and the evidence includes the
 * half that is not flattering.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * YESTERDAY'S FREE TIP LOOKS LIKE A REAL TIP, BECAUSE IT IS ONE
 *
 * Not a sample, not a mock-up, not a "typical" tip: the most recent tip whose
 * 24-hour delay has elapsed, with its selection, its price and — if it has
 * settled — its result, won or lost. The delay is stated in words next to it.
 *
 * The dishonest versions of this section are easy and common: a hand-picked
 * winner, a tip with the result hidden, or a "sample" that was never
 * published to anybody. `loadLatestPublicTip` sorts by publication date and
 * takes the first one whose `publicAt` has passed — there is no room in it
 * for a choice.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT IS DELIBERATELY NOT HERE
 *
 * No gradient backgrounds, no glass panels, no eyebrow label above every
 * heading, no icon beside every list item, and no 96px of air between
 * sections — the rhythm belongs to `Section`, which decides it once.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('home')

  return pageMetadata({
    path: '/',
    title: t('metaTitle'),
    description: t('metaDescription'),
  })
}

export default async function HomePage() {
  const t = await getTranslations('home')
  const common = await getTranslations('common')
  const tipCopy = await getTranslations('tip')
  const pricing = await getTranslations('pricing')
  const newsletter = await getTranslations('newsletter')

  const payload = await getPayload({ config })
  const now = new Date()

  const [tips, latestTip, faq, settings, tiers] = await Promise.all([
    loadAllSettledTips({ payload }),
    loadLatestPublicTip({ payload }, now),
    loadFaqEntries(DEFAULT_LOCALE),
    loadSiteSettings(DEFAULT_LOCALE),
    loadPublicTiers(payload, 'CZK'),
  ])

  const record = publicTrackRecord(tips, now)

  // `operatorForDisplay()` performs `assertOperatorConfigured()`, so a
  // production build with placeholder register data fails here rather than
  // publishing an `Organization` node with an invented IČO.
  const operator = operatorForDisplay()

  const freeTipDisclosure = latestTip ? tipDisclosure(latestTip, [], now) : null

  return (
    <div className="flex flex-col">
      <JsonLd
        data={jsonLdGraph([
          organisationJsonLd({
            operator,
            contactEmail: settings.contactEmail,
            sameAs: settings.socialLinks,
          }),
          webSiteJsonLd(),
          // Built from the same rows the FAQ section renders. Null when there
          // are none, and `jsonLdGraph` drops it.
          faqPageJsonLd(
            faq.map((entry) => ({
              question: entry.question,
              answer: entry.answer,
            })),
          ),
        ])}
      />

      {/* ================================================================ */}
      {/* Hero                                                             */}
      {/* ================================================================ */}
      <section className="page-shell page-gutter grid gap-10 py-12 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="flex flex-col gap-6">
          {/* No eyebrow label. The heading is the first thing. */}
          <h1 className="text-display-xl text-ink">{t('hero.heading')}</h1>
          <p className="max-w-prose text-body text-ink-muted">
            {t('hero.body')}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button href="/historie" variant="primary" size="lg">
              {t('hero.primaryCta')}
            </Button>
            <Button href="/cenik" variant="secondary" size="lg">
              {t('hero.secondaryCta')}
            </Button>
          </div>
        </div>

        {/* A labelled frame, not an invented character. */}
        <MascotPlaceholder label={common('mascotPlaceholder')} />
      </section>

      {/* ================================================================ */}
      {/* The record. Second block on the page.                            */}
      {/* ================================================================ */}
      <div className="page-shell page-gutter py-6">
        <Section
          title={t('record.heading')}
          lead={t('record.body')}
          action={
            <Button href="/historie" variant="ghost">
              {t('record.cta')}
            </Button>
          }
        >
          {record.settled === 0 ? (
            <EmptyState>{t('record.empty')}</EmptyState>
          ) : (
            <Card>
              <TrackRecordFigures
                record={record}
                labels={{
                  roi: common('metrics.roiLong'),
                  profit: common('metrics.profit'),
                  staked: common('metrics.staked'),
                  stakedNote: common('metrics.stakedNote'),
                  settled: common('metrics.settled'),
                  won: common('metrics.won'),
                  lost: common('metrics.lost'),
                  void: common('metrics.void'),
                  averageOdds: common('metrics.averageOdds'),
                  units: common('metrics.unitsShort'),
                }}
              />
            </Card>
          )}
        </Section>
      </div>

      {/* ================================================================ */}
      {/* Yesterday's free tip                                             */}
      {/* ================================================================ */}
      <div className="page-shell page-gutter py-6">
        <Section title={t('freeTip.heading')}>
          {latestTip && freeTipDisclosure ? (
            <Card className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <Badge tone="neutral">
                  {latestTip.sportName || latestTip.sportCode}
                </Badge>
                {latestTip.publishedAt ? (
                  <span className="text-body-sm text-ink-muted">
                    {formatDate(latestTip.publishedAt)}
                  </span>
                ) : null}
                {freeTipDisclosure.showResult ? (
                  <ResultIndicator
                    outcome={tipResult(latestTip.selections)}
                    compact
                  />
                ) : null}
              </div>

              <h3 className="text-heading text-ink">{latestTip.title}</h3>

              {/* The delay, said plainly. */}
              <p className="max-w-prose text-body-sm text-ink-muted">
                {t('freeTip.delayNotice')}
              </p>

              {freeTipDisclosure.showSelections ? (
                <dl className="flex flex-wrap gap-x-10 gap-y-3">
                  {latestTip.selections.map((selection, index) => (
                    <div
                      key={`${selection.eventName}-${index}`}
                      className="flex flex-col gap-1"
                    >
                      <dt className="text-label text-ink-muted">
                        {selection.eventName}
                      </dt>
                      <dd className="text-data text-ink">
                        {selection.market} {selection.selection}
                        {selection.line ? ` ${selection.line}` : ''}
                        {' · '}
                        {formatOdds(selection.oddsAtPublication)}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}

              <div>
                <Button href={`/tipy/${latestTip.slug}`} variant="secondary">
                  {t('freeTip.cta')}
                </Button>
              </div>

              {/* Rule 3 again: a minimum figure, never a bookmaker. */}
              <p className="max-w-prose text-label text-ink-muted">
                {tipCopy('minimumOddsNote')}
              </p>
            </Card>
          ) : (
            <EmptyState>{t('freeTip.none')}</EmptyState>
          )}
        </Section>
      </div>

      {/* ================================================================ */}
      {/* How it works                                                     */}
      {/* ================================================================ */}
      <div className="page-shell page-gutter py-6">
        <Section title={t('howItWorks.heading')}>
          {/* An ordered list, because the steps are ordered. No icons: three
              decorative glyphs would carry no information the numbers do not
              already carry. */}
          <ol className="grid gap-6 md:grid-cols-3">
            {(
              t.raw('howItWorks.steps') as readonly {
                title: string
                body: string
              }[]
            ).map((step, index) => (
              <li key={step.title}>
                <Card className="flex h-full flex-col gap-2">
                  <span className="text-data-xl text-brand-text">
                    {index + 1}
                  </span>
                  <h3 className="text-heading text-ink">{step.title}</h3>
                  <p className="text-body-sm text-ink-muted">{step.body}</p>
                </Card>
              </li>
            ))}
          </ol>
        </Section>
      </div>

      {/* ================================================================ */}
      {/* Tiers                                                            */}
      {/* ================================================================ */}
      <div className="page-shell page-gutter py-6">
        <Section
          title={t('tiers.heading')}
          lead={t('tiers.body')}
          action={
            <Button href="/cenik" variant="ghost">
              {common('nav.pricing')}
            </Button>
          }
        >
          {tiers.length === 0 ? (
            <EmptyState>{pricing('empty')}</EmptyState>
          ) : (
            <TierCards
              tiers={tiers}
              interval="MONTH"
              labels={{
                recommended: pricing('recommended'),
                perMonth: pricing('perMonth'),
                perYear: pricing('perYear'),
                yearlySaving: (amount) => pricing('yearlySaving', { amount }),
                yearlyEquivalent: (amount) =>
                  pricing('yearlyEquivalent', { amount }),
                featuresHeading: pricing('featuresHeading'),
                cta: pricing('cta'),
                vatNote: pricing('vatNote'),
                unavailable: pricing('unavailable'),
                featureLabel: (key: FeatureKey) => pricing(`features.${key}`),
              }}
            />
          )}
        </Section>
      </div>

      {/* ================================================================ */}
      {/* FAQ                                                              */}
      {/* ================================================================ */}
      <div className="page-shell page-gutter py-6">
        <Section title={t('faq.heading')}>
          {faq.length === 0 ? (
            <EmptyState>{common('loading')}</EmptyState>
          ) : (
            // `<details>` rather than a JavaScript accordion: it opens with
            // no script, it is keyboard operable for free, and a crawler sees
            // the answer text whether or not it is open — which is what keeps
            // the FAQPage markup and the page in agreement.
            <div className="flex flex-col gap-3">
              {faq.map((entry) => (
                <details
                  key={entry.id}
                  className="rounded-card border border-border-subtle bg-surface-raised p-4"
                >
                  <summary className="min-h-11 cursor-pointer text-body font-semibold text-ink">
                    {entry.question}
                  </summary>
                  <p className="mt-2 max-w-prose text-body text-ink-muted">
                    {entry.answer}
                  </p>
                </details>
              ))}
            </div>
          )}
        </Section>
      </div>

      {/* ================================================================ */}
      {/* Newsletter. The anchor the footer links to.                      */}
      {/* ================================================================ */}
      <div className="page-shell page-gutter py-6">
        <Section
          id="novinky"
          title={newsletter('heading')}
          lead={newsletter('body')}
        >
          <Card className="max-w-xl">
            <NewsletterForm siteKey={turnstileSiteKey()} />
          </Card>
        </Section>
      </div>
    </div>
  )
}
