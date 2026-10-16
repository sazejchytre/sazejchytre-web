/**
 * Issuing a credit note.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE INVOICE IS NEVER TOUCHED
 *
 * An issued invoice has been sent, and may already be in somebody else's
 * accounting. In Czech terms a correction is a separate document, not an edit,
 * so a refund produces a new document in its own series that references the
 * original. The pair then shows what actually happened rather than only the
 * corrected end state — which is the difference between a record and a
 * revision.
 *
 * The one permitted change to the invoice is its `status` marker moving to
 * CREDITED, so the admin can see at a glance that a correction exists. No
 * amount on it ever changes.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * OVER-CREDITING IS REFUSED
 *
 * Credit notes against one invoice may not sum past the invoice total.
 * Crediting 1 200 Kč against a 599 Kč invoice is not a bigger refund; it is a
 * document asserting money that was never taken, and it would understate
 * revenue in a VAT return by the difference.
 *
 * Step 4 left this open because the refund path had no caller. It has one now,
 * so it is closed here with a typed error — and with a database trigger as the
 * backstop, because the read-then-write below has a window that two concurrent
 * refunds can both pass. The application check gives a good message; the
 * trigger makes the invariant true.
 */
import type { Payload, PayloadRequest } from 'payload'

import type { Currency } from '../billing/constants.ts'
import { allocateDocumentNumber } from '../billing/document-number.ts'

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

/** A credit note would take the total credited past the invoice total. */
export class OverCreditError extends Error {
  readonly code = 'OVER_CREDIT'
  readonly invoiceId: number
  readonly invoiceTotalMinor: number
  readonly alreadyCreditedMinor: number
  readonly requestedMinor: number

  constructor(args: {
    invoiceId: number
    invoiceTotalMinor: number
    alreadyCreditedMinor: number
    requestedMinor: number
  }) {
    super(
      `Crediting ${String(args.requestedMinor)} against invoice ${String(args.invoiceId)} ` +
        `would exceed its total: ${String(args.invoiceTotalMinor)} total, ` +
        `${String(args.alreadyCreditedMinor)} already credited.`,
    )
    this.name = 'OverCreditError'
    this.invoiceId = args.invoiceId
    this.invoiceTotalMinor = args.invoiceTotalMinor
    this.alreadyCreditedMinor = args.alreadyCreditedMinor
    this.requestedMinor = args.requestedMinor
  }
}

/** The credit note's currency disagrees with the invoice it corrects. */
export class CreditCurrencyMismatchError extends Error {
  readonly code = 'CREDIT_CURRENCY_MISMATCH'

  constructor(invoiceCurrency: string, requested: string) {
    super(
      `Cannot credit ${requested} against an invoice issued in ${invoiceCurrency}.`,
    )
    this.name = 'CreditCurrencyMismatchError'
  }
}

/* -------------------------------------------------------------------------- */
/* How much is already credited                                               */
/* -------------------------------------------------------------------------- */

/**
 * Sum of credit notes already issued against an invoice, in minor units.
 *
 * Exported because the admin and the export both want it, and because a
 * second implementation of "how much has been credited" is a second chance to
 * get it wrong.
 */
export const creditedTotalMinor = async (args: {
  payload: Payload
  invoiceId: number
  req?: PayloadRequest
}): Promise<number> => {
  const notes = await args.payload.find({
    collection: 'credit-notes',
    depth: 0,
    limit: 0,
    pagination: false,
    overrideAccess: true,
    ...(args.req ? { req: args.req } : {}),
    where: { invoice: { equals: args.invoiceId } },
  })

  return notes.docs.reduce(
    (total, note) => total + (note.amountMinor as number),
    0,
  )
}

/* -------------------------------------------------------------------------- */
/* Issuing                                                                    */
/* -------------------------------------------------------------------------- */

export type IssueCreditNoteArgs = {
  payload: Payload
  req?: PayloadRequest
  invoiceId: number
  amountMinor: number
  currency: Currency
  /** Printed on the document and carried into the export. */
  reason: string
  /**
   * The provider refund this records, when it came from one.
   *
   * Unique at the database level, which is what makes the refund webhook
   * idempotent by itself rather than only through the event claim: a replay
   * cannot produce a second credit note. Null for a credit note issued by
   * hand.
   */
  providerRefundId?: string | null
  now?: Date
  /** Overridable allocator, for tests that must not touch the live series. */
  allocate?: typeof allocateDocumentNumber
}

export type IssuedCreditNote = {
  id: number
  number: string
  /** False when a credit note for this provider refund already existed. */
  created: boolean
}

/** Find a credit note already issued for this provider refund. */
const existingForRefund = async (
  payload: Payload,
  providerRefundId: string,
  req?: PayloadRequest,
): Promise<{ id: number; number: string } | null> => {
  const found = await payload.find({
    collection: 'credit-notes',
    depth: 0,
    limit: 1,
    pagination: false,
    overrideAccess: true,
    ...(req ? { req } : {}),
    where: { providerRefundId: { equals: providerRefundId } },
  })

  const doc = found.docs[0]

  return doc ? { id: doc.id, number: doc.number } : null
}

/**
 * Issue a credit note against an invoice.
 *
 * Does NOT render the PDF or send the email; those follow and may fail
 * without unissuing the document.
 *
 * @throws {OverCreditError} the total credited would exceed the invoice total.
 * @throws {CreditCurrencyMismatchError} currencies disagree.
 */
export const issueCreditNote = async ({
  payload,
  req,
  invoiceId,
  amountMinor,
  currency,
  reason,
  providerRefundId = null,
  now = new Date(),
  allocate = allocateDocumentNumber,
}: IssueCreditNoteArgs): Promise<IssuedCreditNote> => {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new RangeError(
      `A credit note needs a positive integer amount; got ${String(amountMinor)}.`,
    )
  }

  if (providerRefundId) {
    const already = await existingForRefund(payload, providerRefundId, req)

    if (already) {
      return { ...already, created: false }
    }
  }

  const invoice = await payload.findByID({
    collection: 'invoices',
    id: invoiceId,
    depth: 0,
    overrideAccess: true,
    ...(req ? { req } : {}),
  })

  if (invoice.currency !== currency) {
    throw new CreditCurrencyMismatchError(invoice.currency, currency)
  }

  const alreadyCredited = await creditedTotalMinor({
    payload,
    invoiceId,
    ...(req ? { req } : {}),
  })

  if (alreadyCredited + amountMinor > invoice.totalMinor) {
    throw new OverCreditError({
      invoiceId,
      invoiceTotalMinor: invoice.totalMinor,
      alreadyCreditedMinor: alreadyCredited,
      requestedMinor: amountMinor,
    })
  }

  const allocated = await allocate({
    payload,
    series: 'CREDIT_NOTE',
    now,
    ...(req ? { req } : {}),
  })

  const created = await payload.create({
    collection: 'credit-notes',
    overrideAccess: true,
    ...(req ? { req } : {}),
    data: {
      number: allocated.number,
      numberYear: allocated.year,
      numberSequence: allocated.sequence,
      invoice: invoiceId,
      currency,
      amountMinor,
      reason,
      issuedAt: now.toISOString(),
      ...(providerRefundId ? { providerRefundId } : {}),
      ...(invoice.billingCountry
        ? { billingCountry: invoice.billingCountry }
        : {}),
      deliveryState: 'PENDING' as const,
      deliveryAttempts: 0,
    },
  })

  // The ONE permitted change to an issued invoice: a status marker, so the
  // admin can see a correction exists. No amount on it moves.
  //
  // Set once the credit covers the whole invoice. A partial refund leaves it
  // ISSUED, because the invoice still stands for the part that was kept.
  if (alreadyCredited + amountMinor >= invoice.totalMinor) {
    await payload.update({
      collection: 'invoices',
      id: invoiceId,
      overrideAccess: true,
      ...(req ? { req } : {}),
      data: { status: 'CREDITED' },
    })
  }

  return { id: created.id, number: created.number, created: true }
}
