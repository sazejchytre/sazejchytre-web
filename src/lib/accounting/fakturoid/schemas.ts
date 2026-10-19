/**
 * What we accept from Fakturoid, and nothing more.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY EVERY RESPONSE IS VALIDATED
 *
 * The response carries the document NUMBER and the document TOTAL, and both
 * go straight into our books. If a field arrives missing or renamed, the
 * choice is between finding out here, on one request, or storing `undefined`
 * as an invoice number and discovering it when an accountant asks why a row
 * in the export has no document against it.
 *
 * The totals are the sharper case. Fakturoid sends them as decimal STRINGS
 * ("799.0"), and `Number()` on a missing field yields `NaN`, which propagates
 * silently through money arithmetic. A schema turns that into one loud
 * failure at the boundary.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THE SCHEMAS ARE LOOSE ABOUT FIELDS WE DO NOT USE
 *
 * Fakturoid's invoice object has upwards of eighty fields and they add more.
 * A strict schema would reject a response because a field we never read
 * appeared — turning their routine feature release into our outage. So
 * unknown keys are allowed through and dropped; only what we actually read is
 * required.
 */
import { z } from 'zod'

/**
 * A money amount as Fakturoid sends it.
 *
 * Accepts a string or a number because they are not consistent about it
 * across fields, and normalises to a string so exactly one parser — the
 * integer-safe one in `../decimal.ts` — turns it into minor units. Converting
 * here with `Number()` would be the one float the codebase does not allow.
 */
const decimalAmount = z.union([z.string(), z.number()]).transform(String)

/** An id, which they send as a number but which we carry as a string. */
const providerId = z.union([z.string(), z.number()]).transform(String)

/**
 * A date as Fakturoid sends it: `2026-10-16`, or a full timestamp.
 *
 * Kept as a string here and parsed in the adapter, so a value we cannot read
 * is reported as a schema failure naming the field rather than becoming an
 * `Invalid Date` that reaches the database.
 */
const dateString = z.string().min(8)

export const fakturoidSubjectSchema = z.looseObject({
  id: providerId,
  custom_id: z.string().nullish(),
  name: z.string().nullish(),
})

export type FakturoidSubject = z.infer<typeof fakturoidSubjectSchema>

export const fakturoidSubjectListSchema = z.array(fakturoidSubjectSchema)

/**
 * The fields of an invoice we actually depend on.
 *
 * `number` and `total` are the two that must never be wrong: the first is the
 * statutory identifier, the second is the amount in the accounts.
 */
export const fakturoidInvoiceSchema = z.looseObject({
  id: providerId,
  custom_id: z.string().nullish(),
  /** The number Fakturoid allocated. We no longer allocate our own. */
  number: z.string().min(1),
  document_type: z.string().min(1),
  subject_id: providerId.nullish(),
  currency: z.string().min(3),
  total: decimalAmount,
  /** Outstanding amount. Zero once the payment is recorded. */
  remaining_amount: decimalAmount.nullish(),
  issued_on: dateString,
  taxable_fulfillment_due: dateString.nullish(),
  paid_on: dateString.nullish(),
  /** `open`, `sent`, `overdue`, `paid`, `cancelled`. */
  status: z.string().nullish(),
  /** Set once the document is locked against edits. */
  locked_at: z.string().nullish(),
  /** Present on a correction: the document being corrected. */
  correction_id: providerId.nullish(),
  /** Fakturoid's own web URL. Never shown to a customer. */
  html_url: z.string().nullish(),
})

export type FakturoidInvoice = z.infer<typeof fakturoidInvoiceSchema>

export const fakturoidInvoiceListSchema = z.array(fakturoidInvoiceSchema)

/** The account settings, read by the preflight check in the live script. */
export const fakturoidAccountSchema = z.looseObject({
  name: z.string().nullish(),
  registration_no: z.string().nullish(),
  /**
   * The account's VAT mode.
   *
   * `non_vat_payer` is what this operator is, and it is why our documents
   * carry no VAT: it is an account setting at Fakturoid rather than a branch
   * in our code. Read so a mismatch is caught loudly — if this ever says
   * anything else, documents would start carrying VAT lines that the rest of
   * the system does not model.
   */
  vat_mode: z.string().nullish(),
  currency: z.string().nullish(),
  invoice_language: z.string().nullish(),
})

export type FakturoidAccount = z.infer<typeof fakturoidAccountSchema>

/**
 * Parse, or explain what arrived.
 *
 * A raw ZodError in a log is a wall of nested objects; this collapses it to
 * the field paths, which is the part that identifies the problem.
 */
export const parseFakturoid = <T>(
  schema: z.ZodType<T>,
  body: unknown,
  what: string,
): { ok: true; value: T } | { ok: false; detail: string } => {
  const result = schema.safeParse(body)

  if (result.success) return { ok: true, value: result.data }

  const detail = result.error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ')

  return { ok: false, detail: `${what} — ${detail}`.slice(0, 500) }
}
