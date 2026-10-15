/**
 * Loads the data that `resolveEntitlements` reasons over.
 *
 * This is the impure half of entitlement resolution, kept separate on purpose:
 * all the decisions live in `src/lib/entitlements.ts`, which is pure and
 * exhaustively testable, and everything that touches the database lives here,
 * where there is nothing to decide.
 *
 * It loads deliberately broadly — every subscription and every grant for the
 * customer, not only the ones that look current. Filtering in the query would
 * put the access rules in two places, and the SQL version would be the one
 * nobody tests. The volume per customer is a handful of rows.
 */
import type { Payload, PayloadRequest } from 'payload'

import type {
  CustomerEntitlementState,
  GrantEntitlementSnapshot,
  SubscriptionEntitlementSnapshot,
} from '../entitlements.ts'
import { resolveEntitlements } from '../entitlements.ts'
import type { FeatureKey, SubscriptionStatus } from './constants.ts'

/** A relationship arrives either as an id or as a populated document. */
const planFeaturesOf = (plan: unknown): readonly FeatureKey[] => {
  if (typeof plan !== 'object' || plan === null) {
    // Not populated: the caller asked for too shallow a depth. Returning an
    // empty list here would silently deny access, so fail loudly instead.
    throw new Error(
      'Entitlement loading requires the plan relationship to be populated (depth >= 1).',
    )
  }

  const features = (plan as { features?: unknown }).features

  return Array.isArray(features) ? (features as FeatureKey[]) : []
}

export type LoadEntitlementStateArgs = {
  payload: Payload
  customerId: string | number
  req?: PayloadRequest
}

/** Fetch every subscription and grant for a customer, shaped for the resolver. */
export const loadCustomerEntitlementState = async ({
  payload,
  customerId,
  req,
}: LoadEntitlementStateArgs): Promise<CustomerEntitlementState> => {
  // `req` is spread conditionally rather than passed as `undefined`:
  // exactOptionalPropertyTypes treats an explicit `undefined` as a different
  // thing from an absent key, and Payload's options type only allows absence.
  const reqOption = req ? { req } : {}

  const [subscriptions, grants] = await Promise.all([
    payload.find({
      collection: 'subscriptions',
      // depth 1 populates `plan`, which carries the feature list.
      depth: 1,
      limit: 0,
      pagination: false,
      overrideAccess: true,
      ...reqOption,
      where: { customer: { equals: customerId } },
    }),
    payload.find({
      collection: 'entitlement-grants',
      depth: 1,
      limit: 0,
      pagination: false,
      overrideAccess: true,
      ...reqOption,
      where: { customer: { equals: customerId } },
    }),
  ])

  const subscriptionSnapshots: SubscriptionEntitlementSnapshot[] =
    subscriptions.docs.map((doc) => ({
      status: doc.status as SubscriptionStatus,
      currentPeriodStart: doc.currentPeriodStart ?? null,
      currentPeriodEnd: doc.currentPeriodEnd ?? null,
      planFeatures: planFeaturesOf(doc.plan),
    }))

  const grantSnapshots: GrantEntitlementSnapshot[] = grants.docs.map((doc) => ({
    // A grant names a single feature or a whole plan; flatten both to a list
    // so the resolver never has to know which form was used.
    features: doc.featureKey
      ? [doc.featureKey as FeatureKey]
      : planFeaturesOf(doc.plan),
    startsAt: doc.startsAt ?? null,
    endsAt: doc.endsAt ?? null,
    revokedAt: doc.revokedAt ?? null,
  }))

  return { subscriptions: subscriptionSnapshots, grants: grantSnapshots }
}

export type GetCustomerEntitlementsArgs = LoadEntitlementStateArgs & {
  /** Injected clock. Defaults to now. */
  now?: Date
}

/**
 * What this customer can access right now.
 *
 * Thin composition of the loader and the pure resolver — the convenience form
 * application code should call.
 */
export const getCustomerEntitlements = async ({
  now = new Date(),
  ...args
}: GetCustomerEntitlementsArgs): Promise<Set<FeatureKey>> =>
  resolveEntitlements(await loadCustomerEntitlementState(args), now)
