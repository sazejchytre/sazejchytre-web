import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getPayload } from 'payload'

import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/States'
import { DEFAULT_LOCALE } from '@/i18n/config'
import { loadFaqEntries } from '@/lib/content/loaders'
import { designPreviewEnabled } from '@/lib/design/preview'
import { formatDate, formatDateIso, formatOdds } from '@/lib/format/czech'
import { buildArchiveRows } from '@/lib/tips/archive'
import { loadAllSettledTips, loadLatestPublicTip } from '@/lib/tips/loader'
import { cumulativeSeries, maxDrawdown } from '@/lib/tips/series'
import { tipResult } from '@/lib/tips/settlement'
import { publicTrackRecord, tipDisclosure } from '@/lib/tips/visibility'
import config from '@/payload.config'

import { ClosingBand } from './_components/ClosingBand'
import { FreeTipArticle, type FreeTipView } from './_components/FreeTipArticle'
import { Hero } from './_components/Hero'
import { HowItWorks } from './_components/HowItWorks'
import { LatestResults } from './_components/LatestResults'
import { RecordBand } from './_components/RecordBand'
import { previewCopy } from './copy'
import { latestResultRows, recordFigures, sampleState } from './view-model'

/**
 * The homepage PROTOTYPE for owner decision D-005 (SC-005), second proposal.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT IT IS FOR
 *
 * To show the proposed visual direction on real data before SC-006
 * redesigns the actual home page. The first proposal (an editorial "results
 * desk") was rejected; this one is a classic, conventional sports analysis
 * website: a strong brand band, one idea per section, obvious actions. The
 * current home page (`src/app/(frontend)/page.tsx`) is not touched.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * HONEST DATA ONLY
 *
 * Every number comes from the loaders and projections the live pages use:
 * `loadAllSettledTips` → `publicTrackRecord` and `buildArchiveRows`, as on
 * `/historie`; `loadLatestPublicTip` → `tipDisclosure`, as on `/`. With an
 * empty database every block says so in words. No sample row, no mock
 * figure, no testimonial.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * LAUNCH SCOPE
 *
 * The first public phase has no customer accounts and no payments (D-008,
 * D-012). So there is no sign-in, no "get access" action and no price
 * picker: the subscription section says plainly that payments are not
 * switched on, in the catalogue's own words.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * COMPOSITION, TOP TO BOTTOM
 *
 *   1. Hero band: what the service is, one primary action (the history).
 *   2. How it works: three steps.
 *   3. The public record: four figures and the newest rows, or one honest
 *      sentence.
 *   4. Yesterday's free analysis.
 *   5. Subscription: not yet, said plainly.
 *   6. FAQ, when there is one.
 *   7. Closing band: the record's promise, and the history.
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

  const [tips, latestTip, faq] = await Promise.all([
    loadAllSettledTips({ payload }),
    loadLatestPublicTip({ payload }, now),
    loadFaqEntries(DEFAULT_LOCALE),
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
  const byKey = new Map(figures.map((figure) => [figure.key, figure]))
  const pick = (keys: readonly (typeof figures)[number]['key'][]) =>
    keys.flatMap((key) => {
      const figure = byKey.get(key)
      return figure ? [figure] : []
    })

  const rows = latestResultRows(buildArchiveRows(tips), unitsShort, 5)

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
      <p className="bg-surface-accent">
        <span className="page-shell page-gutter block py-2 text-body-sm text-ink-muted">
          {previewCopy.notice}
        </span>
      </p>

      <Hero
        heading={home('hero.heading')}
        body={home('hero.body')}
        serviceStatement={common('serviceStatement')}
        brand={common('brand')}
        primary={{ href: '/historie', label: home('hero.primaryCta') }}
        secondary={{
          href: '#jak-to-funguje',
          label: home('howItWorks.heading'),
        }}
      />

      <div id="jak-to-funguje">
        <HowItWorks
          headingId="jak-to-funguje-nadpis"
          heading={home('howItWorks.heading')}
          steps={steps}
        />
      </div>

      <RecordBand
        headingId="verejna-historie"
        heading={home('record.heading')}
        lead={home('record.body')}
        asOf={history('asOf', { date: formatDate(record.asOf) })}
        asOfIso={formatDateIso(record.asOf)}
        sample={sampleState(record.settled)}
        sampleSize={history('sampleSize', { count: record.settled })}
        headline={pick(['settled', 'roi', 'profit', 'drawdown'])}
        counts={pick(['won', 'lost', 'void'])}
        emptyNote={home('record.empty')}
        smallSampleNote={previewCopy.record.smallSample}
        links={[
          { href: '/historie', label: home('record.cta') },
          { href: '/metodika', label: history('methodology.cta') },
        ]}
      >
        {rows.length > 0 ? (
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
        ) : null}
      </RecordBand>

      <section aria-labelledby="tip-zdarma">
        <div className="page-shell page-gutter flex flex-col gap-8 py-16 md:py-20">
          <h2 id="tip-zdarma" className="text-display-lg text-ink">
            {home('freeTip.heading')}
          </h2>
          {freeTip ? (
            <div className="max-w-reading">
              <FreeTipArticle
                tip={freeTip}
                labels={{
                  delayNotice: home('freeTip.delayNotice'),
                  cta: home('freeTip.cta'),
                  minimumOddsNote: tipCopy('minimumOddsNote'),
                  oddsColumn: tipCopy('oddsColumn'),
                }}
              />
            </div>
          ) : (
            <EmptyState className="max-w-reading">
              {home('freeTip.none')}
            </EmptyState>
          )}
        </div>
      </section>

      <section aria-labelledby="predplatne" className="bg-surface-accent">
        <div className="page-shell page-gutter flex flex-col gap-6 py-16 md:py-20">
          <div className="flex max-w-reading flex-col gap-3">
            <h2 id="predplatne" className="text-display-lg text-ink">
              {home('tiers.heading')}
            </h2>
            <p className="text-heading text-ink">
              {pricing('checkoutStub.heading')}
            </p>
            <p className="text-lead text-ink-muted">
              {pricing('checkoutStub.body')}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button href="/cenik" variant="secondary" prefetch={false}>
              {common('nav.pricing')}
            </Button>
            <Button href="/kontakt" variant="ghost" prefetch={false}>
              {pricing('checkoutStub.cta')}
            </Button>
          </div>
        </div>
      </section>

      {faq.length > 0 ? (
        <section aria-labelledby="caste-dotazy">
          <div className="page-shell page-gutter flex flex-col gap-8 py-16 md:py-20">
            <h2 id="caste-dotazy" className="text-display-lg text-ink">
              {home('faq.heading')}
            </h2>
            {/* `<details>`: opens without script, keyboard operable for free. */}
            <div className="max-w-reading divide-y divide-border-subtle border-y border-border-subtle">
              {faq.map((entry) => (
                <details key={entry.id} className="py-2">
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

      <ClosingBand
        headingId="zaver"
        heading={previewCopy.record.heading}
        body={home('record.body')}
        action={{ href: '/historie', label: home('hero.primaryCta') }}
      />
    </div>
  )
}
