/**
 * The accounting contract, run against the in-memory fake.
 *
 * Part of `pnpm test`: no network, no credentials, nothing that could touch
 * the operator's real accounting account. The identical suite runs against
 * the Fakturoid adapter in `accounting.fakturoid-test.ts`, which is opt-in
 * only.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createFakeAccountingPort } from './fake-adapter.ts'
import { runAccountingPortContract } from './port-contract.ts'
import {
  ACCOUNTING_FAILURE_CODES,
  accountingFail,
  accountingOk,
} from './port.ts'

const fakePort = createFakeAccountingPort({
  now: () => new Date('2026-10-16T09:00:00.000Z'),
})

runAccountingPortContract({
  label: 'in-memory fake',
  mode: 'fake',
  port: fakePort,
  fake: fakePort.fake,
  runId: 'contract',
  pollDelayMs: 0,
})

describe('accounting failure helpers', () => {
  it('derives retryability from the code rather than the call site', () => {
    // So that a new call site cannot accidentally declare a permanent failure
    // retryable, which would turn the retry cron into an infinite loop
    // against a request the provider will refuse every time.
    assert.equal(accountingFail('RATE_LIMITED', 'slow down').retryable, true)
    assert.equal(
      accountingFail('PROVIDER_MAINTENANCE', 'read-only').retryable,
      true,
    )
    assert.equal(accountingFail('REJECTED_DATA', 'bad zip').retryable, false)
    assert.equal(accountingFail('ACCOUNT_BLOCKED', 'unpaid').retryable, false)
  })

  it('omits the optional fields rather than setting them undefined', () => {
    // An explicit `undefined` would survive JSON.stringify as a missing key
    // but show up in a structured log as a null column. Cheap to get right.
    const failure = accountingFail('DOCUMENT_NOT_FOUND', 'gone')

    assert.ok(!('providerDetail' in failure))
    assert.ok(!('retryAfterSeconds' in failure))
  })

  it('keeps a zero wait, which is not the same as no wait', () => {
    const failure = accountingFail('RATE_LIMITED', 'slow down', {
      retryAfterSeconds: 0,
    })

    assert.equal(failure.retryAfterSeconds, 0)
  })

  it('wraps a value without copying it', () => {
    const value = { providerSubjectId: '42' }

    assert.equal(accountingOk(value).value, value)
  })

  it('has no duplicate failure codes', () => {
    assert.equal(
      new Set(ACCOUNTING_FAILURE_CODES).size,
      ACCOUNTING_FAILURE_CODES.length,
    )
  })
})

describe('the fake itself', () => {
  it('never reuses a document number', async () => {
    const port = createFakeAccountingPort({
      now: () => new Date('2026-10-16T09:00:00.000Z'),
    })

    const subject = await port.ensureSubject({
      customId: 'c-1',
      name: 'Zkouška',
      email: 'z@example.com',
    })

    assert.ok(subject.ok)

    for (let index = 0; index < 5; index += 1) {
      const issued = await port.issueInvoice({
        customId: `inv-${String(index)}`,
        providerSubjectId: subject.value.providerSubjectId,
        currency: 'CZK',
        lines: [{ name: 'Předplatné', unitPriceMinor: 79_900, quantity: 1 }],
        issuedOn: new Date('2026-10-16T09:00:00.000Z'),
        taxableFulfillmentDue: new Date('2026-10-16T09:00:00.000Z'),
        alreadyPaid: true,
        paidOn: new Date('2026-10-16T09:00:00.000Z'),
        paymentMethod: 'CARD',
      })

      assert.ok(issued.ok, 'issuing should succeed')
      assert.equal(issued.value.adopted, false)
    }

    const numbers = port.fake.issuedNumbers()

    assert.equal(numbers.length, 5)
    assert.equal(
      new Set(numbers).size,
      5,
      'a reused number is a real-world bug',
    )
  })

  // The port takes lines, not a total, precisely so the two cannot disagree:
  // a document whose lines do not add up to its total is one an accountant has
  // to query by hand.
  it('multiplies quantity into the total', async () => {
    const port = createFakeAccountingPort()

    const subject = await port.ensureSubject({
      customId: 'c-1',
      name: 'Zkouška',
      email: 'z@example.com',
    })

    assert.ok(subject.ok)

    const issued = await port.issueInvoice({
      customId: 'inv-q',
      providerSubjectId: subject.value.providerSubjectId,
      currency: 'CZK',
      lines: [
        { name: 'Předplatné', unitPriceMinor: 34_900, quantity: 3 },
        { name: 'Příplatek', unitPriceMinor: 1_000, quantity: 1 },
      ],
      issuedOn: new Date(),
      taxableFulfillmentDue: new Date(),
      alreadyPaid: true,
      paidOn: new Date(),
      paymentMethod: 'CARD',
    })

    assert.ok(issued.ok)
    assert.equal(issued.value.document.totalMinor, 34_900 * 3 + 1_000)
  })

  it('refuses a document with no lines', async () => {
    const port = createFakeAccountingPort()

    const subject = await port.ensureSubject({
      customId: 'c-1',
      name: 'Zkouška',
      email: 'z@example.com',
    })

    assert.ok(subject.ok)

    const issued = await port.issueInvoice({
      customId: 'inv-empty',
      providerSubjectId: subject.value.providerSubjectId,
      currency: 'CZK',
      lines: [],
      issuedOn: new Date(),
      taxableFulfillmentDue: new Date(),
      alreadyPaid: true,
      paidOn: new Date(),
      paymentMethod: 'CARD',
    })

    assert.ok(!issued.ok)
    assert.equal(issued.code, 'REJECTED_DATA')
  })
})
