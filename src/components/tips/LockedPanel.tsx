/**
 * What a non-subscriber sees instead of a tip.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE TEXT IS NOT BLURRED. IT IS NOT THERE.
 *
 * A CSS blur over real content is the standard implementation and it is wrong
 * twice over. It is not a lock — the text is in the HTML, so "inspect
 * element" or disabling CSS reveals it, and so does a screen reader, which
 * reads blurred text out loud in full. And it is a bad experience even when
 * it works: the reader can see that something is being hidden from them,
 * character by character, which reads as a trick rather than as a price.
 *
 * So the decisive values are NEVER SENT. This component does not receive the
 * selection, the odds or the stake — it receives the structure around them
 * and a list of what the lock covers. It cannot leak them, because it has
 * never been told them.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE STRUCTURE IS REAL
 *
 * The match, the market type, the number of legs. A reader has to be able to
 * see that there IS a tip, of a particular shape, on a particular match —
 * otherwise the page is a paywall over a rumour, and nothing on it supports
 * the decision to subscribe.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * A SETTLED TIP'S RESULT IS NOT BEHIND THIS LOCK
 *
 * It is rendered by the page, outside this component, in every state
 * including a loss. `isTipResultPublic` takes no entitlements — see the
 * header of `visibility.ts`. If losing tips could be hidden behind a
 * paywall, the published ROI would be unfalsifiable.
 */
import { Badge, Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

export type LockedPanelProps = {
  /** Matches the tip covers. Not decisive — the reader can see the fixture. */
  events: readonly string[]
  /** Market types, e.g. `1X2`, `OVER_UNDER`. The selection is NOT included. */
  markets: readonly string[]
  labels: {
    heading: string
    body: string
    /** What is behind the lock, as a list. */
    items: readonly string[]
    /** Shown in place of each withheld value. */
    withheld: string
    cta: string
    eventHeading: string
    selectionHeading: string
    oddsHeading: string
    stakeHeading: string
  }
}

export const LockedPanel = ({ events, markets, labels }: LockedPanelProps) => (
  <Card tone="accent" className="flex flex-col gap-6">
    <div className="flex flex-col gap-2">
      <h2 className="text-heading text-ink">{labels.heading}</h2>
      <p className="max-w-prose text-body text-ink-muted">{labels.body}</p>
    </div>

    {/*
      The real shape of the tip, with the decisive cells replaced by a badge.
      A table rather than a list, because this is the same table the unlocked
      tip renders — the structure is what is on display.
    */}
    <table className="data-table">
      <thead>
        <tr>
          <th scope="col">{labels.eventHeading}</th>
          <th scope="col">{labels.selectionHeading}</th>
          <th scope="col" data-align="end">
            {labels.oddsHeading}
          </th>
        </tr>
      </thead>
      <tbody>
        {events.map((event, index) => (
          <tr key={`${event}-${index}`}>
            <td data-label={labels.eventHeading}>{event}</td>
            <td data-label={labels.selectionHeading}>
              {/* The market type is shown; the pick within it is not. */}
              <span className="text-ink-muted">
                {markets[index] ?? ''}
              </span>{' '}
              <Badge tone="neutral">{labels.withheld}</Badge>
            </td>
            <td data-label={labels.oddsHeading} data-align="end">
              <Badge tone="neutral">{labels.withheld}</Badge>
            </td>
          </tr>
        ))}
      </tbody>
    </table>

    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {labels.items.map((item) => (
          <li key={item} className="flex gap-2 text-body text-ink">
            <span aria-hidden="true" className="text-brand-text">
              ✓
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>

      <div>
        <Button href="/cenik" variant="primary" size="lg">
          {labels.cta}
        </Button>
      </div>
    </div>
  </Card>
)
