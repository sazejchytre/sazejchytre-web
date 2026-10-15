import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { FeatureKey } from './billing/constants.ts'
import type {
  CustomerEntitlementState,
  GrantEntitlementSnapshot,
  SubscriptionEntitlementSnapshot,
} from './entitlements.ts'
import {
  hasFeature,
  isGrantActiveAt,
  isSubscriptionActiveAt,
  resolveEntitlements,
} from './entitlements.ts'

/**
 * These assertions are the actual definition of "what has this customer paid
 * for". Entitlement is derived here and nowhere else — the payment provider is
 * never consulted — so a regression in this file is a regression in who can
 * read paid content.
 *
 * Time is injected everywhere; nothing below depends on the real clock.
 */

const NOW = new Date('2026-06-15T12:00:00.000Z')
const d = (iso: string) => new Date(iso)

const PRO_FEATURES: FeatureKey[] = [
  'TIPS_REALTIME',
  'VALUE_RATING',
  'FULL_RATIONALE',
]

const subscription = (
  overrides: Partial<SubscriptionEntitlementSnapshot> = {},
): SubscriptionEntitlementSnapshot => ({
  status: 'ACTIVE',
  currentPeriodStart: d('2026-06-01T00:00:00.000Z'),
  currentPeriodEnd: d('2026-07-01T00:00:00.000Z'),
  planFeatures: PRO_FEATURES,
  ...overrides,
})

const grant = (
  overrides: Partial<GrantEntitlementSnapshot> = {},
): GrantEntitlementSnapshot => ({
  features: ['API_ACCESS'],
  startsAt: d('2026-06-01T00:00:00.000Z'),
  endsAt: null,
  revokedAt: null,
  ...overrides,
})

const state = (
  parts: Partial<CustomerEntitlementState> = {},
): CustomerEntitlementState => ({
  subscriptions: [],
  grants: [],
  ...parts,
})

const sorted = (features: Set<FeatureKey>): FeatureKey[] => [...features].sort()

describe('resolveEntitlements — subscriptions', () => {
  it('an active subscription grants exactly its plan features', () => {
    const result = resolveEntitlements(
      state({ subscriptions: [subscription()] }),
      NOW,
    )

    assert.deepEqual(sorted(result), [...PRO_FEATURES].sort())
  })

  it('a customer with nothing gets nothing', () => {
    assert.equal(resolveEntitlements(state(), NOW).size, 0)
  })

  it('an expired subscription grants nothing', () => {
    const expired = subscription({
      status: 'EXPIRED',
      currentPeriodStart: d('2026-04-01T00:00:00.000Z'),
      currentPeriodEnd: d('2026-05-01T00:00:00.000Z'),
    })

    assert.equal(
      resolveEntitlements(state({ subscriptions: [expired] }), NOW).size,
      0,
    )
  })

  it('an ACTIVE subscription whose period has elapsed grants nothing', () => {
    // A missed renewal webhook must fail closed: the period window is the
    // authority, not the status column.
    const stale = subscription({
      status: 'ACTIVE',
      currentPeriodStart: d('2026-04-01T00:00:00.000Z'),
      currentPeriodEnd: d('2026-05-01T00:00:00.000Z'),
    })

    assert.equal(
      resolveEntitlements(state({ subscriptions: [stale] }), NOW).size,
      0,
    )
  })

  it('a subscription whose period has not started grants nothing', () => {
    const future = subscription({
      currentPeriodStart: d('2026-07-01T00:00:00.000Z'),
      currentPeriodEnd: d('2026-08-01T00:00:00.000Z'),
    })

    assert.equal(
      resolveEntitlements(state({ subscriptions: [future] }), NOW).size,
      0,
    )
  })

  it('INCOMPLETE grants nothing — payment has not succeeded', () => {
    assert.equal(
      resolveEntitlements(
        state({ subscriptions: [subscription({ status: 'INCOMPLETE' })] }),
        NOW,
      ).size,
      0,
    )
  })

  it('CANCELED grants nothing', () => {
    assert.equal(
      resolveEntitlements(
        state({ subscriptions: [subscription({ status: 'CANCELED' })] }),
        NOW,
      ).size,
      0,
    )
  })

  it('PAST_DUE keeps access until currentPeriodEnd', () => {
    const pastDue = subscription({ status: 'PAST_DUE' })

    // Inside the paid period: the customer already paid for this period, so a
    // failed *renewal* must not retroactively take it away.
    assert.deepEqual(
      sorted(resolveEntitlements(state({ subscriptions: [pastDue] }), NOW)),
      [...PRO_FEATURES].sort(),
    )

    // Exactly at the boundary: still inside.
    assert.equal(
      resolveEntitlements(
        state({ subscriptions: [pastDue] }),
        d('2026-07-01T00:00:00.000Z'),
      ).size,
      PRO_FEATURES.length,
    )

    // One millisecond past the end: access stops.
    assert.equal(
      resolveEntitlements(
        state({ subscriptions: [pastDue] }),
        d('2026-07-01T00:00:00.001Z'),
      ).size,
      0,
    )
  })

  it('a subscription with no period end grants nothing', () => {
    const noEnd = subscription({ currentPeriodEnd: null })

    assert.equal(
      resolveEntitlements(state({ subscriptions: [noEnd] }), NOW).size,
      0,
    )
  })

  it('unions the features of several active subscriptions', () => {
    const result = resolveEntitlements(
      state({
        subscriptions: [
          subscription({ planFeatures: ['TIPS_REALTIME'] }),
          subscription({ planFeatures: ['API_ACCESS'] }),
        ],
      }),
      NOW,
    )

    assert.deepEqual(sorted(result), ['API_ACCESS', 'TIPS_REALTIME'])
  })

  it('accepts ISO strings as well as Date objects', () => {
    const result = resolveEntitlements(
      state({
        subscriptions: [
          subscription({
            currentPeriodStart: '2026-06-01T00:00:00.000Z',
            currentPeriodEnd: '2026-07-01T00:00:00.000Z',
          }),
        ],
      }),
      NOW,
    )

    assert.equal(result.size, PRO_FEATURES.length)
  })

  it('throws on an unparseable timestamp rather than guessing', () => {
    assert.throws(
      () =>
        resolveEntitlements(
          state({
            subscriptions: [subscription({ currentPeriodEnd: 'not-a-date' })],
          }),
          NOW,
        ),
      /Invalid timestamp/,
    )
  })
})

describe('resolveEntitlements — manual grants', () => {
  it('a grant extends what a subscription provides', () => {
    const result = resolveEntitlements(
      state({ subscriptions: [subscription()], grants: [grant()] }),
      NOW,
    )

    assert.deepEqual(sorted(result), [...PRO_FEATURES, 'API_ACCESS'].sort())
  })

  it('a grant alone is enough, with no subscription at all', () => {
    const result = resolveEntitlements(state({ grants: [grant()] }), NOW)

    assert.deepEqual(sorted(result), ['API_ACCESS'])
  })

  it('a revoked grant does not grant', () => {
    const revoked = grant({ revokedAt: d('2026-06-10T00:00:00.000Z') })

    assert.equal(resolveEntitlements(state({ grants: [revoked] }), NOW).size, 0)
  })

  it('revocation wins even inside an open window', () => {
    const revoked = grant({
      startsAt: d('2026-01-01T00:00:00.000Z'),
      endsAt: d('2026-12-31T00:00:00.000Z'),
      revokedAt: d('2026-06-01T00:00:00.000Z'),
    })

    assert.equal(resolveEntitlements(state({ grants: [revoked] }), NOW).size, 0)
  })

  it('a revocation dated in the future has not taken effect yet', () => {
    const pending = grant({ revokedAt: d('2026-07-01T00:00:00.000Z') })

    assert.deepEqual(
      sorted(resolveEntitlements(state({ grants: [pending] }), NOW)),
      ['API_ACCESS'],
    )
  })

  it('an expired grant does not grant', () => {
    const expired = grant({ endsAt: d('2026-06-01T00:00:00.000Z') })

    assert.equal(resolveEntitlements(state({ grants: [expired] }), NOW).size, 0)
  })

  it('a not-yet-started grant does not grant', () => {
    const future = grant({ startsAt: d('2026-07-01T00:00:00.000Z') })

    assert.equal(resolveEntitlements(state({ grants: [future] }), NOW).size, 0)
  })

  it('an open-ended grant still applies', () => {
    assert.deepEqual(
      sorted(
        resolveEntitlements(state({ grants: [grant({ endsAt: null })] }), NOW),
      ),
      ['API_ACCESS'],
    )
  })

  it('a plan-shaped grant contributes the whole feature list', () => {
    const planGrant = grant({ features: PRO_FEATURES })

    assert.deepEqual(
      sorted(resolveEntitlements(state({ grants: [planGrant] }), NOW)),
      [...PRO_FEATURES].sort(),
    )
  })

  it('a revoked grant does not remove what a subscription already provides', () => {
    // Grants are additive only: there is no "deny" grant, so revoking one must
    // never take away access that comes from a paid subscription.
    const result = resolveEntitlements(
      state({
        subscriptions: [subscription()],
        grants: [
          grant({
            features: ['FULL_RATIONALE'],
            revokedAt: d('2026-06-02T00:00:00.000Z'),
          }),
        ],
      }),
      NOW,
    )

    assert.ok(result.has('FULL_RATIONALE'))
  })
})

describe('predicate helpers', () => {
  it('isSubscriptionActiveAt matches resolveEntitlements', () => {
    assert.equal(isSubscriptionActiveAt(subscription(), NOW), true)
    assert.equal(
      isSubscriptionActiveAt(subscription({ status: 'CANCELED' }), NOW),
      false,
    )
  })

  it('isGrantActiveAt matches resolveEntitlements', () => {
    assert.equal(isGrantActiveAt(grant(), NOW), true)
    assert.equal(
      isGrantActiveAt(grant({ revokedAt: d('2026-01-01T00:00:00.000Z') }), NOW),
      false,
    )
  })

  it('hasFeature answers for one key', () => {
    const customer = state({ subscriptions: [subscription()] })

    assert.equal(hasFeature(customer, 'FULL_RATIONALE', NOW), true)
    assert.equal(hasFeature(customer, 'API_ACCESS', NOW), false)
  })
})
