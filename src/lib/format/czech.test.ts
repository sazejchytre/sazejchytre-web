/**
 * The formatters, including the Czech conventions that are easy to get wrong.
 *
 * `Intl` output varies a little between ICU versions, so these assert the
 * things that MATTER — the separator characters, the sign, the ordering, the
 * plural form — rather than exact strings that would break on a Node upgrade
 * for no reason.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  formatCount,
  formatDate,
  formatDateIso,
  formatOdds,
  formatProfitUnits,
  formatRoi,
  formatTipCount,
} from './czech.ts'

describe('odds', () => {
  it('turns thousandths into a two-decimal price', () => {
    // A comma, because this is Czech. A dot here is the single most common
    // formatting bug on a Czech site.
    assert.equal(formatOdds(2345), '2,35')
    assert.equal(formatOdds(2000), '2,00')
    assert.equal(formatOdds(1800), '1,80')
  })

  it('always shows two decimals, so a column lines up', () => {
    for (const thousandths of [1500, 2000, 10_000]) {
      assert.match(
        formatOdds(thousandths),
        /,\d{2}$/,
        `${String(thousandths)} should end in two decimals`,
      )
    }
  })
})

describe('profit', () => {
  it('shows the sign, including the plus', () => {
    // A column where gains have no sign reads as though they were neutral.
    assert.match(formatProfitUnits(575), /^\+5,75$/)
    assert.match(formatProfitUnits(-300), /^−?-?3,00$/)
    assert.equal(formatProfitUnits(0), '0,00')
  })

  it('does not lose the minus on a loss', () => {
    const text = formatProfitUnits(-100)

    // Intl may use U+2212 MINUS SIGN rather than a hyphen. Either is fine;
    // neither being present is not.
    assert.ok(
      text.includes('-') || text.includes('−'),
      `a loss must be visibly negative, got ${JSON.stringify(text)}`,
    )
  })
})

describe('ROI', () => {
  it('formats basis points as a signed percentage', () => {
    const text = formatRoi(3833)

    assert.ok(text)
    assert.match(text, /38,33/)
    assert.match(text, /%/)
    assert.match(text, /^\+/)
  })

  it('puts a space before the percent sign, as Czech does', () => {
    const text = formatRoi(3833)

    assert.ok(text)
    // Intl uses a non-breaking space here; assert a space of some kind rather
    // than the exact codepoint.
    assert.match(text, /\d[\s  ]%/)
  })

  it('returns null for a null ROI rather than inventing a zero', () => {
    // THE void case: a record where every tip was void has nothing staked.
    // "0 %" would be a claim about money that was never at risk.
    assert.equal(formatRoi(null), null)
  })

  it('shows a negative ROI without flinching', () => {
    const text = formatRoi(-10_000)

    assert.ok(text)
    assert.match(text, /100/)
    assert.ok(text.includes('-') || text.includes('−'))
  })
})

describe('dates', () => {
  it('uses the Czech day-first form', () => {
    const text = formatDate('2026-11-05T12:00:00.000Z')

    assert.match(text, /^5\.\s*11\.\s*2026$/)
  })

  it('formats in Prague, not UTC', () => {
    // 23:30 UTC on the 4th is 00:30 on the 5th in Prague. Formatting in UTC
    // would file a tip under the wrong day, and the table and the analysis
    // text would then disagree about when it happened.
    assert.match(formatDate('2026-11-04T23:30:00.000Z'), /^5\./)
  })

  it('produces a Prague-dated ISO string, not a UTC one', () => {
    // `toISOString()` would give 2026-11-04 here, which is the bug this
    // helper exists to avoid.
    assert.equal(formatDateIso('2026-11-04T23:30:00.000Z'), '2026-11-05')
  })

  it('handles summer time too', () => {
    // CEST is +2, so 22:30 UTC in July is already the next day in Prague.
    assert.equal(formatDateIso('2026-07-14T22:30:00.000Z'), '2026-07-15')
  })
})

describe('counts and plurals', () => {
  it('groups thousands without a comma', () => {
    const text = formatCount(1234)

    assert.ok(!text.includes(','), 'a comma here would read as a decimal')
    assert.match(text, /^1[\s  ]234$/)
  })

  it('picks the right Czech plural form for each count', () => {
    // Czech has three. Hard-coding "tipů" reads as broken Czech for exactly
    // the counts a new site has.
    assert.match(formatTipCount(1), /\b1 tip$/)
    assert.match(formatTipCount(2), /2 tipy$/)
    assert.match(formatTipCount(4), /4 tipy$/)
    assert.match(formatTipCount(5), /5 tipů$/)
    assert.match(formatTipCount(0), /0 tipů$/)
    assert.match(formatTipCount(11), /11 tipů$/)
  })
})
