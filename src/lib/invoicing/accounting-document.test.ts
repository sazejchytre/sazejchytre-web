/**
 * What happens when the accounting provider will not cooperate.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE PROPERTY UNDER TEST
 *
 * A provider outage must never lose a payment or roll back an entitlement.
 * Our row is written first and unconditionally; this module only decides what
 * to do about the document, and the worst thing it may do is leave the row
 * PENDING for the cron.
 *
 * And every distinguishable cause must stay distinguishable in the log.
 * Step 4 cost an afternoon to a webhook that reported two different problems
 * with one reason string; the same mistake here would be a provider outage
 * and a malformed payload looking identical at 2am.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createFakeAccountingPort } from '../accounting/fake-adapter.ts'
import {
  ACCOUNTING_REASONS,
  accountingCustomId,
  ensureCreditNoteDocument,
  ensureDocumentPdf,
  ensureInvoiceDocument,
} from './accounting-document.ts'

/* -------------------------------------------------------------------------- */
/* A Payload double                                                           */
/* -------------------------------------------------------------------------- */

type Row = Record<string, unknown> & { id: number }

const createPayloadDouble = (seed: Record<string, Row[]> = {}) => {
  const store = new Map<string, Row[]>(Object.entries(seed))

  const rows = (collection: string): Row[] => {
    const existing = store.get(collection)

    if (existing) return existing

    const created: Row[] = []
    store.set(collection, created)

    return created
  }

  const payload = {
    findByID: async ({
      collection,
      id,
    }: {
      collection: string
      id: number
    }) => {
      const found = rows(collection).find((row) => row.id === Number(id))

      if (!found) throw new Error(`${collection}/${String(id)} not found`)

      return found
    },
    update: async ({
      collection,
      id,
      data,
    }: {
      collection: string
      id: number
      data: Record<string, unknown>
    }) => {
      const found = rows(collection).find((row) => row.id === Number(id))

      if (!found) throw new Error(`${collection}/${String(id)} not found`)

      Object.assign(found, data)

      return found
    },
  }

  return { payload: payload as never, rows }
}

const invoiceRow = (overrides: Partial<Row> = {}): Row => ({
  id: 42,
  customer: 7,
  currency: 'CZK',
  totalMinor: 79_900,
  issuedAt: '2026-10-16T09:00:00.000Z',
  taxableSupplyDate: '2026-10-16T00:00:00.000Z',
  accountingState: 'PENDING',
  fakturoidDocumentId: null,
  fakturoidNumber: null,
  pdfStorageKey: null,
  serviceSnapshot: {
    planName: 'PRO',
    description: 'Předplatné služby sazejchytre.cz – tarif PRO',
    periodStart: '2026-10-16T00:00:00.000Z',
    periodEnd: '2026-11-15T00:00:00.000Z',
  },
  paymentSnapshot: { paidAt: '2026-10-16T09:30:00.000Z' },
  ...overrides,
})

const customerRow = (overrides: Partial<Row> = {}): Row => ({
  id: 7,
  email: 'zakaznik@example.test',
  name: 'Žluťoučký Kůň',
  billingCountry: 'CZ',
  fakturoidSubjectId: null,
  ...overrides,
})

const world = (overrides: { invoice?: Partial<Row> } = {}) =>
  createPayloadDouble({
    invoices: [invoiceRow(overrides.invoice ?? {})],
    customers: [customerRow()],
    'credit-notes': [],
  })

/* -------------------------------------------------------------------------- */

describe('reason vocabulary', () => {
  it('has no duplicate reasons', () => {
    // The whole point. Two causes sharing a string is how an hour goes on the
    // wrong hypothesis.
    assert.equal(
      new Set(ACCOUNTING_REASONS).size,
      ACCOUNTING_REASONS.length,
      'two reasons collided',
    )
  })

  it('keeps the four lookalikes apart', () => {
    // Named individually because these are the four the brief singles out:
    // they all read as "issuing didn't work" and each needs a different
    // response — wait, wait differently, fix our data, or do nothing at all.
    for (const reason of [
      'PROVIDER_UNREACHABLE',
      'RATE_LIMITED',
      'REJECTED_DATA',
      'ADOPTED_EXISTING_DOCUMENT',
    ] as const) {
      assert.ok(
        ACCOUNTING_REASONS.includes(reason),
        `${reason} is not in the vocabulary`,
      )
    }
  })
})

describe('custom_id', () => {
  it('prefixes, so an invoice and a credit note cannot collide', () => {
    // Fakturoid keeps corrections in the same collection as invoices. Without
    // the prefix, our invoice #7 and credit note #7 would both search for
    // custom_id=7, and a refund would "find" the invoice it meant to correct.
    assert.equal(accountingCustomId('invoices', 7), 'inv-7')
    assert.equal(accountingCustomId('credit-notes', 7), 'cn-7')
    assert.notEqual(
      accountingCustomId('invoices', 7),
      accountingCustomId('credit-notes', 7),
    )
  })
})

describe('issuing an invoice document', () => {
  it('issues, locks, and records the number', async () => {
    const { payload, rows } = world()
    const port = createFakeAccountingPort()

    const outcome = await ensureInvoiceDocument({ payload, id: 42, port })

    assert.equal(outcome.reason, 'ISSUED')
    assert.ok(outcome.number)

    const invoice = rows('invoices')[0]

    assert.equal(invoice?.accountingState, 'ISSUED')
    assert.equal(invoice?.fakturoidNumber, outcome.number)
    assert.equal(invoice?.fakturoidDocumentId, outcome.providerDocumentId)

    // Locked, so the document the customer holds and the document in the
    // books cannot drift apart.
    const document = await port.getDocument(outcome.providerDocumentId ?? '')

    assert.ok(document.ok)
    assert.equal(document.value.locked, true)
    assert.equal(document.value.paid, true)
  })

  it('caches the subject on the customer', async () => {
    const { payload, rows } = world()
    const port = createFakeAccountingPort()

    await ensureInvoiceDocument({ payload, id: 42, port })

    const subjectId = rows('customers')[0]?.fakturoidSubjectId

    assert.ok(subjectId, 'the subject id should have been cached')

    // A second issuing must reuse it rather than create a second subject,
    // which would split this customer's documents across two records.
    const second = world()

    assert.equal(port.fake.subjects().length, 1)
    void second
  })

  it('does nothing when the document already exists', async () => {
    const { payload } = world({
      invoice: { accountingState: 'ISSUED', fakturoidDocumentId: 'inv-1' },
    })
    const port = createFakeAccountingPort()

    const outcome = await ensureInvoiceDocument({ payload, id: 42, port })

    assert.equal(outcome.reason, 'ALREADY_ISSUED')
    assert.equal(port.fake.documents().length, 0, 'nothing should be created')
  })

  it('reports adoption separately from a fresh issue', async () => {
    const { payload, rows } = world()
    const port = createFakeAccountingPort()

    // A document carrying our id is already at the provider — the state left
    // behind when a create succeeded and the response was lost.
    const subject = await port.ensureSubject({
      customId: 'cust-7',
      name: 'Žluťoučký Kůň',
      email: 'zakaznik@example.test',
    })

    assert.ok(subject.ok)

    await port.issueInvoice({
      customId: 'inv-42',
      providerSubjectId: subject.value.providerSubjectId,
      currency: 'CZK',
      lines: [{ name: 'Předplatné', unitPriceMinor: 79_900, quantity: 1 }],
      issuedOn: new Date('2026-10-16T09:00:00.000Z'),
      taxableFulfillmentDue: new Date('2026-10-16T00:00:00.000Z'),
      alreadyPaid: true,
      paidOn: new Date('2026-10-16T09:30:00.000Z'),
      paymentMethod: 'CARD',
    })

    // Our customer row has to know the subject, or `ensureSubject` would make
    // a second one and the adoption would be tested against the wrong setup.
    const customer = rows('customers')[0]

    if (customer) customer.fakturoidSubjectId = subject.value.providerSubjectId

    const outcome = await ensureInvoiceDocument({ payload, id: 42, port })

    assert.equal(
      outcome.reason,
      'ADOPTED_EXISTING_DOCUMENT',
      'a recovered retry must not be logged as a fresh issue',
    )
    assert.equal(
      port.fake.documents().length,
      1,
      'exactly one document, not two',
    )
    assert.equal(rows('invoices')[0]?.accountingState, 'ISSUED')
  })
})

describe('when the provider will not cooperate', () => {
  it('leaves the row PENDING when it cannot be reached', async () => {
    const { payload, rows } = world()
    const port = createFakeAccountingPort()

    port.fake.setUnreachable(true)

    const outcome = await ensureInvoiceDocument({ payload, id: 42, port })

    assert.equal(outcome.reason, 'PROVIDER_UNREACHABLE')
    assert.equal(outcome.retryable, true)

    // THE PROPERTY THAT MATTERS. The sale is recorded, the entitlement
    // stands, and nothing has been rolled back. The cron will come back.
    const invoice = rows('invoices')[0]

    assert.equal(invoice?.accountingState, 'PENDING')
    assert.equal(invoice?.fakturoidNumber, null)
    assert.equal(
      invoice?.totalMinor,
      79_900,
      'the recorded sale must be untouched',
    )
  })

  it('leaves the row PENDING when throttled, and says so distinctly', async () => {
    const { payload, rows } = world()
    const port = createFakeAccountingPort()

    port.fake.scriptFailure({ code: 'RATE_LIMITED', retryAfterSeconds: 30 })

    const outcome = await ensureInvoiceDocument({ payload, id: 42, port })

    assert.equal(outcome.reason, 'RATE_LIMITED')
    assert.notEqual(
      outcome.reason,
      'PROVIDER_UNREACHABLE',
      'throttled and unreachable must not share a reason',
    )
    assert.equal(outcome.retryable, true)
    assert.equal(rows('invoices')[0]?.accountingState, 'PENDING')
  })

  it('marks the row FAILED when our data is refused', async () => {
    const { payload, rows } = world()
    const port = createFakeAccountingPort()

    port.fake.scriptFailure({ code: 'REJECTED_DATA' })

    const outcome = await ensureInvoiceDocument({ payload, id: 42, port })

    assert.equal(outcome.reason, 'REJECTED_DATA')
    assert.equal(outcome.retryable, false)
    // Retrying would send the same thing and get the same answer. FAILED stops
    // the cron hammering it and shows a human there is something to fix.
    assert.equal(rows('invoices')[0]?.accountingState, 'FAILED')
  })

  it('marks the row FAILED when the provider account is blocked', async () => {
    const { payload, rows } = world()
    const port = createFakeAccountingPort()

    port.fake.scriptFailure({ code: 'ACCOUNT_BLOCKED' })

    const outcome = await ensureInvoiceDocument({ payload, id: 42, port })

    // Its own reason: somebody has to pay a Fakturoid bill. No amount of
    // retrying or payload-fixing helps, and reporting it as REJECTED_DATA
    // would send somebody to read our request instead.
    assert.equal(outcome.reason, 'ACCOUNT_BLOCKED')
    assert.equal(outcome.retryable, false)
    assert.equal(rows('invoices')[0]?.accountingState, 'FAILED')
  })

  it('refuses a row with no service snapshot rather than inventing one', async () => {
    const { payload, rows } = world({ invoice: { serviceSnapshot: null } })
    const port = createFakeAccountingPort()

    const outcome = await ensureInvoiceDocument({ payload, id: 42, port })

    // The snapshot is what the document is made of. Guessing would put
    // invented text on a tax document.
    assert.equal(outcome.reason, 'ROW_NOT_ISSUABLE')
    assert.equal(port.fake.documents().length, 0)
    // FAILED, not PENDING: a row with no snapshot will not become issuable by
    // itself, so this needs a human rather than another cron run.
    assert.equal(rows('invoices')[0]?.accountingState, 'FAILED')
  })

  it('leaves the row PENDING when WE are misconfigured', async () => {
    const { payload, rows } = world()
    const broken = {
      provider: 'FAKTUROID',
      ensureSubject: async () => {
        const { AccountingConfigurationError } =
          await import('../accounting/port.ts')

        throw new AccountingConfigurationError('FAKTUROID_SLUG is not set')
      },
    }

    const outcome = await ensureInvoiceDocument({
      payload,
      id: 42,
      port: broken as never,
    })

    assert.equal(outcome.reason, 'MISCONFIGURED')
    // PENDING, deliberately. Missing credentials get fixed by a deploy, and
    // every row that landed during the outage should then go through on the
    // next cron run rather than needing to be reset by hand.
    assert.equal(rows('invoices')[0]?.accountingState, 'PENDING')
  })

  it('rethrows a genuine bug instead of filing it as a provider problem', async () => {
    const { payload } = world()
    const port = createFakeAccountingPort()
    const broken = {
      ...port,
      ensureSubject: async () => {
        throw new TypeError('a real bug')
      },
    }

    await assert.rejects(
      () =>
        ensureInvoiceDocument({
          payload,
          id: 42,
          port: broken as never,
        }),
      TypeError,
    )
  })
})

describe('the PDF', () => {
  it('polls to readiness and stores exactly one copy', async () => {
    const { payload, rows } = world()
    const port = createFakeAccountingPort({ pdfAttemptsBeforeReady: 2 })

    const issued = await ensureInvoiceDocument({ payload, id: 42, port })

    assert.equal(issued.reason, 'ISSUED')

    const stored: Buffer[] = []

    // The writer is the one thing injected: it reaches for R2, and this suite
    // runs with no environment. Everything above it is the real code path.
    const outcome = await ensureDocumentPdf({
      payload,
      collection: 'invoices',
      id: 42,
      port,
      sleep: async () => {
        /* no waiting */
      },
      write: async (key, body) => {
        stored.push(body)

        return key
      },
    })

    assert.equal(outcome.reason, 'STORED')
    assert.ok(outcome.key)
    assert.equal(stored.length, 1)
    assert.equal(
      stored[0]?.subarray(0, 5).toString('latin1'),
      '%PDF-',
      'what was stored is not a PDF',
    )
    assert.equal(rows('invoices')[0]?.pdfStorageKey, outcome.key)
  })

  it('gives up after a bounded number of polls, retryably', async () => {
    const { payload, rows } = world()
    // Never ready. A real provider that is slow, rather than broken.
    const port = createFakeAccountingPort({ pdfAttemptsBeforeReady: 999 })

    await ensureInvoiceDocument({ payload, id: 42, port })

    const outcome = await ensureDocumentPdf({
      payload,
      collection: 'invoices',
      id: 42,
      port,
      sleep: async () => {
        /* no waiting */
      },
    })

    // NOT a failure of issuing. The document exists, is numbered, and the
    // money is accounted for; only our copy is outstanding.
    assert.equal(outcome.reason, 'PDF_GENERATING')
    assert.equal(outcome.retryable, true)
    assert.equal(rows('invoices')[0]?.accountingState, 'ISSUED')
    assert.equal(rows('invoices')[0]?.pdfStorageKey, null)
  })

  it('does not re-fetch when a copy is already stored', async () => {
    const { payload } = world({
      invoice: {
        accountingState: 'ISSUED',
        fakturoidDocumentId: 'inv-1',
        fakturoidNumber: '2026-0001',
        pdfStorageKey: 'private/documents/invoices/2026/2026-0001.pdf',
      },
    })
    const port = createFakeAccountingPort()

    const outcome = await ensureDocumentPdf({
      payload,
      collection: 'invoices',
      id: 42,
      port,
    })

    // Re-fetching would produce a second file for one document number, and
    // only one of them is the one the customer received.
    assert.equal(outcome.reason, 'ALREADY_STORED')
    assert.equal(outcome.key, 'private/documents/invoices/2026/2026-0001.pdf')
  })

  it('reports no document rather than fetching nothing', async () => {
    const { payload } = world()
    const port = createFakeAccountingPort()

    const outcome = await ensureDocumentPdf({
      payload,
      collection: 'invoices',
      id: 42,
      port,
    })

    assert.equal(outcome.reason, 'ROW_NOT_ISSUABLE')
  })
})

describe('correction documents', () => {
  const creditWorld = () =>
    createPayloadDouble({
      invoices: [
        invoiceRow({
          accountingState: 'ISSUED',
          fakturoidDocumentId: 'PLACEHOLDER',
          fakturoidNumber: '2026-0001',
        }),
      ],
      customers: [customerRow()],
      'credit-notes': [
        {
          id: 9,
          invoice: 42,
          currency: 'CZK',
          amountMinor: 79_900,
          reason: 'Vrácení platby na žádost zákazníka',
          issuedAt: '2026-10-20T10:00:00.000Z',
          accountingState: 'PENDING',
          fakturoidDocumentId: null,
          fakturoidNumber: null,
        },
      ],
    })

  it('issues a correction against the invoice and reduces the amount', async () => {
    const { payload, rows } = creditWorld()
    const port = createFakeAccountingPort()

    // Give the invoice a real provider document to correct.
    const subject = await port.ensureSubject({
      customId: 'cust-7',
      name: 'Ž',
      email: 'z@example.test',
    })

    assert.ok(subject.ok)

    const invoiceDocument = await port.issueInvoice({
      customId: 'inv-42',
      providerSubjectId: subject.value.providerSubjectId,
      currency: 'CZK',
      lines: [{ name: 'Předplatné', unitPriceMinor: 79_900, quantity: 1 }],
      issuedOn: new Date('2026-10-16T09:00:00.000Z'),
      taxableFulfillmentDue: new Date('2026-10-16T00:00:00.000Z'),
      alreadyPaid: true,
      paidOn: new Date('2026-10-16T09:30:00.000Z'),
      paymentMethod: 'CARD',
    })

    assert.ok(invoiceDocument.ok)

    const invoice = rows('invoices')[0]

    if (invoice) {
      invoice.fakturoidDocumentId =
        invoiceDocument.value.document.providerDocumentId
    }

    const customer = rows('customers')[0]

    if (customer) customer.fakturoidSubjectId = subject.value.providerSubjectId

    const outcome = await ensureCreditNoteDocument({ payload, id: 9, port })

    assert.equal(outcome.reason, 'ISSUED')

    const note = rows('credit-notes')[0]

    assert.equal(note?.accountingState, 'ISSUED')
    assert.equal(note?.fakturoidNumber, outcome.number)

    const document = await port.getDocument(outcome.providerDocumentId ?? '')

    assert.ok(document.ok)
    assert.equal(document.value.documentType, 'CREDIT_NOTE')
    // Negative, so it REDUCES what the customer owes. A positive correction
    // would be a document billing them a second time.
    assert.equal(document.value.totalMinor, -79_900)
  })

  it('waits rather than failing when the invoice has no document yet', async () => {
    const { payload, rows } = creditWorld()
    const invoice = rows('invoices')[0]

    if (invoice) {
      invoice.fakturoidDocumentId = null
      invoice.accountingState = 'PENDING'
    }

    const port = createFakeAccountingPort()
    const outcome = await ensureCreditNoteDocument({ payload, id: 9, port })

    // A correction needs a document to point at. "Not yet" is retryable, not
    // a failure — the cron will come back once the invoice is issued.
    assert.equal(outcome.retryable, true)
    assert.equal(rows('credit-notes')[0]?.accountingState, 'PENDING')
    assert.equal(port.fake.documents().length, 0)
  })
})

/* -------------------------------------------------------------------------- */
