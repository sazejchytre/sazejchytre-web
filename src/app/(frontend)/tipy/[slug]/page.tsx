import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getPayload } from 'payload'

import { LockedPanel } from '@/components/tips/LockedPanel'
import { TipSelections } from '@/components/tips/TipSelections'
import { Button } from '@/components/ui/Button'
import { Badge, Card, Figure, Section } from '@/components/ui/Card'
import { ResultIndicator, VoidRoiNote } from '@/components/ui/ResultIndicator'
import {
  formatDateTime,
  formatOdds,
  formatProfitUnits,
  formatStakeUnits,
} from '@/lib/format/czech'
import { pageMetadata } from '@/lib/seo/metadata'
import {
  combinedOddsThousandths,
  profitHundredths,
  tipResult,
} from '@/lib/tips/settlement'
import { loadTipBySlug } from '@/lib/tips/loader'
import { tipDisclosure } from '@/lib/tips/visibility'
import config from '@/payload.config'

/**
 * One tip.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * TWO STATES IN THIS STEP: DELAYED AND LOCKED
 *
 * FULL is the paid zone and lands in a later step. There is no signed-in
 * reader here, so `tipDisclosure` is asked with an EMPTY entitlement set and
 * can only answer DELAYED or LOCKED. That is deliberate rather than
 * temporary: this page is the unauthenticated one, and when the paid zone
 * arrives it will hand real entitlements to the same function rather than
 * this page growing a second notion of who may see what.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE RESULT IS PUBLIC IN EVERY STATE, INCLUDING A LOSS
 *
 * `isTipResultPublic` — which `tipDisclosure` consults — takes no
 * entitlements by design. A losing tip renders its loss on a page a stranger
 * can read, because a track record whose bad half sits behind a paywall is
 * not a track record. The result block below is therefore OUTSIDE the
 * locked/delayed branch.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * A DELAYED TIP SAYS IT IS DELAYED
 *
 * Plainly, at the top, with the publication time. The dishonest version of
 * this page presents a 24-hour-old tip as though it were current, and the
 * reader finds out when the match has already kicked off.
 */

type PageProps = { params: Promise<{ slug: string }> }

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params
  const t = await getTranslations('tip')

  const payload = await getPayload({ config })
  const tip = await loadTipBySlug({ payload }, slug)

  if (!tip) {
    return pageMetadata({
      path: `/tipy/${slug}`,
      title: t('notFound.heading'),
      description: t('notFound.body'),
      // A missing tip must not be indexed as a page in its own right.
      noindex: true,
    })
  }

  return pageMetadata({
    path: `/tipy/${slug}`,
    title: tip.title,
    description: t('metaDescriptionDelayed'),
    ogType: 'article',
    publishedTime: tip.publishedAt
      ? new Date(tip.publishedAt).toISOString()
      : null,
  })
}

export default async function TipPage({ params }: PageProps) {
  const { slug } = await params
  const t = await getTranslations('tip')
  const common = await getTranslations('common')
  const history = await getTranslations('history')

  const payload = await getPayload({ config })
  const tip = await loadTipBySlug({ payload }, slug)

  if (!tip) {
    // Renders `not-found.tsx` and answers 404 rather than 200 with an
    // apology, so a dead link does not stay in an index as a real page.
    notFound()
  }

  const now = new Date()
  // No entitlements: this is the unauthenticated page. See the header.
  const disclosure = tipDisclosure(tip, [], now)

  const result = tipResult(tip.selections)
  const profit = profitHundredths(tip.selections, tip.stakeUnits)
  const combinedOdds = combinedOddsThousandths(tip.selections)

  return (
    <article className="page-shell page-gutter flex flex-col gap-10 py-10">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="neutral">{tip.sportName || tip.sportCode}</Badge>
          {disclosure.visibility === 'DELAYED' ? (
            <Badge tone="accent">{common('result.pending')}</Badge>
          ) : null}
        </div>

        <h1 className="text-display-lg text-ink">{tip.title}</h1>

        {tip.publishedAt ? (
          <p className="text-body-sm text-ink-muted">
            {t('publishedAt')}:{' '}
            <time dateTime={new Date(tip.publishedAt).toISOString()}>
              {formatDateTime(tip.publishedAt)}
            </time>
          </p>
        ) : null}

        {/* The delay, stated rather than implied. */}
        {disclosure.visibility === 'DELAYED' ? (
          <Card tone="accent">
            <p className="max-w-prose text-body text-ink">
              {t('delayedBanner')}
            </p>
          </Card>
        ) : null}
      </header>

      {/* ---------------------------------------------------------------- */}
      {/* The result. Outside the lock, in every state.                    */}
      {/* ---------------------------------------------------------------- */}
      {disclosure.showResult ? (
        <Section title={t('resultHeading')} as="h2">
          <Card className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-4">
              <ResultIndicator outcome={result} filled />
              {result === 'VOID' ? <VoidRoiNote /> : null}
            </div>

            <dl className="grid grid-cols-2 gap-6 sm:grid-cols-4">
              <Figure
                label={history('table.columns.profit')}
                value={`${formatProfitUnits(profit)} ${common('metrics.unitsShort')}`}
                tone={profit > 0 ? 'win' : profit < 0 ? 'loss' : 'default'}
              />
              {disclosure.showOdds ? (
                <Figure
                  label={t('combinedOdds')}
                  value={formatOdds(combinedOdds)}
                />
              ) : null}
              {disclosure.showOdds ? (
                <Figure
                  label={t('stakeColumn')}
                  value={`${formatStakeUnits(tip.stakeUnits)} ${common('metrics.unitsShort')}`}
                />
              ) : null}
              <Figure label={t('legs')} value={String(tip.selections.length)} />
            </dl>

            <p className="max-w-prose text-body-sm text-ink-muted">
              {t('resultAlwaysPublic')}
            </p>
          </Card>
        </Section>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* The tip itself: shown, or locked.                                */}
      {/* ---------------------------------------------------------------- */}
      {disclosure.showSelections ? (
        <Section title={t('selectionsHeading')} as="h2">
          <Card flush>
            <div className="md:p-2">
              <TipSelections
                selections={tip.selections.map((selection) => ({
                  eventName: selection.eventName,
                  market: selection.market,
                  selection: selection.selection,
                  line: selection.line,
                  oddsThousandths: selection.oddsAtPublication,
                  minimumOddsThousandths: selection.minimumOddsThousandths,
                  outcome: selection.outcome,
                }))}
                labels={{
                  eventHeading: t('eventHeading'),
                  selectionHeading: t('selectionColumn'),
                  oddsHeading: t('oddsColumn'),
                  minimumOddsHeading: t('minOddsColumn'),
                  resultHeading: t('resultHeading'),
                  showResult: disclosure.showResult,
                }}
              />
            </div>
          </Card>

          {/* Rule 3: a minimum figure, and the sentence that explains why
              there is no bookmaker next to it. */}
          <p className="max-w-prose text-body-sm text-ink-muted">
            {t('minimumOddsNote')}
          </p>
        </Section>
      ) : (
        <LockedPanel
          // Only the non-decisive structure is passed in: the component is
          // never told the selection, the odds or the stake.
          events={tip.selections.map((selection) => selection.eventName)}
          markets={tip.selections.map((selection) => selection.market)}
          labels={{
            heading: t('locked.heading'),
            body: t('locked.body'),
            // `t.raw` because the catalogue holds an array here. `t()` with
            // an index would return the key as a string in production, where
            // a missing-message error is swallowed rather than thrown.
            items: t.raw('locked.items') as readonly string[],
            withheld: t('locked.withheld'),
            cta: t('locked.cta'),
            eventHeading: t('eventHeading'),
            selectionHeading: t('selectionColumn'),
            oddsHeading: t('oddsColumn'),
            stakeHeading: t('stakeColumn'),
          }}
        />
      )}

      {/*
        THERE IS NO ANALYSIS SECTION HERE.

        `disclosure.showRationale` is true only for FULL, and FULL requires an
        entitlement this page never looks up — so a rationale block would be
        unreachable code pretending to be a feature. The paid zone renders it,
        in the step that builds the paid zone.
      */}

      <div>
        <Button href="/historie" variant="secondary">
          {t('backToHistory')}
        </Button>
      </div>
    </article>
  )
}
