/**
 * The Fakturoid adapter: the only file that knows Fakturoid exists.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * IDEMPOTENCY IS THE WHOLE DESIGN, NOT A FEATURE
 *
 * Every document carries `custom_id` — our own invoice or credit-note id —
 * and every create is preceded by a query on it. If a document with our id is
 * already there, it is ADOPTED and nothing is created.
 *
 * This is not an optimisation. The sequence that makes it necessary is
 * ordinary: Fakturoid creates the document, the response is lost to a
 * timeout, our row never records the id, the retry cron comes round. Without
 * the lookup that retry creates a second real document in the operator's
 * statutory number series — and a document in that series cannot be cleanly
 * removed, because deleting it leaves a gap that has to be explained to a tax
 * inspection. There is no undo. So the only safe create is one that asks
 * first.
 *
 * The lookup costs one request. A duplicate costs a conversation with an
 * accountant.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHERE THE MONEY CHANGES SHAPE
 *
 * Fakturoid takes and returns decimal strings; everything inside this
 * codebase is integer minor units. The conversion happens only through
 * `../decimal.ts`, which does it with integer arithmetic and refuses values
 * it cannot represent exactly, rather than with `Number()` — which is how a
 * one-haléř drift gets into an accounting export.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * A CREDIT NOTE IS NOT ALWAYS A "CORRECTION"
 *
 * Fakturoid has a `correction` document type, and the obvious reading is that
 * every credit note should be one. It is not, and the live account said so:
 *
 *   correction_id: "Opravný daňový doklad lze vytvořit pouze k faktuře od
 *                   plátce DPH"
 *   ("a correction tax document can only be created for an invoice from a
 *    VAT payer")
 *
 * An *opravný daňový doklad* is a VAT instrument. A trader who is not
 * registered for VAT does not issue daňové doklady at all, so there is
 * nothing for a correction document to correct — the credit note is simply an
 * invoice carrying negative amounts.
 *
 * So the adapter asks the account which it is, and issues accordingly. The
 * account's `vat_mode` is read once per process and cached. That costs one
 * request and buys two things: today's documents are the kind this operator
 * may legally issue, and the day they register for VAT the adapter starts
 * issuing proper correction documents with no code change — which is exactly
 * the sort of thing nobody would remember to do by hand.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT THIS ADAPTER DELIBERATELY DOES NOT DO
 *
 * It does not ask Fakturoid to email anything, and it never surfaces an
 * `html_url`. Delivery goes through our own stored copy and our own sender,
 * so what the customer receives is the document we archived, from an address
 * on our domain. A Fakturoid link in a customer's inbox would be an
 * accounting account's URL handed to a stranger, and it would outlive our
 * control of it.
 */
import { minorToDecimalString, decimalStringToMinor } from '../decimal.ts'
import {
  type AccountingDocument,
  type AccountingFailure,
  type AccountingLine,
  type AccountingPort,
  type AccountingResult,
  type AccountingSubject,
  type DocumentPdf,
  type EnsureSubjectInput,
  type IssueCreditNoteInput,
  type IssueInvoiceInput,
  type IssuedDocument,
  accountingFail,
  accountingOk,
} from '../port.ts'
import type { Currency } from '../../billing/constants.ts'
import { readFakturoidConfig, type FakturoidConfig } from './config.ts'
import {
  createFakturoidHttp,
  type FakturoidHttp,
  type FakturoidOutcome,
} from './http.ts'
import {
  fakturoidAccountSchema,
  fakturoidInvoiceListSchema,
  fakturoidInvoiceSchema,
  fakturoidSubjectListSchema,
  fakturoidSubjectSchema,
  parseFakturoid,
  type FakturoidInvoice,
} from './schemas.ts'
import { createTokenSource, type TokenSource } from './token.ts'

/** `2026-10-16`. Fakturoid dates have no time and no zone. */
const isoDate = (date: Date): string => {
  const text = date.toISOString()

  return text.slice(0, 10)
}

/**
 * A Fakturoid date back to a Date.
 *
 * Anchored at UTC midnight. The alternative, `new Date('2026-10-16')` parsed
 * as local time, shifts the date by a day for anyone west of Greenwich —
 * which would put a document in the wrong accounting period at a month
 * boundary.
 */
const fromIsoDate = (text: string): Date =>
  new Date(`${text.slice(0, 10)}T00:00:00.000Z`)

/** Our payment-method vocabulary to theirs. */
const PAYMENT_METHODS = { CARD: 'card', OTHER: 'bank' } as const

/**
 * The outstanding balance in minor units, or null if it cannot be read.
 *
 * Null rather than a throw. Whether a document is paid is a question with a
 * sensible fallback — the `status` label — and an unreadable optional field
 * must not be able to fail the issuing of an invoice whose payment has
 * already been taken.
 */
const remainingMinor = (raw: FakturoidInvoice): number | null => {
  const remaining = raw.remaining_amount

  if (remaining === undefined || remaining === null) return null

  try {
    return decimalStringToMinor(remaining, 'CZK')
  } catch {
    return null
  }
}

export type FakturoidAdapterOptions = {
  config?: FakturoidConfig
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  /** Injected so a test can inspect token behaviour. */
  tokens?: TokenSource
}

type DocumentShape = {
  document: AccountingDocument
  /** Fakturoid's own view, for decisions the port does not expose. */
  raw: FakturoidInvoice
}

export const createFakturoidAccountingPort = (
  options: FakturoidAdapterOptions = {},
): AccountingPort => {
  const config = options.config ?? readFakturoidConfig()
  const tokens =
    options.tokens ??
    createTokenSource({
      config,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    })

  const http: FakturoidHttp = createFakturoidHttp({
    config,
    tokens,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.sleep ? { sleep: options.sleep } : {}),
  })

  /** Turn a non-success outcome into a failure, or null if it succeeded. */
  const failureOf = (
    outcome: FakturoidOutcome,
    what: string,
  ): AccountingFailure | null => {
    if (outcome.kind === 'failure') return outcome.failure

    if (outcome.kind === 'missing') {
      return accountingFail('DOCUMENT_NOT_FOUND', `${what}: not found.`)
    }

    return null
  }

  const lines = (
    input: readonly AccountingLine[],
    currency: Currency,
    negate: boolean,
  ) =>
    input.map((line) => ({
      name: line.name,
      quantity: String(line.quantity),
      unit_price: minorToDecimalString(
        // A correction always reduces. The absolute value is taken first so a
        // caller who passes a negative amount cannot accidentally produce a
        // correction that bills the customer again.
        negate ? -Math.abs(line.unitPriceMinor) : line.unitPriceMinor,
        currency,
      ),
    }))

  /**
   * Fakturoid's invoice object into ours.
   *
   * Returns a failure rather than throwing when the currency is one we do not
   * model: the document exists either way, and a thrown error here would turn
   * a readable problem into a crashed webhook.
   */
  const toDocument = (
    raw: FakturoidInvoice,
    what: string,
  ): AccountingResult<DocumentShape> => {
    const currency = raw.currency.toUpperCase()

    if (currency !== 'CZK') {
      // Only CZK is modelled today. A document in another currency would need
      // a `MINOR_UNITS_PER_MAJOR` entry and an export column, so it is
      // refused loudly rather than stored with the wrong precision.
      return accountingFail(
        'REJECTED_DATA',
        `${what}: document ${raw.number} is in ${currency}, which this ` +
          'application does not model.',
      )
    }

    let totalMinor: number

    try {
      totalMinor = decimalStringToMinor(raw.total, 'CZK')
    } catch (error) {
      // The total is the amount that lands in the accounts. A value we cannot
      // convert exactly is refused rather than rounded.
      return accountingFail(
        'REJECTED_DATA',
        `${what}: could not read the total of document ${raw.number}.`,
        error instanceof Error ? { providerDetail: error.message } : {},
      )
    }

    // A correction document is a credit note — and so is a plain invoice with
    // a negative total, which is what a non-VAT payer issues instead. Judging
    // by the amount as well as the type is not a heuristic here: a document
    // that takes money back is a credit note whatever the provider files it
    // as, and getting this wrong would put a refund into the books as revenue.
    const isCorrection = raw.document_type === 'correction' || totalMinor < 0

    const document: AccountingDocument = {
      providerDocumentId: raw.id,
      number: raw.number,
      documentType: isCorrection ? 'CREDIT_NOTE' : 'INVOICE',
      currency: 'CZK',
      totalMinor,
      issuedOn: fromIsoDate(raw.issued_on),
      taxableFulfillmentDue: fromIsoDate(
        raw.taxable_fulfillment_due ?? raw.issued_on,
      ),
      // `remaining_amount` is the outstanding balance, so zero means settled.
      // Preferred over `status`, which is a workflow label that also says
      // "sent" and "overdue" and would need its own mapping table. Falls back
      // to the label when the balance is absent or unreadable, rather than
      // throwing: being unsure whether a document is paid must not take down
      // the issuing flow, and `status` is a good enough second opinion.
      paid: remainingMinor(raw) === 0 || raw.status === 'paid',
      locked: Boolean(raw.locked_at),
    }

    return accountingOk({ document, raw })
  }

  /**
   * Is this account registered for VAT?
   *
   * Cached for the life of the adapter: it is an account setting that changes
   * once in a business's lifetime, and re-reading it per credit note would
   * spend a request from a 150-per-minute budget to learn something that did
   * not change.
   *
   * Returns null when it cannot be determined, which the caller treats as
   * "not a VAT payer" — the safer of the two guesses here, because issuing a
   * plain negative invoice when a correction was permitted is untidy, while
   * issuing a correction when it is not permitted is refused outright and
   * leaves the refund with no document at all.
   */
  let vatPayerCache: boolean | null = null

  const isVatPayer = async (): Promise<boolean> => {
    if (vatPayerCache !== null) return vatPayerCache

    const outcome = await http.request({
      method: 'GET',
      path: '/account.json',
    })

    if (outcome.kind !== 'json') return false

    const parsed = parseFakturoid(
      fakturoidAccountSchema,
      outcome.body,
      'account',
    )

    if (!parsed.ok) return false

    // Anything other than an explicit non-payer mode counts as registered.
    vatPayerCache = parsed.value.vat_mode !== 'non_vat_payer'

    return vatPayerCache
  }

  /** Find a document by OUR id. The adoption lookup. */
  const findByCustomId = async (
    customId: string,
  ): Promise<AccountingResult<DocumentShape | null>> => {
    const outcome = await http.request({
      method: 'GET',
      path: '/invoices.json',
      query: { custom_id: customId },
    })

    if (outcome.kind === 'missing') return accountingOk(null)

    const failure = failureOf(outcome, 'looking up a document by custom_id')
    if (failure) return failure

    if (outcome.kind !== 'json') return accountingOk(null)

    const parsed = parseFakturoid(
      fakturoidInvoiceListSchema,
      outcome.body,
      'invoice search',
    )

    if (!parsed.ok) {
      return accountingFail(
        'REJECTED_DATA',
        'Could not read the invoice search response.',
        { providerDetail: parsed.detail },
      )
    }

    const [first] = parsed.value

    if (!first) return accountingOk(null)

    // Fakturoid filters server-side, but confirm it: a response that ignored
    // the filter would otherwise have us adopt somebody else's document and
    // attach it to this customer's invoice row.
    if (first.custom_id !== customId) {
      return accountingFail(
        'REJECTED_DATA',
        `A custom_id search for ${customId} returned document ${first.number} ` +
          `whose custom_id is ${String(first.custom_id)}.`,
      )
    }

    const shape = toDocument(first, 'adopting an existing document')

    if (!shape.ok) return shape

    return accountingOk(shape.value)
  }

  /**
   * Record the payment so the document is marked paid.
   *
   * Separate from creation because Fakturoid models a payment as its own
   * resource. Tolerant of 403: that is their answer for "already paid", which
   * on a retry is the state we wanted anyway. Treating it as an error would
   * make a perfectly successful retry look like a failure.
   */
  const recordPayment = async (
    documentId: string,
    paidOn: Date,
    amountMinor: number,
    currency: Currency,
  ): Promise<AccountingResult<void>> => {
    const outcome = await http.request({
      method: 'POST',
      path: `/invoices/${documentId}/payments.json`,
      body: {
        paid_on: isoDate(paidOn),
        amount: minorToDecimalString(amountMinor, currency),
        currency,
        mark_document_as_paid: true,
      },
    })

    if (
      outcome.kind === 'failure' &&
      outcome.failure.code === 'ALREADY_FINALISED'
    ) {
      return accountingOk(undefined)
    }

    const failure = failureOf(outcome, 'recording the payment')
    if (failure) return failure

    return accountingOk(undefined)
  }

  const fetchDocument = async (
    providerDocumentId: string,
    what: string,
  ): Promise<AccountingResult<DocumentShape>> => {
    const outcome = await http.request({
      method: 'GET',
      path: `/invoices/${providerDocumentId}.json`,
    })

    const failure = failureOf(outcome, what)
    if (failure) return failure

    if (outcome.kind !== 'json') {
      return accountingFail('REJECTED_DATA', `${what}: empty response.`)
    }

    const parsed = parseFakturoid(fakturoidInvoiceSchema, outcome.body, what)

    if (!parsed.ok) {
      return accountingFail('REJECTED_DATA', `${what}: unreadable response.`, {
        providerDetail: parsed.detail,
      })
    }

    return toDocument(parsed.value, what)
  }

  return {
    provider: 'FAKTUROID',

    async ensureSubject(
      input: EnsureSubjectInput,
    ): Promise<AccountingResult<AccountingSubject>> {
      // Look first. A second subject for one customer would split their
      // documents across two records nothing joins back up — and Fakturoid
      // does not enforce uniqueness on custom_id for us.
      const search = await http.request({
        method: 'GET',
        path: '/subjects.json',
        query: { custom_id: input.customId },
      })

      const searchFailure = failureOf(search, 'searching for the subject')
      if (searchFailure) return searchFailure

      if (search.kind === 'json') {
        const parsed = parseFakturoid(
          fakturoidSubjectListSchema,
          search.body,
          'subject search',
        )

        if (!parsed.ok) {
          return accountingFail(
            'REJECTED_DATA',
            'Could not read the subject search response.',
            { providerDetail: parsed.detail },
          )
        }

        const existing = parsed.value.find(
          (subject) => subject.custom_id === input.customId,
        )

        if (existing) {
          return accountingOk({ providerSubjectId: existing.id })
        }
      }

      const created = await http.request({
        method: 'POST',
        path: '/subjects.json',
        body: {
          custom_id: input.customId,
          name: input.name,
          email: input.email,
          ...(input.street ? { street: input.street } : {}),
          ...(input.city ? { city: input.city } : {}),
          ...(input.zip ? { zip: input.zip } : {}),
          ...(input.country ? { country: input.country } : {}),
        },
      })

      const createFailure = failureOf(created, 'creating the subject')
      if (createFailure) return createFailure

      if (created.kind !== 'json') {
        return accountingFail(
          'REJECTED_DATA',
          'Creating the subject returned an empty response.',
        )
      }

      const parsed = parseFakturoid(
        fakturoidSubjectSchema,
        created.body,
        'created subject',
      )

      if (!parsed.ok) {
        return accountingFail(
          'REJECTED_DATA',
          'Could not read the created subject.',
          { providerDetail: parsed.detail },
        )
      }

      return accountingOk({ providerSubjectId: parsed.value.id })
    },

    async issueInvoice(
      input: IssueInvoiceInput,
    ): Promise<AccountingResult<IssuedDocument>> {
      // ───────────────────────────────────────────────────────────────────
      // THE ADOPTION CHECK. Everything in this adapter depends on it.
      // ───────────────────────────────────────────────────────────────────
      const existing = await findByCustomId(input.customId)

      if (!existing.ok) return existing

      if (existing.value) {
        const found = existing.value

        // Adopted, so the document already exists. Still make sure it is
        // marked paid: the original attempt may have died between creating
        // the document and recording the payment, which would leave a real
        // invoice standing as unpaid against a customer who has paid.
        if (input.alreadyPaid && !found.document.paid) {
          const payment = await recordPayment(
            found.document.providerDocumentId,
            input.paidOn,
            found.document.totalMinor,
            found.document.currency,
          )

          if (!payment.ok) return payment

          const refreshed = await fetchDocument(
            found.document.providerDocumentId,
            're-reading the adopted document',
          )

          if (!refreshed.ok) return refreshed

          return accountingOk({
            document: refreshed.value.document,
            adopted: true,
          })
        }

        return accountingOk({ document: found.document, adopted: true })
      }

      const created = await http.request({
        method: 'POST',
        path: '/invoices.json',
        body: {
          custom_id: input.customId,
          subject_id: input.providerSubjectId,
          currency: input.currency,
          issued_on: isoDate(input.issuedOn),
          taxable_fulfillment_due: isoDate(input.taxableFulfillmentDue),
          payment_method: PAYMENT_METHODS[input.paymentMethod],
          // The customer paid by card before the document existed, so the PDF
          // must say so. Without this the document reads as a demand for
          // money already taken.
          show_already_paid_note_in_pdf: true,
          ...(input.note ? { note: input.note } : {}),
          lines: lines(input.lines, input.currency, false),
        },
      })

      if (created.kind === 'missing') {
        return accountingFail(
          'SUBJECT_NOT_FOUND',
          `Fakturoid could not find subject ${input.providerSubjectId}.`,
        )
      }

      const createFailure = failureOf(created, 'creating the invoice')

      if (createFailure) {
        // A rejection naming the subject is a missing subject, not a generic
        // data problem. Worth separating: one means "our customer record is
        // not synced", the other means "our payload is wrong".
        if (
          createFailure.code === 'REJECTED_DATA' &&
          /subject/i.test(createFailure.providerDetail ?? createFailure.message)
        ) {
          return accountingFail(
            'SUBJECT_NOT_FOUND',
            `Fakturoid rejected subject ${input.providerSubjectId}.`,
            { providerDetail: createFailure.providerDetail ?? '' },
          )
        }

        return createFailure
      }

      if (created.kind !== 'json') {
        return accountingFail(
          'REJECTED_DATA',
          'Creating the invoice returned an empty response.',
        )
      }

      const parsed = parseFakturoid(
        fakturoidInvoiceSchema,
        created.body,
        'created invoice',
      )

      if (!parsed.ok) {
        // The document may well exist. Reported as data we cannot read rather
        // than as a failure to create, because the retry will adopt it.
        return accountingFail(
          'REJECTED_DATA',
          'The invoice was created but the response could not be read. ' +
            'A retry will adopt it by custom_id.',
          { providerDetail: parsed.detail },
        )
      }

      const shape = toDocument(parsed.value, 'created invoice')

      if (!shape.ok) return shape

      if (!input.alreadyPaid) {
        return accountingOk({ document: shape.value.document, adopted: false })
      }

      const payment = await recordPayment(
        shape.value.document.providerDocumentId,
        input.paidOn,
        shape.value.document.totalMinor,
        shape.value.document.currency,
      )

      if (!payment.ok) return payment

      // Re-read rather than assume. `paid` is reported from
      // `remaining_amount`, which only the server can tell us.
      const settled = await fetchDocument(
        shape.value.document.providerDocumentId,
        're-reading the paid invoice',
      )

      if (!settled.ok) return settled

      return accountingOk({ document: settled.value.document, adopted: false })
    },

    async issueCreditNote(
      input: IssueCreditNoteInput,
    ): Promise<AccountingResult<IssuedDocument>> {
      const existing = await findByCustomId(input.customId)

      if (!existing.ok) return existing

      if (existing.value) {
        return accountingOk({
          document: existing.value.document,
          adopted: true,
        })
      }

      // Read the corrected invoice first. It has to exist — and its NUMBER
      // is what makes the credit note traceable to it when the account is not
      // a VAT payer, because a plain negative invoice has no `correction_id`
      // field to carry the link.
      const corrected = await fetchDocument(
        input.correctsProviderDocumentId,
        'reading the document being corrected',
      )

      if (!corrected.ok) {
        return corrected.code === 'DOCUMENT_NOT_FOUND'
          ? accountingFail(
              'DOCUMENT_NOT_FOUND',
              `No document ${input.correctsProviderDocumentId} to correct.`,
            )
          : corrected
      }

      const vatPayer = await isVatPayer()
      const correctedNumber = corrected.value.document.number

      const created = await http.request({
        method: 'POST',
        path: '/invoices.json',
        body: {
          custom_id: input.customId,
          subject_id: input.providerSubjectId,
          // A VAT payer gets a real opravný daňový doklad, bound to the
          // invoice it corrects. A non-VAT payer cannot: Fakturoid refuses
          // `correction` outright for them, because the document type is a
          // VAT instrument. See the header.
          ...(vatPayer
            ? {
                document_type: 'correction',
                correction_id: input.correctsProviderDocumentId,
              }
            : { document_type: 'invoice' }),
          currency: input.currency,
          issued_on: isoDate(input.issuedOn),
          taxable_fulfillment_due: isoDate(input.issuedOn),
          // A refund goes back the way it came. Without this the document
          // prints "Převodem" — by bank transfer — which is what an
          // accountant reconciling a card payout would go looking for and
          // not find.
          payment_method: 'card',
          // The link in words when it cannot be a field. An accountant
          // holding this document has to be able to find the one it corrects,
          // and for a non-VAT payer this sentence is the only thing that says
          // so.
          note: vatPayer
            ? input.reason
            : `Opravný doklad k faktuře ${correctedNumber}. ${input.reason}`,
          lines: lines(input.lines, input.currency, true),
        },
      })

      if (created.kind === 'missing') {
        return accountingFail(
          'DOCUMENT_NOT_FOUND',
          `Fakturoid could not find document ${input.correctsProviderDocumentId} to correct.`,
        )
      }

      const createFailure = failureOf(created, 'creating the correction')

      if (createFailure) {
        if (
          createFailure.code === 'REJECTED_DATA' &&
          /correction/i.test(
            createFailure.providerDetail ?? createFailure.message,
          )
        ) {
          return accountingFail(
            'NOT_CORRECTABLE',
            `Fakturoid refused to correct document ${input.correctsProviderDocumentId}.`,
            { providerDetail: createFailure.providerDetail ?? '' },
          )
        }

        return createFailure
      }

      if (created.kind !== 'json') {
        return accountingFail(
          'REJECTED_DATA',
          'Creating the correction returned an empty response.',
        )
      }

      const parsed = parseFakturoid(
        fakturoidInvoiceSchema,
        created.body,
        'created correction',
      )

      if (!parsed.ok) {
        return accountingFail(
          'REJECTED_DATA',
          'The correction was created but the response could not be read. ' +
            'A retry will adopt it by custom_id.',
          { providerDetail: parsed.detail },
        )
      }

      const shape = toDocument(parsed.value, 'created correction')

      if (!shape.ok) return shape

      return accountingOk({ document: shape.value.document, adopted: false })
    },

    async fetchDocumentPdf(
      providerDocumentId: string,
    ): Promise<AccountingResult<DocumentPdf>> {
      const outcome = await http.request({
        method: 'GET',
        path: `/invoices/${providerDocumentId}/download.pdf`,
        accept: 'pdf',
      })

      if (outcome.kind === 'empty') {
        // 204. Fakturoid renders PDFs asynchronously, so this is the ordinary
        // first answer and the caller polls. Not a failure.
        return accountingOk({ ready: false, reason: 'GENERATING' })
      }

      const failure = failureOf(outcome, 'downloading the PDF')
      if (failure) return failure

      if (outcome.kind !== 'binary') {
        return accountingFail(
          'REJECTED_DATA',
          'The PDF download returned something that was not a PDF.',
        )
      }

      if (outcome.bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
        // Checked because this file gets stored and emailed to a customer. An
        // error page saved as `faktura.pdf` is worse than a failure here.
        return accountingFail(
          'REJECTED_DATA',
          'The PDF download did not start with %PDF-.',
        )
      }

      return accountingOk({ ready: true, pdf: outcome.bytes })
    },

    async getDocument(
      providerDocumentId: string,
    ): Promise<AccountingResult<AccountingDocument>> {
      const result = await fetchDocument(
        providerDocumentId,
        'reading the document',
      )

      return result.ok ? accountingOk(result.value.document) : result
    },

    async lockDocument(
      providerDocumentId: string,
    ): Promise<AccountingResult<AccountingDocument>> {
      const outcome = await http.request({
        method: 'POST',
        path: `/invoices/${providerDocumentId}/fire.json`,
        query: { event: 'lock' },
      })

      // Already locked. Fakturoid refuses the event; we wanted the state, and
      // the state is what we have, so this is a success. A retry after a lost
      // response must not need special handling at the call site.
      const alreadyLocked =
        outcome.kind === 'failure' &&
        outcome.failure.code === 'ALREADY_FINALISED'

      if (!alreadyLocked) {
        const failure = failureOf(outcome, 'locking the document')
        if (failure) return failure
      }

      // Re-read, because `fire.json` does not reliably return the document
      // and the caller needs `locked` to actually reflect the server.
      const result = await fetchDocument(
        providerDocumentId,
        're-reading the locked document',
      )

      if (!result.ok) return result

      if (!result.value.document.locked) {
        return accountingFail(
          'REJECTED_DATA',
          `Document ${result.value.document.number} did not report as locked ` +
            'after the lock event.',
        )
      }

      return accountingOk(result.value.document)
    },
  }
}
