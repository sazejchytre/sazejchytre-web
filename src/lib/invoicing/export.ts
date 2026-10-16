/**
 * The shape an accountant needs, and a CSV of it.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY A TYPE AND NOT JUST A QUERY
 *
 * Whatever this feeds — a CSV today, Fakturoid's API later, an accountant's
 * own template — the set of facts per document is the same, and it is worth
 * naming once. `docs/accounting-integration.md` maps these fields onto
 * Fakturoid; if that mapping is ever built, it consumes this type rather than
 * re-deriving everything from the collections.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * EVERY ROW CARRIES ITS DOCUMENT TYPE
 *
 * Invoices and credit notes live in separate series (FA…, OD…), so the
 * numbers cannot collide. The type column is still explicit, because an
 * export is read by software that should not have to infer meaning from a
 * prefix — and because a credit note is a NEGATIVE entry in the books while
 * an invoice is a positive one, which is the single most important thing for
 * a reader to get right.
 *
 * Amounts stay in MINOR UNITS in the typed shape and are formatted only at
 * the CSV boundary. A float in an accounting export is how a rounding
 * difference enters somebody's ledger.
 */
import type { Payload, PayloadRequest } from 'payload'

import type { Currency, TaxTreatment } from '../billing/constants.ts'

export type AccountingDocumentType = 'INVOICE' | 'CREDIT_NOTE'

export type AccountingDocumentRow = {
  documentType: AccountingDocumentType
  /** `FA2026-000001` / `OD2026-000001`. */
  number: string
  numberYear: number
  numberSequence: number
  /** Datum vystavení. */
  issuedAt: string
  /** Datum uskutečnění plnění. Equal to `issuedAt` for a credit note. */
  taxableSupplyDate: string
  currency: Currency
  /**
   * Signed minor units: positive for an invoice, NEGATIVE for a credit note.
   *
   * Signed so a sum over a period is the period's revenue without the reader
   * having to know which rows to subtract.
   */
  totalMinor: number
  subtotalMinor: number
  taxMinor: number
  taxRateBasisPoints: number
  taxTreatment: TaxTreatment | 'N/A'
  customerName: string
  customerEmail: string
  customerCountry: string
  /** What was sold, as printed. */
  description: string
  /** Credit notes: the invoice corrected, and why. Empty for invoices. */
  correctsNumber: string
  correctionReason: string
  /** The provider payment, so a bank or Stripe payout can be reconciled. */
  providerPaymentId: string
  /** PENDING / SENT / FAILED, so unsent documents are visible to a human. */
  deliveryState: string
}

/* -------------------------------------------------------------------------- */
/* Gathering                                                                  */
/* -------------------------------------------------------------------------- */

export type ExportRangeArgs = {
  payload: Payload
  req?: PayloadRequest
  /** Inclusive. */
  from: Date
  /** Inclusive of the whole day. */
  to: Date
}

/**
 * Every document issued in a date range, ordered as an accountant reads them.
 *
 * Ordered by number within year rather than by timestamp: the series is the
 * thing being audited, and a gap is only visible when the rows are in series
 * order.
 */
export const collectAccountingRows = async ({
  payload,
  req,
  from,
  to,
}: ExportRangeArgs): Promise<AccountingDocumentRow[]> => {
  const reqOption = req ? { req } : {}

  // End of the `to` day, so a range given as two dates includes both.
  const toInclusive = new Date(to)
  toInclusive.setUTCHours(23, 59, 59, 999)

  const range = {
    issuedAt: {
      greater_than_equal: from.toISOString(),
      less_than_equal: toInclusive.toISOString(),
    },
  }

  const [invoices, creditNotes] = await Promise.all([
    payload.find({
      collection: 'invoices',
      depth: 0,
      limit: 0,
      pagination: false,
      overrideAccess: true,
      ...reqOption,
      sort: 'number',
      where: range,
    }),
    payload.find({
      collection: 'credit-notes',
      depth: 1,
      limit: 0,
      pagination: false,
      overrideAccess: true,
      ...reqOption,
      sort: 'number',
      where: range,
    }),
  ])

  const rows: AccountingDocumentRow[] = []

  for (const invoice of invoices.docs) {
    const customer = invoice.customerSnapshot
    const service = invoice.serviceSnapshot

    rows.push({
      documentType: 'INVOICE',
      number: invoice.number,
      numberYear: invoice.numberYear,
      numberSequence: invoice.numberSequence,
      issuedAt: invoice.issuedAt,
      taxableSupplyDate: invoice.taxableSupplyDate,
      currency: invoice.currency as Currency,
      totalMinor: invoice.totalMinor,
      subtotalMinor: invoice.subtotalMinor,
      taxMinor: invoice.taxMinor,
      taxRateBasisPoints: invoice.taxRateBasisPoints,
      taxTreatment: invoice.taxTreatment as TaxTreatment,
      customerName: customer.name,
      customerEmail: customer.email,
      customerCountry: customer.country,
      description: service.description,
      correctsNumber: '',
      correctionReason: '',
      providerPaymentId: invoice.providerPaymentId ?? '',
      deliveryState: invoice.deliveryState,
    })
  }

  for (const note of creditNotes.docs) {
    const invoice =
      typeof note.invoice === 'object' && note.invoice !== null
        ? note.invoice
        : null

    rows.push({
      documentType: 'CREDIT_NOTE',
      number: note.number,
      numberYear: note.numberYear,
      numberSequence: note.numberSequence,
      issuedAt: note.issuedAt,
      // A credit note has no separate supply date: the correction takes
      // effect when it is issued.
      taxableSupplyDate: note.issuedAt,
      currency: note.currency as Currency,
      // NEGATIVE. See the note on the field.
      totalMinor: -note.amountMinor,
      subtotalMinor: -note.amountMinor,
      taxMinor: 0,
      taxRateBasisPoints: 0,
      taxTreatment: invoice
        ? (invoice.taxTreatment as TaxTreatment)
        : 'NONE_NOT_VAT_REGISTERED',
      customerName: invoice?.customerSnapshot.name ?? '',
      customerEmail: invoice?.customerSnapshot.email ?? '',
      customerCountry: invoice?.customerSnapshot.country ?? '',
      description: invoice?.serviceSnapshot.description ?? '',
      correctsNumber: invoice?.number ?? '',
      correctionReason: note.reason,
      providerPaymentId: invoice?.providerPaymentId ?? '',
      deliveryState: note.deliveryState,
    })
  }

  return rows.sort((a, b) => a.number.localeCompare(b.number))
}

/* -------------------------------------------------------------------------- */
/* CSV                                                                        */
/* -------------------------------------------------------------------------- */

const COLUMNS: readonly (keyof AccountingDocumentRow)[] = [
  'documentType',
  'number',
  'numberYear',
  'numberSequence',
  'issuedAt',
  'taxableSupplyDate',
  'currency',
  'subtotalMinor',
  'taxMinor',
  'totalMinor',
  'taxRateBasisPoints',
  'taxTreatment',
  'customerName',
  'customerEmail',
  'customerCountry',
  'description',
  'correctsNumber',
  'correctionReason',
  'providerPaymentId',
  'deliveryState',
]

/**
 * Quote a CSV field.
 *
 * Always quoted, never conditionally. A conditional quoter has to decide
 * whether a value "needs" it, and the value that breaks the file is always the
 * one nobody thought of — a Czech name with a comma, a correction reason with
 * a newline.
 *
 * Also guards against formula injection: a field starting with `=`, `+`, `-`
 * or `@` is executed by Excel when the file is opened. An accountant opening
 * an export in Excel must not be running anything.
 */
const csvField = (value: unknown): string => {
  const text = value === null || value === undefined ? '' : String(value)
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text

  return `"${guarded.replace(/"/g, '""')}"`
}

/**
 * Render rows as CSV.
 *
 * CRLF line endings and a UTF-8 BOM, because the reader is Excel on a Czech
 * Windows machine: without the BOM it decodes the file as the system code page
 * and every diacritic in every customer name is mangled.
 */
export const toAccountingCsv = (
  rows: readonly AccountingDocumentRow[],
): string => {
  const lines = [
    COLUMNS.map(csvField).join(','),
    ...rows.map((row) =>
      COLUMNS.map((column) => csvField(row[column])).join(','),
    ),
  ]

  return `﻿${lines.join('\r\n')}\r\n`
}
