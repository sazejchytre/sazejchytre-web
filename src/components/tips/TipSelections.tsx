/**
 * The legs of a tip, when the reader is allowed to see them.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE MINIMUM ODDS FIGURE, AND THE RULE IT EXISTS UNDER
 *
 * Copy rule 3: no bookmaker may be named, pictured or compared. A table of
 * prices across operators is an advertisement for whoever happens to be top
 * of it, and it is the single most common way a tipster site turns into an
 * affiliate page.
 *
 * What may appear is a RECOMMENDED MINIMUM — a property of the analysis
 * rather than a recommendation of a seller. It answers "below what price is
 * this no longer worth doing", which is the only question the analysis can
 * honestly speak to. The note beside it says as much in words.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ODDS AT PUBLICATION, NOT ODDS NOW
 *
 * The column is labelled with the moment it belongs to. A price from three
 * days ago presented as a current one is a number that is wrong by the time
 * anybody reads it, and the track record is computed from the publication
 * price — so the two have to be the same figure under the same name.
 */
import { ResultIndicator } from '@/components/ui/ResultIndicator'
import { formatOdds } from '@/lib/format/czech'
import type { SelectionOutcome } from '@/lib/tips/constants'

export type TipSelectionView = {
  eventName: string
  market: string
  selection: string
  line: string | null
  oddsThousandths: number
  minimumOddsThousandths: number | null
  outcome: SelectionOutcome
}

export type TipSelectionsLabels = {
  eventHeading: string
  selectionHeading: string
  oddsHeading: string
  minimumOddsHeading: string
  resultHeading: string
  /** Rendered only when a result is public. */
  showResult: boolean
}

/** Maps a leg's outcome onto the indicator's vocabulary. */
const toOutcome = (
  outcome: SelectionOutcome,
): 'WON' | 'LOST' | 'VOID' | 'PENDING' => {
  switch (outcome) {
    case 'WON':
      return 'WON'
    case 'LOST':
      return 'LOST'
    case 'VOID':
      return 'VOID'
    default:
      return 'PENDING'
  }
}

export const TipSelections = ({
  selections,
  labels,
}: {
  selections: readonly TipSelectionView[]
  labels: TipSelectionsLabels
}) => (
  <table className="data-table">
    <thead>
      <tr>
        <th scope="col">{labels.eventHeading}</th>
        <th scope="col">{labels.selectionHeading}</th>
        <th scope="col" data-align="end">
          {labels.oddsHeading}
        </th>
        <th scope="col" data-align="end">
          {labels.minimumOddsHeading}
        </th>
        {labels.showResult ? <th scope="col">{labels.resultHeading}</th> : null}
      </tr>
    </thead>
    <tbody>
      {selections.map((selection, index) => (
        <tr key={`${selection.eventName}-${index}`}>
          <td data-label={labels.eventHeading}>{selection.eventName}</td>
          <td data-label={labels.selectionHeading}>
            {selection.market} {selection.selection}
            {selection.line ? ` ${selection.line}` : ''}
          </td>
          <td data-label={labels.oddsHeading} data-align="end">
            <span className="text-data-sm">
              {formatOdds(selection.oddsThousandths)}
            </span>
          </td>
          <td data-label={labels.minimumOddsHeading} data-align="end">
            <span className="text-data-sm">
              {selection.minimumOddsThousandths === null
                ? '—'
                : formatOdds(selection.minimumOddsThousandths)}
            </span>
          </td>
          {labels.showResult ? (
            <td data-label={labels.resultHeading}>
              <ResultIndicator outcome={toOutcome(selection.outcome)} compact />
            </td>
          ) : null}
        </tr>
      ))}
    </tbody>
  </table>
)
