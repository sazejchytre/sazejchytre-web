/**
 * The accounting port: everything the application may know about issuing
 * accounting documents.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * NO PROVIDER TYPE APPEARS IN THIS FILE
 *
 * Not a Fakturoid type, not a Fakturoid status string, not a Fakturoid id
 * under a generic name. Same rule and same reason as the billing port: a
 * provider type here would spread through every caller, and "replace the
 * accounting provider" would stop being a file and become a refactor.
 *
 * The test is mechanical. If `grep -i fakturoid` over this file returns
 * anything but prose, the abstraction has already failed.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT MAKES THIS PORT DIFFERENT FROM THE BILLING ONE
 *
 * Billing failures are mostly about a customer's card. Accounting failures
 * are about a statutory series, and the asymmetry is brutal: a document
 * created by mistake cannot be cleanly removed, because deleting it leaves a
 * gap in a numbered sequence that has to be explained to a tax inspection.
 *
 * So every operation here is designed around "ask before you create":
 * `issueInvoice` and `issueCreditNote` look for an existing document carrying
 * our own id first and ADOPT it rather than making a second one. That is not
 * an optimisation, it is the only safe way to retry.
 */
import type { Currency } from '../billing/constants.ts'

/* -------------------------------------------------------------------------- */
/* Failure vocabulary                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Every expected way an accounting operation can fail.
 *
 * Deliberately distinct strings for the four situations that look alike in a
 * log and mean completely different things — the same lesson as the webhook
 * refusal reasons: a provider that is down, a provider that is throttling us,
 * a provider that rejected our data, and a document that already exists must
 * never share a reason.
 */
export const ACCOUNTING_FAILURE_CODES = [
  /** The provider throttled us. Retry after the window. */
  'RATE_LIMITED',
  /** The provider is in maintenance / read-only. Retry later. */
  'PROVIDER_MAINTENANCE',
  /**
   * The provider failed unexpectedly — a 5xx that is not maintenance.
   *
   * Distinct from maintenance although both are retryable, because a log
   * reading "maintenance" for a crash sends somebody to a status page that
   * says everything is fine. Same reason the webhook refusals were split in
   * step 4: two causes sharing one reason string costs an afternoon.
   */
  'PROVIDER_ERROR',
  /**
   * The provider account is blocked — an unpaid bill with the provider.
   * Retrying will not help; somebody has to pay it.
   */
  'ACCOUNT_BLOCKED',
  /**
   * The provider refused our data. Our bug or our configuration, not a
   * transient: the same request will be refused again.
   */
  'REJECTED_DATA',
  /** A document carrying our id already exists. Usually adopted, not failed. */
  'DOCUMENT_ALREADY_EXISTS',
  'DOCUMENT_NOT_FOUND',
  'SUBJECT_NOT_FOUND',
  /** Already locked, or already paid. Both mean "nothing left to do". */
  'ALREADY_FINALISED',
  /** The document cannot be corrected (already cancelled, for instance). */
  'NOT_CORRECTABLE',
] as const

export type AccountingFailureCode = (typeof ACCOUNTING_FAILURE_CODES)[number]

/** Failures where trying the same thing later could plausibly work. */
export const RETRYABLE_ACCOUNTING_CODES: readonly AccountingFailureCode[] = [
  'RATE_LIMITED',
  'PROVIDER_MAINTENANCE',
  'PROVIDER_ERROR',
] as const

export type AccountingFailure = {
  ok: false
  code: AccountingFailureCode
  /** For operators and logs. Never shown to a customer. */
  message: string
  retryable: boolean
  /** The provider's own code or field errors, for support. */
  providerDetail?: string
  /**
   * Seconds to wait before retrying, when the provider told us.
   *
   * Present for RATE_LIMITED. Honoured rather than guessed, because guessing
   * is how a backoff turns into a hammer.
   */
  retryAfterSeconds?: number
}

export type AccountingSuccess<T> = { ok: true; value: T }

export type AccountingResult<T> = AccountingSuccess<T> | AccountingFailure

export const accountingOk = <T>(value: T): AccountingSuccess<T> => ({
  ok: true,
  value,
})

export const accountingFail = (
  code: AccountingFailureCode,
  message: string,
  extra: { providerDetail?: string; retryAfterSeconds?: number } = {},
): AccountingFailure => ({
  ok: false,
  code,
  message,
  retryable: RETRYABLE_ACCOUNTING_CODES.includes(code),
  ...(extra.providerDetail ? { providerDetail: extra.providerDetail } : {}),
  ...(extra.retryAfterSeconds === undefined
    ? {}
    : { retryAfterSeconds: extra.retryAfterSeconds }),
})

/* -------------------------------------------------------------------------- */
/* Exceptions — only for what a caller cannot handle                          */
/* -------------------------------------------------------------------------- */

/** We are misconfigured: bad credentials, wrong slug, missing user agent. */
export class AccountingConfigurationError extends Error {
  readonly code = 'ACCOUNTING_MISCONFIGURED'

  constructor(message: string) {
    super(message)
    this.name = 'AccountingConfigurationError'
  }
}

/**
 * The provider could not be reached at all.
 *
 * Distinct from maintenance, which is the provider answering "not now". This
 * is the provider not answering — and it must never lose a payment or roll
 * back an entitlement, so callers record and retry rather than fail the sale.
 */
export class AccountingProviderUnreachableError extends Error {
  readonly code = 'ACCOUNTING_PROVIDER_UNREACHABLE'

  constructor(provider: string, options?: ErrorOptions) {
    super(`Accounting provider ${provider} is unreachable.`, options)
    this.name = 'AccountingProviderUnreachableError'
  }
}

/* -------------------------------------------------------------------------- */
/* Domain shapes crossing the port                                            */
/* -------------------------------------------------------------------------- */

/** A customer as the accounting provider knows them. */
export type AccountingSubject = {
  providerSubjectId: string
}

export type AccountingDocumentType = 'INVOICE' | 'CREDIT_NOTE'

/**
 * A document as the provider currently reports it.
 *
 * `number` is the provider's — it owns the series now. Our row records it and
 * no longer allocates it.
 */
export type AccountingDocument = {
  providerDocumentId: string
  number: string
  documentType: AccountingDocumentType
  currency: Currency
  /**
   * Document total in OUR integer minor units, SIGNED as the provider states
   * it: positive for an invoice, NEGATIVE for a credit note.
   *
   * Reported signed rather than absolute because the sign is the whole
   * meaning of a correction document. A correction with a positive total is a
   * valid document — it corrects an undercharge upward — so an adapter that
   * returned absolute values would make "we credited the customer 799" and
   * "we billed the customer another 799" indistinguishable at this boundary.
   * Our own `credit_notes` rows keep their positive convention; the mapping
   * negates in exactly one place.
   */
  totalMinor: number
  issuedOn: Date
  taxableFulfillmentDue: Date
  paid: boolean
  locked: boolean
}

/** One line of a document. */
export type AccountingLine = {
  /** Plain-language description, as printed. */
  name: string
  /** Unit price in integer minor units. Converted at the adapter boundary. */
  unitPriceMinor: number
  quantity: number
}

export type EnsureSubjectInput = {
  /**
   * Our customer id, carried to the provider as its own `custom_id`.
   *
   * What makes subject creation idempotent: a second call for the same
   * customer finds the first subject instead of creating a duplicate, which
   * would split their documents across two records nothing joins back up.
   */
  customId: string
  name: string
  email: string
  street?: string | null
  city?: string | null
  zip?: string | null
  /** ISO 3166-1 alpha-2. */
  country?: string | null
}

export type IssueInvoiceInput = {
  /**
   * OUR invoice id, carried as the provider's `custom_id`.
   *
   * THE IDEMPOTENCY KEY. Before creating anything the adapter looks for a
   * document with this id and adopts it. Without that, a failure between the
   * provider creating a document and us recording its id produces a duplicate
   * on retry — and a duplicate in a statutory series cannot be cleanly
   * removed.
   */
  customId: string
  providerSubjectId: string
  currency: Currency
  lines: readonly AccountingLine[]
  issuedOn: Date
  /** Datum uskutečnění plnění. */
  taxableFulfillmentDue: Date
  /** Already settled through our payment provider. */
  alreadyPaid: boolean
  /** When the money arrived, for the payment record. */
  paidOn: Date
  /** Our own vocabulary; the adapter maps it. */
  paymentMethod: 'CARD' | 'OTHER'
  /** Free text printed on the document, e.g. the period covered. */
  note?: string | null
}

export type IssueCreditNoteInput = {
  customId: string
  providerSubjectId: string
  /** The document being corrected. */
  correctsProviderDocumentId: string
  currency: Currency
  /**
   * The amounts being credited, as POSITIVE numbers.
   *
   * The adapter takes the absolute value and negates it, so a correction
   * always reduces what the customer owes no matter which sign a caller
   * passes. That is deliberately forgiving: the failure mode of the strict
   * alternative is a caller who omits a minus sign and thereby issues a
   * correction that bills the customer a second time, which is a real
   * accounting error on a document that cannot be deleted. Being lenient here
   * makes that mistake impossible to make.
   */
  lines: readonly AccountingLine[]
  issuedOn: Date
  /** Printed on the document and carried into the export. */
  reason: string
}

/**
 * The outcome of issuing: the document, and whether it already existed.
 *
 * `adopted: true` means a document carrying our `customId` was already there
 * and we took it rather than creating a second one. The caller needs to know
 * which happened — "issued FA-1" and "adopted the FA-1 that already existed"
 * are different events, and a log that cannot tell them apart cannot tell a
 * healthy retry from a duplicate-creation bug.
 */
export type IssuedDocument = {
  document: AccountingDocument
  adopted: boolean
}

/**
 * The result of asking for a document's PDF.
 *
 * `ready: false` is NOT a failure. Providers generate PDFs asynchronously, so
 * "not yet" is the ordinary first answer and the caller polls. Modelling it as
 * a failure would make every first attempt look like something went wrong.
 */
export type DocumentPdf =
  { ready: true; pdf: Buffer } | { ready: false; reason: 'GENERATING' }

/* -------------------------------------------------------------------------- */
/* The port                                                                   */
/* -------------------------------------------------------------------------- */

export type AccountingPort = {
  /** Which provider this is, in our own vocabulary. */
  readonly provider: string

  /** Find or create the provider-side customer. Idempotent on `customId`. */
  ensureSubject(
    input: EnsureSubjectInput,
  ): Promise<AccountingResult<AccountingSubject>>

  /**
   * Issue an invoice, or adopt the one that already carries this `customId`.
   *
   * Records the payment and leaves the document paid when `alreadyPaid`.
   */
  issueInvoice(
    input: IssueInvoiceInput,
  ): Promise<AccountingResult<IssuedDocument>>

  /** Issue a correction document against an invoice, or adopt the existing one. */
  issueCreditNote(
    input: IssueCreditNoteInput,
  ): Promise<AccountingResult<IssuedDocument>>

  /** Fetch the rendered PDF, or report that it is still being generated. */
  fetchDocumentPdf(
    providerDocumentId: string,
  ): Promise<AccountingResult<DocumentPdf>>

  getDocument(
    providerDocumentId: string,
  ): Promise<AccountingResult<AccountingDocument>>

  /**
   * Lock the document against further edits.
   *
   * Idempotent: locking an already-locked document succeeds rather than
   * failing, so a retry after a lost response does not need special handling.
   */
  lockDocument(
    providerDocumentId: string,
  ): Promise<AccountingResult<AccountingDocument>>
}

/** Every operation name, for the contract tests to iterate over. */
export const ACCOUNTING_PORT_OPERATIONS = [
  'ensureSubject',
  'issueInvoice',
  'issueCreditNote',
  'fetchDocumentPdf',
  'getDocument',
  'lockDocument',
] as const satisfies readonly (keyof AccountingPort)[]
