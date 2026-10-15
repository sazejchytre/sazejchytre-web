import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type {
  CreditNoteRevenueSnapshot,
  InvoiceRevenueSnapshot,
} from './eu-revenue.ts'
import { euRevenueTotalMinor, euRevenueTotalsMinor } from './eu-revenue.ts'

const FROM = new Date('2026-01-01T00:00:00.000Z')
const TO = new Date('2027-01-01T00:00:00.000Z')

const invoice = (
  overrides: Partial<InvoiceRevenueSnapshot> = {},
): InvoiceRevenueSnapshot => ({
  billingCountry: 'SK',
  currency: 'CZK',
  totalMinor: 34_900,
  issuedAt: new Date('2026-06-01T00:00:00.000Z'),
  status: 'ISSUED',
  ...overrides,
})

const creditNote = (
  overrides: Partial<CreditNoteRevenueSnapshot> = {},
): CreditNoteRevenueSnapshot => ({
  billingCountry: 'SK',
  currency: 'CZK',
  amountMinor: 10_000,
  issuedAt: new Date('2026-07-01T00:00:00.000Z'),
  ...overrides,
})

describe('euRevenueTotalMinor', () => {
  it('sums cross-border invoices', () => {
    const total = euRevenueTotalMinor(
      [invoice(), invoice({ totalMinor: 79_900 })],
      FROM,
      TO,
      'CZK',
    )

    assert.equal(total, 114_800)
  })

  it('excludes domestic supplies', () => {
    const total = euRevenueTotalMinor(
      [invoice({ billingCountry: 'CZ' }), invoice({ billingCountry: 'cz' })],
      FROM,
      TO,
      'CZK',
    )

    assert.equal(total, 0)
  })

  it('excludes invoices outside the window', () => {
    const total = euRevenueTotalMinor(
      [
        invoice({ issuedAt: new Date('2025-12-31T23:59:59.999Z') }),
        invoice({ issuedAt: new Date('2027-01-01T00:00:00.000Z') }),
      ],
      FROM,
      TO,
      'CZK',
    )

    assert.equal(total, 0)
  })

  it('treats the window as half-open so consecutive periods tile', () => {
    const atStart = invoice({ issuedAt: FROM })
    const atEnd = invoice({ issuedAt: TO })

    // `from` is included, `to` is not — so the same document is never counted
    // in two adjacent periods.
    assert.equal(euRevenueTotalMinor([atStart], FROM, TO, 'CZK'), 34_900)
    assert.equal(euRevenueTotalMinor([atEnd], FROM, TO, 'CZK'), 0)
  })

  it('excludes fully credited invoices', () => {
    const total = euRevenueTotalMinor(
      [invoice({ status: 'CREDITED' })],
      FROM,
      TO,
      'CZK',
    )

    assert.equal(total, 0)
  })

  it('does not count a row with no recorded country as cross-border', () => {
    // Unknown must not be guessed as foreign: that would raise a false alarm
    // on the threshold. Such rows are a data defect to find.
    const total = euRevenueTotalMinor(
      [invoice({ billingCountry: null })],
      FROM,
      TO,
      'CZK',
    )

    assert.equal(total, 0)
  })

  it('nets credit notes, including partial ones', () => {
    const total = euRevenueTotalMinor([invoice()], FROM, TO, 'CZK', {
      creditNotes: [creditNote()],
    })

    assert.equal(total, 24_900)
  })

  it('ignores credit notes outside the window', () => {
    const total = euRevenueTotalMinor([invoice()], FROM, TO, 'CZK', {
      creditNotes: [
        creditNote({ issuedAt: new Date('2027-02-01T00:00:00.000Z') }),
      ],
    })

    assert.equal(total, 34_900)
  })

  it('honours an alternative home country', () => {
    const total = euRevenueTotalMinor(
      [invoice({ billingCountry: 'SK' })],
      FROM,
      TO,
      'CZK',
      { homeCountry: 'SK' },
    )

    assert.equal(total, 0)
  })

  it('throws on an unparseable issuedAt', () => {
    assert.throws(
      () =>
        euRevenueTotalMinor(
          [invoice({ issuedAt: 'not-a-date' })],
          FROM,
          TO,
          'CZK',
        ),
      /Invalid issuedAt/,
    )
  })
})

describe('euRevenueTotalsMinor', () => {
  it('keeps currencies apart rather than blending them', () => {
    // Adding CZK to EUR would need an FX rate, and inventing one in a helper
    // buries a financial assumption. Each currency is reported separately.
    const totals = euRevenueTotalsMinor(
      [
        invoice({ currency: 'CZK', totalMinor: 34_900 }),
        invoice({ currency: 'EUR', totalMinor: 1_499 }),
      ],
      FROM,
      TO,
    )

    assert.equal(totals.CZK, 34_900)
    assert.equal(totals.EUR, 1_499)
  })

  it('reports zero for a currency with no activity', () => {
    const totals = euRevenueTotalsMinor([invoice()], FROM, TO)

    assert.equal(totals.EUR, 0)
  })

  it('returns zeros for an empty ledger', () => {
    const totals = euRevenueTotalsMinor([], FROM, TO)

    assert.equal(totals.CZK, 0)
    assert.equal(totals.EUR, 0)
  })
})
