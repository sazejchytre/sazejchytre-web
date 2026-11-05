/**
 * The headline figures.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE LOSS COUNT IS AS PROMINENT AS THE ROI
 *
 * Same type size, same row, no smaller tone. That is a requirement, not a
 * style choice: a record that shows "ROI +38 %" in 32px and "prohraných 41"
 * in grey 12px underneath is a marketing claim with a footnote, and the whole
 * argument of this site is that it is not making one.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ROI CAN BE NULL, AND NULL IS NOT ZERO
 *
 * `formatRoi` returns null when nothing was staked — every tip void, or none
 * settled. The figure then shows an em dash, because printing "0 %" would be
 * a claim about money that was never at risk.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * "VSAZENO" CARRIES ITS OWN CAVEAT
 *
 * The staked total excludes void tips, because their stake came back and left
 * the ROI denominator. A reader adding up the stake column of the table will
 * get a bigger number, and would be right to distrust the ROI rather than the
 * label. So the label says so and the methodology note explains it.
 */
import { Figure } from '@/components/ui/Card'
import {
  formatCount,
  formatOdds,
  formatProfitUnits,
  formatRoi,
  formatStakeUnits,
} from '@/lib/format/czech'
import type { PublicTrackRecord } from '@/lib/tips/visibility'

export type TrackRecordFiguresLabels = {
  roi: string
  profit: string
  staked: string
  stakedNote: string
  settled: string
  won: string
  lost: string
  void: string
  averageOdds: string
  units: string
}

/** Em dash, for a figure that genuinely has no value. */
const NO_VALUE = '—'

export const TrackRecordFigures = ({
  record,
  labels,
}: {
  record: PublicTrackRecord
  labels: TrackRecordFiguresLabels
}) => {
  const roi = formatRoi(record.roiBasisPoints)
  const roiTone =
    record.roiBasisPoints === null
      ? 'default'
      : record.roiBasisPoints > 0
        ? 'win'
        : record.roiBasisPoints < 0
          ? 'loss'
          : 'default'

  const profitTone =
    record.profitHundredths > 0
      ? 'win'
      : record.profitHundredths < 0
        ? 'loss'
        : 'default'

  return (
    // A description list: each figure is a label and a value, which is what
    // `dl` is for and what makes the pairing available to a screen reader.
    <dl className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
      <Figure label={labels.roi} value={roi ?? NO_VALUE} tone={roiTone} />

      <Figure
        label={labels.profit}
        value={`${formatProfitUnits(record.profitHundredths)} ${labels.units}`}
        tone={profitTone}
      />

      <Figure label={labels.settled} value={formatCount(record.settled)} />

      {/* Wins and losses side by side, at the same weight. */}
      <Figure label={labels.won} value={formatCount(record.won)} tone="win" />

      <Figure
        label={labels.lost}
        value={formatCount(record.lost)}
        tone="loss"
      />

      <Figure
        label={labels.void}
        value={formatCount(record.void)}
        tone="void"
      />

      <Figure
        label={labels.staked}
        value={`${formatStakeUnits(record.stakedUnits)} ${labels.units}`}
        foot={labels.stakedNote}
      />

      <Figure
        label={labels.averageOdds}
        value={
          record.averageOddsThousandths === null
            ? NO_VALUE
            : formatOdds(record.averageOddsThousandths)
        }
      />
    </dl>
  )
}
