/**
 * Rendering a document to PDF.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THE FONT IS EMBEDDED
 *
 * The built-in PDF fonts use WinAnsi encoding, which does not contain č, ř,
 * ž, ě, ů, ň, ď or ť. A Czech invoice set in Helvetica is therefore not a
 * Czech invoice — it is one with holes in the customer's name.
 *
 * So DejaVu Sans is embedded in every document. That also makes each file
 * self-contained: it renders identically in ten years on a machine that has
 * never heard of our fonts, which is the point of a statutory record.
 *
 * The font comes from the `dejavu-fonts-ttf` package rather than a binary in
 * this repository, so its version and licence are tracked by the lockfile.
 * `next.config.ts` lists it in `outputFileTracingIncludes`, because the path
 * is resolved at runtime and the bundler cannot see that by itself.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY IT IS PLAIN
 *
 * No logo, no colour, no rules beyond the ones that separate blocks. A tax
 * document is read by an accountant and a tax inspector, printed in black and
 * white, and archived for ten years. Legibility is the only aesthetic that
 * matters, and every decorative element is one more thing that can render
 * badly in a viewer nobody tested.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ONCE AND ONLY ONCE
 *
 * The caller stores the result and writes `pdfStorageKey`, which is
 * write-once at the collection level. A corrected document is a NEW document;
 * nothing regenerates this one, because two files must never be able to claim
 * to be the same invoice number.
 */
import { createRequire } from 'node:module'

import PDFDocument from 'pdfkit'

import { formatMinorAmount } from '../billing/money.ts'
import type { Currency } from '../billing/constants.ts'

/**
 * The embedded font.
 *
 * Resolved through `createRequire` rather than imported, because it is a
 * binary asset and not a module. Memoised: reading 757KB per invoice is
 * wasteful, and pdfkit copies the buffer anyway.
 */
let fontCache: Buffer | null = null

/**
 * The font package's own path parts, assembled at runtime.
 *
 * Deliberately NOT a literal. Turbopack statically analyses
 * `require.resolve('...')` and tries to bundle the target as a module, which
 * fails outright for a `.ttf` — "Unknown module type". Assembling the
 * specifier makes it opaque to that analysis, so the font stays a plain file
 * read, and `outputFileTracingIncludes` in next.config.ts is what puts the
 * file in the deployment.
 *
 * The two have to stay in step: if this path changes, that config must too,
 * or the renderer throws ENOENT in production and only in production.
 */
const FONT_SPECIFIER = ['dejavu-fonts-ttf', 'ttf', 'DejaVuSans.ttf'].join('/')

export const invoiceFontPath = (): string =>
  createRequire(import.meta.url).resolve(FONT_SPECIFIER)

const loadFont = async (): Promise<Buffer> => {
  if (fontCache) return fontCache

  const { readFile } = await import('node:fs/promises')
  fontCache = await readFile(invoiceFontPath())

  return fontCache
}

/* -------------------------------------------------------------------------- */
/* What a document needs to say                                               */
/* -------------------------------------------------------------------------- */

export type DocumentParty = {
  legalName: string
  address: string
  /** IČO. */
  businessId: string
  /** DIČ, or null when not VAT registered. */
  taxId?: string | null
  email?: string | null
}

export type DocumentKind = 'INVOICE' | 'CREDIT_NOTE'

export type RenderableDocument = {
  kind: DocumentKind
  number: string
  issuedAt: Date
  /** Datum uskutečnění plnění. */
  taxableSupplyDate: Date
  supplier: DocumentParty
  /** Whether the supplier was VAT registered when this was issued. */
  supplierVatRegistered: boolean
  customer: {
    name: string
    email: string
    address?: string | null
    country: string
    businessId?: string | null
    taxId?: string | null
  }
  /** The service, in plain Czech. */
  description: string
  periodStart: Date
  periodEnd: Date
  amountMinor: number
  currency: Currency
  /** How it was paid, and that it is already settled. */
  payment: {
    method: string
    paidAt: Date
    cardBrand?: string | null
    cardLast4?: string | null
  }
  /** Credit notes only: the invoice corrected, and why. */
  corrects?: { number: string; reason: string }
}

/* -------------------------------------------------------------------------- */
/* Czech wording                                                              */
/* -------------------------------------------------------------------------- */

const czechDate = (value: Date): string =>
  new Intl.DateTimeFormat('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    timeZone: 'Europe/Prague',
  }).format(value)

const DESIGNATION: Readonly<Record<DocumentKind, string>> = {
  // "Faktura" alone would be ambiguous: a non-VAT-payer issues an accounting
  // document, not a tax document (daňový doklad), and the designation has to
  // say which.
  INVOICE: 'FAKTURA – ÚČETNÍ DOKLAD',
  CREDIT_NOTE: 'OPRAVNÝ ÚČETNÍ DOKLAD',
}

const PAYMENT_METHOD_CS: Readonly<Record<string, string>> = {
  CARD: 'platební kartou',
  OTHER: 'jiným způsobem',
}

/**
 * The statement that the issuer does not charge VAT.
 *
 * Required: an invoice with no VAT line and no explanation looks like an
 * invoice that forgot the VAT. This is the sentence that tells an accountant
 * the absence is deliberate and lawful.
 */
const NOT_VAT_PAYER_CS = 'Dodavatel není plátcem DPH.'

/* -------------------------------------------------------------------------- */
/* Layout                                                                     */
/* -------------------------------------------------------------------------- */

const MARGIN = 56
const PAGE_WIDTH = 595.28 // A4 at 72dpi
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2
const COLUMN_GAP = 24
const COLUMN_WIDTH = (CONTENT_WIDTH - COLUMN_GAP) / 2

/**
 * Render a document.
 *
 * Returns the complete PDF. Not streamed: an invoice is a few kilobytes, the
 * caller has to hand the whole thing to R2 and to an email attachment, and a
 * stream would only move the buffering somewhere less obvious.
 */
export const renderDocumentPdf = async (
  document: RenderableDocument,
): Promise<Buffer> => {
  const font = await loadFont()

  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGIN,
    info: {
      Title: `${DESIGNATION[document.kind]} ${document.number}`,
      Author: document.supplier.legalName,
      Subject: document.description,
      // No Producer/Creator strings naming tooling versions: they date the
      // file and tell a reader nothing about the transaction.
    },
  })

  const chunks: Buffer[] = []
  doc.on('data', (chunk: Buffer) => chunks.push(chunk))
  const finished = new Promise<void>((resolve) =>
    doc.on('end', () => resolve()),
  )

  doc.registerFont('body', font)
  doc.font('body')

  /* --- Designation and number ------------------------------------------- */

  doc.fontSize(16).text(DESIGNATION[document.kind], { align: 'left' })
  doc.moveDown(0.2)
  doc.fontSize(13).text(`č. ${document.number}`)

  if (document.corrects) {
    doc.moveDown(0.4)
    doc
      .fontSize(10)
      .text(`Opravuje fakturu č. ${document.corrects.number}`)
      .text(`Důvod opravy: ${document.corrects.reason}`)
  }

  doc.moveDown(1.2)

  /* --- The two parties, side by side ------------------------------------ */

  const partiesTop = doc.y

  const supplierLines = [
    document.supplier.legalName,
    document.supplier.address,
    `IČO: ${document.supplier.businessId}`,
    document.supplier.taxId
      ? `DIČ: ${document.supplier.taxId}`
      : NOT_VAT_PAYER_CS,
    ...(document.supplier.email ? [document.supplier.email] : []),
  ]

  const customerLines = [
    document.customer.name,
    ...(document.customer.address ? [document.customer.address] : []),
    `Země: ${document.customer.country}`,
    ...(document.customer.businessId
      ? [`IČO: ${document.customer.businessId}`]
      : []),
    ...(document.customer.taxId ? [`DIČ: ${document.customer.taxId}`] : []),
    document.customer.email,
  ]

  doc.fontSize(9).text('DODAVATEL', MARGIN, partiesTop, { width: COLUMN_WIDTH })
  doc.fontSize(10).text(supplierLines.join('\n'), MARGIN, doc.y + 2, {
    width: COLUMN_WIDTH,
  })
  const supplierBottom = doc.y

  const customerX = MARGIN + COLUMN_WIDTH + COLUMN_GAP
  doc
    .fontSize(9)
    .text('ODBĚRATEL', customerX, partiesTop, { width: COLUMN_WIDTH })
  doc.fontSize(10).text(customerLines.join('\n'), customerX, partiesTop + 13, {
    width: COLUMN_WIDTH,
  })

  doc.y = Math.max(supplierBottom, doc.y) + 18
  doc.x = MARGIN

  /* --- Dates ------------------------------------------------------------- */

  const dateLines: [string, string][] = [
    ['Datum vystavení', czechDate(document.issuedAt)],
    // Separate from the issue date on purpose: the tax period follows the
    // supply, and the two legitimately differ.
    ['Datum uskutečnění plnění', czechDate(document.taxableSupplyDate)],
    [
      'Zúčtovací období',
      `${czechDate(document.periodStart)} – ${czechDate(document.periodEnd)}`,
    ],
  ]

  doc.fontSize(10)
  for (const [label, value] of dateLines) {
    doc.text(`${label}: ${value}`, MARGIN, doc.y, { width: CONTENT_WIDTH })
  }

  doc.moveDown(1)

  /* --- What was supplied -------------------------------------------------- */

  doc.fontSize(9).text('PŘEDMĚT PLNĚNÍ', MARGIN, doc.y, {
    width: CONTENT_WIDTH,
  })
  doc.moveDown(0.3)
  doc.fontSize(10).text(document.description, { width: CONTENT_WIDTH })
  doc.moveDown(0.8)

  /* --- Amount ------------------------------------------------------------ */

  const amount = formatMinorAmount(document.amountMinor, document.currency)
  const amountLabel =
    document.kind === 'CREDIT_NOTE' ? 'Vráceno celkem' : 'Celkem k úhradě'

  doc.fontSize(9).text('ČÁSTKA', MARGIN, doc.y, { width: CONTENT_WIDTH })
  doc.moveDown(0.3)
  doc.fontSize(10).text(`Základ: ${amount}`)
  // Stated explicitly rather than omitted: a reader must be able to see that
  // the VAT is zero because none is charged, not because a line is missing.
  doc.text('DPH 0 % (dodavatel není plátcem DPH): 0,00')
  doc.fontSize(13).text(`${amountLabel}: ${amount}`)
  doc.moveDown(0.8)

  /* --- Payment ----------------------------------------------------------- */

  const card =
    document.payment.cardBrand && document.payment.cardLast4
      ? ` (${document.payment.cardBrand} •••• ${document.payment.cardLast4})`
      : ''
  const method = PAYMENT_METHOD_CS[document.payment.method] ?? 'jiným způsobem'

  doc.fontSize(9).text('PLATBA', MARGIN, doc.y, { width: CONTENT_WIDTH })
  doc.moveDown(0.3)
  doc.fontSize(10)

  if (document.kind === 'CREDIT_NOTE') {
    doc.text(
      `Částka byla vrácena ${method}${card} dne ${czechDate(document.payment.paidAt)}.`,
      { width: CONTENT_WIDTH },
    )
  } else {
    // The single most useful line on the document: it stops a customer paying
    // twice and stops an accountant chasing a receivable that does not exist.
    doc.text(
      `Uhrazeno ${method}${card} dne ${czechDate(document.payment.paidAt)}. ` +
        'Tento doklad není výzvou k platbě.',
      { width: CONTENT_WIDTH },
    )
  }

  doc.moveDown(1.2)
  doc.fontSize(8).text(NOT_VAT_PAYER_CS, MARGIN, doc.y, {
    width: CONTENT_WIDTH,
  })

  doc.end()
  await finished

  return Buffer.concat(chunks)
}
