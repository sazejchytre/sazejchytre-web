import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  SEQUENCE_DIGITS,
  SERIES_PREFIX,
  formatDocumentNumber,
  isContiguousFromOne,
  parseDocumentNumber,
} from './document-number.ts'

describe('formatDocumentNumber', () => {
  it('renders an invoice number', () => {
    assert.equal(formatDocumentNumber('INVOICE', 2026, 1), 'FA2026-000001')
    assert.equal(
      formatDocumentNumber('INVOICE', 2026, 123_456),
      'FA2026-123456',
    )
  })

  it('renders a credit note in its own series', () => {
    // Separate prefixes make it impossible to mistake one document for the
    // other, and the two series are numbered independently.
    assert.equal(formatDocumentNumber('CREDIT_NOTE', 2026, 1), 'OD2026-000001')
    assert.notEqual(SERIES_PREFIX.INVOICE, SERIES_PREFIX.CREDIT_NOTE)
  })

  it('zero-pads so lexical order matches numeric order', () => {
    const numbers = [1, 2, 10, 99, 100].map((n) =>
      formatDocumentNumber('INVOICE', 2026, n),
    )

    assert.deepEqual([...numbers].sort(), numbers)
  })

  it('rejects a sequence of zero or below', () => {
    assert.throws(() => formatDocumentNumber('INVOICE', 2026, 0), RangeError)
    assert.throws(() => formatDocumentNumber('INVOICE', 2026, -1), RangeError)
  })

  it('rejects a sequence that would not fit the padding', () => {
    const tooBig = 10 ** SEQUENCE_DIGITS

    assert.throws(
      () => formatDocumentNumber('INVOICE', 2026, tooBig),
      RangeError,
    )
  })

  it('rejects a fractional sequence', () => {
    assert.throws(() => formatDocumentNumber('INVOICE', 2026, 1.5), RangeError)
  })

  it('rejects an implausible year', () => {
    assert.throws(() => formatDocumentNumber('INVOICE', 199, 1), RangeError)
    assert.throws(() => formatDocumentNumber('INVOICE', 20_260, 1), RangeError)
  })
})

describe('parseDocumentNumber', () => {
  it('round-trips every series', () => {
    for (const series of ['INVOICE', 'CREDIT_NOTE'] as const) {
      const rendered = formatDocumentNumber(series, 2026, 42)

      assert.deepEqual(parseDocumentNumber(rendered), {
        series,
        year: 2026,
        sequence: 42,
      })
    }
  })

  it('rejects a malformed number', () => {
    for (const bad of [
      'FA2026-1',
      'FA26-000001',
      '2026-000001',
      'XX2026-000001',
    ]) {
      assert.throws(() => parseDocumentNumber(bad), RangeError, bad)
    }
  })
})

describe('isContiguousFromOne', () => {
  it('accepts a complete run regardless of order', () => {
    assert.equal(isContiguousFromOne([1, 2, 3, 4, 5]), true)
    assert.equal(isContiguousFromOne([3, 1, 5, 2, 4]), true)
    assert.equal(isContiguousFromOne([1]), true)
    assert.equal(isContiguousFromOne([]), true)
  })

  it('rejects a gap — the defect a tax inspection looks for', () => {
    assert.equal(isContiguousFromOne([1, 2, 4]), false)
  })

  it('rejects a duplicate', () => {
    assert.equal(isContiguousFromOne([1, 2, 2, 3]), false)
  })

  it('rejects a run that does not start at 1', () => {
    assert.equal(isContiguousFromOne([2, 3, 4]), false)
  })
})
