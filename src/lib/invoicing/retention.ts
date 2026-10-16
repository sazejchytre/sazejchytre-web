/**
 * Erasing a customer without erasing the accounting record.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE RULE
 *
 * A GDPR erasure request ANONYMISES the customer record and removes the
 * sign-in account. It does NOT touch issued invoices or credit notes.
 *
 * That is not a loophole, it is the other half of the law. GDPR Art. 17(3)(b)
 * exempts processing required to comply with a legal obligation, and Czech
 * accounting and tax law obliges the operator to keep accounting documents
 * (zákon č. 563/1991 Sb. — accounting records for 5 years; VAT documents 10
 * years under the VAT Act where applicable). An invoice is the statutory
 * record of a transaction that happened; deleting it would not protect the
 * customer, it would destroy the operator's own evidence and leave a hole in a
 * numbered series that has to be gap-free.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHICH MEANS THE SNAPSHOTS ARE THE POINT
 *
 * `customerSnapshot` on an invoice holds the name, email and country as at
 * issue. That is deliberately a COPY, and this function deliberately does not
 * touch it. If erasure rewrote the snapshots, every historical document would
 * change and the operator would hold invoices that no longer say who they were
 * issued to — which is exactly the record-keeping failure the retention
 * obligation exists to prevent.
 *
 * So the live `customers` row is anonymised, the auth user is deleted, and the
 * documents stand. What is retained is the minimum: the documents, and the
 * `customers` row they point at, reduced to an opaque marker.
 */
import type { Payload, PayloadRequest } from 'payload'

import { authDb } from '../auth/config.ts'

export type AnonymiseResult = {
  customerId: number
  /** The placeholder the row now holds, for the audit trail. */
  anonymisedEmail: string
  /** How many documents were deliberately left untouched. */
  retainedInvoices: number
  retainedCreditNotes: number
  /** Whether a sign-in account was found and removed. */
  authUserRemoved: boolean
}

/**
 * The address an anonymised customer gets.
 *
 * Unique per customer so the column's uniqueness still holds, and obviously
 * not a real address so nobody tries to mail it. `.invalid` is reserved by
 * RFC 2606 precisely so it can never resolve.
 */
export const anonymisedEmailFor = (customerId: number): string =>
  `anonymised-${String(customerId)}@erased.invalid`

/** What the live customer row's name becomes. Never the invoice snapshots'. */
export const ANONYMISED_NAME = 'Anonymizovaný zákazník'

/**
 * Anonymise a customer, keeping the accounting documents.
 *
 * Idempotent: running it twice leaves the same row and reports the same
 * counts, so a retried erasure request is harmless.
 */
export const anonymiseCustomer = async (args: {
  payload: Payload
  customerId: number
  req?: PayloadRequest
}): Promise<AnonymiseResult> => {
  const { payload, customerId } = args
  const reqOption = args.req ? { req: args.req } : {}

  const customer = await payload.findByID({
    collection: 'customers',
    id: customerId,
    depth: 0,
    overrideAccess: true,
    ...reqOption,
  })

  // Counted, not modified. Reported so the caller can record in the erasure
  // log what was retained and why — which is what an data-protection enquiry
  // will ask for.
  const [invoices, creditNotes] = await Promise.all([
    payload.count({
      collection: 'invoices',
      overrideAccess: true,
      ...reqOption,
      where: { customer: { equals: customerId } },
    }),
    payload.count({
      collection: 'credit-notes',
      overrideAccess: true,
      ...reqOption,
      where: { 'invoice.customer': { equals: customerId } },
    }),
  ])

  const anonymisedEmail = anonymisedEmailFor(customerId)
  const authUserId = customer.authUserId ?? null

  await payload.update({
    collection: 'customers',
    id: customerId,
    overrideAccess: true,
    ...reqOption,
    data: {
      email: anonymisedEmail,
      // A placeholder, not null: `name` is required because an invoice needs
      // somebody named on it. Visibly anonymised beats an empty field that
      // reads like missing data.
      name: ANONYMISED_NAME,
      // The sign-in account is going; the link must not dangle.
      authUserId: null,
      // `billingCountry` and `currency` stay. They are not personal data on
      // their own and the cross-border revenue aggregation reads them; a
      // country alone cannot identify anybody.
    },
  })

  /* --- Remove the sign-in account ---------------------------------------- */

  let authUserRemoved = false

  if (authUserId) {
    // Raw SQL against the `auth` schema: better-auth owns those tables and
    // Payload cannot see them, which is the whole point of the schema split.
    // Deleting the user cascades to its sessions and accounts.
    const deleted = await authDb
      .deleteFrom('auth.user' as never)
      .where('id' as never, '=', authUserId as never)
      .executeTakeFirst()

    authUserRemoved = Number(deleted?.numDeletedRows ?? 0n) > 0
  }

  return {
    customerId,
    anonymisedEmail,
    retainedInvoices: invoices.totalDocs,
    retainedCreditNotes: creditNotes.totalDocs,
    authUserRemoved,
  }
}
