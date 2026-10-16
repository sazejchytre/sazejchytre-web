/**
 * Issuing an invoice.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ONE CONFIRMED PAYMENT, ONE INVOICE
 *
 * An invoice is a statutory document. Issuing one burns a sequence number
 * that can never be reused, and the series must have no gaps — so a document
 * is created only when money has definitely arrived, and exactly once per
 * payment.
 *
 * "Definitely arrived" is not a judgement made here. The caller supplies a
 * `ConfirmedPayment`, which is the evidence; see that file for why the
 * boundary is drawn there. This module never looks at an event type, never
 * issues on subscription creation, and never issues speculatively.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * IDEMPOTENCY HAS TWO LAYERS, AND THE SECOND IS THE REAL ONE
 *
 * 1. Read first: if an invoice already names this `providerPaymentId`, return
 *    it. Covers the ordinary redelivery.
 * 2. `invoices.providerPaymentId` is UNIQUE. Two concurrent webhook
 *    deliveries can both pass step 1 — they genuinely do, which is what the
 *    concurrency test demonstrates — and the index is what stops the second
 *    one. On that collision we re-read and return the winner's invoice.
 *
 * Without the second layer the failure is expensive and quiet: two numbers
 * burnt, two documents emailed, and a VAT return that counts the revenue
 * twice.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT IS SNAPSHOTTED AND WHY NOTHING IS JOINED
 *
 * The document must read the same in five years, when the plan has been
 * renamed, the price has changed, the customer has moved and the operator's
 * address is different. So everything the invoice asserts is copied onto it:
 * both identities, the service, the period, the amounts, the tax treatment
 * and how it was paid. Re-deriving an invoice from today's data would produce
 * a different document from the one the customer received, which is the one
 * thing an invoice must never do.
 */
import type { Payload, PayloadRequest } from 'payload'
import { APIError } from 'payload'

import type { Currency } from '../billing/constants.ts'
import { allocateDocumentNumber } from '../billing/document-number.ts'
import {
  OPERATOR,
  assertOperatorConfigured,
  formatOperatorAddress,
} from '../legal/operator.ts'
import type { BilledPeriod, ConfirmedPayment } from './confirmed-payment.ts'

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

/** The payment or the customer does not support issuing a document. */
export class CannotIssueError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'CannotIssueError'
    this.code = code
  }
}

/* -------------------------------------------------------------------------- */
/* Operator snapshot                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The operator's identity, as printed.
 *
 * Read from `src/lib/legal/operator.ts` and never retyped. In production
 * `assertOperatorConfigured()` refuses outright rather than printing a guess:
 * an invoice bearing an invented IČO is a compliance failure, and a
 * plausible-looking fake is far more dangerous than an obvious placeholder.
 *
 * Outside production the placeholders are copied through verbatim, so a
 * development document is visibly unusable instead of subtly wrong.
 */
export const operatorSnapshot = (): {
  legalName: string
  address: string
  businessId: string
  taxId: string | null
  vatRegistered: boolean
  email: string
} => {
  // A bare `process.env` read rather than the validated `env`, deliberately:
  // issuing has to be loadable without a full environment so the pure tests
  // can exercise it, and "are we in production" is the one question that does
  // not need the schema to answer.
  if (process.env.NODE_ENV === 'production') {
    assertOperatorConfigured()
  }

  return {
    legalName: OPERATOR.name,
    address: formatOperatorAddress(),
    businessId: OPERATOR.ico,
    // Null, not an empty string: the operator is not VAT registered, so there
    // is no DIČ to print. An empty string would render as a blank labelled
    // field, which reads like an omission rather than an absence.
    taxId: null,
    vatRegistered: OPERATOR.vatPayer,
    email: OPERATOR.email,
  }
}

/* -------------------------------------------------------------------------- */
/* Issuing                                                                    */
/* -------------------------------------------------------------------------- */

export type IssueInvoiceArgs = {
  payload: Payload
  req?: PayloadRequest
  /** Our customer id. */
  customerId: number
  /** The subscription billed, when there is one. */
  subscriptionId?: number | null
  payment: ConfirmedPayment
  period: BilledPeriod
  /**
   * Country inferred from the payer's IP when checkout started.
   *
   * Supplied by step 5, which owns the request that begins a payment. Absent
   * here rather than guessed from the webhook request, whose IP is Stripe's
   * and would be evidence of nothing.
   */
  ipCountry?: string | null
  /** Injected clock. */
  now?: Date
}

export type IssuedInvoice = {
  id: number
  number: string
  /** False when an invoice for this payment already existed. */
  created: boolean
}

type CustomerRow = {
  id: number
  email: string
  name?: string | null
  billingCountry?: string | null
}

/** Find an invoice already issued for this payment. */
const existingFor = async (
  payload: Payload,
  providerPaymentId: string,
  req?: PayloadRequest,
): Promise<{ id: number; number: string } | null> => {
  const found = await payload.find({
    collection: 'invoices',
    depth: 0,
    limit: 1,
    pagination: false,
    overrideAccess: true,
    ...(req ? { req } : {}),
    where: { providerPaymentId: { equals: providerPaymentId } },
  })

  const doc = found.docs[0]

  return doc ? { id: doc.id, number: doc.number } : null
}

/**
 * Issue an invoice for a confirmed payment, or return the one that exists.
 *
 * Does NOT render the PDF or send the email. Those follow, and may fail
 * without unissuing the document — see `pdf.ts` and `delivery.ts`.
 */
export const issueInvoiceForPayment = async ({
  payload,
  req,
  customerId,
  subscriptionId = null,
  payment,
  period,
  ipCountry = null,
  now = new Date(),
}: IssueInvoiceArgs): Promise<IssuedInvoice> => {
  if (payment.amountMinor <= 0) {
    // A zero or negative "payment" is not a sale. Issuing a document for one
    // would put a number in the series that nothing settles.
    throw new CannotIssueError(
      'NON_POSITIVE_AMOUNT',
      `Refusing to issue an invoice for amountMinor ${String(payment.amountMinor)}.`,
    )
  }

  if (!Number.isInteger(payment.amountMinor)) {
    throw new CannotIssueError(
      'NON_INTEGER_AMOUNT',
      'Amounts are integer minor units. A fractional amount is a bug upstream.',
    )
  }

  const already = await existingFor(payload, payment.providerPaymentId, req)

  if (already) {
    return { ...already, created: false }
  }

  const customer = (await payload.findByID({
    collection: 'customers',
    id: customerId,
    depth: 0,
    overrideAccess: true,
    ...(req ? { req } : {}),
  })) as CustomerRow

  const operator = operatorSnapshot()
  const allocated = await allocateDocumentNumber({
    payload,
    series: 'INVOICE',
    now,
    ...(req ? { req } : {}),
  })

  const data = {
    number: allocated.number,
    numberYear: allocated.year,
    numberSequence: allocated.sequence,
    customer: customerId,
    ...(subscriptionId === null ? {} : { subscription: subscriptionId }),
    issuedAt: now.toISOString(),
    // The tax period follows the supply, not the paperwork. For a
    // subscription the supply is the period paid for, so the taxable supply
    // date is when that period starts.
    taxableSupplyDate: period.periodStart.toISOString(),
    currency: payment.currency,
    // No VAT: operator is not registered. The CHECK constraints and the
    // collection hook both enforce this triple.
    subtotalMinor: payment.amountMinor,
    taxMinor: 0,
    totalMinor: payment.amountMinor,
    taxTreatment: 'NONE_NOT_VAT_REGISTERED' as const,
    taxRateBasisPoints: 0,
    providerPaymentId: payment.providerPaymentId,
    deliveryState: 'PENDING' as const,
    deliveryAttempts: 0,
    status: 'ISSUED' as const,
    // The three location signals, recorded as at payment time and never
    // recalculated.
    ...(customer.billingCountry
      ? { billingCountry: customer.billingCountry }
      : {}),
    ...(ipCountry ? { ipCountry } : {}),
    ...(payment.cardCountry ? { cardCountry: payment.cardCountry } : {}),
    serviceSnapshot: {
      planName: period.planName,
      description: describeService(period),
      periodStart: period.periodStart.toISOString(),
      periodEnd: period.periodEnd.toISOString(),
    },
    paymentSnapshot: {
      method: payment.method,
      paidAt: payment.paidAt.toISOString(),
      ...(payment.cardBrand ? { cardBrand: payment.cardBrand } : {}),
      ...(payment.cardLast4 ? { cardLast4: payment.cardLast4 } : {}),
    },
    operatorSnapshot: operator,
    customerSnapshot: {
      // Falls back to the email when no name was given: a document needs
      // somebody named on it, and the email is the only identity we are
      // guaranteed to hold.
      name: customer.name?.trim() || customer.email,
      email: customer.email,
      country: customer.billingCountry ?? 'CZ',
    },
  }

  try {
    const created = await payload.create({
      collection: 'invoices',
      overrideAccess: true,
      ...(req ? { req } : {}),
      data,
    })

    return { id: created.id, number: created.number, created: true }
  } catch (error) {
    // The unique index on providerPaymentId. Another delivery won the race
    // between our read above and this insert — which is the case the
    // concurrency test provokes deliberately. Return the winner's document.
    const winner = await existingFor(payload, payment.providerPaymentId, req)

    if (winner) {
      return { ...winner, created: false }
    }

    throw error instanceof APIError
      ? error
      : new CannotIssueError(
          'CREATE_FAILED',
          `Could not issue an invoice for payment ${payment.providerPaymentId}.`,
        )
  }
}

/**
 * The supplied service, in plain Czech.
 *
 * Deliberately describes information analysis and nothing resembling betting,
 * brokering or a guaranteed outcome — the same line the responsible-gambling
 * copy has to hold. A tax document is a bad place to overstate what was sold.
 */
export const describeService = (period: BilledPeriod): string =>
  `Předplatné služby sazejchytre.cz – tarif ${period.planName}`
