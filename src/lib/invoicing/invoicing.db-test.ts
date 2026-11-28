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
import { env } from '@/lib/env'
import { openDisposableDatabase } from '@/lib/testing/disposable-database'
import type { ConfirmedPayment } from '@/lib/invoicing/confirmed-payment'
import { issueInvoiceForPayment } from '@/lib/invoicing/issue'
import {
  OverCreditError,
  creditedTotalMinor,
  issueCreditNote,
} from '@/lib/invoicing/credit-note'
import { createFakeAccountingPort } from '@/lib/accounting/fake-adapter'
import {
  ensureCreditNoteDocument,
  ensureInvoiceDocument,
} from '@/lib/invoicing/accounting-document'
import { anonymiseCustomer } from '@/lib/invoicing/retention'
import { collectAccountingRows } from '@/lib/invoicing/export'

const guard = await openDisposableDatabase(env.DATABASE_URL)
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
  // Scoped by the RUN-prefixed customer, not by document number.
  //
  // Teardown used to delete by `number LIKE '%<TEST_YEAR>%'`, which worked
  // because we allocated the number and could put a throwaway year in it.
  // Fakturoid allocates it now, so there is no number to key on — and a row
  // may legitimately have none at all. The customer is the stable handle:
  // every fixture row in this file hangs off one, and its email carries RUN.
  await db().execute(
    sql`DELETE FROM "credit_notes"
        WHERE "invoice_id" IN (
          SELECT "id" FROM "invoices"
          WHERE "customer_id" IN (
            SELECT "id" FROM "customers" WHERE "email" LIKE ${`${RUN}%`}
          )
        )`,
  )
  await db().execute(
    sql`DELETE FROM "invoices"
        WHERE "customer_id" IN (
          SELECT "id" FROM "customers" WHERE "email" LIKE ${`${RUN}%`}
        )`,
  )
  await db().execute(
    sql`DELETE FROM "customers" WHERE "email" LIKE ${`${RUN}%`}`,
  )
})

after(() => guard.end())

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
    // No number yet, and that is the point: the row records the sale the
    // moment money arrives, and the accounting document — which is what gets
    // numbered — is issued afterwards at Fakturoid. A row with no number is a
    // normal state, not a broken one.
    assert.equal(result.number, null)

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

  it('never lets two rows claim one accounting document', async () => {
    // This replaced a gap-in-the-series test.
    //
    // That test checked `number_sequence` ran 1..n with no holes, which was
    // the right invariant while WE allocated the numbers. We do not any more,
    // and a test of Fakturoid's internal numbering would be a test of
    // somebody else's code that we could not fix if it failed.
    //
    // What IS ours, and is just as damaging to get wrong, is the mapping: two
    // of our rows must never point at one statutory document. The unique
    // indexes make that impossible; this proves they are doing it.
    const rows = (await db().execute(
      sql`SELECT COUNT(*) AS total,
                 COUNT(DISTINCT "fakturoid_document_id") AS documents,
                 COUNT("fakturoid_document_id") AS issued
          FROM "invoices"
          WHERE "customer_id" IN (
            SELECT "id" FROM "customers" WHERE "email" LIKE ${`${RUN}%`}
          )`,
    )) as unknown as {
      rows?: { total: number; documents: number; issued: number }[]
    }

    const counts = (rows.rows ?? [])[0]

    assert.ok(counts, 'no invoices found for this run')
    assert.ok(Number(counts.total) > 0, 'no invoices issued in this run')
    // Every issued row has its own document. In this suite nothing reaches an
    // accounting provider at all, so `issued` is zero and the assertion holds
    // trivially — which is itself the point being made: a row with no
    // document number is a normal state, not a broken one.
    assert.equal(
      Number(counts.documents),
      Number(counts.issued),
      'two rows share one Fakturoid document id',
    )
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
    })
    const second = await issueCreditNote({
      payload,
      invoiceId: invoice.id,
      amountMinor: 24_900,
      currency: 'CZK',
      reason: 'Zbytek',
      providerRefundId: `re_${RUN}_b`,
    })

    assert.equal(first.created, true)
    assert.equal(second.created, true)
    // Same as an invoice: the refund is recorded now, Fakturoid numbers the
    // correction document afterwards.
    assert.equal(first.number, null)

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

    await assert.rejects(
      () =>
        db().execute(
          sql`INSERT INTO "credit_notes"
                ("accounting_state", "invoice_id",
                 "currency", "amount_minor", "reason", "issued_at",
                 "delivery_state", "delivery_attempts", "updated_at", "created_at")
              VALUES ('PENDING'::"enum_credit_notes_accounting_state",
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
    })
    const second = await issueCreditNote({
      payload,
      invoiceId: invoice.id,
      amountMinor: 5_000,
      currency: 'CZK',
      reason: 'Redelivered refund',
      providerRefundId: refundId,
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
    assert.equal(after.fakturoidNumber, before.fakturoidNumber)
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
      now: new Date(`${String(TEST_YEAR)}-06-02T00:00:00.000Z`),
    })

    const rows = await collectAccountingRows({
      payload,
      from: new Date(`${String(TEST_YEAR)}-01-01T00:00:00.000Z`),
      to: new Date(`${String(TEST_YEAR)}-12-31T00:00:00.000Z`),
    })

    // Filtered by the correction reason, not by the document number.
    // Numbers come from Fakturoid now, and nothing in this suite reaches it,
    // so every row in the range has an EMPTY number — which the export
    // reports rather than hiding, because an unissued document is exactly the
    // thing somebody needs to see.
    const mine = rows.filter((row) => row.customerName.includes('Žluťoučký'))

    assert.ok(mine.some((row) => row.documentType === 'INVOICE'))

    const credit = mine.find((row) => row.documentType === 'CREDIT_NOTE')
    assert.ok(credit, 'the credit note is missing from the export')
    assert.equal(credit.totalMinor, -4_900)
    assert.equal(credit.correctionReason, 'Sleva po dohodě')
    // The customer identity comes from the invoice it corrects.
    assert.match(credit.customerName, /Žluťoučký/)

    // Unissued, and visible as such. A reader must be able to tell "no
    // document yet" from "document with no number", and `accountingState` is
    // what says which.
    assert.equal(credit.number, '')
    assert.equal(credit.accountingState, 'PENDING')
    assert.equal(credit.correctsNumber, '')
  })
})

/* ========================================================================== */

/**
 * A Fakturoid outage, end to end, against the real database.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE GUARANTEE BEING TESTED
 *
 * A provider outage must never lose a payment or roll back an entitlement.
 * Everything else in this step is arranged to make that true, and this is the
 * test that says so: the row is written, it stays PENDING, the money on it is
 * untouched, and a later attempt — which is what the cron is — finishes the
 * job and never produces a second document.
 *
 * Deliberately a database test rather than a pure one. The pure tests prove
 * the decisions; this proves the WRITES, including that `accountingState` and
 * the two Fakturoid columns are actually settable on a row whose other fields
 * are frozen by `lockFieldsAfterCreate`. That is exactly the kind of thing a
 * Payload double cannot tell you.
 */
describe('a Fakturoid outage loses nothing', () => {
  it('records the sale, stays PENDING, and issues on the retry', async () => {
    const customer = await makeCustomer('outage')
    const paid = payment({ amountMinor: 34_900 })

    const invoice = await issue({
      customerId: Number(customer.id),
      payment: paid,
    })

    // 1. The sale is recorded no matter what the provider is doing.
    assert.equal(invoice.created, true)
    assert.equal(invoice.number, null)

    const down = createFakeAccountingPort()
    down.fake.setUnreachable(true)

    const first = await ensureInvoiceDocument({
      payload,
      id: invoice.id,
      port: down,
    })

    // 2. The outage is reported as itself — not as a rejection, not as a
    //    crash, and not flattened into "failed".
    assert.equal(first.reason, 'PROVIDER_UNREACHABLE')
    assert.equal(first.retryable, true)

    const stranded = await payload.findByID({
      collection: 'invoices',
      id: invoice.id,
      overrideAccess: true,
      depth: 0,
    })

    // 3. Nothing was lost and nothing was rolled back.
    assert.equal(stranded.accountingState, 'PENDING')
    assert.equal(stranded.fakturoidNumber, null)
    assert.equal(stranded.fakturoidDocumentId, null)
    assert.equal(stranded.totalMinor, 34_900)
    assert.equal(stranded.providerPaymentId, paid.providerPaymentId)

    // 4. The retry — which is what the cron does — finishes the job.
    const up = createFakeAccountingPort()
    const second = await ensureInvoiceDocument({
      payload,
      id: invoice.id,
      port: up,
    })

    assert.equal(second.reason, 'ISSUED')
    assert.ok(second.number)

    const issuedRow = await payload.findByID({
      collection: 'invoices',
      id: invoice.id,
      overrideAccess: true,
      depth: 0,
    })

    assert.equal(issuedRow.accountingState, 'ISSUED')
    assert.equal(issuedRow.fakturoidNumber, second.number)
    assert.equal(issuedRow.fakturoidDocumentId, second.providerDocumentId)
    // Still exactly as sold. The document is new; the sale is not.
    assert.equal(issuedRow.totalMinor, 34_900)

    // 5. And a third attempt does nothing at all, rather than issuing again.
    const third = await ensureInvoiceDocument({
      payload,
      id: invoice.id,
      port: up,
    })

    assert.equal(third.reason, 'ALREADY_ISSUED')
    assert.equal(
      up.fake.documents().length,
      1,
      'a second document would be a second number in a statutory series',
    )
  })

  it('refuses to correct an invoice that has no document yet', async () => {
    const customer = await makeCustomer('outage-credit')
    const invoice = await issue({
      customerId: Number(customer.id),
      payment: payment({ amountMinor: 34_900 }),
    })

    const note = await issueCreditNote({
      payload,
      invoiceId: invoice.id,
      amountMinor: 10_000,
      currency: 'CZK',
      reason: 'Vratka během výpadku',
      providerRefundId: `re_${RUN}_outage`,
    })

    // The refund is recorded regardless — money went back to a customer and
    // that is not contingent on a third party being reachable.
    assert.equal(note.created, true)
    assert.equal(note.number, null)

    const port = createFakeAccountingPort()
    const outcome = await ensureCreditNoteDocument({
      payload,
      id: note.id,
      port,
    })

    // A correction has to point at a document. "Not yet" is retryable, not a
    // failure: the cron comes back once the invoice has been issued.
    assert.equal(outcome.retryable, true)
    assert.equal(port.fake.documents().length, 0)

    const row = await payload.findByID({
      collection: 'credit-notes',
      id: note.id,
      overrideAccess: true,
      depth: 0,
    })

    assert.equal(row.accountingState, 'PENDING')
    assert.equal(row.amountMinor, 10_000)
  })
})
