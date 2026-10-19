/**
 * Getting a document to the customer, and recording whether it got there.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * A DELIVERY FAILURE DOES NOT UNDO ANYTHING
 *
 * The document exists the moment the accounting provider issues it. It has a
 * number out of a statutory series, it is the record of a payment that really
 * happened, and it is in the customer's account page whether or not an email
 * left the building.
 *
 * So nothing here rolls anything back. A failure is written to
 * `deliveryState` with the reason, and the retry sweep picks it up. The
 * alternative — undoing on a send failure — would make Resend's availability a
 * precondition for Czech accounting law.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ORDER: ROW, THEN DOCUMENT, THEN PDF, THEN EMAIL
 *
 * Four steps, four places to fail, each retryable from wherever the last one
 * stopped. The document and the PDF both come from a third party now, which
 * is exactly why they are separate states rather than one.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WE SEND OUR OWN COPY, AND NEVER A PROVIDER LINK
 *
 * The attachment is read back out of our own bucket, not taken from the
 * provider on the way past and not linked to. Two reasons, and both matter:
 *
 *   - The customer must receive the same bytes the account page serves. A
 *     re-fetch could differ, and then there are two files that both claim to
 *     be this document.
 *   - A Fakturoid URL in a customer's inbox is an accounting account's
 *     address handed to a stranger, and it outlives our control of it.
 *
 * This is also why Fakturoid's own email sending is not used at all.
 */
import type { Payload, PayloadRequest } from 'payload'

import type { Currency } from '../billing/constants.ts'
import { EmailDeliveryError, sendEmail } from '../auth/email.ts'
import {
  ensureDocumentPdf,
  type DocumentCollection,
} from './accounting-document.ts'
import { getPrivateDocument } from './storage.ts'
import {
  invoiceDeliveryEmail,
  creditNoteDeliveryEmail,
} from './email-templates.ts'

export type { DocumentCollection }

export type DeliveryOutcome = {
  /** True when the email was accepted by the provider on this call. */
  delivered: boolean
  /** True when the PDF was fetched and stored on this call. */
  pdfStored: boolean
  storageKey: string | null
  /** Set when nothing could be done; safe to log. */
  reason?: string
}

/**
 * What the delivery email needs to say.
 *
 * Much smaller than it used to be. When we rendered the PDF ourselves this
 * had to carry both parties' identities, the tax treatment and the layout
 * data; now that the provider renders it, all that is needed is enough to
 * write a covering email — and the attachment comes from storage.
 */
type Deliverable = {
  number: string
  email: string
  amountMinor: number
  currency: Currency
  periodStart: Date
  periodEnd: Date
  /** Credit notes only: the invoice being corrected. */
  correctsNumber: string
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
  /** Injected so tests do not actually wait between PDF polls. */
  sleep?: (ms: number) => Promise<void>
}

/**
 * Fetch and store the PDF if needed, email it, and record the outcome.
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
  sleep,
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

  if (doc.accountingState !== 'ISSUED' || !doc.fakturoidNumber) {
    // There is no document to send yet. Not a delivery failure, so
    // `deliveryState` is left alone and the attempt counter is not burnt: the
    // accounting document has to be issued first, and a separate state
    // already tracks that.
    return {
      delivered: false,
      pdfStored: false,
      storageKey: null,
      reason: 'NO_ACCOUNTING_DOCUMENT',
    }
  }

  const deliverable = await toDeliverable(payload, collection, doc, reqOption)

  if (!deliverable) {
    return {
      delivered: false,
      pdfStored: false,
      storageKey: null,
      reason: 'NOT_DELIVERABLE',
    }
  }

  const pdf = await ensureDocumentPdf({
    payload,
    ...reqOption,
    collection,
    id,
    ...(sleep ? { sleep } : {}),
  })

  if (!pdf.key) {
    // Still generating, or the provider could not be reached. Both are
    // ordinary and both are the cron's business, so the reason is recorded
    // only when it is NOT retryable — burning a delivery attempt on "the PDF
    // isn't ready yet" would eventually trip the give-up threshold on a
    // document that was never actually refused.
    if (!pdf.retryable) {
      await recordFailure({
        payload,
        reqOption,
        collection,
        id,
        attempts: (doc.deliveryAttempts as number) ?? 0,
        reason: `PDF_UNAVAILABLE_${pdf.reason}: ${pdf.detail ?? ''}`,
      })
    }

    return {
      delivered: false,
      pdfStored: false,
      storageKey: null,
      reason: `PDF_${pdf.reason}`,
    }
  }

  const storageKey = pdf.key
  const pdfStored = pdf.reason === 'STORED'

  // Read the stored bytes back rather than reusing whatever was just fetched.
  // On a retry there is no fresh buffer, and the customer must receive the
  // SAME file the download route serves.
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
          number: deliverable.number,
          amount: deliverable.amountMinor,
          currency: deliverable.currency,
          periodStart: deliverable.periodStart,
          periodEnd: deliverable.periodEnd,
        })
      : creditNoteDeliveryEmail({
          number: deliverable.number,
          amount: deliverable.amountMinor,
          currency: deliverable.currency,
          correctsNumber: deliverable.correctsNumber,
        })

  try {
    await sendEmail({
      to: deliverable.email,
      email,
      kind: collection === 'invoices' ? 'invoice.issued' : 'credit_note.issued',
      attachments: [
        { filename: `${deliverable.number}.pdf`, content: attachment },
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
/* Row → deliverable                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Build what the covering email needs from the stored row.
 *
 * Reads the SNAPSHOTS, never the live relations. The email has to describe the
 * document that was issued, not whatever the plan is called today.
 */
const toDeliverable = async (
  payload: Payload,
  collection: DocumentCollection,
  doc: Record<string, unknown>,
  reqOption: { req?: PayloadRequest },
): Promise<Deliverable | null> => {
  const number = doc.fakturoidNumber as string | null

  if (!number) return null

  if (collection === 'invoices') {
    const customer = doc.customerSnapshot as { email?: string } | undefined
    const service = doc.serviceSnapshot as
      { periodStart?: string; periodEnd?: string } | undefined

    if (!customer?.email || !service?.periodStart || !service.periodEnd) {
      return null
    }

    return {
      number,
      email: customer.email,
      amountMinor: doc.totalMinor as number,
      currency: doc.currency as Currency,
      periodStart: new Date(service.periodStart),
      periodEnd: new Date(service.periodEnd),
      correctsNumber: '',
    }
  }

  // A credit note carries no snapshots of its own: it corrects exactly one
  // invoice, and the parties and the period are that invoice's. Taking them
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

  const customer = invoice.customerSnapshot as { email?: string } | undefined
  const service = invoice.serviceSnapshot as
    { periodStart?: string; periodEnd?: string } | undefined

  if (!customer?.email || !service?.periodStart || !service.periodEnd) {
    return null
  }

  return {
    number,
    email: customer.email,
    amountMinor: doc.amountMinor as number,
    currency: doc.currency as Currency,
    periodStart: new Date(service.periodStart),
    periodEnd: new Date(service.periodEnd),
    // Empty rather than absent when the invoice has no number yet — which
    // cannot happen, since a correction needs an issued invoice to point at,
    // but the email must not print "undefined" if it ever did.
    correctsNumber: (invoice.fakturoidNumber as string | null) ?? '',
  }
}
