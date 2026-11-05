import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { SeriesTip } from './series.ts'
import { cumulativeSeries, maxDrawdown, seriesBounds } from './series.ts'
import type { SelectionResult } from './settlement.ts'

/**
 * The chart's honesty rules, asserted.
 *
 * Each of these corresponds to a way the same data could be drawn to look
 * better than it is: cropping the axis, seeding the peak with the first
 * value, dropping the void steps, or re-ordering ties.
 */

const leg = (
  outcome: SelectionResult['outcome'],
  oddsAtPublication: number,
): SelectionResult => ({ outcome, oddsAtPublication })

const tip = (
  id: number,
  publishedAt: string,
  outcome: SelectionResult['outcome'],
  odds = 2000,
  stakeUnits = 1,
): SeriesTip => ({
  id,
  sportCode: 'FOOTBALL',
  status: 'SETTLED',
  publishedAt,
  stakeUnits,
  selections: [leg(outcome, odds)],
})

/* -------------------------------------------------------------------------- */

describe('cumulativeSeries', () => {
  it('runs oldest first, whatever order it is handed', () => {
    const points = cumulativeSeries([
      tip(3, '2026-03-03T10:00:00.000Z', 'WON'),
      tip(1, '2026-03-01T10:00:00.000Z', 'LOST'),
      tip(2, '2026-03-02T10:00:00.000Z', 'WON'),
    ])

    assert.deepEqual(
      points.map((point) => point.tipId),
      [1, 2, 3],
    )
    assert.deepEqual(
      points.map((point) => point.index),
      [1, 2, 3],
    )
  })

  it('accumulates in hundredths, one point per settled tip', () => {
    // Stake 1 at 2.000: a win is +1.00 unit (+100), a loss is −1.00 (−100).
    const points = cumulativeSeries([
      tip(1, '2026-03-01T10:00:00.000Z', 'LOST'),
      tip(2, '2026-03-02T10:00:00.000Z', 'WON'),
      tip(3, '2026-03-03T10:00:00.000Z', 'WON'),
    ])

    assert.deepEqual(
      points.map((point) => point.cumulativeHundredths),
      [-100, 0, 100],
    )
  })

  it('keeps a void tip as a flat step rather than dropping it', () => {
    // A chart with fewer points than the table has rows invites the reader to
    // wonder what was taken out.
    const points = cumulativeSeries([
      tip(1, '2026-03-01T10:00:00.000Z', 'WON'),
      tip(2, '2026-03-02T10:00:00.000Z', 'VOID'),
      tip(3, '2026-03-03T10:00:00.000Z', 'LOST'),
    ])

    assert.equal(points.length, 3)
    assert.equal(points[1]?.result, 'VOID')
    assert.equal(points[1]?.profitHundredths, 0)
    assert.equal(points[1]?.cumulativeHundredths, 100)
  })

  it('leaves unsettled tips out entirely', () => {
    const pending: SeriesTip = {
      ...tip(9, '2026-03-09T10:00:00.000Z', 'PENDING'),
      status: 'PUBLISHED',
    }

    const points = cumulativeSeries([
      tip(1, '2026-03-01T10:00:00.000Z', 'WON'),
      pending,
    ])

    assert.deepEqual(
      points.map((point) => point.tipId),
      [1],
    )
  })

  it('orders ties by id so the same data always draws the same shape', () => {
    const points = cumulativeSeries([
      tip(2, '2026-03-01T10:00:00.000Z', 'WON'),
      tip(1, '2026-03-01T10:00:00.000Z', 'LOST'),
    ])

    assert.deepEqual(
      points.map((point) => point.tipId),
      [1, 2],
    )
  })
})

/* -------------------------------------------------------------------------- */

describe('maxDrawdown', () => {
  it('measures the deepest peak-to-trough fall', () => {
    // 0 → +100 → +300 → +100 → 0 → +200.
    // The peak is +300 at index 2, the trough 0 at index 4: depth 300.
    const points = cumulativeSeries([
      tip(1, '2026-03-01T10:00:00.000Z', 'WON'),
      tip(2, '2026-03-02T10:00:00.000Z', 'WON', 3000),
      tip(3, '2026-03-03T10:00:00.000Z', 'LOST', 2000, 2),
      tip(4, '2026-03-04T10:00:00.000Z', 'LOST'),
      tip(5, '2026-03-05T10:00:00.000Z', 'WON', 3000),
    ])

    const drawdown = maxDrawdown(points)

    assert.equal(drawdown?.peakIndex, 2)
    assert.equal(drawdown?.troughIndex, 4)
    assert.equal(drawdown?.depthHundredths, 300)
    assert.equal(drawdown?.peakHundredths, 300)
    assert.equal(drawdown?.troughHundredths, 0)
  })

  it('counts a fall from the starting zero, before any peak exists', () => {
    // THE ONE THAT IS EASY TO GET WRONG. Seeding the running peak with the
    // first point's value reports this record as having had no drawdown,
    // when in fact it has never been above water.
    const points = cumulativeSeries([
      tip(1, '2026-03-01T10:00:00.000Z', 'LOST'),
      tip(2, '2026-03-02T10:00:00.000Z', 'LOST'),
    ])

    const drawdown = maxDrawdown(points)

    assert.equal(drawdown?.peakIndex, 0)
    assert.equal(drawdown?.peakHundredths, 0)
    assert.equal(drawdown?.troughIndex, 2)
    assert.equal(drawdown?.depthHundredths, 200)
  })

  it('reports a zero-depth drawdown rather than null for a record that only rose', () => {
    const points = cumulativeSeries([
      tip(1, '2026-03-01T10:00:00.000Z', 'WON'),
      tip(2, '2026-03-02T10:00:00.000Z', 'WON'),
    ])

    const drawdown = maxDrawdown(points)

    assert.notEqual(drawdown, null)
    assert.equal(drawdown?.depthHundredths, 0)
  })

  it('is null only for an empty series', () => {
    assert.equal(maxDrawdown([]), null)
  })
})

/* -------------------------------------------------------------------------- */

describe('seriesBounds', () => {
  it('always includes zero, even when the record never went negative', () => {
    // The no-cropping rule. An axis fitted to the data would start at +100
    // and make a modest rise look like a launch.
    const points = cumulativeSeries([
      tip(1, '2026-03-01T10:00:00.000Z', 'WON'),
      tip(2, '2026-03-02T10:00:00.000Z', 'WON'),
    ])

    assert.deepEqual(seriesBounds(points), {
      minHundredths: 0,
      maxHundredths: 200,
    })
  })

  it('always includes zero when the record never went positive', () => {
    const points = cumulativeSeries([
      tip(1, '2026-03-01T10:00:00.000Z', 'LOST'),
      tip(2, '2026-03-02T10:00:00.000Z', 'LOST'),
    ])

    assert.deepEqual(seriesBounds(points), {
      minHundredths: -200,
      maxHundredths: 0,
    })
  })

  it('gives a flat series a drawable height instead of dividing by zero', () => {
    const points = cumulativeSeries([
      tip(1, '2026-03-01T10:00:00.000Z', 'VOID'),
    ])

    const bounds = seriesBounds(points)

    assert.equal(bounds.minHundredths, 0)
    assert.ok(bounds.maxHundredths > bounds.minHundredths)
  })

  it('handles an empty series without throwing', () => {
    const bounds = seriesBounds([])

    assert.ok(bounds.maxHundredths > bounds.minHundredths)
  })
})
