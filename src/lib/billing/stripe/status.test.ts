/**
 * The status mapping, and — more importantly — that it agrees with the
 * entitlement resolver written in step 2.
 *
 * The two were written weeks apart against the same prose rule ("PAST_DUE
 * keeps entitlements until currentPeriodEnd"). Prose is not a test. If the
 * table here and `isSubscriptionActiveAt` ever disagree, the outcome is
 * either a customer locked out of a period they paid for or a customer
 * getting a free month, and neither of those shows up in a type check or in
 * any test that exercises only one of the two files.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { ACCESS_GRANTING_STATUSES } from '../constants.ts'
import { isSubscriptionActiveAt } from '../../entitlements.ts'
import {
  STRIPE_STATUS_MAP,
  STRIPE_SUBSCRIPTION_STATUSES,
  type StripeSubscriptionStatus,
  mapStripeSubscriptionStatus,
} from './status.ts'

/**
 * The "Grants access?" column of the table in `status.ts`, transcribed.
 *
 * Deliberately written out by hand rather than derived from
 * `ACCESS_GRANTING_STATUSES`. Deriving it would make this test agree with the
 * code by construction and prove nothing; stating the intended answer
 * independently is what makes a disagreement visible.
 */
const GRANTS_ACCESS_WITHIN_PERIOD: Readonly<
  Record<StripeSubscriptionStatus, boolean>
> = {
  incomplete: false,
  incomplete_expired: false,
  trialing: true,
  active: true,
  past_due: true,
  unpaid: true,
  paused: true,
  canceled: false,
}

const PERIOD_START = new Date('2026-03-01T00:00:00.000Z')
const PERIOD_END = new Date('2026-04-01T00:00:00.000Z')
const WITHIN_PERIOD = new Date('2026-03-15T12:00:00.000Z')
const AFTER_PERIOD = new Date('2026-04-02T00:00:00.000Z')

const snapshotFor = (providerStatus: string) => ({
  status: mapStripeSubscriptionStatus(providerStatus).status,
  currentPeriodStart: PERIOD_START,
  currentPeriodEnd: PERIOD_END,
  planFeatures: [] as const,
})

describe('Stripe subscription status mapping', () => {
  it('maps every status Stripe documents', () => {
    for (const providerStatus of STRIPE_SUBSCRIPTION_STATUSES) {
      const mapped = mapStripeSubscriptionStatus(providerStatus)

      assert.equal(mapped.unknown, false, providerStatus)
      assert.equal(
        mapped.status,
        STRIPE_STATUS_MAP[providerStatus],
        providerStatus,
      )
    }
  })

  it('fails closed on a status Stripe has not invented yet', () => {
    const mapped = mapStripeSubscriptionStatus('quantum_superposition')

    assert.equal(mapped.unknown, true)
    // Not ACTIVE. A status we have never seen must not grant access, and a
    // throw here would make the webhook return 500 and retry for days.
    assert.equal(mapped.status, 'INCOMPLETE')
    assert.equal(
      ACCESS_GRANTING_STATUSES.includes(mapped.status),
      false,
      'an unrecognised provider status granted access',
    )
  })

  it('flags paused as unexpected without failing', () => {
    // We never pause a subscription, so one can only come from a dashboard
    // action. Worth a log line, not worth a 500.
    const mapped = mapStripeSubscriptionStatus('paused')

    assert.equal(mapped.unexpected, true)
    assert.equal(mapped.unknown, false)
  })

  describe('agreement with the entitlement resolver', () => {
    it('grants exactly what the documented table says, inside the period', () => {
      for (const providerStatus of STRIPE_SUBSCRIPTION_STATUSES) {
        assert.equal(
          isSubscriptionActiveAt(snapshotFor(providerStatus), WITHIN_PERIOD),
          GRANTS_ACCESS_WITHIN_PERIOD[providerStatus],
          `${providerStatus} -> ${STRIPE_STATUS_MAP[providerStatus]} disagrees with the table in status.ts`,
        )
      }
    })

    it('grants nothing once the period has elapsed, whatever the status', () => {
      for (const providerStatus of STRIPE_SUBSCRIPTION_STATUSES) {
        assert.equal(
          isSubscriptionActiveAt(snapshotFor(providerStatus), AFTER_PERIOD),
          false,
          `${providerStatus} still granted access after currentPeriodEnd`,
        )
      }
    })

    it('keeps PAST_DUE entitlements to the last instant of the period', () => {
      // This is the rule that matters most and the one easiest to get wrong
      // in either direction: cut access the moment a renewal fails and we
      // punish a customer for their bank; keep it past the period end and we
      // give away a month every time a card expires.
      const pastDue = snapshotFor('past_due')

      assert.equal(isSubscriptionActiveAt(pastDue, PERIOD_END), true)
      assert.equal(
        isSubscriptionActiveAt(pastDue, new Date(PERIOD_END.getTime() + 1)),
        false,
      )
    })

    it('treats a dunned subscription the same as an unpaid one', () => {
      // `past_due` and `unpaid` are the same situation at different stages of
      // Stripe's retry schedule. Mapping them differently would mean access
      // flickering as Stripe advances the status.
      assert.equal(
        STRIPE_STATUS_MAP.past_due,
        STRIPE_STATUS_MAP.unpaid,
        'past_due and unpaid map to different statuses',
      )
    })
  })
})
