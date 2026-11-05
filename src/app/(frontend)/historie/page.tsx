import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { getPayload } from 'payload'

import { CumulativeChart } from '@/components/history/CumulativeChart'
import { HistoryFilters } from '@/components/history/HistoryFilters'
import { TipsTable } from '@/components/history/TipsTable'
import { TrackRecordFigures } from '@/components/history/TrackRecordFigures'
import { Button } from '@/components/ui/Button'
import { Card, Section } from '@/components/ui/Card'
import { JsonLd } from '@/components/ui/JsonLd'
import { EmptyState } from '@/components/ui/States'
import { MascotPlaceholder } from '@/components/layout/MascotPlaceholder'
import { formatDateTime } from '@/lib/format/czech'
import { operatorForDisplay } from '@/lib/legal/operator-display'
import { absoluteUrl } from '@/lib/seo/base'
import { datasetJsonLd, jsonLdGraph } from '@/lib/seo/jsonld'
import { pageMetadata } from '@/lib/seo/metadata'
import {
  buildArchiveRows,
  filterArchiveRows,
  hasActiveFilter,
  parseArchiveQuery,
  sortArchiveRows,
} from '@/lib/tips/archive'
import { loadAllSettledTips, loadSportsWithTips } from '@/lib/tips/loader'
import { trackRecordDataset } from '@/lib/tips/presentation'
import { cumulativeSeries } from '@/lib/tips/series'
import { publicTrackRecord } from '@/lib/tips/visibility'
import config from '@/payload.config'

/**
 * The track record. The most important page on the site.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * IT HAS TO READ AS A DATASET, NOT AS MARKETING
 *
 * Which means a specific set of decisions, each of which has an easier and
 * worse alternative:
 *
 *   - THE FIGURES COME FROM AN UNFILTERED QUERY. `loadAllSettledTips` takes
 *     no filter argument — not an optional one, none — and `publicTrackRecord`
 *     is computed over everything it returns. The filter below narrows WHICH
 *     ROWS ARE LISTED and never touches the numbers.
 *
 *   - THE SAMPLE SIZE IS ON THE PAGE. A return quoted without one is
 *     unfalsifiable, and the sentence "ROI +38 %" means something very
 *     different over 12 tips than over 300.
 *
 *   - THE CHART IS THE WHOLE RECORD, ALWAYS. It does not respond to the
 *     filter. A chart that redrew itself per sport would be read as the
 *     record while being a slice of it, and the reader would have no way to
 *     tell which they were looking at.
 *
 *   - THE METHODOLOGY IS IN PROSE, ON THE PAGE. Including the void rule,
 *     which is the one figure on here that does not add up by inspection.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS PAGE IS DYNAMIC
 *
 * It reads `searchParams`, so Next renders it per request. That is correct
 * rather than unfortunate: the record changes whenever a tip settles, and a
 * cached ROI is a wrong claim about money. The figures are deliberately NOT
 * among the things `src/lib/content/loaders.ts` caches.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('history')

  return pageMetadata({
    path: '/historie',
    title: t('metaTitle'),
    description: t('metaDescription'),
  })
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const t = await getTranslations('history')
  const common = await getTranslations('common')
  const tipCopy = await getTranslations('tip')

  const query = parseArchiveQuery(await searchParams)

  const payload = await getPayload({ config })
  const tips = await loadAllSettledTips({ payload })

  const now = new Date()
  // Unfiltered, by construction. See the header.
  const record = publicTrackRecord(tips, now)
  const series = cumulativeSeries(tips)
  const sports = await loadSportsWithTips(tips)

  const allRows = buildArchiveRows(tips)
  const rows = sortArchiveRows(
    filterArchiveRows(allRows, query.filter),
    query.sort,
    query.direction,
  )

  const filtered = hasActiveFilter(query.filter)

  /**
   * The JSON-LD `Dataset`.
   *
   * `operatorForDisplay()` is what performs `assertOperatorConfigured()`, so
   * in production this page refuses to render rather than publishing a
   * dataset with an invented publisher. That is the assertion the brief
   * requires of this caller, and it is here rather than inside the pure
   * builder so that a pure function does not start throwing depending on the
   * environment.
   */
  const operator = operatorForDisplay()
  const dataset = trackRecordDataset(
    record,
    tips.map((tip) => tip.publishedAt),
    {
      creator: {
        name: operator.operator.name,
        identifier: operator.operator.ico,
        url: absoluteUrl('/'),
      },
      url: absoluteUrl('/historie'),
    },
  )

  return (
    <div className="page-shell page-gutter flex flex-col gap-12 py-10">
      <JsonLd data={jsonLdGraph([datasetJsonLd(dataset, operator)])} />

      <header className="flex flex-col gap-4">
        <h1 className="text-display-lg text-ink">{t('heading')}</h1>
        <p className="max-w-prose text-body text-ink-muted">{t('lead')}</p>
        <p className="text-body-sm text-ink-muted">
          <span className="text-data-sm text-ink">
            {t('sampleSize', { count: record.settled })}
          </span>
          {' · '}
          {t('asOf', { date: formatDateTime(record.asOf) })}
        </p>
      </header>

      {record.settled === 0 ? (
        <EmptyState
          title={t('table.heading')}
          illustration={
            <MascotPlaceholder
              label={common('mascotPlaceholder')}
              size="inline"
            />
          }
          action={
            <Button href="/cenik" variant="secondary">
              {common('nav.pricing')}
            </Button>
          }
        >
          {/* Says WHY it is empty — no tips yet, rather than no tips matching
              something. The filter's own empty state is separate, below. */}
          {t('chart.emptyLabel')}
        </EmptyState>
      ) : (
        <>
          <Section
            title={t('methodology.heading')}
            lead={t('methodology.body')}
          >
            <Card tone="accent" className="flex flex-col gap-3">
              {/* The void rule, in words, on the page — not only in code. */}
              <p className="max-w-prose text-body text-ink">
                {t('methodology.voidRule')}
              </p>
              <p className="max-w-prose text-body-sm text-ink-muted">
                {t('methodology.voidLegNote')}
              </p>
              <p className="max-w-prose text-body-sm text-ink-muted">
                {t('methodology.rounding')}
              </p>
              <div>
                <Button href="/metodika" variant="ghost">
                  {t('methodology.cta')}
                </Button>
              </div>
            </Card>
          </Section>

          <Section title={t('figuresHeading')} as="h2">
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
          </Section>

          <Section title={t('chart.heading')} lead={t('chart.body')}>
            <Card>
              <CumulativeChart
                points={series}
                labels={{
                  drawdown: t('chart.drawdownLabel'),
                  axisProfit: t('chart.axisProfit'),
                  axisTip: t('chart.axisTip'),
                  empty: t('chart.emptyLabel'),
                }}
              />
            </Card>
          </Section>

          {/*
            No `Section` wrapper here: the form carries its own heading and
            points `aria-labelledby` at it, so a Section title would be the
            same words twice — once as an h2 nobody needs and once as the
            label the form actually uses.
          */}
          <Card>
            <HistoryFilters
              query={query}
              sports={sports}
              basePath="/historie"
              labels={{
                heading: t('filters.heading'),
                sport: t('filters.sport'),
                allSports: t('filters.allSports'),
                from: t('filters.from'),
                to: t('filters.to'),
                apply: t('filters.apply'),
                reset: t('filters.reset'),
                noResultFilterNote: t('filters.noResultFilterNote'),
              }}
            />
          </Card>

          <Section
            title={t('table.heading')}
            as="h2"
            lead={
              filtered
                ? t('table.filteredNotice', {
                    shown: rows.length,
                    total: allRows.length,
                  })
                : undefined
            }
          >
            {rows.length === 0 ? (
              <EmptyState
                action={
                  <Button href="/historie" variant="secondary">
                    {t('filters.reset')}
                  </Button>
                }
              >
                {t('table.empty')}
              </EmptyState>
            ) : (
              /*
               * The frame appears from `md` up only. Below that the rows ARE
               * cards (see `.data-table` in globals.css), and a card inside a
               * card is a double border for no reason.
               */
              <div className="md:rounded-card md:border md:border-border-subtle md:bg-surface-raised md:p-4">
                <TipsTable
                  rows={rows}
                  query={query}
                  basePath="/historie"
                  labels={{
                    caption: t('table.caption'),
                    columns: {
                      date: t('table.columns.date'),
                      sport: t('table.columns.sport'),
                      event: t('table.columns.event'),
                      selection: t('table.columns.selection'),
                      odds: t('table.columns.odds'),
                      stake: t('table.columns.stake'),
                      result: t('table.columns.result'),
                      profit: t('table.columns.profit'),
                      cumulative: t('table.columns.cumulative'),
                    },
                    sortAscending: t('table.sortAscending'),
                    sortDescending: t('table.sortDescending'),
                    legs: tipCopy('legs'),
                  }}
                />
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  )
}
