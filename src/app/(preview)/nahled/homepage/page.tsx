import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getPayload } from 'payload'

import { TierCards } from '@/components/pricing/TierCards'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/States'
import { DEFAULT_LOCALE } from '@/i18n/config'
import type { FeatureKey } from '@/lib/billing/constants'
import { loadPublicTiers } from '@/lib/billing/pricing-loader'
import { loadFaqEntries } from '@/lib/content/loaders'
import { designPreviewEnabled } from '@/lib/design/preview'
import { formatDate, formatDateIso, formatOdds } from '@/lib/format/czech'
import { buildArchiveRows } from '@/lib/tips/archive'
import { loadAllSettledTips, loadLatestPublicTip } from '@/lib/tips/loader'
import { cumulativeSeries, maxDrawdown } from '@/lib/tips/series'
import { tipResult } from '@/lib/tips/settlement'
import { publicTrackRecord, tipDisclosure } from '@/lib/tips/visibility'
import config from '@/payload.config'

import { FreeTipArticle, type FreeTipView } from './_components/FreeTipArticle'
import { HowItWorks } from './_components/HowItWorks'
import { LatestResults } from './_components/LatestResults'
import { RecordSummary } from './_components/RecordSummary'
import { previewCopy } from './copy'
import { latestResultRows, recordFigures, sampleState } from './view-model'

/**
 * The homepage PROTOTYPE for owner decision D-005 (SC-005).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT IT IS FOR
 *
 * To show the proposed visual direction — tokens, Geist, the restyled
 * primitives, a "results desk" composition — on real data, so the owner can
 * approve or reject it before SC-006 redesigns the actual home page. The
 * current home page (`src/app/(frontend)/page.tsx`) is not touched.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * HONEST DATA ONLY
 *
 * Every number comes from the loaders and projections the live pages use:
 * `loadAllSettledTips` → `publicTrackRecord` and `buildArchiveRows`, as on
 * `/historie`; `loadLatestPublicTip` → `tipDisclosure`, as on `/`. With an
 * empty database every block says so in words. No sample row, no mock
 * figure, no testimonial — there is nothing in this file that could produce
 * one.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * COMPOSITION, TOP TO BOTTOM
 *
 *   1. One sentence of what the service is, and the scoreboard beside it —
 *      evidence before offer, at under half a desktop viewport (rule 38).
 *   2. The newest results as a table, losses in the same rows as wins:
 *      "Výsledky neschováváme. Ani ty špatné."
 *   3. Yesterday's free tip, and how the work is done.
 *   4. Prices as information, then the FAQ if there is one.
 *
 * Green is spent on the primary action, links, step numbers and positive
 * figures. Nothing else is coloured.
 */

export const metadata: Metadata = {
  title: previewCopy.meta.title,
  robots: { index: false, follow: false, nocache: true },
}

export default async function HomepagePreview() {
  // Repeated from the layout on purpose: neither file alone is the gate.
  if (!designPreviewEnabled()) notFound()

  const [home, common, history, tipCopy, pricing] = await Promise.all([
    getTranslations('home'),
    getTranslations('common'),
    getTranslations('history'),
    getTranslations('tip'),
    getTranslations('pricing'),
  ])

  const payload = await getPayload({ config })
  const now = new Date()

  const [tips, latestTip, faq, tiers] = await Promise.all([
    loadAllSettledTips({ payload }),
    loadLatestPublicTip({ payload }, now),
    loadFaqEntries(DEFAULT_LOCALE),
    loadPublicTiers(payload, 'CZK'),
  ])

  // Unfiltered, by construction — the same calls `/historie` makes.
  const record = publicTrackRecord(tips, now)
  const drawdown = maxDrawdown(cumulativeSeries(tips))
  const unitsShort = common('metrics.unitsShort')

  const figures = recordFigures(record, drawdown, {
    settled: common('metrics.settled'),
    won: common('metrics.won'),
    lost: common('metrics.lost'),
    void: common('metrics.void'),
    profit: common('metrics.profit'),
    roi: common('metrics.roiLong'),
    averageOdds: common('metrics.averageOdds'),
    drawdown: history('chart.drawdownLabel'),
    unitsShort,
    noValue: previewCopy.record.noValue,
  })

  const rows = latestResultRows(buildArchiveRows(tips), unitsShort)

  const disclosure = latestTip ? tipDisclosure(latestTip, [], now) : null
  const freeTip: FreeTipView | null =
    latestTip && disclosure
      ? {
          href: `/tipy/${latestTip.slug}`,
          title: latestTip.title,
          sport: latestTip.sportName || latestTip.sportCode,
          date: latestTip.publishedAt
            ? formatDate(latestTip.publishedAt)
            : null,
          dateIso: latestTip.publishedAt
            ? formatDateIso(latestTip.publishedAt)
            : null,
          outcome: disclosure.showResult
            ? tipResult(latestTip.selections)
            : null,
          selections: disclosure.showSelections
            ? latestTip.selections.map((selection, index) => ({
                key: `${selection.eventName}-${index}`,
                event: selection.eventName,
                pick: [selection.market, selection.selection, selection.line]
                  .filter(Boolean)
                  .join(' '),
                odds: formatOdds(selection.oddsAtPublication),
              }))
            : [],
        }
      : null

  const steps = home.raw('howItWorks.steps') as readonly {
    title: string
    body: string
  }[]

  return (
    <div className="flex flex-col">
      {/* For the reviewer: what this page is and is not. */}
      <p className="border-b border-border-subtle bg-surface-raised">
        <span className="page-shell page-gutter block py-2 text-body-sm text-ink-muted">
          {previewCopy.notice}
        </span>
      </p>

      {/* ================================================================ */}
      {/* 1. Hero: what this is, and the record beside it                  */}
      {/* ================================================================ */}
      <div className="page-shell page-gutter py-10 md:py-12">
        <div className="layout-grid items-start gap-y-10">
          <div className="col-span-4 flex flex-col gap-6 md:col-span-6 md:pe-8">
            {/* No eyebrow label above it (rule 40). */}
            <h1 className="text-display-xl text-ink">{home('hero.heading')}</h1>
            <p className="max-w-reading text-heading font-normal text-ink-muted">
              {home('hero.body')}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button href="/historie" size="lg">
                {previewCopy.cta.showHistory}
              </Button>
              <Button href="/metodika" variant="secondary" size="lg">
                {history('methodology.heading')}
              </Button>
            </div>
            {/* What the service is, and what it is not, in one line. */}
            <p className="max-w-reading text-body-sm text-ink-muted">
              {common('serviceStatement')}
            </p>
          </div>

          <div className="col-span-4 md:col-span-6">
            <RecordSummary
              headingId="stav-historie"
              heading={previewCopy.record.summaryHeading}
              asOf={history('asOf', { date: formatDate(record.asOf) })}
              asOfIso={formatDateIso(record.asOf)}
              figures={figures}
              sample={sampleState(record.settled)}
              sampleSize={history('sampleSize', { count: record.settled })}
              emptyNote={home('record.empty')}
              smallSampleNote={previewCopy.record.smallSample}
              noValueLabel={previewCopy.record.noValueLabel}
              links={[
                { href: '/historie', label: previewCopy.cta.fullHistory },
                { href: '/metodika', label: previewCopy.cta.fullMethodology },
              ]}
            />
          </div>
        </div>
      </div>

      {/* ================================================================ */}
      {/* 2. The newest results, losses included                           */}
      {/* ================================================================ */}
      <section
        aria-labelledby="vysledky"
        className="border-t border-border-subtle bg-surface-page"
      >
        <div className="page-shell page-gutter flex flex-col gap-6 py-12 md:py-16">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <div className="flex max-w-reading flex-col gap-2">
              <h2 id="vysledky" className="text-display-lg text-ink">
                {previewCopy.record.heading}
              </h2>
              <p className="text-body text-ink-muted">{home('record.body')}</p>
            </div>
            <Button href="/historie" variant="ghost">
              {previewCopy.cta.fullHistory}
            </Button>
          </div>

          <LatestResults
            rows={rows}
            labels={{
              caption: previewCopy.table.caption,
              timeZone: previewCopy.table.timeZone,
              date: history('table.columns.date'),
              event: history('table.columns.event'),
              selection: history('table.columns.selection'),
              odds: tipCopy('oddsColumn'),
              result: history('table.columns.result'),
              profit: history('table.columns.profit'),
              empty: home('record.empty'),
            }}
          />
        </div>
      </section>

      {/* ================================================================ */}
      {/* 3. Yesterday's free tip, and how the work is done                */}
      {/* ================================================================ */}
      <div className="border-t border-border-subtle">
        <div className="page-shell page-gutter py-12 md:py-16">
          <div className="layout-grid gap-y-12">
            <section
              aria-labelledby="tip-zdarma"
              className="col-span-4 flex flex-col gap-6 md:col-span-7"
            >
              <h2 id="tip-zdarma" className="text-display-lg text-ink">
                {home('freeTip.heading')}
              </h2>
              {freeTip ? (
                <FreeTipArticle
                  tip={freeTip}
                  labels={{
                    delayNotice: home('freeTip.delayNotice'),
                    cta: previewCopy.cta.fullAnalysis,
                    minimumOddsNote: tipCopy('minimumOddsNote'),
                    oddsColumn: tipCopy('oddsColumn'),
                  }}
                />
              ) : (
                <EmptyState>{home('freeTip.none')}</EmptyState>
              )}
            </section>

            <div className="col-span-4 md:col-span-5">
              <HowItWorks
                headingId="jak-to-funguje"
                heading={home('howItWorks.heading')}
                steps={steps}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ================================================================ */}
      {/* 4. Prices as information, then the FAQ                           */}
      {/* ================================================================ */}
      <section
        aria-labelledby="predplatne"
        className="border-t border-border-subtle"
      >
        <div className="page-shell page-gutter flex flex-col gap-6 py-12 md:py-16">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <div className="flex max-w-reading flex-col gap-2">
              <h2 id="predplatne" className="text-display-lg text-ink">
                {home('tiers.heading')}
              </h2>
              <p className="text-body text-ink-muted">{home('tiers.body')}</p>
            </div>
            <Button href="/cenik" variant="ghost">
              {common('nav.pricing')}
            </Button>
          </div>

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
                cta: previewCopy.cta.getAccess,
                vatNote: pricing('vatNote'),
                unavailable: pricing('unavailable'),
                featureLabel: (key: FeatureKey) => pricing(`features.${key}`),
              }}
            />
          )}
        </div>
      </section>

      {faq.length > 0 ? (
        <section
          aria-labelledby="caste-dotazy"
          className="border-t border-border-subtle"
        >
          <div className="page-shell page-gutter flex flex-col gap-6 py-12 md:py-16">
            <h2 id="caste-dotazy" className="text-display-lg text-ink">
              {home('faq.heading')}
            </h2>
            {/* `<details>`: opens without script, keyboard operable for free. */}
            <div className="max-w-reading divide-y divide-border-subtle border-y border-border-subtle">
              {faq.map((entry) => (
                <details key={entry.id} className="group py-2">
                  <summary className="flex min-h-11 cursor-pointer items-center text-body font-medium text-ink">
                    {entry.question}
                  </summary>
                  <p className="pb-4 text-body text-ink-muted">
                    {entry.answer}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  )
}
