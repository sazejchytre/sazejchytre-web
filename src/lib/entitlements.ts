/**
 * Entitlement resolution.
 *
 * ENTITLEMENT IS DERIVED FROM OUR DATABASE, NEVER FROM THE PAYMENT PROVIDER.
 * The provider is authoritative about whether money moved. What that money
 * buys is our decision, and this file is where it is made. A provider outage,
 * a webhook we have not processed yet, or a provider-side data edit must never
 * silently change what a customer can see.
 *
 * `resolveEntitlements` is pure: no I/O, no clock, no network. Time is always
 * injected. It takes a *snapshot* of the customer's subscriptions and grants
 * rather than a customer id, which is what makes it exhaustively testable —
 * loading that snapshot is a separate, impure concern (see
 * `./billing/entitlement-loader.ts`).
 */
import {
  ACCESS_GRANTING_STATUSES,
  type FeatureKey,
  type SubscriptionStatus,
} from './billing/constants.ts'

/** Anything we are willing to read a timestamp from. */
export type TimeInput = Date | string | number

/**
 * The part of a subscription that decides access.
 *
 * `planFeatures` is resolved by the caller from the subscription's plan. It is
 * passed in rather than looked up so that this module never needs the plan
 * table — and so a test can state the feature set directly.
 */
export type SubscriptionEntitlementSnapshot = {
  status: SubscriptionStatus
  currentPeriodStart: TimeInput | null
  currentPeriodEnd: TimeInput | null
  planFeatures: readonly FeatureKey[]
}

/**
 * The part of a manual grant that decides access.
 *
 * A grant names either a single feature or a plan; by the time it reaches here
 * both have been flattened to a feature list.
 */
export type GrantEntitlementSnapshot = {
  features: readonly FeatureKey[]
  startsAt: TimeInput | null
  /** `null` means open-ended. */
  endsAt: TimeInput | null
  /** Non-null and in the past means the grant no longer counts. */
  revokedAt: TimeInput | null
}

/**
 * A reason to withhold everything, regardless of subscriptions and grants.
 *
 * Exists for chargebacks. When a customer disputes a payment, the money is
 * being taken back from us by their bank, and the usual sequence is that the
 * subscription still looks perfectly ACTIVE while that happens — the dispute
 * is a fact about a charge, not about the subscription. Waiting for the
 * subscription status to catch up means serving paid content to somebody who
 * has already reversed the payment, for however long the dispute takes to
 * resolve, which is weeks.
 *
 * So a suspension overrides, rather than joining, the additive logic below.
 */
export type EntitlementSuspensionSnapshot = {
  /** Recorded for the audit trail; not used in the decision. */
  reason: string
  startsAt: TimeInput
  /** `null` while still in force. */
  endsAt: TimeInput | null
}

export type CustomerEntitlementState = {
  subscriptions: readonly SubscriptionEntitlementSnapshot[]
  grants: readonly GrantEntitlementSnapshot[]
  /**
   * Optional so that every existing caller and test still compiles. Absent
   * means "none", which is the honest reading of a snapshot taken before
   * suspensions existed.
   */
  suspensions?: readonly EntitlementSuspensionSnapshot[]
}

/**
 * Convert an input to epoch milliseconds, or `null` if absent.
 *
 * An unparseable value is a data defect, not a reason to guess. Guessing in
 * either direction is wrong: guess "granted" and we leak paid content, guess
 * "denied" and we lock out a paying customer while hiding the cause.
 */
const toTime = (value: TimeInput | null | undefined): number | null => {
  if (value === null || value === undefined) {
    return null
  }

  const time =
    value instanceof Date ? value.getTime() : new Date(value).getTime()

  if (Number.isNaN(time)) {
    throw new TypeError(
      `Invalid timestamp in entitlement input: ${String(value)}`,
    )
  }

  return time
}

/**
 * Is this subscription granting access at `now`?
 *
 * Both ends are inclusive. A subscription whose period has not started yet
 * grants nothing, and one whose period has elapsed grants nothing even if the
 * status has not been reconciled to EXPIRED yet — the period window is the
 * authority, so a missed renewal webhook fails closed.
 */
export const isSubscriptionActiveAt = (
  subscription: SubscriptionEntitlementSnapshot,
  now: Date,
): boolean => {
  if (!ACCESS_GRANTING_STATUSES.includes(subscription.status)) {
    return false
  }

  const nowTime = now.getTime()
  const start = toTime(subscription.currentPeriodStart)
  const end = toTime(subscription.currentPeriodEnd)

  // Without a period we cannot prove the customer paid for right now.
  if (end === null) {
    return false
  }

  if (start !== null && nowTime < start) {
    return false
  }

  return nowTime <= end
}

/**
 * Is this suspension in force at `now`?
 *
 * Starts inclusively and, unlike a subscription period, ends EXCLUSIVELY: a
 * dispute resolved in our favour at 14:00 should restore access at 14:00, not
 * leave the customer locked out for one more millisecond.
 */
export const isSuspensionActiveAt = (
  suspension: EntitlementSuspensionSnapshot,
  now: Date,
): boolean => {
  const nowTime = now.getTime()
  const start = toTime(suspension.startsAt)

  if (start === null || nowTime < start) {
    return false
  }

  const end = toTime(suspension.endsAt)

  return end === null || nowTime < end
}

/** Is anything withholding this customer's access outright? */
export const isSuspendedAt = (
  customer: CustomerEntitlementState,
  now: Date,
): boolean =>
  (customer.suspensions ?? []).some((suspension) =>
    isSuspensionActiveAt(suspension, now),
  )

/** Is this manual grant in force at `now`? */
export const isGrantActiveAt = (
  grant: GrantEntitlementSnapshot,
  now: Date,
): boolean => {
  const nowTime = now.getTime()
  const revokedAt = toTime(grant.revokedAt)

  // Revocation wins over any window.
  if (revokedAt !== null && revokedAt <= nowTime) {
    return false
  }

  const startsAt = toTime(grant.startsAt)

  if (startsAt !== null && nowTime < startsAt) {
    return false
  }

  const endsAt = toTime(grant.endsAt)

  if (endsAt !== null && nowTime > endsAt) {
    return false
  }

  return true
}

/**
 * Everything this customer can access at `now`.
 *
 * The union of the features of every access-granting subscription and every
 * in-force manual grant. Grants are additive — support can top up a plan
 * without changing the subscription.
 *
 * @param customer snapshot of the customer's subscriptions and grants
 * @param now injected clock
 */
export const resolveEntitlements = (
  customer: CustomerEntitlementState,
  now: Date,
): Set<FeatureKey> => {
  // Checked first and short-circuiting: a suspension is not one more input to
  // the union, it is a veto. Folding it in alongside subscriptions and grants
  // would mean a manual grant could out-vote a chargeback.
  if (isSuspendedAt(customer, now)) {
    return new Set<FeatureKey>()
  }

  const features = new Set<FeatureKey>()

  for (const subscription of customer.subscriptions) {
    if (isSubscriptionActiveAt(subscription, now)) {
      for (const feature of subscription.planFeatures) {
        features.add(feature)
      }
    }
  }

  for (const grant of customer.grants) {
    if (isGrantActiveAt(grant, now)) {
      for (const feature of grant.features) {
        features.add(feature)
      }
    }
  }

  return features
}

/** Convenience predicate over `resolveEntitlements`. */
export const hasFeature = (
  customer: CustomerEntitlementState,
  feature: FeatureKey,
  now: Date,
): boolean => resolveEntitlements(customer, now).has(feature)
