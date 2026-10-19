/**
 * Getting one of our rows an accounting document, and its PDF.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE ROW COMES FIRST, ALWAYS
 *
 * Our row is written the moment money arrives. The accounting document is
 * created afterwards, at a third party that can be unreachable, in
 * maintenance, or throttling us.
 *
 * That order is not an implementation detail, it is the whole safety
 * property. If issuing the document were part of recording the sale, then
 * Fakturoid being down would mean one of two things: we lose the payment, or
 * we roll back an entitlement the customer has already been given and paid
 * for. Neither is acceptable. So the row is recorded, `accountingState` stays
 * PENDING, and the retry cron finishes the job later. Nothing is lost and
 * nothing is rolled back.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * CUSTOM_ID IS OUR ROW ID, AND IT IS PREFIXED
 *
 * Every document carries `custom_id`, which is how a retry finds a document
 * that was already created rather than creating a second one. It is our own
 * row id — but PREFIXED, which matters more than it looks:
 *
 * Fakturoid keeps corrections in the same collection as invoices. A bare
 * numeric id would mean our invoice #7 and our credit note #7 both search for
 * `custom_id=7`, and whichever was created first would be adopted by the
 * other. A refund would then "find" the invoice it was meant to correct and
 * report it as already done. The prefix makes that impossible.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * EVERY OUTCOME HAS ITS OWN REASON STRING
 *
 * `ACCOUNTING_REASONS` below. A provider that is unreachable, a provider
 * that is throttling us, a provider that refused our data, and a document
 * that already existed are four different situations with four different
 * responses, and in a log they all look like "issuing didn't work". Step 4
 * cost an afternoon to exactly that collapse, in the webhook refusals; the
 * lesson is applied here before it costs another one.
 */
import type { Payload, PayloadRequest } from 'payload'

import { getAccountingPort } from '../accounting/registry.ts'
import {
  AccountingConfigurationError,
  AccountingProviderUnreachableError,
  type AccountingPort,
} from '../accounting/port.ts'
import type { Currency } from '../billing/constants.ts'
import { documentStorageKey } from './document-key.ts'

export type DocumentCollection = 'invoices' | 'credit-notes'

/**
 * Why a call to this module ended the way it did.
 *
 * Deliberately distinct strings, and asserted to be distinct by a test. Two
 * causes sharing one reason is how an hour goes on the wrong hypothesis.
 */
export const ACCOUNTING_REASONS = [
  /** Created at the provider, numbered and locked. */
  'ISSUED',
  /**
   * A document carrying our id was already there, so it was taken rather than
   * created again. A healthy retry, NOT a duplicate — but worth its own
   * string, because a log that cannot tell this from ISSUED cannot tell a
   * recovered failure from a duplicate-creation bug.
   */
  'ADOPTED_EXISTING_DOCUMENT',
  /** Already done before this call. Nothing happened. */
  'ALREADY_ISSUED',
  /** The provider did not answer at all. Row stays PENDING; the cron retries. */
  'PROVIDER_UNREACHABLE',
  /** The provider throttled us. Row stays PENDING. */
  'RATE_LIMITED',
  /** The provider is in maintenance. Row stays PENDING. */
  'PROVIDER_MAINTENANCE',
  /** The provider failed unexpectedly. Row stays PENDING. */
  'PROVIDER_ERROR',
  /**
   * The provider refused our data. Retrying sends the same thing and gets the
   * same answer, so the row goes to FAILED and wants a human.
   */
  'REJECTED_DATA',
  /** The provider account is blocked. A human has to pay a bill. */
  'ACCOUNT_BLOCKED',
  /** We are misconfigured. Not retryable, and not the provider's fault. */
  'MISCONFIGURED',
  /** The row does not hold what a document needs. */
  'ROW_NOT_ISSUABLE',
  /** The PDF is still being generated. Ordinary; the cron comes back. */
  'PDF_GENERATING',
] as const

export type AccountingReason = (typeof ACCOUNTING_REASONS)[number]

/** Reasons where coming back later could plausibly work. */
const RETRYABLE_REASONS: readonly AccountingReason[] = [
  'PROVIDER_UNREACHABLE',
  'RATE_LIMITED',
  'PROVIDER_MAINTENANCE',
  'PROVIDER_ERROR',
  'PDF_GENERATING',
]

/**
 * Reasons that put the row in FAILED, so the cron stops trying.
 *
 * Retrying any of these sends the same request and gets the same answer, so
 * the only thing another attempt achieves is noise — and a row stuck on
 * PENDING forever looks like a transient problem when it is not.
 *
 * MISCONFIGURED is deliberately NOT here, although it is equally
 * non-retryable right now. The difference is who fixes it: a bad payload or a
 * blocked provider account needs somebody to look at THIS document, whereas
 * missing credentials get fixed by a deploy, after which every PENDING row
 * should go through on the next cron run. Marking those FAILED would mean
 * hand-resetting every invoice that happened to land during the outage.
 */
const PERMANENT_REASONS: readonly AccountingReason[] = [
  'REJECTED_DATA',
  'ACCOUNT_BLOCKED',
  'ROW_NOT_ISSUABLE',
]

export type EnsureDocumentResult = {
  reason: AccountingReason
  /** Whether the caller should expect a later attempt to do better. */
  retryable: boolean
  providerDocumentId?: string
  number?: string
  /** For logs. Never shown to a customer. */
  detail?: string
}

const result = (
  reason: AccountingReason,
  extra: Omit<EnsureDocumentResult, 'reason' | 'retryable'> = {},
): EnsureDocumentResult => ({
  reason,
  retryable: RETRYABLE_REASONS.includes(reason),
  ...extra,
})

/** Map a provider failure code onto our reason vocabulary. */
const reasonForCode = (code: string): AccountingReason => {
  switch (code) {
    case 'RATE_LIMITED':
      return 'RATE_LIMITED'
    case 'PROVIDER_MAINTENANCE':
      return 'PROVIDER_MAINTENANCE'
    case 'PROVIDER_ERROR':
      return 'PROVIDER_ERROR'
    case 'ACCOUNT_BLOCKED':
      return 'ACCOUNT_BLOCKED'
    default:
      // SUBJECT_NOT_FOUND, NOT_CORRECTABLE, DOCUMENT_NOT_FOUND and
      // REJECTED_DATA all mean the same thing operationally: what we sent
      // cannot succeed, so stop sending it.
      return 'REJECTED_DATA'
  }
}

/**
 * Record a permanent failure on the row, once, wherever it came from.
 *
 * Centralised because the sequence has several steps that can be permanently
 * refused — finding the customer at the provider, creating the document,
 * locking it — and the row has to end up in the same state regardless of
 * which one said no. Doing it per-call-site is how one of them gets missed.
 */
const recordPermanentFailure = async (
  payload: Payload,
  req: PayloadRequest | undefined,
  collection: DocumentCollection,
  id: number,
  outcome: EnsureDocumentResult,
): Promise<EnsureDocumentResult> => {
  if (!PERMANENT_REASONS.includes(outcome.reason)) return outcome

  await payload.update({
    collection,
    id,
    overrideAccess: true,
    ...(req ? { req } : {}),
    data: { accountingState: 'FAILED' },
  })

  return outcome
}

/**
 * `inv-42`, `cn-7`. See the header for why the prefix is load-bearing.
 */
export const accountingCustomId = (
  collection: DocumentCollection,
  id: number,
): string => `${collection === 'invoices' ? 'inv' : 'cn'}-${String(id)}`

/* -------------------------------------------------------------------------- */
/* Subject                                                                    */
/* -------------------------------------------------------------------------- */

type CustomerRow = {
  id: number
  email: string
  name?: string | null
  billingCountry?: string | null
  fakturoidSubjectId?: string | null
}

/**
 * The customer as the provider knows them, cached on our row.
 *
 * The cache saves a request per issuing, but it is not only an optimisation:
 * the provider-side lookup is what keeps subject creation idempotent, and
 * holding the id means a provider that briefly forgets its own index cannot
 * cause us to create a second subject for one customer. Two subjects would
 * split their documents across two records nothing joins back up.
 */
export const ensureSubjectForCustomer = async (args: {
  payload: Payload
  req?: PayloadRequest
  port: AccountingPort
  customer: CustomerRow
}): Promise<{ providerSubjectId: string } | EnsureDocumentResult> => {
  const { payload, req, port, customer } = args

  if (customer.fakturoidSubjectId) {
    return { providerSubjectId: customer.fakturoidSubjectId }
  }

  const ensured = await port.ensureSubject({
    customId: `cust-${String(customer.id)}`,
    // A document needs somebody named on it, and the email is the only
    // identity we are guaranteed to hold.
    name: customer.name?.trim() || customer.email,
    email: customer.email,
    country: customer.billingCountry ?? 'CZ',
  })

  if (!ensured.ok) {
    return result(reasonForCode(ensured.code), { detail: ensured.message })
  }

  await payload.update({
    collection: 'customers',
    id: customer.id,
    overrideAccess: true,
    ...(req ? { req } : {}),
    data: { fakturoidSubjectId: ensured.value.providerSubjectId },
  })

  return { providerSubjectId: ensured.value.providerSubjectId }
}

/* -------------------------------------------------------------------------- */
/* Issuing                                                                    */
/* -------------------------------------------------------------------------- */

type InvoiceRow = {
  id: number
  customer: number | { id: number }
  currency: string
  totalMinor: number
  issuedAt: string
  taxableSupplyDate: string
  accountingState: string
  fakturoidDocumentId?: string | null
  fakturoidNumber?: string | null
  serviceSnapshot?: {
    planName?: string | null
    description?: string | null
    periodStart?: string | null
    periodEnd?: string | null
  } | null
  paymentSnapshot?: { paidAt?: string | null } | null
}

type CreditNoteRow = {
  id: number
  invoice: number | { id: number }
  currency: string
  amountMinor: number
  reason: string
  issuedAt: string
  accountingState: string
  fakturoidDocumentId?: string | null
  fakturoidNumber?: string | null
}

const idOf = (reference: number | { id: number }): number =>
  typeof reference === 'object' ? reference.id : reference

/** `16. 10. 2026 – 15. 11. 2026`, for the line on the document. */
const formatPeriod = (start: string, end: string): string => {
  const czech = (iso: string): string => {
    const date = new Date(iso)

    return `${String(date.getUTCDate())}. ${String(date.getUTCMonth() + 1)}. ${String(date.getUTCFullYear())}`
  }

  return `${czech(start)} – ${czech(end)}`
}

/**
 * Make sure an invoice row has an accounting document.
 *
 * Idempotent in both directions: it short circuits if our row already names a
 * document, and the provider adopts an existing one if our row does not know
 * about it. The second is the one that matters — it covers the case where the
 * document was created and the response never reached us.
 */
export const ensureInvoiceDocument = async (args: {
  payload: Payload
  req?: PayloadRequest
  id: number
  port?: AccountingPort
}): Promise<EnsureDocumentResult> =>
  recordPermanentFailure(
    args.payload,
    args.req,
    'invoices',
    args.id,
    await issueInvoiceDocument(args),
  )

const issueInvoiceDocument = async (args: {
  payload: Payload
  req?: PayloadRequest
  id: number
  port?: AccountingPort
}): Promise<EnsureDocumentResult> => {
  const { payload, req, id } = args
  const reqOption = req ? { req } : {}

  const row = (await payload.findByID({
    collection: 'invoices',
    id,
    depth: 0,
    overrideAccess: true,
    ...reqOption,
  })) as unknown as InvoiceRow

  if (row.accountingState === 'ISSUED' && row.fakturoidDocumentId) {
    return result('ALREADY_ISSUED', {
      providerDocumentId: row.fakturoidDocumentId,
      ...(row.fakturoidNumber ? { number: row.fakturoidNumber } : {}),
    })
  }

  const service = row.serviceSnapshot

  if (!service?.description || !service.periodStart || !service.periodEnd) {
    // The snapshot is what the document is made of. Without it there is
    // nothing to issue, and guessing would put invented text on a tax
    // document.
    return result('ROW_NOT_ISSUABLE', {
      detail: `Invoice ${String(id)} has no service snapshot.`,
    })
  }

  try {
    const port = args.port ?? (await getAccountingPort())

    const customer = (await payload.findByID({
      collection: 'customers',
      id: idOf(row.customer),
      depth: 0,
      overrideAccess: true,
      ...reqOption,
    })) as unknown as CustomerRow

    const subject = await ensureSubjectForCustomer({
      payload,
      ...reqOption,
      port,
      customer,
    })

    if ('reason' in subject) return subject

    const issued = await port.issueInvoice({
      customId: accountingCustomId('invoices', id),
      providerSubjectId: subject.providerSubjectId,
      currency: row.currency as Currency,
      lines: [
        {
          name: service.description,
          unitPriceMinor: row.totalMinor,
          quantity: 1,
        },
      ],
      issuedOn: new Date(row.issuedAt),
      taxableFulfillmentDue: new Date(row.taxableSupplyDate),
      // The card was charged before the document existed, so the document
      // must say so rather than read as a demand for money already taken.
      alreadyPaid: true,
      paidOn: new Date(row.paymentSnapshot?.paidAt ?? row.issuedAt),
      paymentMethod: 'CARD',
      note: `Zdaňovací období: ${formatPeriod(service.periodStart, service.periodEnd)}`,
    })

    if (!issued.ok) {
      // No FAILED write here: `recordPermanentFailure` does it for every
      // step of this sequence at once, so none of them can be forgotten.
      return result(reasonForCode(issued.code), { detail: issued.message })
    }

    const document = issued.value.document

    // Locked immediately. An invoice is a statutory record the moment it is
    // issued, and leaving it editable at the provider means the document the
    // customer holds and the document in the books can drift apart.
    const locked = await port.lockDocument(document.providerDocumentId)

    if (!locked.ok) {
      // The document exists and is numbered, so this is NOT a failure to
      // issue — recording it and retrying the lock is right. Our row gets the
      // id either way, or the retry would look for it by custom_id again.
      await payload.update({
        collection: 'invoices',
        id,
        overrideAccess: true,
        ...reqOption,
        data: {
          accountingState: 'ISSUED',
          fakturoidDocumentId: document.providerDocumentId,
          fakturoidNumber: document.number,
        },
      })

      return result(reasonForCode(locked.code), {
        providerDocumentId: document.providerDocumentId,
        number: document.number,
        detail: `Issued but not locked: ${locked.message}`,
      })
    }

    await payload.update({
      collection: 'invoices',
      id,
      overrideAccess: true,
      ...reqOption,
      data: {
        accountingState: 'ISSUED',
        fakturoidDocumentId: document.providerDocumentId,
        fakturoidNumber: document.number,
      },
    })

    return result(
      issued.value.adopted ? 'ADOPTED_EXISTING_DOCUMENT' : 'ISSUED',
      {
        providerDocumentId: document.providerDocumentId,
        number: document.number,
      },
    )
  } catch (error) {
    return fromThrown(error)
  }
}

/** Make sure a credit-note row has a correction document. */
export const ensureCreditNoteDocument = async (args: {
  payload: Payload
  req?: PayloadRequest
  id: number
  port?: AccountingPort
}): Promise<EnsureDocumentResult> =>
  recordPermanentFailure(
    args.payload,
    args.req,
    'credit-notes',
    args.id,
    await issueCreditNoteDocument(args),
  )

const issueCreditNoteDocument = async (args: {
  payload: Payload
  req?: PayloadRequest
  id: number
  port?: AccountingPort
}): Promise<EnsureDocumentResult> => {
  const { payload, req, id } = args
  const reqOption = req ? { req } : {}

  const row = (await payload.findByID({
    collection: 'credit-notes',
    id,
    depth: 0,
    overrideAccess: true,
    ...reqOption,
  })) as unknown as CreditNoteRow

  if (row.accountingState === 'ISSUED' && row.fakturoidDocumentId) {
    return result('ALREADY_ISSUED', {
      providerDocumentId: row.fakturoidDocumentId,
      ...(row.fakturoidNumber ? { number: row.fakturoidNumber } : {}),
    })
  }

  try {
    const port = args.port ?? (await getAccountingPort())

    const invoice = (await payload.findByID({
      collection: 'invoices',
      id: idOf(row.invoice),
      depth: 0,
      overrideAccess: true,
      ...reqOption,
    })) as unknown as InvoiceRow

    if (!invoice.fakturoidDocumentId) {
      // A correction has to point at a document. If the invoice has not
      // reached the provider yet, this is not a failure — it is "not yet",
      // and the cron will come back once the invoice is issued.
      return result('PROVIDER_UNREACHABLE', {
        detail:
          `Invoice ${String(invoice.id)} has no accounting document yet, so ` +
          'there is nothing to correct. Issue it first.',
      })
    }

    const customer = (await payload.findByID({
      collection: 'customers',
      id: idOf(invoice.customer),
      depth: 0,
      overrideAccess: true,
      ...reqOption,
    })) as unknown as CustomerRow

    const subject = await ensureSubjectForCustomer({
      payload,
      ...reqOption,
      port,
      customer,
    })

    if ('reason' in subject) return subject

    const issued = await port.issueCreditNote({
      customId: accountingCustomId('credit-notes', id),
      providerSubjectId: subject.providerSubjectId,
      correctsProviderDocumentId: invoice.fakturoidDocumentId,
      currency: row.currency as Currency,
      lines: [
        {
          name: `Vrácení platby – ${invoice.serviceSnapshot?.description ?? 'předplatné sazejchytre.cz'}`,
          // Positive. The adapter negates, so a correction always reduces
          // what the customer owes whatever sign arrives here.
          unitPriceMinor: row.amountMinor,
          quantity: 1,
        },
      ],
      issuedOn: new Date(row.issuedAt),
      reason: row.reason,
    })

    if (!issued.ok) {
      return result(reasonForCode(issued.code), { detail: issued.message })
    }

    const document = issued.value.document

    const locked = await port.lockDocument(document.providerDocumentId)

    await payload.update({
      collection: 'credit-notes',
      id,
      overrideAccess: true,
      ...reqOption,
      data: {
        accountingState: 'ISSUED',
        fakturoidDocumentId: document.providerDocumentId,
        fakturoidNumber: document.number,
      },
    })

    if (!locked.ok) {
      return result(reasonForCode(locked.code), {
        providerDocumentId: document.providerDocumentId,
        number: document.number,
        detail: `Issued but not locked: ${locked.message}`,
      })
    }

    return result(
      issued.value.adopted ? 'ADOPTED_EXISTING_DOCUMENT' : 'ISSUED',
      {
        providerDocumentId: document.providerDocumentId,
        number: document.number,
      },
    )
  } catch (error) {
    return fromThrown(error)
  }
}

/**
 * An exception into a reason.
 *
 * Only two exceptions are expected here, and both are things a caller cannot
 * sensibly handle in-line. Anything else is a real bug and is rethrown, so it
 * reaches the error reporting rather than being filed as a provider problem.
 */
const fromThrown = (error: unknown): EnsureDocumentResult => {
  if (error instanceof AccountingProviderUnreachableError) {
    // The sale is already recorded. This is the case the whole design is
    // built around: stay PENDING, lose nothing, retry later.
    return result('PROVIDER_UNREACHABLE', { detail: error.message })
  }

  if (error instanceof AccountingConfigurationError) {
    return result('MISCONFIGURED', { detail: error.message })
  }

  throw error
}

/* -------------------------------------------------------------------------- */
/* PDF                                                                        */
/* -------------------------------------------------------------------------- */

/** How many times to ask for a PDF before leaving it to the next cron run. */
const MAX_PDF_ATTEMPTS = 5

/** First wait, doubling each time: 400, 800, 1600, 3200 ms. */
const PDF_BASE_DELAY_MS = 400

/**
 * Where a fetched PDF is written.
 *
 * Injected rather than imported, because the real one reads R2 credentials
 * and this module has to stay loadable without an environment — the pure
 * tests exercise the polling and the bounded give-up, and neither needs a
 * bucket. The default dynamically imports the real writer, so nothing at a
 * call site has to know about the seam.
 */
export type DocumentWriter = (key: string, body: Buffer) => Promise<string>

const realWriter: DocumentWriter = async (key, body) => {
  const { putPrivateDocument } = await import('./storage.ts')

  return putPrivateDocument(key, body)
}

export type PdfOutcome = {
  reason: AccountingReason | 'STORED' | 'ALREADY_STORED'
  retryable: boolean
  key?: string
  detail?: string
}

/**
 * Fetch the document's PDF from the provider and store our own copy.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY WE KEEP A COPY AT ALL
 *
 * Because the customer's copy must not depend on a third party. What is
 * emailed, and what the account page serves, is the file in our own bucket —
 * the same bytes, every time, for as long as the retention rules say. A link
 * to Fakturoid would be an accounting account's URL handed to a stranger, and
 * it would outlive our control of it.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THE POLLING IS BOUNDED
 *
 * Fakturoid renders PDFs asynchronously and answers 204 until one is ready,
 * so some polling is unavoidable. But this runs inside a webhook handler, and
 * holding that open until the PDF appears would make the caller time out and
 * redeliver — more load, not less, and a second handler racing the first.
 *
 * So it tries a few times with a doubling delay and then gives up. Giving up
 * is NOT a failure of issuing: the document exists and is numbered, the
 * payment is recorded, the entitlement is granted. Only our copy is missing,
 * and the cron will come back for it.
 */
export const ensureDocumentPdf = async (args: {
  payload: Payload
  req?: PayloadRequest
  collection: DocumentCollection
  id: number
  port?: AccountingPort
  /** Injected so tests do not actually wait. */
  sleep?: (ms: number) => Promise<void>
  /** Injected so tests do not need a bucket. */
  write?: DocumentWriter
}): Promise<PdfOutcome> => {
  const { payload, req, collection, id } = args
  const reqOption = req ? { req } : {}
  const write = args.write ?? realWriter
  const sleep =
    args.sleep ??
    ((ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms)
      }))

  const row = (await payload.findByID({
    collection,
    id,
    depth: 0,
    overrideAccess: true,
    ...reqOption,
  })) as unknown as {
    pdfStorageKey?: string | null
    fakturoidDocumentId?: string | null
    fakturoidNumber?: string | null
    issuedAt: string
  }

  if (row.pdfStorageKey) {
    // Short circuit. Re-fetching would produce a second file for one document
    // number, and only one of them is the one the customer received.
    return {
      reason: 'ALREADY_STORED',
      retryable: false,
      key: row.pdfStorageKey,
    }
  }

  if (!row.fakturoidDocumentId || !row.fakturoidNumber) {
    return {
      reason: 'ROW_NOT_ISSUABLE',
      retryable: false,
      detail: 'No accounting document yet, so there is no PDF to fetch.',
    }
  }

  try {
    const port = args.port ?? (await getAccountingPort())

    for (let attempt = 0; attempt < MAX_PDF_ATTEMPTS; attempt += 1) {
      const fetched = await port.fetchDocumentPdf(row.fakturoidDocumentId)

      if (!fetched.ok) {
        return {
          reason: reasonForCode(fetched.code),
          retryable: fetched.retryable,
          detail: fetched.message,
        }
      }

      if (fetched.value.ready) {
        const key = documentStorageKey(
          collection,
          new Date(row.issuedAt).getUTCFullYear(),
          row.fakturoidNumber,
        )

        await write(key, fetched.value.pdf)

        await payload.update({
          collection,
          id,
          overrideAccess: true,
          ...reqOption,
          data: { pdfStorageKey: key },
        })

        return { reason: 'STORED', retryable: false, key }
      }

      // Not ready. Wait and ask again — but do not wait after the last try,
      // which would be sleeping for nothing.
      if (attempt < MAX_PDF_ATTEMPTS - 1) {
        await sleep(PDF_BASE_DELAY_MS * 2 ** attempt)
      }
    }

    // Exhausted. A retryable state, not a failure: the document is issued and
    // the money is accounted for; only our copy is outstanding.
    return {
      reason: 'PDF_GENERATING',
      retryable: true,
      detail: `Still generating after ${String(MAX_PDF_ATTEMPTS)} attempts.`,
    }
  } catch (error) {
    const outcome = fromThrown(error)

    return {
      reason: outcome.reason,
      retryable: outcome.retryable,
      ...(outcome.detail ? { detail: outcome.detail } : {}),
    }
  }
}
