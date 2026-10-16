/**
 * What "the payment really happened" looks like, independent of any provider.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS TYPE EXISTS
 *
 * An invoice may be issued only from a CONFIRMED payment — never from an event
 * type, never speculatively, never on subscription creation. "Confirmed" is a
 * claim about the provider's data, and the only honest way to keep that claim
 * checkable is to make the caller produce the evidence as a value.
 *
 * So `issueInvoiceForPayment` does not take a Stripe object and decide for
 * itself. It takes this, and the one place that builds it from Stripe
 * (`src/lib/invoicing/stripe-payment.ts`) is the only place that has to be
 * read carefully. Everything downstream — the snapshot, the numbering, the
 * PDF, the email — is then provider-agnostic and testable without a network.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY cardCountry IS ALLOWED TO BE NULL
 *
 * The card's issuing country is one of the three tax-location signals, and it
 * is the only one that lives on the provider's charge rather than on anything
 * we hold. Fetching it is an extra API call that can fail.
 *
 * It must not be able to stop an invoice being issued. A statutory document
 * for a payment that definitely happened is more important than a nice-to-have
 * evidence column, and VAT location evidence only matters once the operator is
 * VAT registered and selling cross-border — neither of which is true today.
 * So it is best-effort, and null means "we did not learn it", never "there was
 * no card".
 */
import type { Currency } from '../billing/constants.ts'

/** How the customer paid. Our vocabulary, not the provider's. */
export const PAYMENT_METHOD_KINDS = ['CARD', 'OTHER'] as const
export type PaymentMethodKind = (typeof PAYMENT_METHOD_KINDS)[number]

export type ConfirmedPayment = {
  /**
   * The provider id that identifies this payment, stored on the invoice.
   *
   * The link a later refund or chargeback is traced back through, and the
   * uniqueness key that makes issuing idempotent. A payment intent id where
   * one exists, otherwise the charge id.
   */
  providerPaymentId: string

  /** The charge, when known. Refunds name a charge, not an intent. */
  providerChargeId: string | null

  /** Settlement currency, from the provider's own record of the payment. */
  currency: Currency

  /** What was actually taken, in minor units. */
  amountMinor: number

  /** When the provider says the money arrived. Not when we found out. */
  paidAt: Date

  method: PaymentMethodKind

  /**
   * Card brand and last four, for the "paid by" line on the document.
   *
   * Last four only. There is nowhere here to put a card number, and there
   * must not be: holding a PAN puts this application inside PCI-DSS scope.
   */
  cardBrand: string | null
  cardLast4: string | null

  /** ISO 3166-1 alpha-2 of the card's issuing country. Best-effort. */
  cardCountry: string | null
}

/**
 * The period the payment bought, and what it bought.
 *
 * Passed in rather than read from the subscription at issue time, because the
 * invoice must describe what was sold THEN. A plan renamed or repriced later
 * must not change a document that has already been sent.
 */
export type BilledPeriod = {
  /** Plan name as it read at the moment of sale. */
  planName: string
  periodStart: Date
  periodEnd: Date
}
