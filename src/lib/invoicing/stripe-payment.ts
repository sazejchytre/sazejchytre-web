/**
 * Turning a Stripe `invoice.paid` event into a `ConfirmedPayment`.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE ONE PLACE THAT HAS TO BE READ CAREFULLY
 *
 * Everything downstream of this file is provider-agnostic. This is where the
 * claim "the money arrived" is established from Stripe's own data, so it is
 * the only part of invoicing whose correctness depends on Stripe specifics.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY IT MAKES API CALLS
 *
 * Two things the issuing code needs are NOT in the webhook payload:
 *
 *   1. The payment id. `invoice.payments` is an EXPANDABLE list, so a webhook
 *      payload does not carry it — verified against a real event, which is
 *      why `paymentIdsOfInvoice` returns `[]` on one. Without the id there is
 *      nothing to make issuing idempotent on and nothing for a later refund
 *      or chargeback to be traced back through.
 *   2. The card's issuing country, which lives on the charge.
 *
 * So the invoice is retrieved with `payments` expanded, and the charge is
 * fetched for the card details. The first call is required — no payment id,
 * no invoice. The second is best-effort: the card country is evidence for a
 * VAT regime that does not apply yet, and it must never stop a statutory
 * document being issued for a payment that definitely happened.
 */
import type Stripe from 'stripe'

import { CURRENCIES, type Currency } from '../billing/constants.ts'
import type { ConfirmedPayment } from './confirmed-payment.ts'

/** An expandable field as an id, whether or not it was expanded. */
const idOf = (
  value: string | { id: string } | null | undefined,
): string | null => {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && typeof value.id === 'string') {
    return value.id
  }

  return null
}

const toCurrency = (providerCurrency: string): Currency | null => {
  const upper = providerCurrency.toUpperCase()

  return (CURRENCIES as readonly string[]).includes(upper)
    ? (upper as Currency)
    : null
}

export type ResolveConfirmedPaymentArgs = {
  stripe: Stripe
  /** The invoice from the event. Re-fetched, because the event lacks payments. */
  invoiceId: string
  /** The event's own `created`, as the fallback paid-at. */
  eventCreated: number
}

export type ResolvedPayment =
  { ok: true; payment: ConfirmedPayment } | { ok: false; reason: string }

/**
 * Establish that the invoice was paid, and by what.
 *
 * Returns a reason rather than throwing, because the caller is a webhook
 * handler that must answer Stripe either way.
 */
export const resolveConfirmedPayment = async ({
  stripe,
  invoiceId,
  eventCreated,
}: ResolveConfirmedPaymentArgs): Promise<ResolvedPayment> => {
  let invoice: Stripe.Invoice

  try {
    invoice = await stripe.invoices.retrieve(invoiceId, {
      // `payments` is expandable and absent from the event payload.
      expand: ['payments'],
    })
  } catch {
    return { ok: false, reason: 'INVOICE_RETRIEVE_FAILED' }
  }

  // Re-check settlement against the FRESH object, not the event. A dashboard
  // replay can deliver `invoice.paid` for an invoice later voided, and this
  // read is the most current word on it.
  if (invoice.status !== 'paid' || (invoice.amount_remaining ?? 0) !== 0) {
    return {
      ok: false,
      reason: `NOT_ACTUALLY_PAID_status_${invoice.status ?? 'null'}`,
    }
  }

  const currency = toCurrency(invoice.currency)

  if (!currency) {
    return { ok: false, reason: `CURRENCY_NOT_SOLD_${invoice.currency}` }
  }

  const entry = invoice.payments?.data?.[0]?.payment
  const paymentIntentId = idOf(entry?.payment_intent)
  const bareChargeId = idOf(entry?.charge)
  const providerPaymentId = paymentIntentId ?? bareChargeId

  if (!providerPaymentId) {
    // Nothing to key the invoice on. Better to refuse and let reconciliation
    // report it than to issue a document that no refund can ever be matched
    // to.
    return { ok: false, reason: 'NO_PAYMENT_ON_INVOICE' }
  }

  /* --- Card details: best effort ----------------------------------------- */

  let providerChargeId = bareChargeId
  let cardBrand: string | null = null
  let cardLast4: string | null = null
  let cardCountry: string | null = null
  let paidAt = new Date(eventCreated * 1000)

  try {
    if (paymentIntentId) {
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
        expand: ['latest_charge'],
      })

      const charge =
        typeof intent.latest_charge === 'object' ? intent.latest_charge : null

      if (charge) {
        providerChargeId = charge.id
        const card = charge.payment_method_details?.card

        if (card) {
          cardBrand = card.brand ?? null
          cardLast4 = card.last4 ?? null
          cardCountry = card.country ?? null
        }

        if (typeof charge.created === 'number') {
          paidAt = new Date(charge.created * 1000)
        }
      }
    }
  } catch {
    // Deliberately swallowed. The card country is evidence for a VAT regime
    // that does not apply while the operator is not registered, and a
    // statutory document for a payment that definitely happened matters more
    // than an optional column. Null means "we did not learn it".
  }

  return {
    ok: true,
    payment: {
      providerPaymentId,
      providerChargeId,
      currency,
      amountMinor: invoice.amount_paid,
      paidAt,
      method: cardBrand ? 'CARD' : 'OTHER',
      cardBrand,
      cardLast4,
      cardCountry,
    },
  }
}
