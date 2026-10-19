/**
 * The accounting contract: what every adapter must do, asserted once.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THE SUITE IS A FUNCTION AND NOT A TEST FILE
 *
 * Same reason as the billing contract. A contract test that only ever runs
 * against the fake proves the fake works, which nobody doubted. The value
 * appears when the identical assertions run against the real provider,
 * because that is where the assumptions turn out to be wrong — step 4 found
 * three adapter bugs that way and none were visible against a fake.
 *
 * So the suite takes a port and runs the same assertions over it. The fake
 * runs it in `pnpm test`; the real adapter runs it in `pnpm test:fakturoid`,
 * which is deliberately NOT part of `pnpm test` or `pnpm test:db`.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THERE IS ONE SHARED INVOICE AND NOT ONE PER TEST
 *
 * Against the live account every document created is real, permanent and
 * numbered in the operator's statutory series. Deleting one leaves a gap that
 * has to be explained to a tax inspection, so documents created here are
 * never cleaned up — they are reported to the operator instead.
 *
 * Written the natural way, with a fresh invoice per test, this suite would
 * put seven documents into those books on every run. So lock, PDF, read-back,
 * adoption and correction all work against ONE invoice, created lazily and
 * exactly once. A live run therefore creates one subject, one invoice and one
 * correction: the minimum that proves the flow end to end.
 *
 * The order is deliberate too. The correction is issued against the invoice
 * AFTER it has been locked, because that is the real sequence — an invoice is
 * locked when issued and a refund arrives days later. If a provider refuses
 * to correct a locked document, that has to surface here and not in
 * production.
 *
 * Scripted-failure assertions run against the fake only. Provoking a 429 or a
 * maintenance window on purpose against a live account is both antisocial and
 * unreliable.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  ACCOUNTING_PORT_OPERATIONS,
  type AccountingDocument,
  type AccountingFailure,
  type AccountingPort,
  AccountingProviderUnreachableError,
  type AccountingResult,
  RETRYABLE_ACCOUNTING_CODES,
} from './port.ts'
import type { FakeAccountingPort } from './fake-adapter.ts'

export type ContractMode = 'fake' | 'live'

export type AccountingContractOptions = {
  /** What to call this run in the test output. */
  label: string
  mode: ContractMode
  port: AccountingPort
  /**
   * Scriptable controls. Present only for the fake; the failure-path
   * assertions skip without them.
   */
  fake?: FakeAccountingPort['fake']
  /**
   * Called for every document the suite creates, so a live run can be
   * reported to the operator by number. Nothing is ever deleted.
   */
  onDocumentCreated?: (document: AccountingDocument) => void
  /**
   * Makes every `custom_id` in this run unique.
   *
   * Required for a live run: a reused id would be ADOPTED from a previous
   * run, so the create path would silently never be exercised — the trap the
   * Stripe contract's hard-coded idempotency keys set in step 4.
   */
  runId?: string
  /** Seconds between PDF polls. Zero for the fake. */
  pollDelayMs?: number
  /**
   * Called with the PDF bytes once they are ready.
   *
   * Exists so a live run can keep the rendered document for inspection. What
   * the provider actually prints is not knowable from the API — in particular
   * whether it prints identifiers we would not choose to publish — and the
   * only way to find out is to look at one.
   */
  onPdfFetched?: (pdf: Buffer, document: AccountingDocument) => void
}

/** Narrow to the value, with the provider's own message in the failure. */
const expectOk = <T>(result: AccountingResult<T>, what: string): T => {
  if (!result.ok) {
    assert.fail(`${what} failed: ${result.code} — ${result.message}`)
  }

  return result.value
}

/** Narrow to the failure, so its code can be asserted. */
const expectFail = <T>(
  result: AccountingResult<T>,
  what: string,
): AccountingFailure => {
  if (result.ok) {
    assert.fail(`${what} unexpectedly succeeded`)
  }

  return result
}

export const runAccountingPortContract = (
  options: AccountingContractOptions,
): void => {
  const { label, mode, port, fake, onDocumentCreated, onPdfFetched } = options
  const live = mode === 'live'
  const pollDelayMs = options.pollDelayMs ?? (live ? 1_500 : 0)

  const runId = options.runId ?? `t${String(Date.now())}`
  const customId = (suffix: string): string => `${runId}-${suffix}`

  const record = (document: AccountingDocument): AccountingDocument => {
    onDocumentCreated?.(document)

    return document
  }

  // Fixed for the fake so failures are reproducible; today's date for a live
  // run, because a document dated in the past lands in the wrong period.
  const issuedOn = live ? new Date() : new Date('2026-10-16T00:00:00.000Z')

  const line = (name: string, unitPriceMinor: number) => ({
    name,
    unitPriceMinor,
    quantity: 1,
  })

  // One koruna. Small enough to be obviously a test in the operator's books,
  // large enough to be a legal amount on a document.
  const TEST_AMOUNT_MINOR = 1_00

  const invoiceInput = () => ({
    customId: customId('invoice'),
    currency: 'CZK' as const,
    lines: [line('Předplatné – kontraktní zkouška', TEST_AMOUNT_MINOR)],
    issuedOn,
    taxableFulfillmentDue: issuedOn,
    alreadyPaid: true,
    paidOn: issuedOn,
    paymentMethod: 'CARD' as const,
    note: `Kontraktní zkouška ${runId}`,
  })

  type Fixture = {
    providerSubjectId: string
    document: AccountingDocument
  }

  let pending: Promise<Fixture> | null = null

  /**
   * The one subject and the one invoice, created on first use.
   *
   * Memoised rather than built in a `before` hook so that it is created once
   * no matter which test runs first, and never at all if the suite is filtered
   * down to tests that do not need it.
   */
  const fixture = (): Promise<Fixture> => {
    pending ??= (async (): Promise<Fixture> => {
      const subject = expectOk(
        await port.ensureSubject({
          customId: customId('subject'),
          name: 'Kontraktní Zkouška',
          email: 'kontrakt@example.com',
          street: 'Zkušební 1',
          city: 'Praha',
          zip: '11000',
          country: 'CZ',
        }),
        'ensureSubject (fixture)',
      )

      const issued = expectOk(
        await port.issueInvoice({
          ...invoiceInput(),
          providerSubjectId: subject.providerSubjectId,
        }),
        'issueInvoice (fixture)',
      )

      assert.equal(
        issued.adopted,
        false,
        'a fresh customId must create, not adopt',
      )

      record(issued.document)

      return {
        providerSubjectId: subject.providerSubjectId,
        document: issued.document,
      }
    })()

    return pending
  }

  describe(`accounting port contract — ${label}`, () => {
    it('declares itself and implements every operation', () => {
      assert.ok(port.provider.length > 0, 'the provider must be named')

      for (const operation of ACCOUNTING_PORT_OPERATIONS) {
        assert.equal(
          typeof port[operation],
          'function',
          `${operation} is missing`,
        )
      }
    })

    describe('ensureSubject', () => {
      it('returns the same subject for the same customId', async () => {
        const { providerSubjectId } = await fixture()

        assert.ok(providerSubjectId.length > 0, 'a subject id must come back')

        // The whole point. A second subject for one customer would split
        // their documents across two provider records nothing joins back up.
        const again = expectOk(
          await port.ensureSubject({
            customId: customId('subject'),
            name: 'Kontraktní Zkouška (jméno změněno)',
            email: 'kontrakt@example.com',
            country: 'CZ',
          }),
          'ensureSubject (second call)',
        )

        assert.equal(
          again.providerSubjectId,
          providerSubjectId,
          'ensureSubject must be idempotent on customId',
        )
      })
    })

    describe('issueInvoice', () => {
      it('comes back numbered, in our currency, with our total', async () => {
        const { document } = await fixture()

        assert.equal(document.documentType, 'INVOICE')
        assert.equal(document.currency, 'CZK')
        assert.equal(
          document.totalMinor,
          TEST_AMOUNT_MINOR,
          'the total must survive the trip through the provider decimals',
        )
        assert.ok(
          document.number.length > 0,
          'the provider must have numbered it — we no longer do',
        )
        assert.ok(
          document.providerDocumentId.length > 0,
          'a provider id must come back, or we cannot find it again',
        )
      })

      it('marks the document paid when we already took the money', async () => {
        const { document } = await fixture()

        // The customer paid by card before the document existed. A document
        // that says otherwise would chase them for money already handed over.
        assert.equal(
          document.paid,
          true,
          'a card-paid invoice must not be issued as outstanding',
        )
      })

      it('adopts the existing document when the customId repeats', async () => {
        const { providerSubjectId, document } = await fixture()

        // THE CENTRAL REQUIREMENT. The same customId means this is a retry,
        // so it must find the existing document rather than put a second one
        // into the operator's number series.
        const retried = expectOk(
          await port.issueInvoice({ ...invoiceInput(), providerSubjectId }),
          'issueInvoice (retry)',
        )

        assert.equal(
          retried.adopted,
          true,
          'a repeated customId must be adopted, not created again',
        )
        assert.equal(
          retried.document.providerDocumentId,
          document.providerDocumentId,
          'the adopted document must be the original',
        )
        assert.equal(
          retried.document.number,
          document.number,
          'adoption must not consume a second number',
        )
      })

      it('refuses a subject that does not exist, without retrying forever', async () => {
        const failure = expectFail(
          await port.issueInvoice({
            ...invoiceInput(),
            customId: customId('no-subject'),
            providerSubjectId: '0',
          }),
          'issueInvoice with a bogus subject',
        )

        // Our data is wrong, not the provider's availability. Marking this
        // retryable would be a cron loop that never terminates.
        assert.ok(
          failure.code === 'SUBJECT_NOT_FOUND' ||
            failure.code === 'REJECTED_DATA',
          `expected a data failure, got ${failure.code}`,
        )
        assert.equal(
          failure.retryable,
          false,
          'bad data must never be marked retryable',
        )
      })
    })

    describe('getDocument', () => {
      it('reads back what was issued', async () => {
        const { document } = await fixture()

        const read = expectOk(
          await port.getDocument(document.providerDocumentId),
          'getDocument',
        )

        assert.equal(read.number, document.number)
        assert.equal(read.documentType, 'INVOICE')
        assert.equal(read.currency, document.currency)
        // A one-haléř drift here is a drift in the accounts.
        assert.equal(read.totalMinor, document.totalMinor)
      })

      it('reports a missing document as missing', async () => {
        const failure = expectFail(
          await port.getDocument('999999999'),
          'getDocument on a missing document',
        )

        assert.equal(failure.code, 'DOCUMENT_NOT_FOUND')
        assert.equal(failure.retryable, false)
      })
    })

    describe('fetchDocumentPdf', () => {
      it('polls to readiness and hands over a real PDF', async () => {
        const { document } = await fixture()

        // Bounded polling, exactly as the issuing flow does it. "Not ready"
        // is an ordinary answer rather than a failure, so an unbounded loop
        // here would be the bug rather than the fix.
        let pdf: Buffer | null = null
        let sawGenerating = false

        for (let attempt = 0; attempt < 12 && !pdf; attempt += 1) {
          const result = expectOk(
            await port.fetchDocumentPdf(document.providerDocumentId),
            'fetchDocumentPdf',
          )

          if (result.ready) {
            pdf = result.pdf
            continue
          }

          sawGenerating = true
          assert.equal(result.reason, 'GENERATING')

          await new Promise((resolve) => {
            setTimeout(resolve, pollDelayMs)
          })
        }

        assert.ok(pdf, 'the PDF never became ready within the poll bound')
        assert.ok(pdf.byteLength > 0, 'an empty PDF is not a PDF')

        onPdfFetched?.(pdf, document)
        assert.equal(
          pdf.subarray(0, 5).toString('latin1'),
          '%PDF-',
          'what came back is not a PDF',
        )

        if (!live) {
          // The fake must force at least one poll, or a caller that forgot to
          // poll would pass here and fail against the real provider.
          assert.ok(
            sawGenerating,
            'the fake must report GENERATING at least once',
          )
        }
      })

      it('reports a missing document as missing', async () => {
        const failure = expectFail(
          await port.fetchDocumentPdf('999999999'),
          'fetchDocumentPdf on a missing document',
        )

        assert.equal(failure.code, 'DOCUMENT_NOT_FOUND')
      })
    })

    describe('lockDocument', () => {
      it('locks, and locking again still succeeds', async () => {
        const { document } = await fixture()

        const locked = expectOk(
          await port.lockDocument(document.providerDocumentId),
          'lockDocument',
        )

        assert.equal(locked.locked, true, 'the document must report as locked')

        // Idempotent on purpose: a retry after a lost response must not need
        // special handling at the call site.
        const again = expectOk(
          await port.lockDocument(document.providerDocumentId),
          'lockDocument (again)',
        )

        assert.equal(again.locked, true, 'locking twice must not fail')
      })

      it('reports a missing document as missing', async () => {
        const failure = expectFail(
          await port.lockDocument('999999999'),
          'lockDocument on a missing document',
        )

        assert.equal(failure.code, 'DOCUMENT_NOT_FOUND')
        assert.equal(failure.retryable, false)
      })
    })

    describe('issueCreditNote', () => {
      it('corrects the locked invoice, takes its own number, adopts on retry', async () => {
        const { providerSubjectId, document } = await fixture()

        // Deliberately after the lock test: an invoice is locked when issued
        // and the refund arrives days later, so correcting a locked document
        // IS the real sequence. A provider that refuses must surface here.
        expectOk(
          await port.lockDocument(document.providerDocumentId),
          'lockDocument (before correcting)',
        )

        const creditInput = {
          customId: customId('credit'),
          providerSubjectId,
          correctsProviderDocumentId: document.providerDocumentId,
          currency: 'CZK' as const,
          lines: [
            line('Vrácení platby – kontraktní zkouška', TEST_AMOUNT_MINOR),
          ],
          issuedOn,
          reason: `Kontraktní zkouška ${runId}`,
        }

        const credit = expectOk(
          await port.issueCreditNote(creditInput),
          'issueCreditNote',
        )

        assert.equal(credit.adopted, false, 'a fresh customId must create')
        record(credit.document)

        assert.equal(credit.document.documentType, 'CREDIT_NOTE')

        // THE ASSERTION THIS WHOLE TEST EXISTS FOR, on a live run.
        //
        // Fakturoid does not document how a correction's line amounts should
        // be signed, and there is no sandbox to find out in. If a correction
        // came back with a positive total it would be a document billing the
        // customer a second time rather than refunding them — issued into a
        // statutory series, and not deletable. So the sign is asserted rather
        // than assumed, and the single permitted live run is what proves it.
        assert.equal(
          credit.document.totalMinor,
          -TEST_AMOUNT_MINOR,
          'a correction must REDUCE what the customer owes',
        )

        assert.notEqual(
          credit.document.number,
          document.number,
          'a correction must not reuse the invoice number',
        )
        assert.notEqual(
          credit.document.providerDocumentId,
          document.providerDocumentId,
          'a correction is its own document',
        )

        const retried = expectOk(
          await port.issueCreditNote(creditInput),
          'issueCreditNote (retry)',
        )

        assert.equal(
          retried.adopted,
          true,
          'a repeated customId must be adopted',
        )
        assert.equal(
          retried.document.providerDocumentId,
          credit.document.providerDocumentId,
          'the adopted correction must be the original',
        )
      })

      it('refuses to correct a document that does not exist', async () => {
        const { providerSubjectId } = await fixture()

        const failure = expectFail(
          await port.issueCreditNote({
            customId: customId('orphan-credit'),
            providerSubjectId,
            correctsProviderDocumentId: '999999999',
            currency: 'CZK',
            lines: [line('Vrácení platby', TEST_AMOUNT_MINOR)],
            issuedOn,
            reason: 'Kontraktní zkouška',
          }),
          'issueCreditNote against a missing invoice',
        )

        assert.ok(
          failure.code === 'DOCUMENT_NOT_FOUND' ||
            failure.code === 'REJECTED_DATA' ||
            failure.code === 'NOT_CORRECTABLE',
          `expected a data failure, got ${failure.code}`,
        )
        assert.equal(failure.retryable, false)
      })
    })

    /* ---------------------------------------------------------------- */
    /* Failure paths — the fake only                                    */
    /* ---------------------------------------------------------------- */

    describe('failure vocabulary', () => {
      it('keeps throttling, maintenance, blocking and bad data apart', async (t) => {
        if (!fake) {
          t.skip('scripted failures need the fake')
          return
        }

        // Step 4's lesson, restated for accounting: a provider that is down,
        // a provider that is throttling us, a provider that refused our data
        // and a document that already exists must never share a reason
        // string. Collapsing them is how an afternoon goes on the wrong cause.
        const reasons = new Set<string>()

        for (const code of [
          'RATE_LIMITED',
          'PROVIDER_MAINTENANCE',
          'ACCOUNT_BLOCKED',
          'REJECTED_DATA',
          'DOCUMENT_ALREADY_EXISTS',
        ] as const) {
          fake.scriptFailure({ code })

          const failure = expectFail(
            await port.getDocument('whatever'),
            `scripted ${code}`,
          )

          assert.equal(failure.code, code, 'the code must survive the port')
          reasons.add(failure.code)
        }

        assert.equal(
          reasons.size,
          5,
          'the five failures must reach the log as five distinct reasons',
        )
      })

      it('marks only the transient failures retryable', async (t) => {
        if (!fake) {
          t.skip('scripted failures need the fake')
          return
        }

        for (const code of RETRYABLE_ACCOUNTING_CODES) {
          fake.scriptFailure({ code, retryAfterSeconds: 7 })

          const failure = expectFail(
            await port.getDocument('whatever'),
            `scripted ${code}`,
          )

          assert.equal(failure.retryable, true, `${code} must be retryable`)
          assert.equal(
            failure.retryAfterSeconds,
            7,
            'the provider-supplied wait must be honoured, not guessed',
          )
        }

        for (const code of ['ACCOUNT_BLOCKED', 'REJECTED_DATA'] as const) {
          fake.scriptFailure({ code })

          const failure = expectFail(
            await port.getDocument('whatever'),
            `scripted ${code}`,
          )

          assert.equal(
            failure.retryable,
            false,
            `${code} must not be retryable — retrying it forever is a loop`,
          )
        }
      })

      it('throws rather than returning a failure when unreachable', async (t) => {
        if (!fake) {
          t.skip('unreachability cannot be simulated against a live provider')
          return
        }

        fake.setUnreachable(true)

        try {
          // Unreachable is not an outcome a caller chooses between. It is the
          // provider not answering, and it must be impossible to ignore by
          // forgetting to check a Result.
          await assert.rejects(
            () => port.getDocument('whatever'),
            AccountingProviderUnreachableError,
          )
        } finally {
          fake.setUnreachable(false)
        }
      })
    })

    describe('idempotency when the response is lost', () => {
      it('yields exactly one document when creation succeeds and the call then dies', async (t) => {
        if (!fake) {
          // Provoking this against the live account means deliberately
          // orphaning a real document in the operator's series. The fake
          // exists precisely so this can be proven without doing that.
          t.skip('a lost response cannot be staged against a live provider')
          return
        }

        const subject = expectOk(
          await port.ensureSubject({
            customId: customId('lost-subject'),
            name: 'Kontraktní Zkouška',
            email: 'kontrakt@example.com',
            country: 'CZ',
          }),
          'ensureSubject',
        )

        const input = {
          ...invoiceInput(),
          customId: customId('lost'),
          providerSubjectId: subject.providerSubjectId,
        }

        const before = fake.documents().length

        // The document is created at the provider and then the call dies, so
        // we never learn its id. THE failure that produces duplicates.
        fake.failAfterCreatingOnce()

        await assert.rejects(
          () => port.issueInvoice(input),
          AccountingProviderUnreachableError,
        )

        assert.equal(
          fake.documents().length,
          before + 1,
          'the provider keeps the document it created — that is the problem',
        )

        const retried = expectOk(
          await port.issueInvoice(input),
          'issueInvoice after a lost response',
        )

        assert.equal(
          retried.adopted,
          true,
          'the retry must adopt the orphaned document',
        )
        assert.equal(
          fake.documents().length,
          before + 1,
          'a retry after a lost response must not create a second document',
        )

        const numbers = fake.issuedNumbers()

        assert.equal(
          new Set(numbers).size,
          numbers.length,
          'no document number may ever be reused',
        )
      })
    })
  })
}
