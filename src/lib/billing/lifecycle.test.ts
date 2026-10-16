import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { BILLING_INTERVALS, PLAN_CODES } from './constants.ts'
import {
  type BillingActor,
  DEFAULT_CANCELLATION_MODE,
  PLAN_RANK,
  authorizeCancellation,
  authorizePlanChange,
  classifyPlanChange,
  effectOfPlanChange,
} from './lifecycle.ts'

const ADMIN: BillingActor = { kind: 'ADMIN', adminUserId: 1 }
const CUSTOMER: BillingActor = { kind: 'CUSTOMER', customerId: 7 }
const SYSTEM: BillingActor = { kind: 'SYSTEM' }

describe('plan ranking', () => {
  it('ranks the declared plans cheapest-first', () => {
    assert.ok(PLAN_RANK.START < PLAN_RANK.PRO)
    assert.ok(PLAN_RANK.PRO < PLAN_RANK.INSIDER)
  })

  it('gives every plan code a distinct rank', () => {
    const ranks = PLAN_CODES.map((code) => PLAN_RANK[code])

    assert.equal(new Set(ranks).size, PLAN_CODES.length)
  })
})

describe('classifyPlanChange', () => {
  it('treats a higher tier as an upgrade regardless of interval', () => {
    // The case that catches a price-based implementation: a yearly START
    // costs more than a monthly PRO, so comparing amounts would call this a
    // downgrade and hand the customer the better plan at period end for free.
    assert.equal(
      classifyPlanChange({
        fromPlan: 'START',
        toPlan: 'PRO',
        fromInterval: 'YEAR',
        toInterval: 'MONTH',
      }),
      'UPGRADE',
    )
  })

  it('treats a lower tier as a downgrade regardless of interval', () => {
    assert.equal(
      classifyPlanChange({
        fromPlan: 'INSIDER',
        toPlan: 'START',
        fromInterval: 'MONTH',
        toInterval: 'YEAR',
      }),
      'DOWNGRADE',
    )
  })

  it('reads monthly to yearly on the same plan as an upgrade', () => {
    assert.equal(
      classifyPlanChange({
        fromPlan: 'PRO',
        toPlan: 'PRO',
        fromInterval: 'MONTH',
        toInterval: 'YEAR',
      }),
      'UPGRADE',
    )
  })

  it('reads yearly to monthly on the same plan as a downgrade', () => {
    // Must wait for period end: they have paid for a year.
    assert.equal(
      classifyPlanChange({
        fromPlan: 'PRO',
        toPlan: 'PRO',
        fromInterval: 'YEAR',
        toInterval: 'MONTH',
      }),
      'DOWNGRADE',
    )
  })

  it('reports no change when nothing changes', () => {
    for (const plan of PLAN_CODES) {
      for (const interval of BILLING_INTERVALS) {
        assert.equal(
          classifyPlanChange({
            fromPlan: plan,
            toPlan: plan,
            fromInterval: interval,
            toInterval: interval,
          }),
          'UNCHANGED',
          `${plan}/${interval}`,
        )
      }
    }
  })

  it('is antisymmetric across every pair of plans', () => {
    // An upgrade one way must be a downgrade the other. An asymmetry here
    // would let somebody ping-pong between two plans, taking immediate
    // proration credit in both directions.
    for (const from of PLAN_CODES) {
      for (const to of PLAN_CODES) {
        if (from === to) continue

        const forward = classifyPlanChange({
          fromPlan: from,
          toPlan: to,
          fromInterval: 'MONTH',
          toInterval: 'MONTH',
        })
        const back = classifyPlanChange({
          fromPlan: to,
          toPlan: from,
          fromInterval: 'MONTH',
          toInterval: 'MONTH',
        })

        assert.equal(
          forward === 'UPGRADE' ? 'DOWNGRADE' : 'UPGRADE',
          back,
          `${from} -> ${to} and back disagree`,
        )
      }
    }
  })
})

describe('effectOfPlanChange', () => {
  it('applies an upgrade now and a downgrade at period end', () => {
    assert.equal(effectOfPlanChange('UPGRADE'), 'IMMEDIATE')
    assert.equal(effectOfPlanChange('DOWNGRADE'), 'AT_PERIOD_END')
  })
})

describe('authorizePlanChange', () => {
  it('lets a customer upgrade immediately', () => {
    const result = authorizePlanChange(
      {
        fromPlan: 'START',
        toPlan: 'PRO',
        fromInterval: 'MONTH',
        toInterval: 'MONTH',
      },
      CUSTOMER,
    )

    assert.ok(result.ok)
    assert.equal(result.value.direction, 'UPGRADE')
    assert.equal(result.value.effect, 'IMMEDIATE')
  })

  it('lets a customer downgrade, but only at period end', () => {
    const result = authorizePlanChange(
      {
        fromPlan: 'PRO',
        toPlan: 'START',
        fromInterval: 'MONTH',
        toInterval: 'MONTH',
      },
      CUSTOMER,
    )

    assert.ok(result.ok)
    assert.equal(result.value.direction, 'DOWNGRADE')
    assert.equal(result.value.effect, 'AT_PERIOD_END')
  })

  it('refuses a change to the plan already held', () => {
    const result = authorizePlanChange(
      {
        fromPlan: 'PRO',
        toPlan: 'PRO',
        fromInterval: 'MONTH',
        toInterval: 'MONTH',
      },
      CUSTOMER,
    )

    assert.ok(!result.ok)
    assert.equal(result.code, 'INVALID_REQUEST')
  })

  it('refuses a plan change with no human behind it', () => {
    const result = authorizePlanChange(
      {
        fromPlan: 'START',
        toPlan: 'PRO',
        fromInterval: 'MONTH',
        toInterval: 'MONTH',
      },
      SYSTEM,
    )

    assert.ok(!result.ok)
    assert.equal(result.providerCode, 'plan_change_requires_actor')
  })
})

describe('authorizeCancellation', () => {
  it('defaults to the end of the paid period', () => {
    assert.equal(DEFAULT_CANCELLATION_MODE, 'AT_PERIOD_END')
  })

  it('lets anybody cancel at period end', () => {
    for (const actor of [ADMIN, CUSTOMER, SYSTEM]) {
      const result = authorizeCancellation('AT_PERIOD_END', actor)

      assert.ok(result.ok, actor.kind)
      assert.equal(result.value, 'AT_PERIOD_END')
    }
  })

  it('lets an admin cancel immediately', () => {
    const result = authorizeCancellation('IMMEDIATE', ADMIN)

    assert.ok(result.ok)
    assert.equal(result.value, 'IMMEDIATE')
  })

  it('refuses an immediate cancellation to a customer', () => {
    // Immediate cancellation forfeits a period they have already paid for.
    // One misread button should not be able to do that.
    const result = authorizeCancellation('IMMEDIATE', CUSTOMER)

    assert.ok(!result.ok)
    assert.equal(result.code, 'NOT_CANCELABLE')
    assert.match(result.message, /podpora/)
  })

  it('refuses an immediate cancellation to a scheduled job', () => {
    // Fails closed. A cron job destroying paid access is not something to
    // find out about afterwards from a log line.
    const result = authorizeCancellation('IMMEDIATE', SYSTEM)

    assert.ok(!result.ok)
    assert.equal(result.code, 'NOT_CANCELABLE')
  })
})
