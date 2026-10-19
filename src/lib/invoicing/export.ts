/**
 * The shape an accountant needs, and a CSV of it.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THIS IS A CONVENIENCE, NOT THE SYSTEM OF RECORD
 *
 * Fakturoid holds the documents and exports to Pohoda and Money S3 natively,
 * so the accountant does not need this file to do their job. It stays because
 * it is the one view that joins the accounting document to OUR side of the
 * story — the Stripe payment id, the subscription, the location evidence —
 * which is what gets asked for when a payout has to be reconciled or a
 * cross-border threshold checked. Nobody should be told to use this instead
 * of Fakturoid's own export.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE NUMBERS ARE FAKTUROID'S
 *
 * `number` is whatever Fakturoid allocated, reported verbatim. We no longer
 * allocate our own, so there is no year/sequence pair to report either: the
 * provider owns the series and may format it however it likes. A row whose
 * document has not been issued yet carries an EMPTY number and says so in
 * `accountingState`, rather than being silently omitted — an unissued
 * document is exactly the thing somebody needs to see.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * EVERY ROW CARRIES ITS DOCUMENT TYPE
 *
 * Explicit, because an export is read by software that should not have to
 * infer meaning from a number's shape — and because a credit note is a
 * NEGATIVE entry in the books while an invoice is a positive one, which is
 * the single most important thing for a reader to get right.
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
  /** As issued by Fakturoid. Empty when the document has not been issued yet. */
  number: string
  /** PENDING / ISSUED / FAILED, so an unissued document is visible. */
  accountingState: string
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
 * Ordered by issue date, then by number. It used to be ordered by number
 * alone, because the series was ours and a gap in it was the thing being
 * audited. The series is Fakturoid's now and gaps in it are Fakturoid's
 * business, so date order — which is how a period is read — is the better
 * default. Rows with no number yet sort together at the end of their day.
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
      sort: 'issuedAt',
      where: range,
    }),
    payload.find({
      collection: 'credit-notes',
      depth: 1,
      limit: 0,
      pagination: false,
      overrideAccess: true,
      ...reqOption,
      sort: 'issuedAt',
      where: range,
    }),
  ])

  const rows: AccountingDocumentRow[] = []

  for (const invoice of invoices.docs) {
    const customer = invoice.customerSnapshot
    const service = invoice.serviceSnapshot

    rows.push({
      documentType: 'INVOICE',
      number: invoice.fakturoidNumber ?? '',
      accountingState: invoice.accountingState,
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
      number: note.fakturoidNumber ?? '',
      accountingState: note.accountingState,
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
      correctsNumber: invoice?.fakturoidNumber ?? '',
      correctionReason: note.reason,
      providerPaymentId: invoice?.providerPaymentId ?? '',
      deliveryState: note.deliveryState,
    })
  }

  return rows.sort(
    (a, b) =>
      a.issuedAt.localeCompare(b.issuedAt) || a.number.localeCompare(b.number),
  )
}

/* -------------------------------------------------------------------------- */
/* CSV                                                                        */
/* -------------------------------------------------------------------------- */

const COLUMNS: readonly (keyof AccountingDocumentRow)[] = [
  'documentType',
  'number',
  'accountingState',
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
  if (value === null || value === undefined) return '""'

  // A NUMBER is never a formula and must not be neutralised. Credit note
  // totals are negative by design, so guarding them would export every refund
  // as the text `'-79900` — which Excel reads as a label rather than an
  // amount, silently dropping refunds out of any sum the accountant takes.
  if (typeof value === 'number') {
    return `"${String(value)}"`
  }

  const text = String(value)
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
