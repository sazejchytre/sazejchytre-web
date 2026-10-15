import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { TrackRecordTip } from './settlement.ts'
import type { VisibilityTip } from './visibility.ts'
import {
  defaultPublicAt,
  isTipResultPublic,
  publicTipSummary,
  publicTrackRecord,
  tipDisclosure,
  tipVisibility,
} from './visibility.ts'

const PUBLISHED = new Date('2026-03-01T12:00:00.000Z')
const PUBLIC_AT = new Date('2026-03-02T12:00:00.000Z') // +24h

const tip = (overrides: Partial<VisibilityTip> = {}): VisibilityTip => ({
  status: 'PUBLISHED',
  publishedAt: PUBLISHED,
  publicAt: PUBLIC_AT,
  requiredFeatureKey: 'TIPS_REALTIME',
  ...overrides,
})

describe('tipVisibility', () => {
  it('is FULL for a subscriber who holds the required entitlement', () => {
    assert.equal(tipVisibility(tip(), ['TIPS_REALTIME'], PUBLISHED), 'FULL')
  })

  it('is LOCKED before publicAt for someone without it', () => {
    assert.equal(tipVisibility(tip(), [], PUBLISHED), 'LOCKED')
  })

  it('is DELAYED from publicAt onwards for someone without it', () => {
    assert.equal(tipVisibility(tip(), [], PUBLIC_AT), 'DELAYED')
  })

  it('flips exactly at the publicAt boundary', () => {
    const justBefore = new Date(PUBLIC_AT.getTime() - 1)
    const exactly = new Date(PUBLIC_AT.getTime())
    const justAfter = new Date(PUBLIC_AT.getTime() + 1)

    assert.equal(tipVisibility(tip(), [], justBefore), 'LOCKED')
    assert.equal(tipVisibility(tip(), [], exactly), 'DELAYED')
    assert.equal(tipVisibility(tip(), [], justAfter), 'DELAYED')
  })

  it('ignores an entitlement the tip does not require', () => {
    assert.equal(
      tipVisibility(tip(), ['ARCHIVE_EXPORT', 'API_ACCESS'], PUBLISHED),
      'LOCKED',
    )
  })

  it('accepts a Set as well as an array', () => {
    assert.equal(
      tipVisibility(tip(), new Set(['TIPS_REALTIME']), PUBLISHED),
      'FULL',
    )
  })

  it('is LOCKED for a draft, even for a subscriber', () => {
    // A draft is not a claim yet. Showing it would make the publication
    // timestamp — which the whole record is defended with — meaningless.
    assert.equal(
      tipVisibility(
        tip({ status: 'DRAFT', publishedAt: null, publicAt: null }),
        ['TIPS_REALTIME'],
        PUBLISHED,
      ),
      'LOCKED',
    )
  })

  it('is LOCKED when publicAt is missing, rather than open', () => {
    // A missing field must not leak paid content.
    assert.equal(
      tipVisibility(tip({ publicAt: null }), [], new Date('2030-01-01')),
      'LOCKED',
    )
  })

  it('still unlocks a settled tip fully for an entitled subscriber', () => {
    assert.equal(
      tipVisibility(tip({ status: 'SETTLED' }), ['TIPS_REALTIME'], PUBLISHED),
      'FULL',
    )
  })
})

describe('isTipResultPublic', () => {
  it('is true once the tip has resolved', () => {
    assert.equal(isTipResultPublic({ status: 'SETTLED' }), true)
    assert.equal(isTipResultPublic({ status: 'VOIDED' }), true)
  })

  it('is false while it is unresolved', () => {
    assert.equal(isTipResultPublic({ status: 'DRAFT' }), false)
    assert.equal(isTipResultPublic({ status: 'PUBLISHED' }), false)
  })

  it('takes no entitlements — there is no per-customer answer', () => {
    // The signature is the guarantee: a result cannot be hidden from someone
    // because of what they have or have not paid for.
    assert.equal(isTipResultPublic.length, 1)
  })
})

describe('tipDisclosure', () => {
  it('shows everything on FULL', () => {
    const disclosure = tipDisclosure(
      tip({ status: 'SETTLED' }),
      ['TIPS_REALTIME'],
      PUBLISHED,
    )

    assert.deepEqual(disclosure, {
      visibility: 'FULL',
      showSelections: true,
      showRationale: true,
      showOdds: true,
      showResult: true,
    })
  })

  it('shows the pick but not the reasoning on DELAYED', () => {
    const disclosure = tipDisclosure(tip(), [], PUBLIC_AT)

    assert.equal(disclosure.visibility, 'DELAYED')
    assert.equal(disclosure.showSelections, true)
    assert.equal(disclosure.showOdds, true)
    assert.equal(disclosure.showRationale, false)
  })

  it('hides the pick on LOCKED', () => {
    const disclosure = tipDisclosure(tip(), [], PUBLISHED)

    assert.equal(disclosure.visibility, 'LOCKED')
    assert.equal(disclosure.showSelections, false)
    assert.equal(disclosure.showRationale, false)
    assert.equal(disclosure.showOdds, false)
  })

  it('STILL shows the result of a settled tip that is otherwise LOCKED', () => {
    // The rule the whole module exists for. A visitor with no subscription
    // cannot see the pick or the reasoning, but can always see how it went —
    // otherwise losses could be hidden and the record would prove nothing.
    const disclosure = tipDisclosure(tip({ status: 'SETTLED' }), [], PUBLISHED)

    assert.equal(disclosure.visibility, 'LOCKED')
    assert.equal(disclosure.showSelections, false)
    assert.equal(disclosure.showRationale, false)
    assert.equal(disclosure.showResult, true, 'the result must stay public')
  })

  it('does not show a result that does not exist yet', () => {
    const disclosure = tipDisclosure(
      tip({ status: 'PUBLISHED' }),
      [],
      PUBLISHED,
    )

    assert.equal(disclosure.showResult, false)
  })
})

describe('defaultPublicAt', () => {
  it('is publication plus 24 hours', () => {
    assert.equal(
      defaultPublicAt(PUBLISHED).toISOString(),
      PUBLIC_AT.toISOString(),
    )
  })
})

/* -------------------------------------------------------------------------- */

const settled = (
  id: number,
  outcome: 'WON' | 'LOST' | 'VOID',
  odds = 2000,
  stakeUnits = 1,
): TrackRecordTip => ({
  id,
  sportCode: 'FOOTBALL',
  status: 'SETTLED',
  publishedAt: `2026-03-0${id}T10:00:00.000Z`,
  stakeUnits,
  selections: [{ outcome, oddsAtPublication: odds }],
})

describe('publicTrackRecord', () => {
  const NOW = new Date('2026-04-01T00:00:00.000Z')

  it('counts every settled tip, including the losses', () => {
    const tips = [
      settled(1, 'WON'),
      settled(2, 'LOST'),
      settled(3, 'LOST'),
      settled(4, 'WON'),
    ]

    const record = publicTrackRecord(tips, NOW)

    assert.equal(record.settled, 4)
    assert.equal(record.won, 2)
    assert.equal(record.lost, 2)
    // +100 −100 −100 +100 = 0 on 4 staked.
    assert.equal(record.profitHundredths, 0)
    assert.equal(record.roiBasisPoints, 0)
  })

  it('takes no filter argument at all', () => {
    // THE structural guarantee. A sport, a date range or a "selected tips"
    // list would each make the published figure unverifiable, so the function
    // accepts only the tips and the clock.
    assert.equal(
      publicTrackRecord.length,
      2,
      'publicTrackRecord must take exactly (tips, now) — no filter',
    )
  })

  it('reports the ids it counted, so the figures can be reconciled', () => {
    const record = publicTrackRecord(
      [settled(1, 'WON'), settled(2, 'LOST')],
      NOW,
    )

    assert.deepEqual([...record.countedTipIds], [1, 2])
  })

  it('reports what it was given and what it excluded', () => {
    // The only legitimate exclusion is "not settled yet", and it is visible.
    const tips: TrackRecordTip[] = [
      settled(1, 'WON'),
      {
        id: 2,
        sportCode: 'FOOTBALL',
        status: 'PUBLISHED',
        publishedAt: '2026-03-02T10:00:00.000Z',
        stakeUnits: 5,
        selections: [{ outcome: 'PENDING', oddsAtPublication: 2000 }],
      },
      {
        id: 3,
        sportCode: 'FOOTBALL',
        status: 'DRAFT',
        publishedAt: null,
        stakeUnits: 5,
        selections: [{ outcome: 'PENDING', oddsAtPublication: 2000 }],
      },
    ]

    const record = publicTrackRecord(tips, NOW)

    assert.equal(record.consideredTips, 3)
    assert.equal(record.settled, 1)
    assert.equal(record.excludedBecauseUnsettled, 2)
    assert.equal(
      record.consideredTips - record.excludedBecauseUnsettled,
      record.settled,
      'the three figures must reconcile, leaving no room for a hidden exclusion',
    )
  })

  it('cannot be made to look better by reordering the input', () => {
    const tips = [
      settled(1, 'WON', 3000),
      settled(2, 'LOST'),
      settled(3, 'LOST'),
    ]
    const forwards = publicTrackRecord(tips, NOW)
    const backwards = publicTrackRecord([...tips].reverse(), NOW)

    assert.equal(forwards.profitHundredths, backwards.profitHundredths)
    assert.equal(forwards.roiBasisPoints, backwards.roiBasisPoints)
  })

  it('reports a negative record without softening it', () => {
    const record = publicTrackRecord(
      [settled(1, 'LOST'), settled(2, 'LOST'), settled(3, 'WON', 1500)],
      NOW,
    )

    // −100 −100 +50 = −150 hundredths = −1.50 units, on 3 staked.
    // −1.50 ÷ 3 = −0.50 = −50% → −5000 bps.
    assert.equal(record.profitHundredths, -150)
    assert.equal(record.roiBasisPoints, -5000)
  })

  it('stamps when it was computed', () => {
    assert.equal(publicTrackRecord([], NOW).asOf, NOW)
  })
})

describe('publicTipSummary', () => {
  it('carries the result and the profit but no reasoning', () => {
    const summary = publicTipSummary(settled(1, 'WON', 2500, 2))

    assert.equal(summary.result, 'WON')
    assert.equal(summary.profitHundredths, 300) // 2 × 1.500
    assert.ok(!('rationale' in summary))
    assert.ok(!('selections' in summary))
  })

  it('gives a losing tip the same shape, with a negative number', () => {
    const summary = publicTipSummary(settled(2, 'LOST', 2500, 2))

    assert.equal(summary.result, 'LOST')
    assert.equal(summary.profitHundredths, -200)
    assert.deepEqual(Object.keys(summary).sort(), [
      'id',
      'profitHundredths',
      'publishedAt',
      'result',
      'sportCode',
      'stakeUnits',
    ])
  })

  it('reports no profit for a tip that has not resolved', () => {
    const summary = publicTipSummary({
      id: 9,
      sportCode: 'FOOTBALL',
      status: 'PUBLISHED',
      publishedAt: '2026-03-09T10:00:00.000Z',
      stakeUnits: 1,
      selections: [{ outcome: 'PENDING', oddsAtPublication: 2000 }],
    })

    assert.equal(summary.result, 'PENDING')
    assert.equal(summary.profitHundredths, null)
  })
})
