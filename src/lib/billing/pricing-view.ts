/**
 * The price list, as the public pages need it.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE YEARLY SAVING IS COMPUTED, NOT TYPED IN
 *
 * "Ušetříte 2 388 Kč" is a number somebody would otherwise put in a CMS
 * field, and the day a price changes it becomes a false claim about money on
 * a commercial page. So it is derived from the two prices that are actually
 * charged: twelve monthly payments minus one yearly payment, in minor units,
 * with no division until the string is formatted.
 *
 * If either price is missing there is no saving to state, and the function
 * returns null rather than zero. "Ušetříte 0 Kč" is worse than silence.
 *
 * A NEGATIVE saving is returned as-is rather than clamped. If the yearly
 * price is ever set above twelve monthlies that is a pricing mistake, and the
 * page showing "ušetříte −200 Kč" is how it gets found — whereas a `max(0, …)`
 * would hide it and keep selling the worse deal as a discount.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * MINOR UNITS ALL THE WAY THROUGH
 *
 * Integers, named with the `Minor` suffix, per the project rule. The only
 * division happens inside `formatMinorAmount` at the edge.
 */
import {
  type BillingInterval,
  type Currency,
  type FeatureKey,
  type PlanCode,
} from './constants.ts'

export type TierPrice = {
  interval: BillingInterval
  amountMinor: number
  currency: Currency
  /** The provider's price id, for the checkout route step 7 owns. */
  providerPriceId: string | null
}

export type TierView = {
  code: PlanCode
  name: string
  description: string | null
  sortOrder: number
  features: readonly FeatureKey[]
  monthly: TierPrice | null
  yearly: TierPrice | null
}

/**
 * Twelve monthly payments minus one yearly, in minor units.
 *
 * Null when either price is missing — see the header.
 */
export const yearlySavingMinor = (tier: TierView): number | null => {
  if (!tier.monthly || !tier.yearly) {
    return null
  }

  if (tier.monthly.currency !== tier.yearly.currency) {
    // Two currencies cannot be subtracted. Returning a number here would be
    // a figure with no meaning presented as a saving.
    return null
  }

  return tier.monthly.amountMinor * 12 - tier.yearly.amountMinor
}

/**
 * What a yearly subscription works out at per month, in minor units.
 *
 * Integer division with rounding half away from zero, so the figure matches
 * the project's one rounding rule rather than JavaScript's default
 * round-half-up — which drifts in our favour over a long list of prices.
 */
export const yearlyPerMonthMinor = (tier: TierView): number | null => {
  if (!tier.yearly) return null

  const amount = tier.yearly.amountMinor
  const sign = amount < 0 ? -1 : 1
  const magnitude = Math.abs(amount)

  return sign * Math.floor((magnitude + 6) / 12)
}

/** Which tier carries the "Doporučujeme" badge. */
export const RECOMMENDED_PLAN: PlanCode = 'PRO'

export const isRecommended = (code: PlanCode): boolean =>
  code === RECOMMENDED_PLAN
