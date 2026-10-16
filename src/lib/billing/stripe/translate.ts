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
import { FIELD_RELOCATION_VERSION } from './api-version.ts'
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

/* -------------------------------------------------------------------------- */
/* Why a translation failed                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Why a Stripe subscription could not become one of ours.
 *
 * Split into two kinds, and that distinction is the whole point of this type:
 *
 *   NOT OURS — the payload was read perfectly well and describes a
 *   subscription we do not sell. A USD subscription from `stripe trigger`, a
 *   weekly price, a hand-built multi-item subscription, another integration
 *   sharing the account. Refusing is CORRECT and uninteresting: no alert, no
 *   investigation.
 *
 *   UNREADABLE — the payload is not shaped the way this code reads it. Almost
 *   always an API version mismatch, because the period fields moved in
 *   `2025-03-31.basil` and a payload rendered before that keeps them
 *   elsewhere. This is a real fault, it affects EVERY subscription, and it
 *   needs an alert.
 *
 * These two used to share one reason string, which made a correct refusal and
 * a broken integration look identical in the log. They must never share one
 * again.
 */
export const SUBSCRIPTION_NOT_OURS_REASONS = [
  'NOT_OURS_CURRENCY',
  'NOT_OURS_INTERVAL',
  'NOT_OURS_MULTIPLE_ITEMS',
] as const

export const SUBSCRIPTION_UNREADABLE_REASONS = [
  /** No items at all — not a shape Stripe produces for a real subscription. */
  'UNREADABLE_NO_ITEMS',
  /**
   * The period fields are not where this code reads them.
   *
   * THE VERSION-MISMATCH SIGNATURE. Compare the event's `api_version` with
   * `FIELD_RELOCATION_VERSION`.
   */
  'UNREADABLE_PERIOD_FIELDS',
] as const

export type SubscriptionNotOursReason =
  (typeof SUBSCRIPTION_NOT_OURS_REASONS)[number]
export type SubscriptionUnreadableReason =
  (typeof SUBSCRIPTION_UNREADABLE_REASONS)[number]
export type SubscriptionTranslationReason =
  SubscriptionNotOursReason | SubscriptionUnreadableReason

/**
 * Does this reason mean the payload itself could not be read?
 *
 * Takes a plain string so a caller holding a reason of unknown provenance —
 * the webhook outcome, a log line, a test fixture — can ask without a cast.
 */
export const isUnreadableReason = (reason: string): boolean =>
  (SUBSCRIPTION_UNREADABLE_REASONS as readonly string[]).includes(reason)

export type SubscriptionTranslation =
  | { ok: true; value: ProviderSubscription }
  | {
      ok: false
      reason: SubscriptionTranslationReason
      /**
       * The specifics, for the log line. Safe to log: statuses, currencies,
       * intervals and counts — never a secret.
       */
      detail: Record<string, unknown>
    }

/**
 * A Stripe subscription in our vocabulary, with a reason when it cannot be.
 *
 * The caller refuses rather than storing a half-understood subscription,
 * because a row with a wrong period or currency is worse than no row at all:
 * it grants or denies access on bad data.
 *
 * Checks are ordered so the most alarming explanation wins. The period fields
 * are validated BEFORE the currency, so a pre-relocation payload that also
 * happens to be in a currency we do not sell reports the version problem
 * rather than the harmless one.
 */
export const translateSubscription = (
  subscription: Stripe.Subscription,
  asOf: number = monotonicNow(),
): SubscriptionTranslation => {
  const items = subscription.items?.data ?? []

  if (items.length === 0) {
    return { ok: false, reason: 'UNREADABLE_NO_ITEMS', detail: {} }
  }

  if (items.length > 1) {
    // Guessing which item is "the" plan would silently bill somebody for the
    // wrong one. Our plans are always one price per subscription.
    return {
      ok: false,
      reason: 'NOT_OURS_MULTIPLE_ITEMS',
      detail: { itemCount: items.length },
    }
  }

  const item = items[0] as Stripe.SubscriptionItem

  // THE MOVED FIELDS, checked first. From `2025-03-31.basil` onwards these
  // live on the item; a payload older than that keeps them on the
  // subscription, and reading the item then yields undefined rather than an
  // error. That is the case this guard exists to name.
  const { current_period_start: periodStart, current_period_end: periodEnd } =
    item

  if (
    typeof periodStart !== 'number' ||
    typeof periodEnd !== 'number' ||
    !Number.isFinite(periodStart) ||
    !Number.isFinite(periodEnd)
  ) {
    return {
      ok: false,
      reason: 'UNREADABLE_PERIOD_FIELDS',
      detail: {
        // This pair IS the diagnosis. If the period is on the subscription
        // instead, the payload predates the field move and the endpoint or
        // account version is the thing to fix.
        periodOnItem: false,
        periodOnSubscriptionInstead:
          typeof (subscription as { current_period_end?: unknown })
            .current_period_end === 'number',
        fieldsMovedIn: FIELD_RELOCATION_VERSION,
      },
    }
  }

  const currency = toCurrency(subscription.currency)

  if (!currency) {
    return {
      ok: false,
      reason: 'NOT_OURS_CURRENCY',
      detail: { currency: subscription.currency, weSell: [...CURRENCIES] },
    }
  }

  const interval = toInterval(item.price.recurring)

  if (!interval) {
    return {
      ok: false,
      reason: 'NOT_OURS_INTERVAL',
      detail: {
        interval: item.price.recurring?.interval ?? null,
        intervalCount: item.price.recurring?.interval_count ?? null,
      },
    }
  }

  const mapped = mapStripeSubscriptionStatus(subscription.status)

  return {
    ok: true,
    value: {
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
    },
  }
}

/**
 * The same translation, reduced to a value or null.
 *
 * For the adapter, which is making an outbound call it controls: that payload
 * is rendered at OUR pinned version, so an unreadable one would be a bug in
 * this file rather than a configuration problem, and the adapter has its own
 * failure codes to return. The webhook handler uses `translateSubscription`
 * instead, because there the version is not ours to control.
 */
export const toProviderSubscription = (
  subscription: Stripe.Subscription,
  asOf: number = monotonicNow(),
): ProviderSubscription | null => {
  const translated = translateSubscription(subscription, asOf)

  return translated.ok ? translated.value : null
}
