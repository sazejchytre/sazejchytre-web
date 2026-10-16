/**
 * Invoicing against the real database.
 *
 * What only Postgres can prove: that one confirmed payment produces exactly
 * one invoice even when two deliveries race, that over-crediting is refused
 * by the database and not merely by the application, that the numbering
 * series has no gaps, and that erasing a customer leaves the accounting
 * record standing.
 *
 * Run with `pnpm test:db`.
 */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { getPayload, type Payload } from 'payload'

import type * as PayloadDrizzle from '@payloadcms/db-postgres/drizzle'

import config from '@/payload.config'
import { allocateDocumentNumber } from '@/lib/billing/document-number'
import type { ConfirmedPayment } from '@/lib/invoicing/confirmed-payment'
import { issueInvoiceForPayment } from '@/lib/invoicing/issue'
import {
  OverCreditError,
  creditedTotalMinor,
  issueCreditNote,
} from '@/lib/invoicing/credit-note'
import { anonymiseCustomer } from '@/lib/invoicing/retention'
import { collectAccountingRows } from '@/lib/invoicing/export'

const RUN = `dbtest-inv-${Date.now()}`

/**
 * One year per test file — these run in PARALLEL and teardown deletes by
 * year. See the note in refunds.db-test.ts for what sharing one costs.
 * Claimed: 2099 invariants, 2098 checks, 2097 refunds, 2096 this file.
 */
const TEST_YEAR = 2096

let payload: Payload
let sql: typeof PayloadDrizzle.sql

/**
 * Walk a drizzle error chain for the Postgres code and message.
 *
 * drizzle wraps driver errors in a generic `Failed query: ...`, so asserting
 * on the wrapper's text would pass for ANY failure — including the insert
 * succeeding and some later statement breaking. The pg code and the trigger's
 * own message live on `error.cause`. Same helper and same reason as
 * invariants.db-test.ts.
 */
const pgErrorOf = (
  error: unknown,
): { code?: string; message?: string } | undefined => {
  let current: unknown = error

  for (let depth = 0; depth < 5 && current; depth += 1) {
    const candidate = current as {
      code?: unknown
      message?: unknown
      cause?: unknown
    }

    if (typeof candidate.code === 'string') {
      return {
        code: candidate.code,
        ...(typeof candidate.message === 'string'
          ? { message: candidate.message }
          : {}),
      }
    }

    current = candidate.cause
  }

  return undefined
}

const db = () =>
  (
    payload.db as unknown as {
      drizzle: { execute: (q: unknown) => Promise<unknown> }
    }
  ).drizzle

/** Allocator pinned to the throwaway year, so the live series is untouched. */
const allocateInTestYear: typeof allocateDocumentNumber = (args) =>
  allocateDocumentNumber({ ...args, year: TEST_YEAR })

before(async () => {
  payload = await getPayload({ config })
  sql = (await import('@payloadcms/db-postgres/drizzle')).sql

  const plans = await payload.find({
    collection: 'plans',
    where: { code: { equals: 'START' } },
    limit: 1,
    pagination: false,
    overrideAccess: true,
    depth: 0,
  })

  // Asserted, not stored: invoices here are issued without a subscription,
  // but a missing seed would make every other failure in this file
  // mysterious.
  assert.ok(plans.docs[0], 'seed must have run: expected a START plan')
})

after(async () => {
  // Raw SQL: these collections refuse deletion by design, which is itself
  // asserted below.
  await db().execute(
    sql`DELETE FROM "credit_notes" WHERE "number" LIKE ${`%${TEST_YEAR}%`}`,
  )
  await db().execute(
    sql`DELETE FROM "invoices" WHERE "number" LIKE ${`%${TEST_YEAR}%`}`,
  )
  await db().execute(
    sql`DELETE FROM "invoice_number_counters" WHERE "year" = ${TEST_YEAR}`,
  )
  await db().execute(
    sql`DELETE FROM "customers" WHERE "email" LIKE ${`${RUN}%`}`,
  )
})

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

let customerCounter = 0

const makeCustomer = async (suffix: string) =>
  payload.create({
    collection: 'customers',
    overrideAccess: true,
    depth: 0,
    data: {
      email: `${RUN}-${suffix}-${++customerCounter}@example.test`,
      name: `Žluťoučký Kůň ${suffix}`,
      billingCountry: 'CZ',
      preferredLocale: 'cs',
      currency: 'CZK',
    },
  })

const payment = (parts: Partial<ConfirmedPayment> = {}): ConfirmedPayment => ({
  providerPaymentId: `pi_${RUN}_${String(++customerCounter)}`,
  providerChargeId: `ch_${RUN}`,
  currency: 'CZK',
  amountMinor: 34_900,
  paidAt: new Date('2026-06-01T10:00:00.000Z'),
  method: 'CARD',
  cardBrand: 'visa',
  cardLast4: '4242',
  cardCountry: 'CZ',
  ...parts,
})

const period = {
  planName: 'Start',
  periodStart: new Date('2026-06-01T00:00:00.000Z'),
  periodEnd: new Date('2026-07-01T00:00:00.000Z'),
}

/**
 * Issue through the real path but on the throwaway number series.
 *
 * `issueInvoiceForPayment` uses the live allocator, so the year is forced by
 * running it with a clock inside TEST_YEAR rather than by injecting an
 * allocator — which also exercises the real allocation code.
 */
const issue = async (args: {
  customerId: number
  payment: ConfirmedPayment
  ipCountry?: string | null
}) =>
  issueInvoiceForPayment({
    payload,
    customerId: args.customerId,
    payment: args.payment,
    period,
    ...(args.ipCountry === undefined ? {} : { ipCountry: args.ipCountry }),
    now: new Date(`${String(TEST_YEAR)}-06-01T10:00:00.000Z`),
  })

/* ========================================================================== */

describe('one confirmed payment, one invoice', () => {
  it('issues an invoice with the snapshots filled in', async () => {
    const customer = await makeCustomer('issue')
    const paid = payment()
    const result = await issue({
      customerId: Number(customer.id),
      payment: paid,
      ipCountry: 'CZ',
    })

    assert.equal(result.created, true)
    assert.match(result.number, new RegExp(`^FA${String(TEST_YEAR)}-\\d{6}$`))

    const invoice = await payload.findByID({
      collection: 'invoices',
      id: result.id,
      overrideAccess: true,
      depth: 0,
    })

    // No VAT: the operator is not registered. The CHECK constraints and the
    // collection hook both enforce this triple, and this proves the issuing
    // path satisfies them.
    assert.equal(invoice.taxTreatment, 'NONE_NOT_VAT_REGISTERED')
    assert.equal(invoice.taxMinor, 0)
    assert.equal(invoice.taxRateBasisPoints, 0)
    assert.equal(invoice.subtotalMinor, 34_900)
    assert.equal(invoice.totalMinor, 34_900)

    // Snapshots, not joins.
    assert.equal(invoice.serviceSnapshot.planName, 'Start')
    assert.match(invoice.serviceSnapshot.description, /Předplatné/)
    assert.equal(invoice.paymentSnapshot.method, 'CARD')
    assert.equal(invoice.paymentSnapshot.cardLast4, '4242')
    assert.match(invoice.customerSnapshot.name, /Žluťoučký/)

    // All three location signals.
    assert.equal(invoice.billingCountry, 'CZ')
    assert.equal(invoice.ipCountry, 'CZ')
    assert.equal(invoice.cardCountry, 'CZ')

    // The link a refund or chargeback is traced back through.
    assert.equal(invoice.providerPaymentId, paid.providerPaymentId)

    assert.equal(invoice.deliveryState, 'PENDING')
    assert.equal(invoice.pdfStorageKey, null)
  })

  it('leaves ipCountry null when the caller does not know it', async () => {
    // The webhook request's IP is Stripe's and would be evidence of nothing,
    // so it is absent rather than guessed. Step 5 supplies it.
    const customer = await makeCustomer('no-ip')
    const result = await issue({
      customerId: Number(customer.id),
      payment: payment(),
    })

    const invoice = await payload.findByID({
      collection: 'invoices',
      id: result.id,
      overrideAccess: true,
      depth: 0,
    })

    assert.equal(invoice.ipCountry, null)
    assert.equal(invoice.billingCountry, 'CZ')
  })

  it('returns the same invoice for a redelivered payment', async () => {
    const customer = await makeCustomer('redeliver')
    const once = payment()

    const first = await issue({
      customerId: Number(customer.id),
      payment: once,
    })
    const second = await issue({
      customerId: Number(customer.id),
      payment: once,
    })

    assert.equal(first.created, true)
    assert.equal(second.created, false)
    assert.equal(second.id, first.id)
    assert.equal(second.number, first.number)
  })

  it('issues exactly once when deliveries race', async () => {
    // THE CONCURRENCY PROOF. The read-before-write in
    // `issueInvoiceForPayment` has a window that concurrent webhook
    // deliveries genuinely both pass; the unique index on providerPaymentId
    // is what actually stops the second one. Two invoices for one payment
    // means two numbers burnt, two documents emailed and a VAT return that
    // double-counts the revenue.
    const customer = await makeCustomer('race')
    const once = payment()

    const attempts = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        issue({ customerId: Number(customer.id), payment: once }),
      ),
    )

    const invoices = await payload.find({
      collection: 'invoices',
      where: { providerPaymentId: { equals: once.providerPaymentId } },
      overrideAccess: true,
      pagination: false,
      depth: 0,
    })

    assert.equal(
      invoices.docs.length,
      1,
      `expected exactly one invoice, got ${String(invoices.docs.length)}`,
    )

    const fulfilled = attempts.filter(
      (attempt) => attempt.status === 'fulfilled',
    )

    // Every caller must get an answer naming the one real invoice — not an
    // error. A webhook that 500s here would have Stripe retry an event that
    // already succeeded.
    assert.ok(fulfilled.length > 0, 'no attempt succeeded at all')

    const ids = new Set(
      fulfilled.map((attempt) =>
        attempt.status === 'fulfilled' ? attempt.value.id : -1,
      ),
    )
    assert.equal(ids.size, 1, 'callers were told about different invoices')
    assert.equal([...ids][0], invoices.docs[0]?.id)

    assert.equal(
      fulfilled.filter(
        (attempt) => attempt.status === 'fulfilled' && attempt.value.created,
      ).length,
      1,
      'more than one caller believed it had created the invoice',
    )
  })

  it('refuses to issue for a non-positive amount', async () => {
    const customer = await makeCustomer('zero')

    await assert.rejects(
      () =>
        issue({
          customerId: Number(customer.id),
          payment: payment({ amountMinor: 0 }),
        }),
      /NON_POSITIVE_AMOUNT|Refusing to issue/,
    )
  })

  it('never produces a gap in the series', async () => {
    // A gap has to be explained to a tax inspection, so the series is checked
    // as a whole rather than per document.
    const rows = (await db().execute(
      sql`SELECT "number_sequence" AS seq FROM "invoices"
          WHERE "number_year" = ${TEST_YEAR} ORDER BY "number_sequence"`,
    )) as unknown as { rows?: { seq: number }[] }

    const sequences = (rows.rows ?? []).map((row) => Number(row.seq))

    assert.ok(sequences.length > 0, 'no invoices issued in the test year')
    sequences.forEach((value, index) => {
      assert.equal(
        value,
        index + 1,
        `series has a gap: expected ${String(index + 1)}, found ${String(value)}`,
      )
    })
  })
})

/* ========================================================================== */

describe('over-crediting is refused', () => {
  const setup = async (suffix: string) => {
    const customer = await makeCustomer(suffix)
    const once = payment({ amountMinor: 34_900 })
    const invoice = await issue({
      customerId: Number(customer.id),
      payment: once,
    })

    return { customer, invoice }
  }

  it('allows credit notes up to the invoice total', async () => {
    const { invoice } = await setup('credit-ok')

    const first = await issueCreditNote({
      payload,
      invoiceId: invoice.id,
      amountMinor: 10_000,
      currency: 'CZK',
      reason: 'Částečná vratka',
      providerRefundId: `re_${RUN}_a`,
      allocate: allocateInTestYear,
    })
    const second = await issueCreditNote({
      payload,
      invoiceId: invoice.id,
      amountMinor: 24_900,
      currency: 'CZK',
      reason: 'Zbytek',
      providerRefundId: `re_${RUN}_b`,
      allocate: allocateInTestYear,
    })

    assert.equal(first.created, true)
    assert.equal(second.created, true)
    assert.match(first.number, new RegExp(`^OD${String(TEST_YEAR)}-\\d{6}$`))

    assert.equal(
      await creditedTotalMinor({ payload, invoiceId: invoice.id }),
      34_900,
    )

    // Fully credited, so the invoice's marker moves — the ONE permitted
    // change. No amount on it has moved.
    const after = await payload.findByID({
      collection: 'invoices',
      id: invoice.id,
      overrideAccess: true,
      depth: 0,
    })
    assert.equal(after.status, 'CREDITED')
    assert.equal(after.totalMinor, 34_900)
  })

  it('refuses the credit note that would exceed the total', async () => {
    const { invoice } = await setup('credit-over')

    await issueCreditNote({
      payload,
      invoiceId: invoice.id,
      amountMinor: 30_000,
      currency: 'CZK',
      reason: 'Většina',
      providerRefundId: `re_${RUN}_c`,
      allocate: allocateInTestYear,
    })

    await assert.rejects(
      () =>
        issueCreditNote({
          payload,
          invoiceId: invoice.id,
          // 30 000 + 10 000 > 34 900.
          amountMinor: 10_000,
          currency: 'CZK',
          reason: 'Příliš',
          providerRefundId: `re_${RUN}_d`,
          allocate: allocateInTestYear,
        }),
      (error: unknown) => {
        assert.ok(error instanceof OverCreditError)
        assert.equal(error.invoiceTotalMinor, 34_900)
        assert.equal(error.alreadyCreditedMinor, 30_000)
        assert.equal(error.requestedMinor, 10_000)

        return true
      },
    )

    assert.equal(
      await creditedTotalMinor({ payload, invoiceId: invoice.id }),
      30_000,
    )
  })

  it('is enforced by the database, not only the application', async () => {
    // The application sums then inserts, and two concurrent refunds can both
    // pass that check. The trigger locks the invoice row, so only one wins.
    // Over-credited notes assert a refund larger than the payment, which
    // understates revenue in a VAT return and never self-corrects.
    const { invoice } = await setup('credit-trigger')

    const number = await allocateInTestYear({
      payload,
      series: 'CREDIT_NOTE',
    })

    await assert.rejects(
      () =>
        db().execute(
          sql`INSERT INTO "credit_notes"
                ("number", "number_year", "number_sequence", "invoice_id",
                 "currency", "amount_minor", "reason", "issued_at",
                 "delivery_state", "delivery_attempts", "updated_at", "created_at")
              VALUES (${number.number}, ${number.year}, ${number.sequence},
                      ${invoice.id}, 'CZK'::"enum_credit_notes_currency",
                      34901, 'Raw SQL over-credit',
                      now(), 'PENDING'::"enum_credit_notes_delivery_state",
                      0, now(), now())`,
        ),
      (error: unknown) => {
        const pg = pgErrorOf(error)

        // Raw SQL bypasses every hook, so only the trigger can refuse this.
        assert.equal(
          pg?.code,
          '23000',
          `unexpected pg code: ${pg?.code ?? '?'}`,
        )
        assert.match(
          String(pg?.message),
          /exceeds the invoice total/,
          'rejected, but not by the over-credit trigger',
        )

        return true
      },
    )
  })

  it('refuses a currency that is not the invoice currency', async () => {
    const { invoice } = await setup('credit-currency')

    await assert.rejects(
      () =>
        issueCreditNote({
          payload,
          invoiceId: invoice.id,
          amountMinor: 1_000,
          currency: 'EUR',
          reason: 'Wrong currency',
          allocate: allocateInTestYear,
        }),
      /Cannot credit EUR/,
    )
  })

  it('issues one credit note per provider refund however often it arrives', async () => {
    const { invoice } = await setup('credit-idem')
    const refundId = `re_${RUN}_idem`

    const first = await issueCreditNote({
      payload,
      invoiceId: invoice.id,
      amountMinor: 5_000,
      currency: 'CZK',
      reason: 'Redelivered refund',
      providerRefundId: refundId,
      allocate: allocateInTestYear,
    })
    const second = await issueCreditNote({
      payload,
      invoiceId: invoice.id,
      amountMinor: 5_000,
      currency: 'CZK',
      reason: 'Redelivered refund',
      providerRefundId: refundId,
      allocate: allocateInTestYear,
    })

    assert.equal(first.created, true)
    assert.equal(second.created, false)
    assert.equal(second.number, first.number)
  })
})

/* ========================================================================== */

describe('retention: erasure keeps the accounting record', () => {
  it('anonymises the customer and leaves the invoice snapshots untouched', async () => {
    const customer = await makeCustomer('erase')
    const issued = await issue({
      customerId: Number(customer.id),
      payment: payment(),
    })

    const before = await payload.findByID({
      collection: 'invoices',
      id: issued.id,
      overrideAccess: true,
      depth: 0,
    })

    const result = await anonymiseCustomer({
      payload,
      customerId: Number(customer.id),
    })

    assert.equal(result.retainedInvoices, 1)
    assert.match(result.anonymisedEmail, /@erased\.invalid$/)

    // The live record is anonymised.
    const live = await payload.findByID({
      collection: 'customers',
      id: customer.id,
      overrideAccess: true,
      depth: 0,
    })
    assert.match(live.email, /@erased\.invalid$/)
    assert.equal(live.authUserId, null)
    assert.doesNotMatch(live.name, /Žluťoučký/)

    // The DOCUMENT is not. This is the statutory record of a transaction that
    // happened; rewriting it would leave the operator holding invoices that
    // no longer say who they were issued to.
    const after = await payload.findByID({
      collection: 'invoices',
      id: issued.id,
      overrideAccess: true,
      depth: 0,
    })
    assert.equal(after.customerSnapshot.name, before.customerSnapshot.name)
    assert.equal(after.customerSnapshot.email, before.customerSnapshot.email)
    assert.match(after.customerSnapshot.name, /Žluťoučký/)
    assert.equal(after.totalMinor, before.totalMinor)
    assert.equal(after.number, before.number)
  })

  it('is idempotent', async () => {
    const customer = await makeCustomer('erase-twice')
    await issue({ customerId: Number(customer.id), payment: payment() })

    const first = await anonymiseCustomer({
      payload,
      customerId: Number(customer.id),
    })
    const second = await anonymiseCustomer({
      payload,
      customerId: Number(customer.id),
    })

    assert.equal(second.anonymisedEmail, first.anonymisedEmail)
    assert.equal(second.retainedInvoices, first.retainedInvoices)
  })

  it('still refuses to delete an invoice', async () => {
    const customer = await makeCustomer('no-delete')
    const issued = await issue({
      customerId: Number(customer.id),
      payment: payment(),
    })

    await assert.rejects(
      () =>
        payload.delete({
          collection: 'invoices',
          id: issued.id,
          overrideAccess: true,
        }),
      /cannot be deleted|immutable/i,
    )
  })
})

/* ========================================================================== */

describe('accounting export', () => {
  it('returns invoices and credit notes for a range, credits negative', async () => {
    const customer = await makeCustomer('export')
    const issued = await issue({
      customerId: Number(customer.id),
      payment: payment({ amountMinor: 34_900 }),
    })

    await issueCreditNote({
      payload,
      invoiceId: issued.id,
      amountMinor: 4_900,
      currency: 'CZK',
      reason: 'Sleva po dohodě',
      providerRefundId: `re_${RUN}_export`,
      allocate: allocateInTestYear,
      now: new Date(`${String(TEST_YEAR)}-06-02T00:00:00.000Z`),
    })

    const rows = await collectAccountingRows({
      payload,
      from: new Date(`${String(TEST_YEAR)}-01-01T00:00:00.000Z`),
      to: new Date(`${String(TEST_YEAR)}-12-31T00:00:00.000Z`),
    })

    const mine = rows.filter((row) => row.number.includes(String(TEST_YEAR)))

    assert.ok(mine.some((row) => row.documentType === 'INVOICE'))

    const credit = mine.find((row) => row.documentType === 'CREDIT_NOTE')
    assert.ok(credit, 'the credit note is missing from the export')
    assert.equal(credit.totalMinor, -4_900)
    assert.match(credit.correctsNumber, /^FA/)
    assert.equal(credit.correctionReason, 'Sleva po dohodě')
    // The customer identity comes from the invoice it corrects.
    assert.match(credit.customerName, /Žluťoučký/)
  })
})
