/**
 * The homepage prototype's view model.
 *
 * The inputs below are TEST FIXTURES built in this file to exercise the
 * formatting rules. They are never rendered on any page, screenshot or
 * route; the prototype itself only ever receives rows from the database.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import type { ArchiveRow } from '../../../../lib/tips/archive.ts'
import type { TrackRecord } from '../../../../lib/tips/settlement.ts'
import {
  LATEST_RESULTS_LIMIT,
  SMALL_SAMPLE_THRESHOLD,
  latestResultRows,
  recordFigures,
  sampleState,
  signTone,
} from './view-model.ts'

const LABELS = {
  settled: 'Vyhodnocených tipů',
  won: 'Vyhraných',
  lost: 'Prohraných',
  void: 'Zrušených',
  profit: 'Zisk',
  roi: 'Návratnost (ROI)',
  averageOdds: 'Průměrný kurz',
  drawdown: 'Největší propad',
  unitsShort: 'j.',
  noValue: '—',
}

const emptyRecord: TrackRecord = {
  settled: 0,
  won: 0,
  lost: 0,
  void: 0,
  stakedUnits: 0,
  profitHundredths: 0,
  roiBasisPoints: null,
  averageOddsThousandths: null,
  closingLineValueBasisPoints: null,
  closingLineSampleSize: 0,
}

const losingRecord: TrackRecord = {
  ...emptyRecord,
  settled: 4,
  won: 1,
  lost: 3,
  stakedUnits: 4,
  profitHundredths: -210,
  roiBasisPoints: -5250,
  averageOddsThousandths: 1900,
}

const byKey = (figures: ReturnType<typeof recordFigures>) =>
  new Map(figures.map((figure) => [figure.key, figure]))

describe('recordFigures', () => {
  it('shows real zero COUNTS for an empty record, and no value for the rates', () => {
    const figures = byKey(recordFigures(emptyRecord, null, LABELS))

    for (const key of ['settled', 'won', 'lost', 'void'] as const) {
      assert.equal(figures.get(key)?.value, '0', `${key} should be a real 0`)
      assert.equal(figures.get(key)?.empty, false)
    }

    // A rate over nothing is not 0 % and a sum over nothing is not 0,00 j.:
    // printing either would read as a result (rule 52).
    for (const key of ['profit', 'roi', 'averageOdds', 'drawdown'] as const) {
      assert.equal(figures.get(key)?.value, '—', `${key} should have no value`)
      assert.equal(figures.get(key)?.empty, true)
      assert.equal(figures.get(key)?.tone, 'default')
    }
  })

  it('returns all eight figures in reading order', () => {
    assert.deepEqual(
      recordFigures(emptyRecord, null, LABELS).map((figure) => figure.key),
      [
        'settled',
        'won',
        'lost',
        'void',
        'profit',
        'roi',
        'averageOdds',
        'drawdown',
      ],
    )
  })

  it('gives won and lost the same tone, whatever the numbers (rule 47)', () => {
    const figures = byKey(recordFigures(losingRecord, null, LABELS))

    assert.equal(figures.get('won')?.tone, figures.get('lost')?.tone)
    assert.equal(figures.get('lost')?.value, '3')
  })

  it('prints a loss as a loss, sign included', () => {
    const figures = byKey(
      recordFigures(
        losingRecord,
        {
          peakIndex: 0,
          troughIndex: 3,
          depthHundredths: 310,
          peakHundredths: 100,
          troughHundredths: -210,
        },
        LABELS,
      ),
    )

    assert.equal(figures.get('profit')?.tone, 'loss')
    assert.match(figures.get('profit')?.value ?? '', /^[-−]2,10 j\.$/)
    assert.equal(figures.get('roi')?.tone, 'loss')
    assert.match(figures.get('roi')?.value ?? '', /^[-−]52,50\s%$/)
    assert.equal(figures.get('averageOdds')?.value, '1,90')
    assert.equal(figures.get('drawdown')?.tone, 'loss')
    assert.match(figures.get('drawdown')?.value ?? '', /^[-−]3,10 j\.$/)
  })

  it('reports a record that never fell as a zero drawdown, not as missing', () => {
    const figures = byKey(
      recordFigures(
        { ...losingRecord, profitHundredths: 150, roiBasisPoints: 375 },
        {
          peakIndex: 0,
          troughIndex: 0,
          depthHundredths: 0,
          peakHundredths: 0,
          troughHundredths: 0,
        },
        LABELS,
      ),
    )

    assert.equal(figures.get('drawdown')?.empty, false)
    assert.equal(figures.get('drawdown')?.tone, 'default')
    assert.equal(figures.get('profit')?.tone, 'win')
  })
})

describe('sampleState (rules 51 and 52)', () => {
  it('distinguishes nothing, too little and enough', () => {
    assert.equal(sampleState(0), 'empty')
    assert.equal(sampleState(1), 'small')
    assert.equal(sampleState(SMALL_SAMPLE_THRESHOLD - 1), 'small')
    assert.equal(sampleState(SMALL_SAMPLE_THRESHOLD), 'sufficient')
  })

  it('uses the ~30 DESIGN.md names', () => {
    assert.equal(SMALL_SAMPLE_THRESHOLD, 30)
  })
})

describe('signTone', () => {
  it('treats zero as neutral, not as a win', () => {
    assert.equal(signTone(0), 'default')
    assert.equal(signTone(1), 'win')
    assert.equal(signTone(-1), 'loss')
  })
})

describe('latestResultRows', () => {
  const row = (
    id: number,
    publishedAt: string,
    result: ArchiveRow['result'],
    profitHundredths: number,
  ): ArchiveRow => ({
    id,
    slug: `fixture-${String(id)}`,
    title: `Fixture ${String(id)}`,
    sportCode: 'FOOTBALL',
    sportName: 'Fotbal',
    publishedAt,
    eventName: `Fixture event ${String(id)}`,
    selectionLabel: '1X2 1',
    legs: 1,
    oddsThousandths: 2100,
    stakeUnits: 1,
    result,
    profitHundredths,
    cumulativeHundredths: 0,
  })

  const rows: readonly ArchiveRow[] = [
    row(1, '2026-11-01T18:00:00Z', 'WON', 110),
    row(2, '2026-11-03T18:00:00Z', 'LOST', -100),
    row(3, '2026-11-02T18:00:00Z', 'VOID', 0),
    row(4, '2026-11-05T18:00:00Z', 'LOST', -100),
    row(5, '2026-11-04T18:00:00Z', 'WON', 90),
  ]

  it('is newest first, by publication date only', () => {
    assert.deepEqual(
      latestResultRows(rows, 'j.').map((view) => view.id),
      [4, 5, 2, 3, 1],
    )
  })

  it('keeps every loss in the excerpt: it never selects by result', () => {
    const shown = latestResultRows(rows, 'j.', 3)

    assert.deepEqual(
      shown.map((view) => view.result),
      ['LOST', 'WON', 'LOST'],
    )
  })

  it('formats odds, profit and dates the Czech way', () => {
    const [newest] = latestResultRows(rows, 'j.')

    assert.ok(newest)
    assert.equal(newest.odds, '2,10')
    assert.match(newest.profit, /^[-−]1,00 j\.$/)
    assert.equal(newest.profitTone, 'loss')
    assert.equal(newest.dateIso, '2026-11-05')
    assert.match(newest.date ?? '', /^5\.\s11\.\s2026$/)
    assert.equal(newest.href, '/tipy/fixture-4')
  })

  it('caps the excerpt and never goes negative', () => {
    assert.equal(LATEST_RESULTS_LIMIT, 8)
    assert.equal(latestResultRows(rows, 'j.', 2).length, 2)
    assert.equal(latestResultRows(rows, 'j.', -1).length, 0)
    assert.equal(latestResultRows([], 'j.').length, 0)
  })
})
