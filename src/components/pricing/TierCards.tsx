/**
 * The three tiers.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE YEARLY SAVING IS STATED HONESTLY OR NOT AT ALL
 *
 * It is computed from the two prices actually charged (see
 * `pricing-view.ts`), and when it cannot be computed — a missing price, two
 * currencies — nothing is shown. The usual version of this component states
 * "ušetříte 2 měsíce" from a hard-coded assumption that the yearly price is
 * ten monthlies; that sentence is a claim about money, and it stops being
 * true the first time a price is edited.
 *
 * The per-month equivalent is shown alongside, because that is the
 * comparison a reader is actually making, and leaving it out is how a yearly
 * price looks dearer than it is.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE BUY BUTTON POINTS AT A STUB
 *
 * `/predplatne/...` is the route the checkout step owns. It is a real link to
 * a real page that says payment is not switched on yet, rather than a
 * disabled button: a disabled primary button with no explanation reads as a
 * broken page, and a visitor who clicks deserves a sentence.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * RULE 1 AND RULE 2
 *
 * The button says what the control does — ZÍSKAT PŘÍSTUP — not what the
 * reader should do with a bookmaker. And nothing here promises a return: the
 * features describe the analysis, and the words are in the message catalogue
 * where the copy test can see them.
 */
import { Badge, Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { formatMinorAmount } from '@/lib/billing/money'
import type { FeatureKey } from '@/lib/billing/constants'
import {
  type TierView,
  isRecommended,
  yearlyPerMonthMinor,
  yearlySavingMinor,
} from '@/lib/billing/pricing-view'

export type TierCardsLabels = {
  recommended: string
  perMonth: string
  perYear: string
  yearlySaving: (amount: string) => string
  yearlyEquivalent: (amount: string) => string
  featuresHeading: string
  cta: string
  vatNote: string
  featureLabel: (key: FeatureKey) => string
  unavailable: string
}

export type TierCardsProps = {
  tiers: readonly TierView[]
  /** Which cadence the page is showing. The toggle is a link, not state. */
  interval: 'MONTH' | 'YEAR'
  labels: TierCardsLabels
}

export const TierCards = ({ tiers, interval, labels }: TierCardsProps) => (
  <ul className="grid gap-6 lg:grid-cols-3">
    {tiers.map((tier) => {
      const price = interval === 'MONTH' ? tier.monthly : tier.yearly
      const recommended = isRecommended(tier.code)
      const saving = yearlySavingMinor(tier)
      const perMonth = yearlyPerMonthMinor(tier)

      return (
        <li key={tier.code} className="flex">
          <Card
            // The recommended tier is the accent surface — one tier, one
            // emphasis. Three emphasised cards is no emphasis.
            tone={recommended ? 'accent' : 'raised'}
            className="flex w-full flex-col gap-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-heading text-ink">{tier.name}</h3>
              {recommended ? (
                <Badge tone="brand">{labels.recommended}</Badge>
              ) : null}
            </div>

            {tier.description ? (
              <p className="text-body-sm text-ink-muted">{tier.description}</p>
            ) : null}

            <div className="flex flex-col gap-1">
              {price ? (
                <>
                  <p className="flex flex-wrap items-baseline gap-2">
                    <span className="text-data-xl text-ink">
                      {formatMinorAmount(price.amountMinor, price.currency)}
                    </span>
                    <span className="text-body-sm text-ink-muted">
                      {interval === 'MONTH' ? labels.perMonth : labels.perYear}
                    </span>
                  </p>

                  {interval === 'YEAR' && perMonth !== null ? (
                    <p className="text-body-sm text-ink-muted">
                      {labels.yearlyEquivalent(
                        formatMinorAmount(perMonth, price.currency),
                      )}
                    </p>
                  ) : null}

                  {interval === 'YEAR' && saving !== null && saving !== 0 ? (
                    <p className="text-body-sm text-ink">
                      {labels.yearlySaving(
                        formatMinorAmount(saving, price.currency),
                      )}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-body-sm text-ink-muted">
                  {labels.unavailable}
                </p>
              )}
            </div>

            <div>
              <Button
                href={`/predplatne?plan=${tier.code}&obdobi=${interval === 'MONTH' ? 'mesicne' : 'rocne'}`}
                variant={recommended ? 'primary' : 'secondary'}
                size="lg"
                className="w-full"
              >
                {labels.cta}
              </Button>
            </div>

            <div className="flex flex-col gap-2">
              <h4 className="text-label text-ink">{labels.featuresHeading}</h4>
              <ul className="flex flex-col gap-1">
                {tier.features.map((feature) => (
                  <li
                    key={feature}
                    className="flex gap-2 text-body-sm text-ink-muted"
                  >
                    {/* 4px between glyph and text — the one odd step on the
                        spacing grid, which exists for exactly this. */}
                    <span aria-hidden="true" className="text-brand-text">
                      ✓
                    </span>
                    <span>{labels.featureLabel(feature)}</span>
                  </li>
                ))}
              </ul>
            </div>

            <p className="mt-auto text-label text-ink-muted">
              {labels.vatNote}
            </p>
          </Card>
        </li>
      )
    })}
  </ul>
)
