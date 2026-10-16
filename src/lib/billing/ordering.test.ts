import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { SUBSCRIPTION_STATUSES, type SubscriptionStatus } from './constants.ts'
import {
  TERMINAL_STATUSES,
  decideSubscriptionWrite,
  isTerminalStatus,
  sequenceFromEventCreated,
} from './ordering.ts'

const stored = (
  status: SubscriptionStatus,
  providerSequence: number | null,
) => ({
  status,
  providerSequence,
})

const incoming = (status: SubscriptionStatus, sequence: number) => ({
  status,
  sequence,
})

describe('terminal statuses', () => {
  it('treats only the irreversible ones as terminal', () => {
    assert.deepEqual([...TERMINAL_STATUSES].sort(), ['CANCELED', 'EXPIRED'])
  })

  it('classifies every status in the enum', () => {
    for (const status of SUBSCRIPTION_STATUSES) {
      assert.equal(typeof isTerminalStatus(status), 'boolean', status)
    }
  })

  it('does not treat PAST_DUE as terminal', () => {
    // PAST_DUE recovers all the time; treating it as terminal would make a
    // recovered payment unable to restore access.
    assert.equal(isTerminalStatus('PAST_DUE'), false)
  })
})

describe('decideSubscriptionWrite', () => {
  it('applies the first event for a row with no recorded sequence', () => {
    const decision = decideSubscriptionWrite(
      stored('INCOMPLETE', null),
      incoming('ACTIVE', 1_000),
    )

    assert.equal(decision.apply, true)
  })

  it('applies a strictly newer event', () => {
    const decision = decideSubscriptionWrite(
      stored('PAST_DUE', 1_000),
      incoming('ACTIVE', 2_000),
    )

    assert.equal(decision.apply, true)
  })

  it('refuses a strictly older event', () => {
    // The retried `past_due` landing after the recovery was processed.
    const decision = decideSubscriptionWrite(
      stored('ACTIVE', 2_000),
      incoming('PAST_DUE', 1_000),
    )

    assert.equal(decision.apply, false)
    assert.ok(!decision.apply)
    assert.equal(decision.reason, 'STALE_SEQUENCE')
  })

  it('applies an event with the same sequence', () => {
    // Indistinguishable in Stripe's own data, and the terminal guard covers
    // the one tie whose outcome matters. Refusing equal sequences instead
    // would drop legitimate same-second updates.
    const decision = decideSubscriptionWrite(
      stored('PAST_DUE', 1_000),
      incoming('ACTIVE', 1_000),
    )

    assert.equal(decision.apply, true)
  })

  describe('terminal-state guard', () => {
    it('refuses to move out of CANCELED even on a newer event', () => {
      const decision = decideSubscriptionWrite(
        stored('CANCELED', 1_000),
        incoming('ACTIVE', 9_999),
      )

      assert.equal(decision.apply, false)
      assert.ok(!decision.apply)
      assert.equal(decision.reason, 'TERMINAL_STATE')
    })

    it('refuses to move out of EXPIRED even on a newer event', () => {
      const decision = decideSubscriptionWrite(
        stored('EXPIRED', 1_000),
        incoming('PAST_DUE', 9_999),
      )

      assert.ok(!decision.apply)
      assert.equal(decision.reason, 'TERMINAL_STATE')
    })

    it('refuses on a same-second tie, which the sequence cannot break', () => {
      // Cancellation and a final `updated` commonly share a second. Resolving
      // that by arrival order is a coin flip over whether somebody keeps
      // access they are no longer paying for.
      const decision = decideSubscriptionWrite(
        stored('CANCELED', 1_000),
        incoming('ACTIVE', 1_000),
      )

      assert.ok(!decision.apply)
      assert.equal(decision.reason, 'TERMINAL_STATE')
    })

    it('allows one terminal state to follow another', () => {
      // CANCELED -> EXPIRED is not a regression, and blocking it would leave
      // rows stuck in whichever terminal state arrived first.
      const decision = decideSubscriptionWrite(
        stored('CANCELED', 1_000),
        incoming('EXPIRED', 2_000),
      )

      assert.equal(decision.apply, true)
    })

    it('allows a terminal state to be reached from any live state', () => {
      for (const from of ['INCOMPLETE', 'ACTIVE', 'PAST_DUE'] as const) {
        for (const to of TERMINAL_STATUSES) {
          const decision = decideSubscriptionWrite(
            stored(from, 1_000),
            incoming(to, 2_000),
          )

          assert.equal(decision.apply, true, `${from} -> ${to}`)
        }
      }
    })

    it('still refuses a stale event that would reach a terminal state', () => {
      // The guard is about direction; staleness is checked independently, so
      // an old `canceled` cannot end a subscription that has since renewed.
      const decision = decideSubscriptionWrite(
        stored('ACTIVE', 5_000),
        incoming('CANCELED', 1_000),
      )

      assert.ok(!decision.apply)
      assert.equal(decision.reason, 'STALE_SEQUENCE')
    })
  })

  it('never leaks anything sensitive in the detail string', () => {
    const decision = decideSubscriptionWrite(
      stored('ACTIVE', 2_000),
      incoming('PAST_DUE', 1_000),
    )

    assert.ok(!decision.apply)
    // The string is logged, so it may only hold statuses and numbers.
    assert.match(decision.detail, /^[\w\s\d>-]+$/)
  })
})

describe('sequenceFromEventCreated', () => {
  it('converts provider seconds to the millisecond unit the rule uses', () => {
    assert.equal(sequenceFromEventCreated(1_773_568_800), 1_773_568_800_000)
  })

  it('stays comparable with a wall-clock millisecond value', () => {
    // The two sources have to be in the same unit or every event looks either
    // ancient or impossibly new. This is the assertion that catches a
    // seconds/milliseconds mix-up.
    const nowSeconds = Math.floor(Date.now() / 1000)
    const fromEvent = sequenceFromEventCreated(nowSeconds)

    assert.ok(Math.abs(fromEvent - Date.now()) < 2_000)
  })

  it('ties for two events in the same provider second', () => {
    // Not a defect to fix here: Stripe reports whole seconds, so the ordering
    // this would need was never recorded. Stated as a test so the limitation
    // is visible rather than discovered.
    assert.equal(
      sequenceFromEventCreated(1_773_568_800),
      sequenceFromEventCreated(1_773_568_800),
    )
  })
})
