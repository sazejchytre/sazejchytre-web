import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { type AccountingDocumentRow, toAccountingCsv } from './export.ts'

const row = (
  parts: Partial<AccountingDocumentRow> = {},
): AccountingDocumentRow => ({
  documentType: 'INVOICE',
  // Fakturoid's format, not ours. We no longer allocate numbers.
  number: '2026-0001',
  accountingState: 'ISSUED',
  issuedAt: '2026-10-16T09:00:00.000Z',
  taxableSupplyDate: '2026-10-16T00:00:00.000Z',
  currency: 'CZK',
  totalMinor: 79_900,
  subtotalMinor: 79_900,
  taxMinor: 0,
  taxRateBasisPoints: 0,
  taxTreatment: 'NONE_NOT_VAT_REGISTERED',
  customerName: 'Žluťoučký Kůň',
  customerEmail: 'kun@example.test',
  customerCountry: 'CZ',
  description: 'Předplatné služby sazejchytre.cz – tarif PRO',
  correctsNumber: '',
  correctionReason: '',
  providerPaymentId: 'pi_123',
  deliveryState: 'SENT',
  ...parts,
})

describe('accounting CSV', () => {
  it('starts with a UTF-8 BOM', () => {
    // Without it Excel on a Czech Windows machine decodes the file as the
    // system code page and mangles every diacritic in every customer name.
    assert.ok(toAccountingCsv([]).startsWith('﻿'))
  })

  it('uses CRLF line endings', () => {
    const csv = toAccountingCsv([row()])

    assert.ok(csv.includes('\r\n'))
    assert.ok(csv.endsWith('\r\n'))
  })

  it('keeps Czech diacritics intact', () => {
    const csv = toAccountingCsv([row()])

    assert.ok(csv.includes('Žluťoučký Kůň'))
    assert.ok(csv.includes('Předplatné'))
  })

  it('quotes every field, so a comma in a name cannot shift a column', () => {
    const csv = toAccountingCsv([row({ customerName: 'Novák, Jan' })])
    const dataLine = csv.split('\r\n')[1] ?? ''

    assert.ok(dataLine.includes('"Novák, Jan"'))
    // Header and data must agree on column count, which is the thing a
    // mis-quoted comma breaks.
    const header = (csv.split('\r\n')[0] ?? '').split('","').length
    assert.equal(dataLine.split('","').length, header)
  })

  it('doubles an embedded quote rather than ending the field', () => {
    const csv = toAccountingCsv([row({ customerName: 'A "B" C' })])

    assert.ok(csv.includes('"A ""B"" C"'))
  })

  it('survives a newline inside a correction reason', () => {
    const csv = toAccountingCsv([
      row({ correctionReason: 'line one\nline two' }),
    ])

    // Still exactly two CRLF-terminated records: header and one row. A raw
    // newline leaking out would make the file one record longer than the
    // number of documents.
    assert.equal(csv.trimEnd().split('\r\n').length, 2)
  })

  describe('formula injection', () => {
    it('neutralises a field that would execute in Excel', () => {
      // An accountant opening an export must not be running anything. Czech
      // company names starting with a hyphen are rare but `=`-prefixed
      // values arrive from anywhere user input reaches.
      for (const dangerous of ['=1+1', '+1', '-1', '@SUM(A1)']) {
        const csv = toAccountingCsv([row({ customerName: dangerous })])

        assert.ok(
          csv.includes(`"'${dangerous}"`),
          `${dangerous} was not neutralised`,
        )
      }
    })

    it('leaves an ordinary value alone', () => {
      const csv = toAccountingCsv([row({ customerName: 'Jan Novák' })])

      assert.ok(csv.includes('"Jan Novák"'))
      assert.equal(csv.includes('"\'Jan'), false)
    })
  })

  it('writes a credit note as a negative total', () => {
    // So a sum over the period is the period's revenue, without the reader
    // having to know which rows to subtract.
    const csv = toAccountingCsv([
      row(),
      row({
        documentType: 'CREDIT_NOTE',
        number: 'OD2026-000001',
        totalMinor: -79_900,
        subtotalMinor: -79_900,
        correctsNumber: 'FA2026-000001',
        correctionReason: 'Vráceno na žádost zákazníka',
      }),
    ])

    assert.ok(csv.includes('"-79900"'))
    assert.ok(csv.includes('"OD2026-000001"'))
    assert.ok(csv.includes('"FA2026-000001"'))
  })

  it('names the document type on every row', () => {
    const csv = toAccountingCsv([row(), row({ documentType: 'CREDIT_NOTE' })])
    const lines = csv.trimEnd().split('\r\n')

    // The BOM sits in front of the header, so strip it before comparing.
    assert.ok((lines[0] ?? '').replace(/^﻿/, '').startsWith('"documentType"'))
    assert.ok((lines[1] ?? '').startsWith('"INVOICE"'))
    assert.ok((lines[2] ?? '').startsWith('"CREDIT_NOTE"'))
  })

  it('renders a header even with no documents', () => {
    // An empty period is a valid answer and the accountant still needs the
    // columns to paste into their template.
    const csv = toAccountingCsv([])

    assert.equal(csv.trimEnd().split('\r\n').length, 1)
    assert.ok(csv.includes('"totalMinor"'))
  })

  it('carries the amounts as integer minor units', () => {
    const csv = toAccountingCsv([row({ totalMinor: 79_900 })])

    // Never 799.00: a float in an accounting export is how a rounding
    // difference enters somebody's ledger.
    assert.ok(csv.includes('"79900"'))
    assert.equal(csv.includes('799.00'), false)
  })
})
