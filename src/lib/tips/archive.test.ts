import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { ArchiveSelection, ArchiveTip } from './archive.ts'
import {
  EMPTY_FILTER,
  archiveQueryString,
  buildArchiveRows,
  filterArchiveRows,
  hasActiveFilter,
  parseArchiveQuery,
  sortArchiveRows,
} from './archive.ts'

const leg = (
  outcome: ArchiveSelection['outcome'],
  oddsAtPublication: number,
  eventName = 'Slavia – Plzeň',
): ArchiveSelection => ({
  outcome,
  oddsAtPublication,
  market: '1X2',
  selection: '1',
  line: null,
  eventName,
})

const tip = (
  id: number,
  publishedAt: string,
  outcome: ArchiveSelection['outcome'],
  options: {
    sportCode?: string
    sportName?: string
    odds?: number
    stakeUnits?: number
  } = {},
): ArchiveTip => ({
  id,
  slug: `tip-${id}`,
  title: `Tip ${id}`,
  sportCode: options.sportCode ?? 'FOOTBALL',
  sportName: options.sportName ?? 'Fotbal',
  status: 'SETTLED',
  publishedAt,
  stakeUnits: options.stakeUnits ?? 1,
  selections: [leg(outcome, options.odds ?? 2000)],
})

/* -------------------------------------------------------------------------- */

describe('buildArchiveRows', () => {
  it('returns settled tips newest first', () => {
    const rows = buildArchiveRows([
      tip(1, '2026-03-01T10:00:00.000Z', 'WON'),
      tip(2, '2026-03-05T10:00:00.000Z', 'LOST'),
    ])

    assert.deepEqual(
      rows.map((row) => row.id),
      [2, 1],
    )
  })

  it('leaves unsettled tips out', () => {
    const published: ArchiveTip = {
      ...tip(3, '2026-03-07T10:00:00.000Z', 'PENDING'),
      status: 'PUBLISHED',
    }

    const rows = buildArchiveRows([
      tip(1, '2026-03-01T10:00:00.000Z', 'WON'),
      published,
    ])

    assert.equal(rows.length, 1)
  })

  it('carries the cumulative total of the WHOLE record, not of the view', () => {
    // The row for tip 1 must say +1.00 whether or not tip 2 is on screen.
    const tips = [
      tip(1, '2026-03-01T10:00:00.000Z', 'WON'),
      tip(2, '2026-03-02T10:00:00.000Z', 'LOST'),
    ]

    const rows = buildArchiveRows(tips)
    const first = rows.find((row) => row.id === 1)

    assert.equal(first?.cumulativeHundredths, 100)

    const filtered = filterArchiveRows(rows, {
      ...EMPTY_FILTER,
      from: '2026-03-01',
      to: '2026-03-01',
    })

    assert.equal(filtered[0]?.cumulativeHundredths, 100)
  })

  it('keeps a void tip in the table with zero profit', () => {
    const rows = buildArchiveRows([tip(1, '2026-03-01T10:00:00.000Z', 'VOID')])

    assert.equal(rows[0]?.result, 'VOID')
    assert.equal(rows[0]?.profitHundredths, 0)
  })
})

/* -------------------------------------------------------------------------- */

describe('the filter cannot exclude a loss', () => {
  it('has exactly three fields, and none of them is a result', () => {
    // The guard that matters. If a fourth key appears here, a result filter
    // has become expressible and the history stops proving anything.
    assert.deepEqual(Object.keys(EMPTY_FILTER).sort(), ['from', 'sport', 'to'])
  })

  it('keeps or drops two otherwise-identical rows together, whatever their results', () => {
    // Same sport, same day, different outcomes. No filter may separate them.
    const rows = buildArchiveRows([
      tip(1, '2026-03-01T10:00:00.000Z', 'WON'),
      tip(2, '2026-03-01T12:00:00.000Z', 'LOST'),
      tip(3, '2026-03-01T14:00:00.000Z', 'VOID'),
    ])

    const filters = [
      EMPTY_FILTER,
      { sport: 'FOOTBALL', from: null, to: null },
      { sport: null, from: '2026-03-01', to: '2026-03-01' },
      { sport: 'FOOTBALL', from: '2026-03-01', to: '2026-03-31' },
      { sport: 'HOCKEY', from: null, to: null },
      { sport: null, from: '2026-04-01', to: null },
    ]

    for (const filter of filters) {
      const kept = filterArchiveRows(rows, filter)

      // All three or none. Any other count means the filter separated rows
      // that differ ONLY by their result, which is the thing that must be
      // impossible.
      assert.ok(
        kept.length === 0 || kept.length === 3,
        `filter ${JSON.stringify(filter)} kept ${kept.length} of 3 rows that ` +
          'differ only by result',
      )
    }
  })

  it('narrows by sport', () => {
    const rows = buildArchiveRows([
      tip(1, '2026-03-01T10:00:00.000Z', 'WON'),
      tip(2, '2026-03-02T10:00:00.000Z', 'LOST', {
        sportCode: 'HOCKEY',
        sportName: 'Hokej',
      }),
    ])

    const kept = filterArchiveRows(rows, { ...EMPTY_FILTER, sport: 'HOCKEY' })

    assert.deepEqual(
      kept.map((row) => row.id),
      [2],
    )
  })

  it('treats the date boundaries as Prague days, not UTC days', () => {
    // 2026-03-01T23:30Z is already 2 March in Prague (UTC+1 in winter). A
    // filter for "1 March" must not include it, and a filter for "2 March"
    // must.
    const rows = buildArchiveRows([tip(1, '2026-03-01T23:30:00.000Z', 'WON')])

    const firstOfMarch = filterArchiveRows(rows, {
      ...EMPTY_FILTER,
      from: '2026-03-01',
      to: '2026-03-01',
    })
    const secondOfMarch = filterArchiveRows(rows, {
      ...EMPTY_FILTER,
      from: '2026-03-02',
      to: '2026-03-02',
    })

    assert.equal(firstOfMarch.length, 0)
    assert.equal(secondOfMarch.length, 1)
  })

  it('ignores a malformed date rather than guessing at it', () => {
    const query = parseArchiveQuery({ od: 'vcera' })

    assert.equal(query.filter.from, null)
  })
})

/* -------------------------------------------------------------------------- */

describe('sortArchiveRows', () => {
  const rows = buildArchiveRows([
    tip(1, '2026-03-01T10:00:00.000Z', 'WON', { odds: 1500, stakeUnits: 3 }),
    tip(2, '2026-03-02T10:00:00.000Z', 'LOST', { odds: 3000, stakeUnits: 1 }),
    tip(3, '2026-03-03T10:00:00.000Z', 'WON', { odds: 2000, stakeUnits: 2 }),
  ])

  it('sorts by date descending by default', () => {
    assert.deepEqual(
      sortArchiveRows(rows).map((row) => row.id),
      [3, 2, 1],
    )
  })

  it('sorts by odds in both directions', () => {
    assert.deepEqual(
      sortArchiveRows(rows, 'odds', 'asc').map((row) => row.oddsThousandths),
      [1500, 2000, 3000],
    )
    assert.deepEqual(
      sortArchiveRows(rows, 'odds', 'desc').map((row) => row.oddsThousandths),
      [3000, 2000, 1500],
    )
  })

  it('sorts by profit, losses included', () => {
    const sorted = sortArchiveRows(rows, 'profit', 'asc')

    // The loss sorts to the front rather than being dropped.
    assert.equal(sorted[0]?.result, 'LOST')
  })

  it('never removes a row, whatever it is sorted by', () => {
    for (const key of [
      'date',
      'sport',
      'odds',
      'stake',
      'profit',
      'cumulative',
    ] as const) {
      assert.equal(sortArchiveRows(rows, key, 'asc').length, rows.length)
    }
  })

  it('leaves the input array untouched', () => {
    const before = rows.map((row) => row.id)
    sortArchiveRows(rows, 'odds', 'asc')

    assert.deepEqual(
      rows.map((row) => row.id),
      before,
    )
  })
})

/* -------------------------------------------------------------------------- */

describe('parseArchiveQuery', () => {
  it('falls back to the default view for an empty query', () => {
    const query = parseArchiveQuery({})

    assert.equal(query.sort, 'date')
    assert.equal(query.direction, 'desc')
    assert.deepEqual(query.filter, EMPTY_FILTER)
  })

  it('ignores an unknown sort key rather than erroring', () => {
    assert.equal(parseArchiveQuery({ razeni: 'vysledek' }).sort, 'date')
  })

  it('reads the Czech parameter names', () => {
    const query = parseArchiveQuery({
      razeni: 'odds',
      smer: 'asc',
      sport: 'HOCKEY',
      od: '2026-03-01',
      do: '2026-03-31',
    })

    assert.deepEqual(query, {
      sort: 'odds',
      direction: 'asc',
      filter: { sport: 'HOCKEY', from: '2026-03-01', to: '2026-03-31' },
    })
  })

  it('takes the first value when a parameter is repeated', () => {
    assert.equal(parseArchiveQuery({ sport: ['A', 'B'] }).filter.sport, 'A')
  })
})

describe('archiveQueryString', () => {
  it('is empty for the default view, so the canonical URL stays clean', () => {
    assert.equal(
      archiveQueryString({
        sort: 'date',
        direction: 'desc',
        filter: EMPTY_FILTER,
      }),
      '',
    )
  })

  it('round-trips through parseArchiveQuery', () => {
    const query = {
      sort: 'profit' as const,
      direction: 'asc' as const,
      filter: { sport: 'HOCKEY', from: '2026-03-01', to: '2026-03-31' },
    }

    const params = Object.fromEntries(
      new URLSearchParams(archiveQueryString(query).slice(1)),
    )

    assert.deepEqual(parseArchiveQuery(params), query)
  })

  it('keeps the filter on a sort link', () => {
    // Otherwise clicking a column header silently resets the filter.
    const encoded = archiveQueryString({
      sort: 'odds',
      direction: 'desc',
      filter: { sport: 'HOCKEY', from: null, to: null },
    })

    assert.match(encoded, /sport=HOCKEY/)
  })
})

describe('hasActiveFilter', () => {
  it('is false for the empty filter', () => {
    assert.equal(hasActiveFilter(EMPTY_FILTER), false)
  })

  it('is true as soon as anything is set', () => {
    assert.equal(hasActiveFilter({ ...EMPTY_FILTER, sport: 'HOCKEY' }), true)
    assert.equal(hasActiveFilter({ ...EMPTY_FILTER, from: '2026-03-01' }), true)
    assert.equal(hasActiveFilter({ ...EMPTY_FILTER, to: '2026-03-01' }), true)
  })
})
