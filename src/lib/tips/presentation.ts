/**
 * The typed shape a structured-data block will need from the track record.
 *
 * PURE, and deliberately NOT markup. This step produces the data; the step
 * that adds pages turns it into a JSON-LD `<script>`. Keeping the two apart
 * means the numbers are unit-testable without parsing HTML, and the same shape
 * can feed a JSON API or an export later.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY BOTHER AT ALL
 *
 * The product's claim is "here is our record, check it". Structured data is
 * what makes that claim machine-readable: a `Dataset` with explicitly
 * described variables can be cited by a search engine or an AI assistant
 * without anybody having to trust prose. It is the difference between
 * asserting a 36% return and publishing a figure with its units, its sample
 * size, its period and its method attached.
 *
 * Two rules follow:
 *
 *  1. EVERY FIGURE CARRIES ITS UNIT. `value: 3594` means nothing on its own;
 *    `{ value: 3594, unitText: 'basis points' }` does. Scaled integers are
 *    exactly the kind of number that gets misread by a factor of 100.
 *
 *  2. THE SAMPLE SIZE AND PERIOD ARE PART OF THE CLAIM, not decoration. A
 *    return quoted without them is unfalsifiable, which is the thing this
 *    whole module exists to avoid.
 *
 * Operator identity is an INPUT, not an import. `src/lib/legal/operator.ts` is
 * still placeholders and `assertOperatorConfigured()` throws in production, so
 * the caller that renders this does the assertion. If this module imported it
 * directly, a pure function would start throwing depending on the
 * environment.
 */
import { BASIS_POINTS_SCALE, ODDS_SCALE, PROFIT_SCALE } from './constants.ts'
import type { PublicTrackRecord } from './visibility.ts'

/** One described figure. The unit is never implied. */
export type MeasuredVariable = {
  /** Machine-ish name, stable across releases. */
  name: string
  /** Human label, Czech. */
  label: string
  /**
   * The value as an INTEGER in its stored scale — never pre-divided into a
   * float. A consumer that wants 35.94% divides by `scale` itself.
   */
  value: number
  /** What to divide `value` by to get the natural unit. */
  scale: number
  /** Unit of the scaled value, for a human. */
  unitText: string
}

export type TrackRecordDataset = {
  /** Dataset name, Czech. */
  name: string
  /** One-sentence description of what the figures are and are not. */
  description: string
  /** How the numbers were produced, in a sentence. */
  measurementTechnique: string
  /** ISO 8601 interval, e.g. `2026-03-01/2026-10-15`. Null if empty. */
  temporalCoverage: string | null
  /** When the figures were computed. */
  dateModified: string
  /** Number of tips the figures are based on. */
  sampleSize: number
  /** Always true: the record is public, including the losses. */
  isAccessibleForFree: true
  /** Supplied by the caller from `operator.ts`, never invented here. */
  creator: { name: string; identifier: string; url?: string }
  /** Every figure, each with its unit. */
  variableMeasured: readonly MeasuredVariable[]
  /** The ids counted, so a reader can reconcile against the archive. */
  countedTipIds: readonly (string | number)[]
  /** Canonical page the dataset is published on, when the caller knows it. */
  url?: string
}

export type DatasetMeta = {
  creator: { name: string; identifier: string; url?: string }
  /** Canonical URL of the page the dataset is published on. */
  url?: string
}

const iso = (value: Date | string | null | undefined): string | null => {
  if (value === null || value === undefined) {
    return null
  }

  const date = value instanceof Date ? value : new Date(value)

  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * Earliest and latest publication date among the counted tips.
 *
 * Used for `temporalCoverage`, which is what tells a reader the record is six
 * months long rather than six days.
 */
export const trackRecordPeriod = (
  publishedDates: readonly (Date | string | null)[],
): { from: string; to: string } | null => {
  const times = publishedDates
    .map((value) => iso(value))
    .filter((value): value is string => value !== null)
    .sort()

  const from = times[0]
  const to = times[times.length - 1]

  if (!from || !to) {
    return null
  }

  return { from, to }
}

/**
 * Turn a public track record into the typed structured-data shape.
 *
 * No markup, no HTML escaping, no `@context` — those belong to whatever
 * renders this. The figures and their units belong here.
 */
export const trackRecordDataset = (
  record: PublicTrackRecord,
  publishedDates: readonly (Date | string | null)[],
  meta: DatasetMeta,
): TrackRecordDataset => {
  const period = trackRecordPeriod(publishedDates)

  const variables: MeasuredVariable[] = [
    {
      name: 'settledTips',
      label: 'Vyhodnocené tipy',
      value: record.settled,
      scale: 1,
      unitText: 'tipů',
    },
    {
      name: 'wonTips',
      label: 'Vítězné tipy',
      value: record.won,
      scale: 1,
      unitText: 'tipů',
    },
    {
      name: 'lostTips',
      label: 'Prohrané tipy',
      value: record.lost,
      scale: 1,
      unitText: 'tipů',
    },
    {
      name: 'voidTips',
      label: 'Zrušené tipy',
      value: record.void,
      scale: 1,
      unitText: 'tipů',
    },
    {
      // Labelled "excluding void" because it is: a void tip's stake came back
      // and leaves the ROI denominator. A dataset that called this plain
      // "Vsazeno" would not add up against the stake column in the table, and
      // the reader would be right to distrust the ROI rather than the label.
      name: 'stakedUnits',
      label: 'Vsazeno (bez zrušených tipů)',
      value: record.stakedUnits,
      scale: 1,
      unitText: 'jednotek',
    },
    {
      name: 'profitUnits',
      label: 'Zisk',
      value: record.profitHundredths,
      scale: PROFIT_SCALE,
      unitText: 'jednotek',
    },
  ]

  if (record.roiBasisPoints !== null) {
    variables.push({
      name: 'returnOnInvestment',
      label: 'Návratnost (ROI)',
      value: record.roiBasisPoints,
      scale: BASIS_POINTS_SCALE,
      unitText: 'podíl (1 = 100 %)',
    })
  }

  if (record.averageOddsThousandths !== null) {
    variables.push({
      name: 'averageOdds',
      label: 'Průměrný kurz',
      value: record.averageOddsThousandths,
      scale: ODDS_SCALE,
      unitText: 'desetinný kurz',
    })
  }

  if (record.closingLineValueBasisPoints !== null) {
    variables.push({
      name: 'closingLineValue',
      label: 'Hodnota proti zavíracímu kurzu',
      value: record.closingLineValueBasisPoints,
      scale: BASIS_POINTS_SCALE,
      unitText: 'podíl (1 = 100 %)',
    })
    variables.push({
      name: 'closingLineSampleSize',
      label: 'Tipy se zavíracím kurzem',
      value: record.closingLineSampleSize,
      scale: 1,
      unitText: 'tipů',
    })
  }

  return {
    name: 'Výsledky tipů — Sázej chytře',
    description:
      'Kompletní historie vyhodnocených tipů včetně prohraných. ' +
      'Žádný tip není z výpočtu vynechán. Jde o informační analýzu, ' +
      'nikoli o nabídku ani o příjem sázek.',
    measurementTechnique:
      'Zisk v jednotkách se počítá celočíselně z kurzu při publikaci a ' +
      'doporučené výše sázky. Kurzy jsou v tisícinách, zisk ve stovkách ' +
      'jednotky, ROI v bazických bodech. Zaokrouhluje se jednou, na konci, ' +
      'od nuly. Do výpočtu vstupují všechny vyhodnocené tipy.',
    temporalCoverage: period ? `${period.from}/${period.to}` : null,
    dateModified: record.asOf.toISOString(),
    sampleSize: record.settled,
    isAccessibleForFree: true,
    creator: meta.creator,
    variableMeasured: variables,
    countedTipIds: record.countedTipIds,
    ...(meta.url ? { url: meta.url } : {}),
  }
}
