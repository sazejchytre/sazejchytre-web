/**
 * The REAL Fakturoid adapter, against an in-memory Fakturoid.
 *
 * This is the suite that proves the adapter's own logic — its `custom_id`
 * lookups, its decimal conversion, its status mapping, its 204 handling.
 * `port.test.ts` proves the port's shape against the fake; this proves the
 * adapter. Neither touches the network, so both run in `pnpm test`.
 *
 * The only thing left for `pnpm test:fakturoid` is whether Fakturoid itself
 * behaves as documented — which is exactly the part a stub cannot answer, and
 * the only reason to spend real document numbers.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { runAccountingPortContract } from '../port-contract.ts'
import { AccountingConfigurationError } from '../port.ts'
import { createFakturoidAccountingPort } from './adapter.ts'
import { readFakturoidConfig } from './config.ts'
import { createFakturoidStub } from './stub-server.ts'

/* -------------------------------------------------------------------------- */
/* The whole contract, against the real adapter                               */
/* -------------------------------------------------------------------------- */

const contractStub = createFakturoidStub()

runAccountingPortContract({
  label: 'Fakturoid adapter against an in-memory Fakturoid',
  mode: 'fake',
  port: createFakturoidAccountingPort({
    config: contractStub.config,
    fetchImpl: contractStub.fetchImpl,
    sleep: async () => {
      /* no waiting in tests */
    },
  }),
  runId: 'stub',
  pollDelayMs: 0,
})

/* -------------------------------------------------------------------------- */
/* Adapter specifics the port cannot express                                  */
/* -------------------------------------------------------------------------- */

const adapterWith = (stub = createFakturoidStub()) => ({
  stub,
  port: createFakturoidAccountingPort({
    config: stub.config,
    fetchImpl: stub.fetchImpl,
    sleep: async () => {
      /* no waiting in tests */
    },
  }),
})

const subjectFor = async (
  port: ReturnType<typeof createFakturoidAccountingPort>,
  customId = 'cust-1',
) => {
  const subject = await port.ensureSubject({
    customId,
    name: 'Zkušební Zákazník',
    email: 'zakaznik@example.com',
    street: 'Zkušební 1',
    city: 'Praha',
    zip: '11000',
    country: 'CZ',
  })

  assert.ok(subject.ok, 'the subject should have been created')

  return subject.value.providerSubjectId
}

const invoiceInput = (providerSubjectId: string, customId = 'inv-1') => ({
  customId,
  providerSubjectId,
  currency: 'CZK' as const,
  lines: [
    {
      name: 'Předplatné Měsíční – 10/2026',
      unitPriceMinor: 79_900,
      quantity: 1,
    },
  ],
  issuedOn: new Date('2026-10-16T00:00:00.000Z'),
  taxableFulfillmentDue: new Date('2026-10-16T00:00:00.000Z'),
  alreadyPaid: true,
  paidOn: new Date('2026-10-16T10:30:00.000Z'),
  paymentMethod: 'CARD' as const,
  note: 'Období 16. 10. 2026 – 15. 11. 2026',
})

describe('the request Fakturoid actually receives', () => {
  it('sends the User-Agent on every single request', async () => {
    const { stub, port } = adapterWith()

    const subjectId = await subjectFor(port)
    const issued = await port.issueInvoice(invoiceInput(subjectId))

    assert.ok(issued.ok)
    assert.ok(stub.calls.length >= 4, 'several requests should have been made')

    // Including the token request. Fakturoid answers 400 without it, and that
    // 400 does not mention headers, so losing this in a refactor would be a
    // confusing outage rather than an obvious one.
    for (const call of stub.calls) {
      assert.ok(
        call.userAgent && call.userAgent.length > 0,
        `${call.method} ${call.url} went out without a User-Agent`,
      )
    }
  })

  it('asks for exactly one token and reuses it', async () => {
    const { stub, port } = adapterWith()

    const subjectId = await subjectFor(port)
    await port.issueInvoice(invoiceInput(subjectId))
    await port.getDocument('1001')

    // A token lasts two hours. Fetching one per call would spend two requests
    // of a 150-per-minute budget on every one that does work, and the
    // throttling would land on the document-creating call.
    assert.equal(
      stub.tokenRequests(),
      1,
      'the access token must be cached, not fetched per request',
    )
  })

  it('sends money as decimal strings, never as floats', async () => {
    const { stub, port } = adapterWith()

    const subjectId = await subjectFor(port)
    await port.issueInvoice(invoiceInput(subjectId))

    const create = stub.calls.find(
      (call) => call.method === 'POST' && call.url.endsWith('/invoices.json'),
    )

    assert.ok(create, 'the invoice should have been created')

    const payload = create.body as {
      lines: { unit_price: unknown; quantity: unknown }[]
      show_already_paid_note_in_pdf: unknown
      payment_method: unknown
      custom_id: unknown
    }

    assert.equal(payload.lines[0]?.unit_price, '799.00')
    assert.equal(typeof payload.lines[0]?.unit_price, 'string')
    assert.equal(payload.payment_method, 'card')
    assert.equal(payload.custom_id, 'inv-1')
    // Without this the PDF reads as a demand for money already taken.
    assert.equal(payload.show_already_paid_note_in_pdf, true)
  })

  it('never asks Fakturoid to email anything', async () => {
    const { stub, port } = adapterWith()

    const subjectId = await subjectFor(port)
    await port.issueInvoice(invoiceInput(subjectId))

    // Delivery is ours: our stored copy, our sender, our domain. A Fakturoid
    // link in a customer's inbox would be an accounting account's URL handed
    // to a stranger, and it would outlive our control of it.
    for (const call of stub.calls) {
      assert.ok(
        !/message|email|deliver/i.test(call.url),
        `the adapter called ${call.url}, which looks like Fakturoid's own delivery`,
      )
    }
  })

  it('records the payment so the document is not left outstanding', async () => {
    const { stub, port } = adapterWith()

    const subjectId = await subjectFor(port)
    const issued = await port.issueInvoice(invoiceInput(subjectId))

    assert.ok(issued.ok)
    assert.equal(issued.value.document.paid, true)

    const payment = stub.calls.find((call) =>
      call.url.includes('/payments.json'),
    )

    assert.ok(payment, 'the payment should have been recorded')
    assert.deepEqual(
      (payment.body as { mark_document_as_paid?: unknown })
        .mark_document_as_paid,
      true,
    )
  })

  it('locks through fire.json?event=lock and confirms it from the server', async () => {
    const { stub, port } = adapterWith()

    const subjectId = await subjectFor(port)
    const issued = await port.issueInvoice(invoiceInput(subjectId))

    assert.ok(issued.ok)

    const locked = await port.lockDocument(
      issued.value.document.providerDocumentId,
    )

    assert.ok(locked.ok)
    assert.equal(locked.value.locked, true)

    const fire = stub.calls.find((call) => call.url.includes('/fire.json'))

    assert.ok(fire)
    assert.ok(fire.url.includes('event=lock'))
  })
})

describe('idempotency through custom_id', () => {
  it('queries by custom_id before creating anything', async () => {
    const { stub, port } = adapterWith()

    const subjectId = await subjectFor(port)
    await port.issueInvoice(invoiceInput(subjectId))

    const invoiceCalls = stub.calls.filter((call) =>
      call.url.includes('/invoices.json'),
    )

    const [first] = invoiceCalls

    // The lookup must come FIRST. A create that happens before the check is a
    // create that cannot be made safe afterwards.
    assert.ok(first)
    assert.equal(first.method, 'GET')
    assert.ok(
      first.url.includes('custom_id=inv-1'),
      `the first invoice call was ${first.url}`,
    )
  })

  it('creates exactly one document when the create response is lost', async () => {
    const { stub, port } = adapterWith()

    const subjectId = await subjectFor(port)
    const input = invoiceInput(subjectId, 'inv-lost')

    // Fakturoid commits the document and the response never arrives. This is
    // the sequence that produces duplicates, and it is ordinary: a timeout
    // between their write and our read.
    stub.loseNextCreateResponse()

    await assert.rejects(
      () => port.issueInvoice(input),
      /unreachable/i,
      'a lost response must surface as unreachable, not as a silent success',
    )

    assert.equal(
      stub.invoices().length,
      1,
      'Fakturoid kept the document it created — that is the problem',
    )

    // The retry. It must find that document rather than create another.
    const retried = await port.issueInvoice(input)

    assert.ok(retried.ok, 'the retry should succeed')
    assert.equal(
      retried.value.adopted,
      true,
      'the retry must adopt the orphaned document',
    )
    assert.equal(
      stub.invoices().length,
      1,
      'a retry after a lost response must not create a second document',
    )

    const numbers = stub.invoices().map((invoice) => invoice.number)

    assert.deepEqual(numbers, ['FA2026-000001'])
  })

  it('marks an adopted document paid if the first attempt did not get that far', async () => {
    const { stub, port } = adapterWith()

    const subjectId = await subjectFor(port)
    const input = invoiceInput(subjectId, 'inv-halfway')

    // Died after creating the document but before recording the payment. The
    // document exists and stands as UNPAID against a customer who has paid —
    // so a retry has to finish the job, not just adopt and move on.
    stub.loseNextCreateResponse()
    await assert.rejects(() => port.issueInvoice(input))

    const [orphan] = stub.invoices()

    assert.ok(orphan)
    assert.equal(orphan.status, 'open', 'the orphan should be unpaid')

    const retried = await port.issueInvoice(input)

    assert.ok(retried.ok)
    assert.equal(retried.value.adopted, true)
    assert.equal(
      retried.value.document.paid,
      true,
      'adopting an unpaid document must still record the payment',
    )
  })

  it('does not create a second subject for the same customer', async () => {
    const { stub, port } = adapterWith()

    await subjectFor(port, 'cust-42')
    await subjectFor(port, 'cust-42')

    assert.equal(
      stub.subjects().length,
      1,
      'two subjects for one customer would split their documents in two',
    )
  })

  it('refuses a custom_id search that comes back with the wrong document', async () => {
    const { stub, port } = adapterWith()

    const subjectId = await subjectFor(port)

    // A server-side filter that silently stopped filtering would otherwise
    // have us adopt somebody else's document onto this customer's invoice.
    stub.script({
      status: 200,
      pathContains: '/invoices.json',
      body: [
        {
          id: 7,
          custom_id: 'somebody-else',
          number: 'FA2026-000123',
          document_type: 'invoice',
          currency: 'CZK',
          total: '799.00',
          issued_on: '2026-10-16',
        },
      ],
    })

    const issued = await port.issueInvoice(invoiceInput(subjectId, 'inv-mine'))

    assert.ok(!issued.ok)
    assert.equal(issued.code, 'REJECTED_DATA')
    assert.match(issued.message, /somebody-else/)
  })
})

describe('correction documents', () => {
  it('issues a negative invoice for a non-VAT payer, naming the corrected one', async () => {
    const { stub, port } = adapterWith()

    const subjectId = await subjectFor(port)
    const invoice = await port.issueInvoice(invoiceInput(subjectId))

    assert.ok(invoice.ok)

    const credit = await port.issueCreditNote({
      customId: 'cn-1',
      providerSubjectId: subjectId,
      correctsProviderDocumentId: invoice.value.document.providerDocumentId,
      currency: 'CZK',
      lines: [
        {
          name: 'Vrácení platby – 10/2026',
          unitPriceMinor: 79_900,
          quantity: 1,
        },
      ],
      issuedOn: new Date('2026-10-20T00:00:00.000Z'),
      reason: 'Vrácení platby na žádost zákazníka',
    })

    assert.ok(credit.ok, 'the correction should have been created')

    const create = stub.calls
      .filter(
        (call) => call.method === 'POST' && call.url.endsWith('/invoices.json'),
      )
      .at(-1)

    assert.ok(create)

    const payload = create.body as {
      document_type: unknown
      correction_id: unknown
      payment_method: unknown
      note: unknown
      lines: { unit_price: unknown }[]
    }

    // NOT a `correction`. Fakturoid refuses that document type outright for a
    // non-VAT payer — an opravný daňový doklad is a VAT instrument — and the
    // stub models the refusal verbatim.
    assert.equal(payload.document_type, 'invoice')
    assert.equal(payload.correction_id, undefined)
    // A refund goes back the way it came; the default would print "by bank
    // transfer" on a card refund.
    assert.equal(payload.payment_method, 'card')

    // A plain invoice has no field to carry the link, so the note does. An
    // accountant holding this document has to be able to find the one it
    // corrects.
    assert.match(
      String(payload.note),
      new RegExp(`Opravný doklad k faktuře ${invoice.value.document.number}`),
    )

    // Negative, so the document reduces what the customer owes. A positive
    // one is a valid document that bills them a second time.
    assert.equal(payload.lines[0]?.unit_price, '-799.00')

    // And it is still a CREDIT NOTE to us, although Fakturoid filed it as an
    // invoice. A document that takes money back is a credit note whatever the
    // provider calls it; reading it as revenue would overstate the books.
    assert.equal(credit.value.document.documentType, 'CREDIT_NOTE')
    assert.equal(credit.value.document.totalMinor, -79_900)
  })

  it('issues a real correction document when the account IS a VAT payer', async () => {
    // The other branch, which this operator does not use today and will the
    // day they register for VAT. Worth testing now: the switch is automatic,
    // so nobody will think to check it then.
    const { stub, port } = adapterWith(
      createFakturoidStub({}, { vatMode: 'vat_payer' }),
    )

    const subjectId = await subjectFor(port)
    const invoice = await port.issueInvoice(invoiceInput(subjectId))

    assert.ok(invoice.ok)

    const credit = await port.issueCreditNote({
      customId: 'cn-vat',
      providerSubjectId: subjectId,
      correctsProviderDocumentId: invoice.value.document.providerDocumentId,
      currency: 'CZK',
      lines: [{ name: 'Vrácení platby', unitPriceMinor: 79_900, quantity: 1 }],
      issuedOn: new Date('2026-10-20T00:00:00.000Z'),
      reason: 'Vrácení platby',
    })

    assert.ok(credit.ok, 'a VAT payer may issue a correction')

    const create = stub.calls
      .filter(
        (call) => call.method === 'POST' && call.url.endsWith('/invoices.json'),
      )
      .at(-1)

    const payload = create?.body as {
      document_type: unknown
      correction_id: unknown
    }

    assert.equal(payload.document_type, 'correction')
    assert.equal(
      payload.correction_id,
      invoice.value.document.providerDocumentId,
    )
    assert.equal(credit.value.document.documentType, 'CREDIT_NOTE')
  })

  it('negates even when the caller passes a negative amount', async () => {
    const { stub, port } = adapterWith()

    const subjectId = await subjectFor(port)
    const invoice = await port.issueInvoice(invoiceInput(subjectId))

    assert.ok(invoice.ok)

    const credit = await port.issueCreditNote({
      customId: 'cn-2',
      providerSubjectId: subjectId,
      correctsProviderDocumentId: invoice.value.document.providerDocumentId,
      currency: 'CZK',
      // Already negative. Naively passing this through would produce
      // `--799.00`, or worse, a positive correction.
      lines: [{ name: 'Vrácení platby', unitPriceMinor: -79_900, quantity: 1 }],
      issuedOn: new Date('2026-10-20T00:00:00.000Z'),
      reason: 'Vrácení platby',
    })

    assert.ok(credit.ok)
    assert.equal(credit.value.document.totalMinor, -79_900)

    const create = stub.calls
      .filter(
        (call) => call.method === 'POST' && call.url.endsWith('/invoices.json'),
      )
      .at(-1)

    assert.equal(
      (create?.body as { lines: { unit_price: unknown }[] }).lines[0]
        ?.unit_price,
      '-799.00',
    )
  })

  it('refuses to correct a document that is not there, before creating anything', async () => {
    const { stub, port } = adapterWith()

    const subjectId = await subjectFor(port)

    const credit = await port.issueCreditNote({
      customId: 'cn-orphan',
      providerSubjectId: subjectId,
      correctsProviderDocumentId: '999999',
      currency: 'CZK',
      lines: [{ name: 'Vrácení platby', unitPriceMinor: 79_900, quantity: 1 }],
      issuedOn: new Date('2026-10-20T00:00:00.000Z'),
      reason: 'Vrácení platby',
    })

    assert.ok(!credit.ok)
    assert.equal(credit.code, 'DOCUMENT_NOT_FOUND')
    assert.equal(credit.retryable, false)

    // Checked BEFORE anything is created. A credit note pointing at nothing
    // would be a real document crediting a customer against no invoice.
    assert.equal(stub.invoices().length, 0, 'nothing should have been created')
  })
})

describe('what comes back from Fakturoid', () => {
  it('reads the number and the total, and refuses a total it cannot convert', async () => {
    const { stub, port } = adapterWith()

    const subjectId = await subjectFor(port)

    stub.script({
      status: 201,
      pathContains: '/invoices.json',
      method: 'POST',
      body: {
        id: 5,
        custom_id: 'inv-1',
        number: 'FA2026-000001',
        document_type: 'invoice',
        currency: 'CZK',
        // More precision than CZK can hold. Rounding it would invent a number
        // nobody agreed to and put it in the accounts.
        total: '799.005',
        issued_on: '2026-10-16',
      },
    })

    const issued = await port.issueInvoice(invoiceInput(subjectId))

    assert.ok(!issued.ok)
    assert.equal(issued.code, 'REJECTED_DATA')
    assert.match(issued.message, /could not read the total/i)
  })

  it('refuses a response with no document number', async () => {
    const { stub, port } = adapterWith()

    const subjectId = await subjectFor(port)

    stub.script({
      status: 201,
      pathContains: '/invoices.json',
      method: 'POST',
      body: {
        id: 5,
        custom_id: 'inv-1',
        document_type: 'invoice',
        currency: 'CZK',
        total: '799.00',
        issued_on: '2026-10-16',
      },
    })

    const issued = await port.issueInvoice(invoiceInput(subjectId))

    // Without the number there is nothing to put in our books. Better one
    // loud failure than a row whose document number is `undefined`.
    assert.ok(!issued.ok)
    assert.equal(issued.code, 'REJECTED_DATA')
    assert.match(issued.message, /adopt it by custom_id/i)
  })

  it('refuses a currency it does not model', async () => {
    const { stub, port } = adapterWith()

    const subjectId = await subjectFor(port)

    stub.script({
      status: 201,
      pathContains: '/invoices.json',
      method: 'POST',
      body: {
        id: 5,
        custom_id: 'inv-1',
        number: 'FA2026-000001',
        document_type: 'invoice',
        currency: 'EUR',
        total: '31.00',
        issued_on: '2026-10-16',
      },
    })

    const issued = await port.issueInvoice(invoiceInput(subjectId))

    assert.ok(!issued.ok)
    assert.match(issued.message, /EUR/)
  })

  it('anchors dates at UTC so a document cannot slip a period', async () => {
    const { port } = adapterWith()

    const subjectId = await subjectFor(port)
    const issued = await port.issueInvoice(invoiceInput(subjectId))

    assert.ok(issued.ok)
    // `new Date('2026-10-16')` parsed as local time shifts the date west of
    // Greenwich, which at a month boundary files the document in the wrong
    // accounting period.
    assert.equal(
      issued.value.document.issuedOn.toISOString(),
      '2026-10-16T00:00:00.000Z',
    )
  })
})

describe('the PDF', () => {
  it('reports 204 as still generating, not as a failure', async () => {
    const { port } = adapterWith()

    const subjectId = await subjectFor(port)
    const issued = await port.issueInvoice(invoiceInput(subjectId))

    assert.ok(issued.ok)

    const first = await port.fetchDocumentPdf(
      issued.value.document.providerDocumentId,
    )

    assert.ok(first.ok, '204 is an ordinary answer, not an error')
    assert.equal(first.value.ready, false)

    const second = await port.fetchDocumentPdf(
      issued.value.document.providerDocumentId,
    )

    assert.ok(second.ok)
    assert.equal(second.value.ready, true)
  })

  it('refuses bytes that are not a PDF', async () => {
    const { stub, port } = adapterWith()

    const subjectId = await subjectFor(port)
    const issued = await port.issueInvoice(invoiceInput(subjectId))

    assert.ok(issued.ok)

    // This file gets stored and emailed to a customer. An error page saved as
    // `faktura.pdf` is worse than a failure here.
    stub.script({
      status: 200,
      pathContains: '/download.pdf',
      body: { errors: { base: ['nope'] } },
    })

    const pdf = await port.fetchDocumentPdf(
      issued.value.document.providerDocumentId,
    )

    assert.ok(!pdf.ok)
    assert.match(pdf.message, /%PDF-/)
  })
})

describe('configuration', () => {
  it('refuses a User-Agent with no contact address', () => {
    assert.throws(
      () =>
        readFakturoidConfig({
          FAKTUROID_CLIENT_ID: 'id',
          FAKTUROID_CLIENT_SECRET: 'secret',
          FAKTUROID_SLUG: 'account',
          FAKTUROID_USER_AGENT: 'sazejchytre.cz',
        } as unknown as NodeJS.ProcessEnv),
      AccountingConfigurationError,
    )
  })

  it('accepts one that has a contact address', () => {
    const config = readFakturoidConfig({
      FAKTUROID_CLIENT_ID: 'id',
      FAKTUROID_CLIENT_SECRET: 'secret',
      FAKTUROID_SLUG: 'account',
      FAKTUROID_USER_AGENT: 'sazejchytre.cz (kontakt@sazejchytre.cz)',
    } as unknown as NodeJS.ProcessEnv)

    assert.equal(config.slug, 'account')
  })

  it('refuses a slug that would address a different endpoint', () => {
    assert.throws(
      () =>
        readFakturoidConfig({
          FAKTUROID_CLIENT_ID: 'id',
          FAKTUROID_CLIENT_SECRET: 'secret',
          FAKTUROID_SLUG: '../other-account',
          FAKTUROID_USER_AGENT: 'sazejchytre.cz (kontakt@sazejchytre.cz)',
        } as unknown as NodeJS.ProcessEnv),
      AccountingConfigurationError,
    )
  })

  it('names the missing variable rather than failing on the first call', () => {
    assert.throws(
      () =>
        readFakturoidConfig({
          FAKTUROID_CLIENT_SECRET: 'secret',
          FAKTUROID_SLUG: 'account',
          FAKTUROID_USER_AGENT: 'sazejchytre.cz (kontakt@sazejchytre.cz)',
        } as unknown as NodeJS.ProcessEnv),
      /FAKTUROID_CLIENT_ID/,
    )
  })
})
