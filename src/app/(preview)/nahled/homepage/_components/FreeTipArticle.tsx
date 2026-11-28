import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Card'
import {
  ResultIndicator,
  type TipOutcome,
} from '@/components/ui/ResultIndicator'

/**
 * Yesterday's free tip, as an article teaser rather than a card.
 *
 * The tip is the REAL most recent one whose public delay has passed
 * (`loadLatestPublicTip`), disclosed through `tipDisclosure` exactly as the
 * current home page does: selections only if the disclosure allows them, a
 * result only once there is one, won or lost. Nothing here chooses which tip
 * is shown.
 *
 * Meta line in Geist Mono (sport, date), headline in the H3 style, the delay
 * said in words, then the picks with their odds at publication.
 */

export type FreeTipSelectionView = {
  key: string
  event: string
  pick: string
  odds: string
}

export type FreeTipView = {
  href: string
  title: string
  sport: string
  date: string | null
  dateIso: string | null
  /** Null while the disclosure does not show a result. */
  outcome: TipOutcome | null
  /** Empty while the disclosure withholds the selections. */
  selections: readonly FreeTipSelectionView[]
}

export const FreeTipArticle = ({
  tip,
  labels,
}: {
  tip: FreeTipView
  labels: {
    delayNotice: string
    cta: string
    minimumOddsNote: string
    oddsColumn: string
  }
}) => (
  <article className="flex flex-col gap-4 rounded-card border border-border-subtle bg-surface-raised p-4 sm:p-6">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Badge tone="neutral">{tip.sport}</Badge>
      {tip.date && tip.dateIso ? (
        <time dateTime={tip.dateIso} className="text-data-sm text-ink-muted">
          {tip.date}
        </time>
      ) : null}
      {tip.outcome ? <ResultIndicator outcome={tip.outcome} compact /> : null}
    </div>

    <h3 className="text-heading text-ink">{tip.title}</h3>

    <p className="max-w-prose text-body-sm text-ink-muted">
      {labels.delayNotice}
    </p>

    {tip.selections.length > 0 ? (
      <dl className="flex flex-col divide-y divide-border-subtle border-y border-border-subtle">
        {tip.selections.map((selection) => (
          <div
            key={selection.key}
            className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3"
          >
            <dt className="text-body-sm text-ink-muted">{selection.event}</dt>
            <dd className="text-data text-ink">
              {selection.pick}
              <span className="text-ink-muted"> · {labels.oddsColumn} </span>
              {selection.odds}
            </dd>
          </div>
        ))}
      </dl>
    ) : null}

    <div>
      <Button href={tip.href} variant="secondary">
        {labels.cta}
      </Button>
    </div>

    {/* Rule 3 of the catalogue: a minimum figure, never a bookmaker. */}
    <p className="max-w-prose text-body-sm text-ink-muted">
      {labels.minimumOddsNote}
    </p>
  </article>
)
