/**
 * Who may see what, and the public track record. PURE.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE RULE THAT MATTERS: A RESOLVED RESULT IS ALWAYS PUBLIC
 *
 * Entitlement decides who sees a tip *before* it resolves — the pick, the
 * price, the reasoning. It never decides who sees how the tip turned out.
 *
 * That is not a generosity; it is the only thing that makes the record worth
 * anything. A track record a visitor cannot check is marketing copy. If losing
 * tips could be hidden behind a paywall, the published ROI would be
 * unfalsifiable, and an unfalsifiable claim about returns is exactly what the
 * service must not make.
 *
 * So `tipVisibility` governs CONTENT, and `isTipResultPublic` governs RESULT,
 * and the second one never consults an entitlement.
 */
import type { FeatureKey } from '../billing/constants.ts'
import {
  PUBLIC_DELAY_HOURS,
  type TipStatus,
  type TipVisibility,
} from './constants.ts'
import {
  type SelectionResult,
  type TrackRecord,
  type TrackRecordTip,
  profitHundredths,
  tipResult,
  trackRecord,
} from './settlement.ts'

/* -------------------------------------------------------------------------- */
/* Visibility                                                                 */
/* -------------------------------------------------------------------------- */

/** The part of a tip that decides visibility. */
export type VisibilityTip = {
  status: TipStatus
  /** When it was published. Null while it is a draft. */
  publishedAt: Date | string | null
  /** When the free tier may see it — normally publishedAt + 24h. */
  publicAt: Date | string | null
  /** The entitlement that unlocks it immediately. */
  requiredFeatureKey: FeatureKey
}

const asTime = (value: Date | string | null | undefined): number | null => {
  if (value === null || value === undefined) {
    return null
  }

  const time =
    value instanceof Date ? value.getTime() : new Date(value).getTime()

  return Number.isNaN(time) ? null : time
}

/**
 * Has this tip resolved, so that its result is public?
 *
 * SETTLED and VOIDED both count: a voided tip resolved to "no result", which
 * is itself part of the record and must not look like a tip that vanished.
 *
 * Takes no entitlements by design — there is deliberately no way to ask this
 * question "for a particular customer", because the answer does not depend on
 * one.
 */
export const isTipResultPublic = (tip: { status: TipStatus }): boolean =>
  tip.status === 'SETTLED' || tip.status === 'VOIDED'

/**
 * How much of a tip's CONTENT this customer may see.
 *
 *  FULL     they hold the required entitlement: pick, price and reasoning.
 *  DELAYED  the public delay has elapsed: pick and price, no reasoning.
 *  LOCKED   neither: the tip exists, and its result if it has resolved.
 *
 * A draft is LOCKED for everyone, including subscribers — it is not a claim
 * yet, and showing an unpublished pick would make the publication timestamp
 * meaningless.
 */
export const tipVisibility = (
  tip: VisibilityTip,
  entitlements: ReadonlySet<string> | readonly string[],
  now: Date,
): TipVisibility => {
  if (tip.status === 'DRAFT') {
    return 'LOCKED'
  }

  const held =
    entitlements instanceof Set ? entitlements : new Set(entitlements)

  if (held.has(tip.requiredFeatureKey)) {
    return 'FULL'
  }

  const publicAt = asTime(tip.publicAt)

  // No publicAt on a published tip means "never free". Defaulting to visible
  // would leak paid content through a missing field.
  if (publicAt === null) {
    return 'LOCKED'
  }

  return now.getTime() >= publicAt ? 'DELAYED' : 'LOCKED'
}

/** Exactly which fields a caller may render. */
export type TipDisclosure = {
  visibility: TipVisibility
  /** The pick itself: event, market, selection, line. */
  showSelections: boolean
  /** The analyst or model reasoning. */
  showRationale: boolean
  /** Odds at publication and minimum odds. */
  showOdds: boolean
  /** The outcome and the profit. Independent of entitlement. */
  showResult: boolean
}

/**
 * Resolve visibility into a field-level answer.
 *
 * Returned as data rather than left to each call site, so "may I show the
 * rationale?" is answered in one place and cannot drift between the tip page,
 * the archive and the feed.
 */
export const tipDisclosure = (
  tip: VisibilityTip,
  entitlements: ReadonlySet<string> | readonly string[],
  now: Date,
): TipDisclosure => {
  const visibility = tipVisibility(tip, entitlements, now)
  const showResult = isTipResultPublic(tip)

  switch (visibility) {
    case 'FULL':
      return {
        visibility,
        showSelections: true,
        showRationale: true,
        showOdds: true,
        showResult,
      }

    case 'DELAYED':
      return {
        visibility,
        showSelections: true,
        showRationale: false,
        showOdds: true,
        showResult,
      }

    case 'LOCKED':
    default:
      return {
        visibility,
        showSelections: false,
        showRationale: false,
        showOdds: false,
        showResult,
      }
  }
}

/** The standard public delay: publication plus 24 hours. */
export const defaultPublicAt = (publishedAt: Date): Date =>
  new Date(publishedAt.getTime() + PUBLIC_DELAY_HOURS * 60 * 60 * 1000)

/* -------------------------------------------------------------------------- */
/* The public track record                                                    */
/* -------------------------------------------------------------------------- */

export type PublicTrackRecord = TrackRecord & {
  /** Every tip id counted, so the figures can be checked against the archive. */
  countedTipIds: readonly (string | number)[]
  /** How many tips were offered to the function in total. */
  consideredTips: number
  /** Tips excluded, and the only reason any tip may be excluded. */
  excludedBecauseUnsettled: number
  /** When this was computed. */
  asOf: Date
}

/**
 * The figures shown to a non-paying visitor.
 *
 * TAKES NO FILTER, ON PURPOSE. There is no sport parameter, no date range, no
 * "selected tips" list, and no exclusion flag — not because a caller would
 * never want one, but because the existence of one would make the published
 * number unverifiable. Every SETTLED tip counts, including every loss.
 *
 * The one thing a caller still controls is which tips it hands over, and no
 * signature can prevent that. Two things make it checkable instead:
 *
 *  - `countedTipIds` is returned, so the figures can be reconciled against
 *    the public archive one by one.
 *  - `consideredTips` and `excludedBecauseUnsettled` are returned, so the
 *    only legitimate exclusion is visible and anything else shows up as a
 *    discrepancy between the two.
 *
 * `loadAllSettledTips` in the loader module is the intended source and applies
 * no filter of its own.
 */
export const publicTrackRecord = (
  tips: readonly TrackRecordTip[],
  now: Date,
): PublicTrackRecord => {
  const settled = tips.filter((tip) => tip.status === 'SETTLED')

  return {
    // No filter argument is forwarded. There is nothing to forward.
    ...trackRecord(tips),
    countedTipIds: settled.map((tip) => tip.id),
    consideredTips: tips.length,
    excludedBecauseUnsettled: tips.length - settled.length,
    asOf: now,
  }
}

/* -------------------------------------------------------------------------- */
/* Per-tip public summary                                                     */
/* -------------------------------------------------------------------------- */

export type PublicTipSummary = {
  id: string | number
  sportCode: string
  publishedAt: Date | string | null
  /** 'PENDING' while unresolved. Always present once resolved. */
  result: ReturnType<typeof tipResult>
  stakeUnits: number
  /** Null while the tip has not resolved. */
  profitHundredths: number | null
}

/**
 * The row a visitor sees in the public archive.
 *
 * Deliberately carries the result and the profit but no rationale and no
 * selections — those are what entitlement governs. A losing tip produces the
 * same shape as a winning one, with a negative number in it.
 */
export const publicTipSummary = (
  tip: TrackRecordTip & { selections: readonly SelectionResult[] },
): PublicTipSummary => {
  const resolved = tip.status === 'SETTLED'

  return {
    id: tip.id,
    sportCode: tip.sportCode,
    publishedAt: tip.publishedAt,
    result: resolved ? tipResult(tip.selections) : 'PENDING',
    stakeUnits: tip.stakeUnits,
    profitHundredths: resolved
      ? profitHundredths(tip.selections, tip.stakeUnits)
      : null,
  }
}
