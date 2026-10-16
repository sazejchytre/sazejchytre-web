/**
 * Translating Stripe objects into our domain types.
 *
 * Split out from `adapter.ts` for a concrete reason, not tidiness: the adapter
 * constructs an SDK client and therefore imports the environment schema, and
 * the webhook handler needs this translation too. Leaving it in the adapter
 * meant the webhook tests could not run without a full environment — which
 * would have made the one part of this module that is pure, deterministic and
 * worth testing exhaustively the part that needed credentials to test.
 *
 * Nothing here does I/O, reads configuration or looks at a clock it was not
 * given.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE FIELD THAT MOVED
 *
 * `current_period_start` / `current_period_end` are NOT on the Stripe
 * Subscription object in API version `2026-09-30.endive`. They are on each
 * subscription item. Code written against an older version reads them off the
 * subscription, gets `undefined`, and stores an Invalid Date — a subscription
 * that grants access until never, or forever, depending on which way the
 * comparison falls. It does not throw, and it does not log.
 */
import type Stripe from 'stripe'

import {
  CURRENCIES,
  type BillingInterval,
  type Currency,
} from '../constants.ts'
import type { ProviderSubscription } from '../port.ts'
import { mapStripeSubscriptionStatus } from './status.ts'

const PROVIDER = 'STRIPE' as const

/* -------------------------------------------------------------------------- */
/* Ordering clock                                                             */
/* -------------------------------------------------------------------------- */

let lastSequence = 0

/**
 * Milliseconds, guaranteed to advance between calls.
 *
 * `ProviderSubscription.sequence` says a fresh read is as-of now. Two reads
 * inside the same millisecond would otherwise tie, and the contract requires
 * strict advance, so the clock is clamped forward. Still a wall-clock value,
 * so it remains comparable with webhook event timestamps.
 */
export const monotonicNow = (): number => {
  lastSequence = Math.max(Date.now(), lastSequence + 1)

  return lastSequence
}

/* -------------------------------------------------------------------------- */
/* Translation helpers                                                        */
/* -------------------------------------------------------------------------- */

/** Stripe's lower-case currency into ours, or null if we do not sell in it. */
export const toCurrency = (providerCurrency: string): Currency | null => {
  const upper = providerCurrency.toUpperCase()

  return (CURRENCIES as readonly string[]).includes(upper)
    ? (upper as Currency)
    : null
}

/** Stripe's recurring interval into ours. */
const toInterval = (
  recurring: Stripe.Price.Recurring | null,
): BillingInterval | null => {
  if (!recurring) return null

  if (recurring.interval === 'month' && recurring.interval_count === 1) {
    return 'MONTH'
  }

  if (recurring.interval === 'year' && recurring.interval_count === 1) {
    return 'YEAR'
  }

  // Weekly, daily or every-three-months prices exist in Stripe and have no
  // home in our model. Refusing is better than rounding one into a month.
  return null
}

const toDate = (epochSeconds: number): Date => new Date(epochSeconds * 1000)

const toDateOrNull = (epochSeconds: number | null): Date | null =>
  epochSeconds === null ? null : toDate(epochSeconds)

/**
 * The single subscription item we expect.
 *
 * Our plans are one price per subscription. A multi-item subscription can
 * only have been built by hand in the dashboard, and guessing which item is
 * "the" plan would silently bill somebody for the wrong one.
 */
export const soleItem = (
  subscription: Stripe.Subscription,
): Stripe.SubscriptionItem | null => {
  const items = subscription.items?.data ?? []

  return items.length === 1 ? (items[0] ?? null) : null
}

/**
 * A Stripe subscription in our vocabulary.
 *
 * Returns null when the object cannot be translated faithfully — an unknown
 * currency, an interval we do not sell, more than one item. The caller turns
 * that into a failure rather than storing a half-understood subscription,
 * because a subscription row with a wrong period or currency is worse than
 * no row at all: it grants or denies access on bad data.
 */
export const toProviderSubscription = (
  subscription: Stripe.Subscription,
  asOf: number = monotonicNow(),
): ProviderSubscription | null => {
  const item = soleItem(subscription)

  if (!item) return null

  const currency = toCurrency(subscription.currency)
  const interval = toInterval(item.price.recurring)

  if (!currency || !interval) return null

  // THE MOVED FIELDS. `subscription.current_period_end` does not exist in this
  // API version; reading it would yield undefined and produce an Invalid Date,
  // i.e. a subscription that grants access until never (or forever, depending
  // on which way the comparison falls).
  const { current_period_start: periodStart, current_period_end: periodEnd } =
    item

  if (
    typeof periodStart !== 'number' ||
    typeof periodEnd !== 'number' ||
    !Number.isFinite(periodStart) ||
    !Number.isFinite(periodEnd)
  ) {
    return null
  }

  const mapped = mapStripeSubscriptionStatus(subscription.status)

  return {
    provider: PROVIDER,
    providerSubscriptionId: subscription.id,
    status: mapped.status,
    currency,
    interval,
    priceMinor: item.price.unit_amount ?? 0,
    providerPriceId: item.price.id,
    currentPeriodStart: toDate(periodStart),
    currentPeriodEnd: toDate(periodEnd),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    canceledAt: toDateOrNull(subscription.canceled_at),
    endedAt: toDateOrNull(subscription.ended_at),
    sequence: asOf,
  }
}
