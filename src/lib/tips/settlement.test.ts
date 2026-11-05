import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { SelectionResult, TrackRecordTip } from './settlement.ts'
import {
  combinedClosingOddsThousandths,
  combinedOddsThousandths,
  isFullySettled,
  profitHundredths,
  roundHalfAwayFromZero,
  tipResult,
  trackRecord,
} from './settlement.ts'

/**
 * These assertions ARE the published ROI. If this file passes, the number on
 * the site is reproducible; if it drifts, the track record stops being
 * evidence of anything.
 */

const leg = (
  outcome: SelectionResult['outcome'],
  oddsAtPublication: number,
  closingOdds?: number,
): SelectionResult =>
  closingOdds === undefined
    ? { outcome, oddsAtPublication }
    : { outcome, oddsAtPublication, closingOdds }

/* -------------------------------------------------------------------------- */

describe('roundHalfAwayFromZero', () => {
  it('rounds a half away from zero in both directions', () => {
    // The reason this is not "half up": half up would round +0.5 to 1 and
    // −0.5 to 0, so a long record of small results drifts in our favour.
    assert.equal(roundHalfAwayFromZero({ num: 1n, den: 2n }), 1n)
    assert.equal(roundHalfAwayFromZero({ num: -1n, den: 2n }), -1n)
    assert.equal(roundHalfAwayFromZero({ num: 3n, den: 2n }), 2n)
    assert.equal(roundHalfAwayFromZero({ num: -3n, den: 2n }), -2n)
    assert.equal(roundHalfAwayFromZero({ num: 5n, den: 2n }), 3n)
    assert.equal(roundHalfAwayFromZero({ num: -5n, den: 2n }), -3n)
  })

  it('is symmetric for every tested magnitude', () => {
    for (let numerator = 0n; numerator <= 40n; numerator += 1n) {
      const positive = roundHalfAwayFromZero({ num: numerator, den: 7n })
      const negative = roundHalfAwayFromZero({ num: -numerator, den: 7n })

      assert.equal(negative, -positive, `asymmetric at ${numerator}/7`)
    }
  })

  it('leaves exact values alone', () => {
    assert.equal(roundHalfAwayFromZero({ num: 110n, den: 1n }), 110n)
    assert.equal(roundHalfAwayFromZero({ num: -300n, den: 1n }), -300n)
  })

  it('rounds just below and just above a half correctly', () => {
    // 33.3 → 33, 33.5 → 34, 33.7 → 34
    assert.equal(roundHalfAwayFromZero({ num: 333n, den: 10n }), 33n)
    assert.equal(roundHalfAwayFromZero({ num: 335n, den: 10n }), 34n)
    assert.equal(roundHalfAwayFromZero({ num: 337n, den: 10n }), 34n)
    assert.equal(roundHalfAwayFromZero({ num: -333n, den: 10n }), -33n)
    assert.equal(roundHalfAwayFromZero({ num: -335n, den: 10n }), -34n)
  })

  it('refuses a non-positive denominator', () => {
    assert.throws(() => roundHalfAwayFromZero({ num: 1n, den: 0n }), RangeError)
  })
})

/* -------------------------------------------------------------------------- */

describe('profitHundredths — singles', () => {
  it('WON pays stake × (odds − 1)', () => {
    // 1 unit at 2.100 → 1 × 1.100 = +1.10 units = 110 hundredths.
    assert.equal(profitHundredths([leg('WON', 2100)], 1), 110)
    // 2 units at 3.000 → 2 × 2.000 = +4.00 units.
    assert.equal(profitHundredths([leg('WON', 3000)], 2), 400)
  })

  it('LOST loses exactly the stake', () => {
    assert.equal(profitHundredths([leg('LOST', 2100)], 1), -100)
    assert.equal(profitHundredths([leg('LOST', 9999)], 3), -300)
  })

  it('VOID returns the stake, so profit is zero — not a loss', () => {
    assert.equal(profitHundredths([leg('VOID', 2100)], 5), 0)
  })

  it('HALF_WON pays half the stake at full odds', () => {
    // 2 units at 1.950, half won → (2 ÷ 2) × 0.950 = +0.95 units.
    assert.equal(profitHundredths([leg('HALF_WON', 1950)], 2), 95)
  })

  it('HALF_LOST loses half the stake', () => {
    // 2 units, half lost → −1.00 unit.
    assert.equal(profitHundredths([leg('HALF_LOST', 2200)], 2), -100)
    // An odd stake still halves exactly, because profit is in hundredths.
    assert.equal(profitHundredths([leg('HALF_LOST', 2200)], 1), -50)
  })

  it('rounds the result once, half away from zero', () => {
    // 1 unit at 1.333 → 0.333 units = 33.3 hundredths → 33.
    assert.equal(profitHundredths([leg('WON', 1333)], 1), 33)
    // 1.335 → 33.5 hundredths → 34, away from zero.
    assert.equal(profitHundredths([leg('WON', 1335)], 1), 34)
    // 1.334 → 33.4 → 33.
    assert.equal(profitHundredths([leg('WON', 1334)], 1), 33)
  })

  it('refuses to settle while a leg is pending', () => {
    assert.throws(() => profitHundredths([leg('PENDING', 2000)], 1), /PENDING/)
  })

  it('refuses a non-integer or non-positive stake', () => {
    assert.throws(() => profitHundredths([leg('WON', 2000)], 1.5), TypeError)
    assert.throws(() => profitHundredths([leg('WON', 2000)], 0), RangeError)
  })

  it('refuses an empty selection list', () => {
    assert.throws(() => profitHundredths([], 1), RangeError)
  })
})

/* -------------------------------------------------------------------------- */

describe('profitHundredths — accumulators', () => {
  it('multiplies the legs', () => {
    // 1 unit on 1.500 × 2.000 = 3.000 → profit +2.00 units.
    assert.equal(profitHundredths([leg('WON', 1500), leg('WON', 2000)], 1), 200)
  })

  it('a LOST leg loses the accumulator whatever the others did', () => {
    assert.equal(
      profitHundredths(
        [leg('WON', 5000), leg('LOST', 1100), leg('WON', 4000)],
        2,
      ),
      -200,
    )
  })

  it('a VOID leg drops out at 1.000 and does NOT void the tip', () => {
    // This is the rule the brief calls out. 2.000 × (void) → the tip pays as
    // the single remaining leg: +1.00 unit on a 1-unit stake.
    assert.equal(
      profitHundredths([leg('WON', 2000), leg('VOID', 1800)], 1),
      100,
    )
  })

  it('every leg void is a push, not a win and not a loss', () => {
    assert.equal(profitHundredths([leg('VOID', 2000), leg('VOID', 1800)], 4), 0)
  })

  it('a HALF_WON leg is the average of full price and void', () => {
    // 2.000 × 1.800 with the second leg half won:
    //   half the stake runs at 2.000 × 1.800 = 3.600
    //   half the stake runs at 2.000 × 1.000 = 2.000
    //   mean multiplier = (3.600 + 2.000) ÷ 2 = 2.800
    // 1 unit → profit +1.80 units.
    assert.equal(
      profitHundredths([leg('WON', 2000), leg('HALF_WON', 1800)], 1),
      180,
    )
  })

  it('a HALF_LOST leg halves the accumulator', () => {
    // half the stake is lost; half runs with the leg void at 2.000.
    //   multiplier = (0 + 2.000) ÷ 2 = 1.000 → profit exactly zero.
    assert.equal(
      profitHundredths([leg('WON', 2000), leg('HALF_LOST', 1800)], 1),
      0,
    )
  })

  it('handles two half legs at once', () => {
    // 2.000 half won, 3.000 half won:
    //   ((2.000 + 1.000) ÷ 2) × ((3.000 + 1.000) ÷ 2) = 1.500 × 2.000 = 3.000
    // 1 unit → +2.00 units.
    assert.equal(
      profitHundredths([leg('HALF_WON', 2000), leg('HALF_WON', 3000)], 1),
      200,
    )
  })

  it('is order independent', () => {
    const legs = [leg('WON', 1730), leg('HALF_WON', 2410), leg('VOID', 1950)]
    const reversed = [...legs].reverse()

    assert.equal(
      profitHundredths(legs, 3),
      profitHundredths(reversed, 3),
      'the same legs in another order must pay the same',
    )
  })
})

/* -------------------------------------------------------------------------- */

describe('combined odds', () => {
  it('is the leg price for a single', () => {
    assert.equal(combinedOddsThousandths([leg('WON', 2100)]), 2100)
  })

  it('is the product for an accumulator', () => {
    assert.equal(
      combinedOddsThousandths([leg('WON', 1500), leg('WON', 2000)]),
      3000,
    )
    assert.equal(
      combinedOddsThousandths([
        leg('WON', 1500),
        leg('WON', 2000),
        leg('WON', 1200),
      ]),
      3600,
    )
  })

  it('uses the price taken, regardless of what the leg did', () => {
    // The combined price is what we recommended, not a post-hoc recalculation.
    assert.equal(
      combinedOddsThousandths([leg('WON', 2000), leg('VOID', 1800)]),
      3600,
    )
  })

  it('rounds once', () => {
    // 1.333 × 1.333 = 1.776889 → 1.777 in thousandths.
    assert.equal(
      combinedOddsThousandths([leg('WON', 1333), leg('WON', 1333)]),
      1777,
    )
  })

  it('needs closing odds on every leg or reports none', () => {
    assert.equal(
      combinedClosingOddsThousandths([
        leg('WON', 2000, 1900),
        leg('WON', 1500, 1450),
      ]),
      2755,
    )
    // One leg missing its close ⇒ no combined close. Dropping the leg would
    // flatter the closing-line figure.
    assert.equal(
      combinedClosingOddsThousandths([
        leg('WON', 2000, 1900),
        leg('WON', 1500),
      ]),
      null,
    )
  })
})

/* -------------------------------------------------------------------------- */

describe('tipResult', () => {
  it('is PENDING until every leg is decided', () => {
    assert.equal(tipResult([leg('WON', 2000), leg('PENDING', 1500)]), 'PENDING')
    assert.equal(
      isFullySettled([leg('WON', 2000), leg('PENDING', 1500)]),
      false,
    )
    assert.equal(isFullySettled([leg('WON', 2000), leg('VOID', 1500)]), true)
  })

  it('classifies by the money for half outcomes', () => {
    assert.equal(tipResult([leg('HALF_WON', 1950)]), 'WON')
    assert.equal(tipResult([leg('HALF_LOST', 1950)]), 'LOST')
  })

  it('is LOST if any leg lost', () => {
    assert.equal(tipResult([leg('WON', 9000), leg('LOST', 1100)]), 'LOST')
  })

  it('is VOID when everything voided, or when the money nets to zero', () => {
    assert.equal(tipResult([leg('VOID', 2000)]), 'VOID')
    // 2.000 won, 1.800 half lost → multiplier exactly 1.000, a push.
    assert.equal(tipResult([leg('WON', 2000), leg('HALF_LOST', 1800)]), 'VOID')
  })
})

/* -------------------------------------------------------------------------- */
/* THE WORKED EXAMPLE                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Ten tips with known outcomes, written out so the arithmetic can be checked
 * by hand. Every figure below is exact — no rounding is involved except the
 * final ROI, which is stated to the basis point.
 *
 *  #   stake  price            outcome     profit (units)
 *  ──────────────────────────────────────────────────────────────────────
 *  1   2      2.000            WON         2 × 1.000        = +2.00
 *  2   1      1.800            WON         1 × 0.800        = +0.80
 *  3   3      1.500            LOST        −3.00            = −3.00
 *  4   1      2.500            LOST        −1.00            = −1.00
 *  5   2      3.000            WON         2 × 2.000        = +4.00
 *  6   1      1.900            VOID        stake returned   =  0.00
 *  7   2      1.950            HALF_WON    (2÷2) × 0.950    = +0.95
 *  8   2      2.200            HALF_LOST   −(2÷2)           = −1.00
 *  9   1      1.500 × 2.000    WON both    1 × 2.000        = +2.00
 * 10   1      2.000 × 1.800    WON + VOID  void → 1.000,
 *                                          so 1 × 1.000     = +1.00
 *                                                           ────────
 *                                                   total    = +5.75
 *
 *  THE VOID RULE: tip #6 is void overall, so its stake was returned and
 *  nothing was at risk. It leaves BOTH sides of the ROI fraction. It is still
 *  counted as settled, still counted as void, and still in the average price.
 *
 *  Note that #10 is NOT affected. It has a void LEG, but the tip itself won,
 *  so its stake was at risk and it counts in full.
 *
 *  staked  = 2+1+3+1+2 + 2+2+1+1   (#6's 1 excluded)  = 15 units
 *  profit  = +5.75 units                             = 575 hundredths
 *            (#6 contributed 0.00 either way)
 *  ROI     = 5.75 ÷ 15 = 0.3833333… = 38.33333%      = 3833.333 bps
 *            rounded half away from zero             → 3833 bps
 *
 *  won  = #1, #2, #5, #7, #9, #10                    = 6
 *  lost = #3, #4, #8                                 = 3
 *  void = #6                                         = 1
 *  settled = 10  (the void is counted, not hidden)
 *
 *  combined prices (thousandths):
 *    2000, 1800, 1500, 2500, 3000, 1900, 1950, 2200,
 *    1500×2000÷1000 = 3000, 2000×1800÷1000 = 3600
 *    sum = 23450,  mean = 23450 ÷ 10                 = 2345  (2.345)
 *
 *  closing odds exist on #1 and #2 only:
 *    #1 taken 2.000, closed 1.900 → (2000−1900)÷1900 = +0.0526316
 *    #2 taken 1.800, closed 1.800 → 0
 *    mean CLV = 0.0526316 ÷ 2 = 0.0263158 = 2.63158% → 263 bps
 */
const WORKED_EXAMPLE: TrackRecordTip[] = [
  {
    id: 1,
    sportCode: 'FOOTBALL',
    status: 'SETTLED',
    publishedAt: '2026-03-01T10:00:00.000Z',
    stakeUnits: 2,
    selections: [leg('WON', 2000, 1900)],
  },
  {
    id: 2,
    sportCode: 'FOOTBALL',
    status: 'SETTLED',
    publishedAt: '2026-03-02T10:00:00.000Z',
    stakeUnits: 1,
    selections: [leg('WON', 1800, 1800)],
  },
  {
    id: 3,
    sportCode: 'FOOTBALL',
    status: 'SETTLED',
    publishedAt: '2026-03-03T10:00:00.000Z',
    stakeUnits: 3,
    selections: [leg('LOST', 1500)],
  },
  {
    id: 4,
    sportCode: 'TENNIS',
    status: 'SETTLED',
    publishedAt: '2026-03-04T10:00:00.000Z',
    stakeUnits: 1,
    selections: [leg('LOST', 2500)],
  },
  {
    id: 5,
    sportCode: 'TENNIS',
    status: 'SETTLED',
    publishedAt: '2026-03-05T10:00:00.000Z',
    stakeUnits: 2,
    selections: [leg('WON', 3000)],
  },
  {
    id: 6,
    sportCode: 'TENNIS',
    status: 'SETTLED',
    publishedAt: '2026-03-06T10:00:00.000Z',
    stakeUnits: 1,
    selections: [leg('VOID', 1900)],
  },
  {
    id: 7,
    sportCode: 'HOCKEY',
    status: 'SETTLED',
    publishedAt: '2026-03-07T10:00:00.000Z',
    stakeUnits: 2,
    selections: [leg('HALF_WON', 1950)],
  },
  {
    id: 8,
    sportCode: 'HOCKEY',
    status: 'SETTLED',
    publishedAt: '2026-03-08T10:00:00.000Z',
    stakeUnits: 2,
    selections: [leg('HALF_LOST', 2200)],
  },
  {
    id: 9,
    sportCode: 'HOCKEY',
    status: 'SETTLED',
    publishedAt: '2026-03-09T10:00:00.000Z',
    stakeUnits: 1,
    selections: [leg('WON', 1500), leg('WON', 2000)],
  },
  {
    id: 10,
    sportCode: 'FOOTBALL',
    status: 'SETTLED',
    publishedAt: '2026-03-10T10:00:00.000Z',
    stakeUnits: 1,
    selections: [leg('WON', 2000), leg('VOID', 1800)],
  },
]

describe('trackRecord — the worked example', () => {
  it('matches the arithmetic written out above, exactly', () => {
    const record = trackRecord(WORKED_EXAMPLE)

    assert.equal(record.settled, 10)
    assert.equal(record.won, 6)
    assert.equal(record.lost, 3)
    assert.equal(record.void, 1)
    // 15, not 16: tip #6 is void overall and its stake leaves the ROI.
    assert.equal(record.stakedUnits, 15)
    assert.equal(record.profitHundredths, 575, '+5.75 units')
    assert.equal(record.roiBasisPoints, 3833, '38.33333% → 3833 bps')
    assert.equal(record.averageOddsThousandths, 2345, 'mean price 2.345')
    assert.equal(record.closingLineValueBasisPoints, 263)
    assert.equal(record.closingLineSampleSize, 2)
  })

  it('each tip individually matches its stated profit', () => {
    const expected = [200, 80, -300, -100, 400, 0, 95, -100, 200, 100]

    WORKED_EXAMPLE.forEach((tip, index) => {
      assert.equal(
        profitHundredths(tip.selections, tip.stakeUnits),
        expected[index],
        `tip #${tip.id}`,
      )
    })

    assert.equal(
      expected.reduce((sum, value) => sum + value, 0),
      575,
      'the stated per-tip profits sum to the stated total',
    )
  })

  it('filters by sport without changing the per-sport arithmetic', () => {
    // FOOTBALL: #1 (+200), #2 (+80), #3 (−300), #10 (+100) = +80 on 7 staked.
    // ROI = 0.80 ÷ 7 = 0.1142857 → 1142.857 bps → 1143.
    const football = trackRecord(WORKED_EXAMPLE, {
      sportCodes: ['FOOTBALL'],
    })

    assert.equal(football.settled, 4)
    assert.equal(football.stakedUnits, 7)
    assert.equal(football.profitHundredths, 80)
    assert.equal(football.roiBasisPoints, 1143)
  })

  it('filters by date range, upper bound exclusive', () => {
    // 1–5 March inclusive of the 1st, exclusive of the 6th: tips #1–#5.
    const window = trackRecord(WORKED_EXAMPLE, {
      from: new Date('2026-03-01T00:00:00.000Z'),
      to: new Date('2026-03-06T00:00:00.000Z'),
    })

    assert.equal(window.settled, 5)
    // +200 +80 −300 −100 +400 = +280 on 2+1+3+1+2 = 9 staked.
    assert.equal(window.profitHundredths, 280)
    assert.equal(window.stakedUnits, 9)
    // 2.80 ÷ 9 = 0.311111 → 3111.11 bps → 3111.
    assert.equal(window.roiBasisPoints, 3111)
  })

  it('tiles consecutive windows without double counting', () => {
    const boundary = new Date('2026-03-06T00:00:00.000Z')
    const first = trackRecord(WORKED_EXAMPLE, { to: boundary })
    const second = trackRecord(WORKED_EXAMPLE, { from: boundary })
    const whole = trackRecord(WORKED_EXAMPLE)

    assert.equal(first.settled + second.settled, whole.settled)
    assert.equal(
      first.profitHundredths + second.profitHundredths,
      whole.profitHundredths,
    )
  })
})

describe('trackRecord — edges', () => {
  it('counts only SETTLED tips in the money figures', () => {
    const withUnsettled: TrackRecordTip[] = [
      ...WORKED_EXAMPLE,
      {
        id: 11,
        sportCode: 'FOOTBALL',
        status: 'PUBLISHED',
        publishedAt: '2026-03-11T10:00:00.000Z',
        stakeUnits: 9,
        selections: [leg('PENDING', 5000)],
      },
      {
        id: 12,
        sportCode: 'FOOTBALL',
        status: 'DRAFT',
        publishedAt: null,
        stakeUnits: 9,
        selections: [leg('PENDING', 5000)],
      },
    ]

    const record = trackRecord(withUnsettled)

    // Identical to the worked example: publishing a return on bets that have
    // not finished would be the easiest way to flatter the record.
    assert.equal(record.settled, 10)
    assert.equal(record.stakedUnits, 15)
    assert.equal(record.profitHundredths, 575)
  })

  it('reports nulls rather than dividing by zero on an empty record', () => {
    const empty = trackRecord([])

    assert.equal(empty.settled, 0)
    assert.equal(empty.stakedUnits, 0)
    assert.equal(empty.profitHundredths, 0)
    assert.equal(empty.roiBasisPoints, null)
    assert.equal(empty.averageOddsThousandths, null)
    assert.equal(empty.closingLineValueBasisPoints, null)
    assert.equal(empty.closingLineSampleSize, 0)
  })

  it('reports a negative ROI without flinching', () => {
    const losing: TrackRecordTip[] = [
      {
        id: 1,
        sportCode: 'FOOTBALL',
        status: 'SETTLED',
        publishedAt: '2026-03-01T10:00:00.000Z',
        stakeUnits: 2,
        selections: [leg('LOST', 2000)],
      },
      {
        id: 2,
        sportCode: 'FOOTBALL',
        status: 'SETTLED',
        publishedAt: '2026-03-02T10:00:00.000Z',
        stakeUnits: 1,
        selections: [leg('LOST', 2000)],
      },
    ]

    const record = trackRecord(losing)

    assert.equal(record.profitHundredths, -300)
    assert.equal(record.stakedUnits, 3)
    // −3.00 ÷ 3 = −100% → −10000 bps.
    assert.equal(record.roiBasisPoints, -10_000)
  })

  it('leaves a void tip out of the ROI while still counting it', () => {
    const record = trackRecord([
      {
        id: 1,
        sportCode: 'FOOTBALL',
        status: 'SETTLED',
        publishedAt: '2026-03-01T10:00:00.000Z',
        stakeUnits: 4,
        selections: [leg('VOID', 2000)],
      },
    ])

    // Visible: it settled, and it was void. Neither a win nor a loss.
    assert.equal(record.settled, 1)
    assert.equal(record.void, 1)
    assert.equal(record.won, 0)
    assert.equal(record.lost, 0)

    // Nothing was at risk, so there is nothing to divide by.
    assert.equal(record.stakedUnits, 0)
    assert.equal(record.profitHundredths, 0)
    // NULL, not zero. "0% return" would be a claim about money that was
    // staked; no money was. Reporting 0% on an all-void record would invent a
    // result out of an absence of one.
    assert.equal(record.roiBasisPoints, null)

    // The price we took is still a fact about the selection.
    assert.equal(record.averageOddsThousandths, 2000)
  })

  it('keeps a void LEG inside a winning accumulator in the ROI', () => {
    // The distinction that does the work: a void leg is not a void tip. This
    // tip settled and its stake was at risk, so it counts in full.
    const record = trackRecord([
      {
        id: 1,
        sportCode: 'FOOTBALL',
        status: 'SETTLED',
        publishedAt: '2026-03-01T10:00:00.000Z',
        stakeUnits: 2,
        selections: [leg('WON', 2000), leg('VOID', 1800)],
      },
    ])

    assert.equal(record.won, 1)
    assert.equal(record.void, 0)
    assert.equal(record.stakedUnits, 2, 'the stake was at risk')
    // Void leg drops out at 1.000, so the multiplier is 2.000: +2.00 on 2.
    assert.equal(record.profitHundredths, 200)
    assert.equal(record.roiBasisPoints, 10_000, '+100%')
  })

  it('computes closing line value only from tips that have it', () => {
    const record = trackRecord([
      {
        id: 1,
        sportCode: 'FOOTBALL',
        status: 'SETTLED',
        publishedAt: '2026-03-01T10:00:00.000Z',
        stakeUnits: 1,
        // Took 2.000, closed 1.800 → beat the close by 200/1800 = 11.11%.
        selections: [leg('LOST', 2000, 1800)],
      },
      {
        id: 2,
        sportCode: 'FOOTBALL',
        status: 'SETTLED',
        publishedAt: '2026-03-02T10:00:00.000Z',
        stakeUnits: 1,
        selections: [leg('WON', 2000)],
      },
    ])

    assert.equal(record.closingLineSampleSize, 1)
    // 200 ÷ 1800 = 0.111111 → 1111.11 bps → 1111.
    assert.equal(record.closingLineValueBasisPoints, 1111)
  })

  it('reports a negative closing line value when we took the worse price', () => {
    const record = trackRecord([
      {
        id: 1,
        sportCode: 'FOOTBALL',
        status: 'SETTLED',
        publishedAt: '2026-03-01T10:00:00.000Z',
        stakeUnits: 1,
        // Took 1.800, closed 2.000 → −200/2000 = −10%.
        selections: [leg('WON', 1800, 2000)],
      },
    ])

    assert.equal(record.closingLineValueBasisPoints, -1000)
  })

  it('excludes a tip with no publication date from a windowed query', () => {
    const record = trackRecord(
      [
        {
          id: 1,
          sportCode: 'FOOTBALL',
          status: 'SETTLED',
          publishedAt: null,
          stakeUnits: 1,
          selections: [leg('WON', 2000)],
        },
      ],
      { from: new Date('2020-01-01T00:00:00.000Z') },
    )

    assert.equal(record.settled, 0)
  })
})
