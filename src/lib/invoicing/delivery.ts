/**
 * Getting a document to the customer, and recording whether it got there.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * A DELIVERY FAILURE DOES NOT UNISSUE A DOCUMENT
 *
 * The document exists the moment it is issued. It has a number out of a
 * gap-free series, it is the statutory record of a payment that really
 * happened, and it is in the customer's account page whether or not an email
 * left the building.
 *
 * So nothing here rolls anything back. A failure is written to
 * `deliveryState` with the reason, and the retry sweep picks it up. The
 * alternative — unissuing on a send failure — would either burn a number for
 * nothing or, worse, make Resend's availability a precondition for Czech
 * accounting law.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ORDER: ROW, THEN PDF, THEN EMAIL
 *
 * Each step is retryable from whatever state the last one left. The PDF is
 * rendered once and `pdfStorageKey` is write-once at the collection level, so
 * a retry after a successful render reuses the stored file rather than
 * producing a second one that could also claim to be this document.
 */
import type { Payload, PayloadRequest } from 'payload'

import type { Currency } from '../billing/constants.ts'
import { EmailDeliveryError, sendEmail } from '../auth/email.ts'
import { renderDocumentPdf, type RenderableDocument } from './pdf.ts'
import {
  documentStorageKey,
  getPrivateDocument,
  putPrivateDocument,
} from './storage.ts'
import {
  invoiceDeliveryEmail,
  creditNoteDeliveryEmail,
} from './email-templates.ts'

export type DocumentCollection = 'invoices' | 'credit-notes'

export type DeliveryOutcome = {
  /** True when the email was accepted by the provider on this call. */
  delivered: boolean
  /** True when the PDF was rendered and stored on this call. */
  pdfStored: boolean
  storageKey: string | null
  /** Set when nothing could be done; safe to log. */
  reason?: string
}

const STORAGE_KIND: Readonly<
  Record<DocumentCollection, 'invoices' | 'credit-notes'>
> = {
  invoices: 'invoices',
  'credit-notes': 'credit-notes',
}

/* -------------------------------------------------------------------------- */
/* PDF                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Make sure the document has a stored PDF, rendering it if it does not.
 *
 * Idempotent and cheap on the happy path: an existing `pdfStorageKey` short
 * circuits, so a delivery retry does not re-render. That is not just an
 * optimisation — re-rendering would produce a second file for one document
 * number, and only one of them is the one the customer received.
 */
export const ensureDocumentPdf = async (args: {
  payload: Payload
  req?: PayloadRequest
  collection: DocumentCollection
  id: number
  renderable: RenderableDocument
  numberYear: number
  existingKey?: string | null
}): Promise<{ key: string; rendered: boolean }> => {
  if (args.existingKey) {
    return { key: args.existingKey, rendered: false }
  }

  const pdf = await renderDocumentPdf(args.renderable)
  const key = documentStorageKey(
    STORAGE_KIND[args.collection],
    args.numberYear,
    args.renderable.number,
  )

  await putPrivateDocument(key, pdf)

  await args.payload.update({
    collection: args.collection,
    id: args.id,
    overrideAccess: true,
    ...(args.req ? { req: args.req } : {}),
    data: { pdfStorageKey: key },
  })

  return { key, rendered: true }
}

/* -------------------------------------------------------------------------- */
/* Email                                                                      */
/* -------------------------------------------------------------------------- */

type DeliverArgs = {
  payload: Payload
  req?: PayloadRequest
  collection: DocumentCollection
  id: number
  now?: Date
}

/**
 * Render if needed, email, and record the outcome.
 *
 * Never throws for a delivery failure — the caller is usually a webhook or a
 * cron sweep, and neither should fail because an email bounced.
 */
export const deliverDocument = async ({
  payload,
  req,
  collection,
  id,
  now = new Date(),
}: DeliverArgs): Promise<DeliveryOutcome> => {
  const reqOption = req ? { req } : {}

  const doc = (await payload.findByID({
    collection,
    id,
    depth: 1,
    overrideAccess: true,
    ...reqOption,
  })) as unknown as Record<string, unknown>

  if (doc.deliveryState === 'SENT') {
    return {
      delivered: false,
      pdfStored: false,
      storageKey: (doc.pdfStorageKey as string | null) ?? null,
      reason: 'ALREADY_SENT',
    }
  }

  const renderable = await toRenderable(payload, collection, doc, reqOption)

  if (!renderable) {
    return {
      delivered: false,
      pdfStored: false,
      storageKey: null,
      reason: 'NOT_RENDERABLE',
    }
  }

  let storageKey: string | null = null
  let pdfStored = false

  try {
    const pdf = await ensureDocumentPdf({
      payload,
      ...reqOption,
      collection,
      id,
      renderable,
      numberYear: doc.numberYear as number,
      existingKey: (doc.pdfStorageKey as string | null) ?? null,
    })
    storageKey = pdf.key
    pdfStored = pdf.rendered
  } catch (error) {
    await recordFailure({
      payload,
      reqOption,
      collection,
      id,
      attempts: (doc.deliveryAttempts as number) ?? 0,
      reason: `PDF_FAILED: ${describe(error)}`,
    })

    return {
      delivered: false,
      pdfStored: false,
      storageKey: null,
      reason: 'PDF_FAILED',
    }
  }

  // Read the stored bytes back rather than reusing the freshly rendered
  // buffer. On a retry there is no fresh buffer, and the customer must
  // receive the SAME file that the download route serves — not a
  // re-render that might differ.
  let attachment: Buffer

  try {
    attachment = await getPrivateDocument(storageKey)
  } catch (error) {
    await recordFailure({
      payload,
      reqOption,
      collection,
      id,
      attempts: (doc.deliveryAttempts as number) ?? 0,
      reason: `STORAGE_READ_FAILED: ${describe(error)}`,
    })

    return {
      delivered: false,
      pdfStored,
      storageKey,
      reason: 'STORAGE_READ_FAILED',
    }
  }

  const email =
    collection === 'invoices'
      ? invoiceDeliveryEmail({
          number: renderable.number,
          amount: renderable.amountMinor,
          currency: renderable.currency,
          periodStart: renderable.periodStart,
          periodEnd: renderable.periodEnd,
        })
      : creditNoteDeliveryEmail({
          number: renderable.number,
          amount: renderable.amountMinor,
          currency: renderable.currency,
          correctsNumber: renderable.corrects?.number ?? '',
        })

  try {
    await sendEmail({
      to: renderable.customer.email,
      email,
      kind: collection === 'invoices' ? 'invoice.issued' : 'credit_note.issued',
      attachments: [
        { filename: `${renderable.number}.pdf`, content: attachment },
      ],
    })
  } catch (error) {
    const retryable =
      error instanceof EmailDeliveryError ? error.retryable : true

    await recordFailure({
      payload,
      reqOption,
      collection,
      id,
      attempts: (doc.deliveryAttempts as number) ?? 0,
      reason: `${retryable ? 'EMAIL_FAILED_RETRYABLE' : 'EMAIL_REFUSED'}: ${describe(error)}`,
    })

    return { delivered: false, pdfStored, storageKey, reason: 'EMAIL_FAILED' }
  }

  await payload.update({
    collection,
    id,
    overrideAccess: true,
    ...reqOption,
    data: {
      deliveryState: 'SENT',
      deliveredAt: now.toISOString(),
      deliveryAttempts: ((doc.deliveryAttempts as number) ?? 0) + 1,
      deliveryError: null,
    },
  })

  return { delivered: true, pdfStored, storageKey }
}

const recordFailure = async (args: {
  payload: Payload
  reqOption: { req?: PayloadRequest }
  collection: DocumentCollection
  id: number
  attempts: number
  reason: string
}): Promise<void> => {
  await args.payload.update({
    collection: args.collection,
    id: args.id,
    overrideAccess: true,
    ...args.reqOption,
    data: {
      deliveryState: 'FAILED',
      deliveryAttempts: args.attempts + 1,
      // Truncated: this column is read by a human in the admin, not parsed.
      deliveryError: args.reason.slice(0, 500),
    },
  })
}

/** A failure reason safe to store: no payload, no attachment, no secret. */
const describe = (error: unknown): string =>
  error instanceof Error ? error.message.slice(0, 200) : 'unknown'

/* -------------------------------------------------------------------------- */
/* Row → renderable                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Build the renderable document from the stored row.
 *
 * Reads the SNAPSHOTS, never the live relations. The document must render the
 * same in five years, when the plan has been renamed and the customer has
 * moved; joining would quietly produce a different document from the one that
 * was sent.
 */
const toRenderable = async (
  payload: Payload,
  collection: DocumentCollection,
  doc: Record<string, unknown>,
  reqOption: { req?: PayloadRequest },
): Promise<RenderableDocument | null> => {
  const operator = doc.operatorSnapshot as
    | {
        legalName: string
        address: string
        businessId: string
        taxId?: string | null
        vatRegistered: boolean
        email?: string | null
      }
    | undefined

  if (collection === 'invoices') {
    const customer = doc.customerSnapshot as {
      name: string
      email: string
      address?: string | null
      country: string
      businessId?: string | null
      taxId?: string | null
    }
    const service = doc.serviceSnapshot as {
      planName: string
      description: string
      periodStart: string
      periodEnd: string
    }
    const paymentInfo = doc.paymentSnapshot as {
      method: string
      paidAt: string
      cardBrand?: string | null
      cardLast4?: string | null
    }

    if (!operator || !customer || !service || !paymentInfo) return null

    return {
      kind: 'INVOICE',
      number: doc.number as string,
      issuedAt: new Date(doc.issuedAt as string),
      taxableSupplyDate: new Date(doc.taxableSupplyDate as string),
      supplier: operator,
      supplierVatRegistered: operator.vatRegistered,
      customer,
      description: service.description,
      periodStart: new Date(service.periodStart),
      periodEnd: new Date(service.periodEnd),
      amountMinor: doc.totalMinor as number,
      currency: doc.currency as Currency,
      payment: {
        method: paymentInfo.method,
        paidAt: new Date(paymentInfo.paidAt),
        cardBrand: paymentInfo.cardBrand ?? null,
        cardLast4: paymentInfo.cardLast4 ?? null,
      },
    }
  }

  // A credit note carries no snapshots of its own: it corrects exactly one
  // invoice, and the parties and the service are that invoice's. Taking them
  // from there is not a live join — the invoice's own fields are frozen.
  const invoiceRef = doc.invoice
  const invoiceId =
    typeof invoiceRef === 'object' && invoiceRef !== null
      ? (invoiceRef as { id: number }).id
      : (invoiceRef as number)

  const invoice = (await payload.findByID({
    collection: 'invoices',
    id: invoiceId,
    depth: 0,
    overrideAccess: true,
    ...reqOption,
  })) as unknown as Record<string, unknown>

  const invoiceOperator = invoice.operatorSnapshot as typeof operator
  const invoiceCustomer = invoice.customerSnapshot as {
    name: string
    email: string
    address?: string | null
    country: string
  }
  const service = invoice.serviceSnapshot as {
    description: string
    periodStart: string
    periodEnd: string
  }

  if (!invoiceOperator || !invoiceCustomer || !service) return null

  return {
    kind: 'CREDIT_NOTE',
    number: doc.number as string,
    issuedAt: new Date(doc.issuedAt as string),
    taxableSupplyDate: new Date(doc.issuedAt as string),
    supplier: invoiceOperator,
    supplierVatRegistered: invoiceOperator.vatRegistered,
    customer: invoiceCustomer,
    description: service.description,
    periodStart: new Date(service.periodStart),
    periodEnd: new Date(service.periodEnd),
    amountMinor: doc.amountMinor as number,
    currency: doc.currency as Currency,
    payment: {
      method: 'CARD',
      paidAt: new Date(doc.issuedAt as string),
    },
    corrects: {
      number: invoice.number as string,
      reason: doc.reason as string,
    },
  }
}
