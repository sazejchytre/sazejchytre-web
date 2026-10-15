/**
 * Tips and track-record vocabulary, and the integer scales everything uses.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY EVERY NUMBER HERE IS AN INTEGER
 *
 * The published ROI is computed from these rows, and customers pay because of
 * that number. A float would make it *almost* reproducible: 2.1 is not
 * representable in binary floating point, so a sum of a few hundred odds can
 * differ in the last digit depending on the order it was added in. A track
 * record that answers slightly differently each time it is computed is not
 * evidence of anything.
 *
 * So, as with money in the billing model: integers only, with the scale
 * written into the field name and into these constants.
 *
 *   odds    thousandths      2.100 → 2100
 *   line    hundredths       -0.75 → -75
 *   profit  hundredths of a unit   1.5 units → 150
 *   ROI/CLV basis points     4.25% → 425
 *
 * Nothing in `settlement.ts` produces a float, not even intermediately.
 */

/* -------------------------------------------------------------------------- */
/* Scales                                                                     */
/* -------------------------------------------------------------------------- */

/** Decimal odds are stored in thousandths. 2.100 → 2100. */
export const ODDS_SCALE = 1000

/** Handicaps and totals are stored in hundredths. -0.75 → -75. */
export const LINE_SCALE = 100

/** Profit and stake are stored in hundredths of a unit. 1.5 → 150. */
export const PROFIT_SCALE = 100

/** ROI and closing line value are stored in basis points. 4.25% → 425. */
export const BASIS_POINTS_SCALE = 10_000

/** Evens, i.e. decimal odds 1.000 — a leg that returns exactly the stake. */
export const EVEN_ODDS = ODDS_SCALE

/**
 * Smallest and largest odds we will store.
 *
 * Below 1.001 a "bet" returns less than the stake, which is never a real
 * price; above 1000.000 it is a data-entry error, not a tip.
 */
export const MIN_ODDS = 1_001
export const MAX_ODDS = 1_000_000

/* -------------------------------------------------------------------------- */
/* Stake                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Recommended stake, in whole units, 1 to 10.
 *
 * Whole units on purpose: the stake is advice to a human, and "stake 2.37
 * units" is advice nobody follows. It also keeps the published record
 * reproducible, since the stake is a factor in every profit figure.
 */
export const MIN_STAKE_UNITS = 1
export const MAX_STAKE_UNITS = 10

/** Analyst confidence, 1 to 100. Presentational; never an input to profit. */
export const MIN_CONFIDENCE = 1
export const MAX_CONFIDENCE = 100

/* -------------------------------------------------------------------------- */
/* Events                                                                     */
/* -------------------------------------------------------------------------- */

export const EVENT_STATUSES = [
  'SCHEDULED',
  'LIVE',
  'FINISHED',
  'POSTPONED',
  'CANCELLED',
] as const
export type EventStatus = (typeof EVENT_STATUSES)[number]

/* -------------------------------------------------------------------------- */
/* Tips                                                                       */
/* -------------------------------------------------------------------------- */

export const TIP_STATUSES = [
  /** Being written. Everything is editable; nothing is public. */
  'DRAFT',
  /** Published. The claim is now on the record and frozen. */
  'PUBLISHED',
  /** Every selection has an outcome and the result is final. */
  'SETTLED',
  /** Withdrawn before it could settle — e.g. every event cancelled. */
  'VOIDED',
] as const
export type TipStatus = (typeof TIP_STATUSES)[number]

/**
 * The only legal status moves.
 *
 * An exhaustive whitelist rather than a list of forbidden ones: a transition
 * nobody thought about has to be refused, not allowed by omission. In
 * particular SETTLED and VOIDED are terminal — a settled tip can never go back
 * to PUBLISHED and be re-settled differently, which is the shape a doctored
 * record would take.
 */
export const TIP_STATUS_TRANSITIONS: Readonly<
  Record<TipStatus, readonly TipStatus[]>
> = Object.freeze({
  DRAFT: ['PUBLISHED'],
  PUBLISHED: ['SETTLED', 'VOIDED'],
  SETTLED: [],
  VOIDED: [],
})

/** Is this status move allowed? Pure. */
export const isLegalTipTransition = (
  from: TipStatus,
  to: TipStatus,
): boolean => {
  // A no-op update is not a transition; Payload saves a document without
  // changing its status all the time.
  if (from === to) {
    return true
  }

  return TIP_STATUS_TRANSITIONS[from].includes(to)
}

/** Statuses in which the published claim is frozen. */
export const FROZEN_TIP_STATUSES: readonly TipStatus[] = [
  'PUBLISHED',
  'SETTLED',
  'VOIDED',
] as const

/** Is the tip's published claim frozen in this status? */
export const isFrozenStatus = (status: TipStatus): boolean =>
  FROZEN_TIP_STATUSES.includes(status)

/* -------------------------------------------------------------------------- */
/* Selections                                                                 */
/* -------------------------------------------------------------------------- */

export const SELECTION_OUTCOMES = [
  /** Not yet known. */
  'PENDING',
  'WON',
  'LOST',
  /** Stake returned: event cancelled, or a push on the line. */
  'VOID',
  /** Asian handicap quarter-line: half the stake won, half returned. */
  'HALF_WON',
  /** Asian handicap quarter-line: half the stake lost, half returned. */
  'HALF_LOST',
] as const
export type SelectionOutcome = (typeof SELECTION_OUTCOMES)[number]

/** Outcomes that mean the leg is decided. */
export const SETTLED_OUTCOMES: readonly SelectionOutcome[] = [
  'WON',
  'LOST',
  'VOID',
  'HALF_WON',
  'HALF_LOST',
] as const

export const isSettledOutcome = (outcome: SelectionOutcome): boolean =>
  SETTLED_OUTCOMES.includes(outcome)

/**
 * Markets we know about today.
 *
 * `market` is stored as TEXT, not an enum, and this list is advisory. New
 * markets appear constantly (and a partner feed will bring its own), and an
 * enum would turn "we can price a new market" into a schema migration that
 * has to ship before the first tip can use it. The same reasoning as the
 * webhook `type` column in the billing model.
 */
export const KNOWN_MARKETS = [
  '1X2',
  'DOUBLE_CHANCE',
  'OVER_UNDER',
  'ASIAN_HANDICAP',
  'BOTH_TEAMS_TO_SCORE',
  'CORRECT_SCORE',
  'DRAW_NO_BET',
  'HANDICAP',
  'MONEYLINE',
  'PLAYER_PROPS',
  'TOTALS',
] as const
export type KnownMarket = (typeof KNOWN_MARKETS)[number]

/** Markets whose line is meaningful, for validation messages. */
export const MARKETS_REQUIRING_LINE: readonly string[] = [
  'OVER_UNDER',
  'ASIAN_HANDICAP',
  'HANDICAP',
  'TOTALS',
] as const

/* -------------------------------------------------------------------------- */
/* Audit                                                                      */
/* -------------------------------------------------------------------------- */

export const TIP_AUDIT_EVENT_TYPES = [
  'CREATED',
  'PUBLISHED',
  'SELECTION_SETTLED',
  'SETTLED',
  'VOIDED',
  'CLOSING_ODDS_RECORDED',
  'EDIT_REJECTED',
] as const
export type TipAuditEventType = (typeof TIP_AUDIT_EVENT_TYPES)[number]

/* -------------------------------------------------------------------------- */
/* Visibility                                                                 */
/* -------------------------------------------------------------------------- */

export const TIP_VISIBILITIES = [
  /** Everything, including the rationale. */
  'FULL',
  /** The pick is visible because the delay has elapsed; the rationale is not. */
  'DELAYED',
  /** Nothing but the fact that a tip exists, and its result if settled. */
  'LOCKED',
] as const
export type TipVisibility = (typeof TIP_VISIBILITIES)[number]

/** How long after publication the free tier may see a tip. */
export const PUBLIC_DELAY_HOURS = 24

/* -------------------------------------------------------------------------- */
/* Payload select helper                                                      */
/* -------------------------------------------------------------------------- */

export const toOptions = <T extends readonly string[]>(
  values: T,
): { label: string; value: T[number] }[] =>
  values.map((value) => ({ label: value, value }))
