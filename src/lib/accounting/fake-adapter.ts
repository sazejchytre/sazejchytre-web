/**
 * An in-memory accounting provider.
 *
 * Exists so the contract tests — and every ordinary test in this repository —
 * run with no network and no credentials. That is not a convenience here, it
 * is a safety requirement: the real credentials point at the operator's
 * actual accounting account, where every document created is a real document
 * in a real statutory number series and deleting one leaves a gap. No
 * ordinary test may go near it.
 *
 * A contract test is only worth having if the fake is a faithful model, so
 * this file enforces every rule the port promises:
 *
 *   - `ensureSubject` is idempotent on `customId`;
 *   - issuing ADOPTS an existing document with the same `customId` rather
 *     than creating a second one, and says which happened;
 *   - PDFs are not ready immediately, because real ones are not;
 *   - locking twice succeeds;
 *   - a number series advances and is never reused.
 *
 * It can also be told to fail in the specific ways the real provider does,
 * including the one that matters most: dying AFTER creating a document but
 * before returning. That is the failure that produces duplicates, and it
 * cannot be provoked against a live account without leaving rubbish in the
 * operator's books.
 */
import {
  type AccountingDocument,
  type AccountingFailureCode,
  type AccountingPort,
  AccountingProviderUnreachableError,
  type AccountingResult,
  type AccountingSubject,
  type DocumentPdf,
  type EnsureSubjectInput,
  type IssueCreditNoteInput,
  type IssueInvoiceInput,
  type IssuedDocument,
  accountingFail,
  accountingOk,
} from './port.ts'

export type ScriptedAccountingFailure = {
  code: AccountingFailureCode
  message?: string
  retryAfterSeconds?: number
}

export type FakeAccountingOptions = {
  /** Injected clock, so issue dates are deterministic. */
  now?: () => Date
  /**
   * How many times a PDF reports "still generating" before it is ready.
   *
   * Defaults to 1, because a real provider's first answer is usually 204 and
   * a fake that returns a PDF immediately would let a caller that forgot to
   * poll pass its tests.
   */
  pdfAttemptsBeforeReady?: number
  provider?: string
}

export type FakeAccountingControls = {
  /** The next operation fails this way, once. */
  scriptFailure(failure: ScriptedAccountingFailure): void
  /** Every operation throws `AccountingProviderUnreachableError` while set. */
  setUnreachable(unreachable: boolean): void
  /**
   * The next issue call creates the document and THEN throws.
   *
   * The failure that produces duplicates: the provider has committed a
   * document to its series, and the caller never learns its id. A retry must
   * find and adopt it rather than create a second one.
   */
  failAfterCreatingOnce(): void
  documents(): readonly AccountingDocument[]
  subjects(): readonly { providerSubjectId: string; customId: string }[]
  /** Every document number ever issued, to prove none was reused. */
  issuedNumbers(): readonly string[]
}

export type FakeAccountingPort = AccountingPort & {
  readonly fake: FakeAccountingControls
}

type StoredDocument = AccountingDocument & {
  customId: string
  providerSubjectId: string
  /** How many times the PDF has been asked for. */
  pdfRequests: number
  correctsProviderDocumentId?: string
}

const sumLines = (
  lines: readonly { unitPriceMinor: number; quantity: number }[],
): number =>
  lines.reduce((total, line) => total + line.unitPriceMinor * line.quantity, 0)

export const createFakeAccountingPort = (
  options: FakeAccountingOptions = {},
): FakeAccountingPort => {
  const provider = options.provider ?? 'FAKTUROID'
  const now = options.now ?? (() => new Date())
  const pdfAttemptsBeforeReady = options.pdfAttemptsBeforeReady ?? 1

  const subjectsByCustomId = new Map<string, string>()
  const documents = new Map<string, StoredDocument>()
  const issuedNumbers: string[] = []

  let counter = 0
  let invoiceSeq = 0
  let creditSeq = 0
  let unreachable = false
  let scripted: ScriptedAccountingFailure | null = null
  let failAfterCreate = false

  const id = (prefix: string): string => `${prefix}-${++counter}`

  const guardReachable = (): void => {
    if (unreachable) throw new AccountingProviderUnreachableError(provider)
  }

  const takeScripted = (): AccountingResult<never> | null => {
    if (!scripted) return null

    const { code, message, retryAfterSeconds } = scripted
    scripted = null

    return accountingFail(code, message ?? `Scripted failure: ${code}`, {
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    })
  }

  /** The provider owns the series, so the fake must too. */
  const nextNumber = (type: 'INVOICE' | 'CREDIT_NOTE'): string => {
    const year = now().getUTCFullYear()
    const number =
      type === 'INVOICE'
        ? `${String(year)}-${String(++invoiceSeq).padStart(4, '0')}`
        : `${String(year)}-C${String(++creditSeq).padStart(4, '0')}`

    issuedNumbers.push(number)

    return number
  }

  const publish = (stored: StoredDocument): AccountingDocument => {
    const {
      customId: _customId,
      providerSubjectId: _subject,
      pdfRequests: _pdf,
      correctsProviderDocumentId: _corrects,
      ...rest
    } = stored

    return { ...rest }
  }

  const findByCustomId = (customId: string): StoredDocument | undefined =>
    [...documents.values()].find((doc) => doc.customId === customId)

  const knownSubjectIds = (): string[] => [...subjectsByCustomId.values()]

  const port: FakeAccountingPort = {
    provider,

    async ensureSubject(
      input: EnsureSubjectInput,
    ): Promise<AccountingResult<AccountingSubject>> {
      guardReachable()

      const failure = takeScripted()
      if (failure) return failure

      // Idempotent on our own id. A second subject for one customer would
      // split their documents across two records nothing joins back up.
      const existing = subjectsByCustomId.get(input.customId)

      if (existing) {
        return accountingOk({ providerSubjectId: existing })
      }

      const providerSubjectId = id('subj')
      subjectsByCustomId.set(input.customId, providerSubjectId)

      return accountingOk({ providerSubjectId })
    },

    async issueInvoice(
      input: IssueInvoiceInput,
    ): Promise<AccountingResult<IssuedDocument>> {
      guardReachable()

      // THE ADOPTION CHECK, before anything is created and before any
      // scripted failure. A document carrying our id already exists, so this
      // is a retry; returning it is the only safe answer.
      const already = findByCustomId(input.customId)

      if (already) {
        return accountingOk({ document: publish(already), adopted: true })
      }

      const failure = takeScripted()
      if (failure) return failure

      // The subject must exist. A fabricated id is refused the way the
      // provider refuses one, so a caller that skipped `ensureSubject` finds
      // out here rather than against the live account.
      if (!knownSubjectIds().includes(input.providerSubjectId)) {
        return accountingFail(
          'SUBJECT_NOT_FOUND',
          `No subject ${input.providerSubjectId}.`,
        )
      }

      if (input.lines.length === 0) {
        return accountingFail(
          'REJECTED_DATA',
          'A document needs at least one line.',
        )
      }

      const stored: StoredDocument = {
        providerDocumentId: id('inv'),
        number: nextNumber('INVOICE'),
        documentType: 'INVOICE',
        currency: input.currency,
        totalMinor: sumLines(input.lines),
        issuedOn: input.issuedOn,
        taxableFulfillmentDue: input.taxableFulfillmentDue,
        paid: input.alreadyPaid,
        locked: false,
        customId: input.customId,
        providerSubjectId: input.providerSubjectId,
        pdfRequests: 0,
      }

      documents.set(stored.providerDocumentId, stored)

      if (failAfterCreate) {
        failAfterCreate = false
        // Committed to the series, then died. The caller never learns the id.
        throw new AccountingProviderUnreachableError(provider)
      }

      return accountingOk({ document: publish(stored), adopted: false })
    },

    async issueCreditNote(
      input: IssueCreditNoteInput,
    ): Promise<AccountingResult<IssuedDocument>> {
      guardReachable()

      const already = findByCustomId(input.customId)

      if (already) {
        return accountingOk({ document: publish(already), adopted: true })
      }

      const failure = takeScripted()
      if (failure) return failure

      const corrected = documents.get(input.correctsProviderDocumentId)

      if (!corrected) {
        return accountingFail(
          'DOCUMENT_NOT_FOUND',
          `No document ${input.correctsProviderDocumentId} to correct.`,
        )
      }

      if (corrected.documentType !== 'INVOICE') {
        return accountingFail(
          'NOT_CORRECTABLE',
          'Only an invoice can be corrected.',
        )
      }

      const stored: StoredDocument = {
        providerDocumentId: id('cor'),
        // Its OWN series. The provider numbers corrections separately.
        number: nextNumber('CREDIT_NOTE'),
        documentType: 'CREDIT_NOTE',
        currency: input.currency,
        // Negated, whatever sign the caller passed. A correction reduces what
        // the customer owes; one with a positive total would bill them again.
        totalMinor: -Math.abs(sumLines(input.lines)),
        issuedOn: input.issuedOn,
        taxableFulfillmentDue: input.issuedOn,
        paid: true,
        locked: false,
        customId: input.customId,
        providerSubjectId: input.providerSubjectId,
        pdfRequests: 0,
        correctsProviderDocumentId: input.correctsProviderDocumentId,
      }

      documents.set(stored.providerDocumentId, stored)

      if (failAfterCreate) {
        failAfterCreate = false
        throw new AccountingProviderUnreachableError(provider)
      }

      return accountingOk({ document: publish(stored), adopted: false })
    },

    async fetchDocumentPdf(
      providerDocumentId: string,
    ): Promise<AccountingResult<DocumentPdf>> {
      guardReachable()

      const failure = takeScripted()
      if (failure) return failure

      const stored = documents.get(providerDocumentId)

      if (!stored) {
        return accountingFail(
          'DOCUMENT_NOT_FOUND',
          `No document ${providerDocumentId}.`,
        )
      }

      stored.pdfRequests += 1

      // Not ready at first, because a real provider renders asynchronously
      // and answers 204. A fake that handed one over immediately would let a
      // caller that forgot to poll pass its tests.
      if (stored.pdfRequests <= pdfAttemptsBeforeReady) {
        return accountingOk({ ready: false, reason: 'GENERATING' })
      }

      // A minimal but genuinely well-formed PDF, so a caller that stores or
      // attaches it is handling something a reader would accept.
      const body = `%PDF-1.4\n% fake document ${stored.number}\n%%EOF\n`

      return accountingOk({ ready: true, pdf: Buffer.from(body, 'latin1') })
    },

    async getDocument(
      providerDocumentId: string,
    ): Promise<AccountingResult<AccountingDocument>> {
      guardReachable()

      const failure = takeScripted()
      if (failure) return failure

      const stored = documents.get(providerDocumentId)

      return stored
        ? accountingOk(publish(stored))
        : accountingFail(
            'DOCUMENT_NOT_FOUND',
            `No document ${providerDocumentId}.`,
          )
    },

    async lockDocument(
      providerDocumentId: string,
    ): Promise<AccountingResult<AccountingDocument>> {
      guardReachable()

      const failure = takeScripted()
      if (failure) return failure

      const stored = documents.get(providerDocumentId)

      if (!stored) {
        return accountingFail(
          'DOCUMENT_NOT_FOUND',
          `No document ${providerDocumentId}.`,
        )
      }

      // Idempotent on purpose. A retry after a lost response must not need
      // special handling at the call site.
      stored.locked = true

      return accountingOk(publish(stored))
    },

    fake: {
      scriptFailure(failure) {
        scripted = failure
      },
      setUnreachable(value) {
        unreachable = value
      },
      failAfterCreatingOnce() {
        failAfterCreate = true
      },
      documents() {
        return [...documents.values()].map(publish)
      },
      subjects() {
        return [...subjectsByCustomId.entries()].map(
          ([customId, providerSubjectId]) => ({ customId, providerSubjectId }),
        )
      },
      issuedNumbers() {
        return [...issuedNumbers]
      },
    },
  }

  return port
}
