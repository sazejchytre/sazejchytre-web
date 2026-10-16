/**
 * Refunds, credit notes and disputes, against the real database.
 *
 * The webhook scenarios in `stripe/webhook.test.ts` run against an in-memory
 * double and prove the decisions. These prove the three things the double
 * cannot, because they are properties of Postgres and of Payload's hooks
 * rather than of our code:
 *
 *   1. An issued invoice really is immutable. The double happily accepts any
 *      write; only the actual `beforeValidate` hook refuses one.
 *   2. `credit_notes.provider_refund_id` really is unique, so a concurrent
 *      double delivery cannot produce two credit notes even if both pass the
 *      read-before-write check.
 *   3. A dispute row really is append-only in the fields that matter, and
 *      really does make `resolveEntitlements` return nothing.
 *
 * Run with `pnpm test:db`.
 */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { getPayload, type Payload } from 'payload'

import type * as PayloadDrizzle from '@payloadcms/db-postgres/drizzle'

import config from '@/payload.config'
import { allocateDocumentNumber } from '@/lib/billing/document-number'
import { issueCreditNoteForRefund } from '@/lib/billing/stripe/webhook'
import { loadCustomerEntitlementState } from '@/lib/billing/entitlement-loader'
import { resolveEntitlements } from '@/lib/entitlements'

const RUN = `dbtest-refund-${Date.now()}`

/**
 * A year no real document will use, so the live series stay untouched.
 *
 * ONE YEAR PER TEST FILE. The test runner runs these files in PARALLEL, and
 * teardown deletes by year, so two files sharing a year delete each other's
 * invoices mid-run — which surfaces as a foreign-key violation from
 * `credit_notes.invoice_id`, in whichever file happened to finish first, with
 * nothing in the failure to suggest the real cause.
 *
 * Claimed so far:  2099 invariants   2098 checks   2097 refunds (this file)
 */
const TEST_YEAR = 2097

let payload: Payload
let sql: typeof PayloadDrizzle.sql
let planId: number

const db = () =>
  (
    payload.db as unknown as {
      drizzle: { execute: (q: unknown) => Promise<unknown> }
    }
  ).drizzle

/** An allocator pinned to the throwaway year, so real numbering is untouched. */
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

  assert.ok(plans.docs[0], 'seed must have run: expected a START plan')
  planId = Number(plans.docs[0].id)
})

after(async () => {
  // Raw SQL: invoices, credit notes, subscription events and disputes all
  // refuse deletion through Payload, which is one of the things asserted here.
  await db().execute(
    sql`DELETE FROM "disputes" WHERE "provider_dispute_id" LIKE ${`${RUN}%`}`,
  )
  await db().execute(
    sql`DELETE FROM "credit_notes" WHERE "number" LIKE ${`%${TEST_YEAR}%`}`,
  )
  await db().execute(
    sql`DELETE FROM "subscription_events" WHERE "source_event_id" LIKE ${`${RUN}%`}`,
  )
  await db().execute(
    sql`DELETE FROM "invoices" WHERE "number" LIKE ${`%${TEST_YEAR}%`}`,
  )
  await db().execute(
    sql`DELETE FROM "invoice_number_counters" WHERE "year" = ${TEST_YEAR}`,
  )
  await db().execute(
    sql`DELETE FROM "subscriptions" WHERE "provider_subscription_id" LIKE ${`sub_${RUN}%`}`,
  )
  await db().execute(
    sql`DELETE FROM "customers" WHERE "email" LIKE ${`${RUN}%`}`,
  )
})

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const makeWorld = async (suffix: string) => {
  const customer = await payload.create({
    collection: 'customers',
    overrideAccess: true,
    depth: 0,
    data: {
      email: `${RUN}-${suffix}@example.test`,
      name: `Refund Test ${suffix}`,
      billingCountry: 'CZ',
      preferredLocale: 'cs',
      currency: 'CZK',
    },
  })

  const subscription = await payload.create({
    collection: 'subscriptions',
    overrideAccess: true,
    depth: 0,
    data: {
      customer: Number(customer.id),
      plan: planId,
      currency: 'CZK',
      interval: 'MONTH',
      priceMinor: 34_900,
      status: 'ACTIVE',
      currentPeriodStart: new Date('2026-06-01T00:00:00.000Z').toISOString(),
      currentPeriodEnd: new Date('2026-07-01T00:00:00.000Z').toISOString(),
      cancelAtPeriodEnd: false,
      provider: 'STRIPE',
      providerSubscriptionId: `sub_${RUN}_${suffix}`,
    },
  })

  const number = await allocateDocumentNumber({
    payload,
    series: 'INVOICE',
    year: TEST_YEAR,
  })

  const invoice = await payload.create({
    collection: 'invoices',
    overrideAccess: true,
    depth: 0,
    data: {
      number: number.number,
      numberYear: number.year,
      numberSequence: number.sequence,
      customer: Number(customer.id),
      subscription: Number(subscription.id),
      issuedAt: new Date('2026-06-01T00:00:00.000Z').toISOString(),
      taxableSupplyDate: new Date('2026-06-01T00:00:00.000Z').toISOString(),
      currency: 'CZK',
      subtotalMinor: 34_900,
      taxMinor: 0,
      totalMinor: 34_900,
      taxTreatment: 'NONE_NOT_VAT_REGISTERED',
      taxRateBasisPoints: 0,
      status: 'ISSUED',
      billingCountry: 'CZ',
      providerPaymentId: `pi_${RUN}_${suffix}`,
      operatorSnapshot: {
        // Fixture values, not operator identity: src/lib/legal/operator.ts is
        // still placeholders by design and must not be guessed at here.
        legalName: 'Test Operator',
        address: 'Testovaci 1, Praha',
        businessId: '00000000',
        vatRegistered: false,
      },
      customerSnapshot: {
        name: `Refund Test ${suffix}`,
        email: `${RUN}-${suffix}@example.test`,
        country: 'CZ',
      },
    },
  })

  return { customer, subscription, invoice }
}

/* ========================================================================== */

describe('a refund credits the invoice without touching it', () => {
  it('issues a credit note and leaves every invoice amount as issued', async () => {
    const { invoice } = await makeWorld('credit')

    const before = await payload.findByID({
      collection: 'invoices',
      id: invoice.id,
      overrideAccess: true,
      depth: 0,
    })

    const result = await issueCreditNoteForRefund({
      payload,
      invoiceId: Number(invoice.id),
      currency: 'CZK',
      amountMinor: 34_900,
      providerRefundId: `${RUN}-re-1`,
      reason: 'Customer request, full refund',
      now: new Date('2026-06-10T00:00:00.000Z'),
      billingCountry: 'CZ',
      allocate: allocateInTestYear,
    })

    assert.equal(result.issued, true)
    // Derived from TEST_YEAR, not written out: the previous hard-coded year
    // silently stopped matching the moment TEST_YEAR moved.
    assert.match(
      String(result.number),
      new RegExp(`^OD${String(TEST_YEAR)}-\\d{6}$`),
    )

    const notes = await payload.find({
      collection: 'credit-notes',
      where: { providerRefundId: { equals: `${RUN}-re-1` } },
      overrideAccess: true,
      pagination: false,
      depth: 0,
    })

    assert.equal(notes.docs.length, 1)
    assert.equal(notes.docs[0]?.amountMinor, 34_900)
    assert.equal(notes.docs[0]?.currency, 'CZK')
    assert.equal(Number(notes.docs[0]?.invoice), Number(invoice.id))

    const after = await payload.findByID({
      collection: 'invoices',
      id: invoice.id,
      overrideAccess: true,
      depth: 0,
    })

    // Everything that is money is exactly as issued. In Czech VAT terms the
    // invoice is a document that has been sent; a correction is a separate
    // document, not an edit to this one.
    assert.equal(after.totalMinor, before.totalMinor)
    assert.equal(after.subtotalMinor, before.subtotalMinor)
    assert.equal(after.taxMinor, before.taxMinor)
    assert.equal(after.currency, before.currency)
    assert.equal(after.number, before.number)
    assert.equal(after.issuedAt, before.issuedAt)

    // Only the status marker moved, so the admin can see at a glance that
    // this invoice has been corrected.
    assert.equal(after.status, 'CREDITED')
  })

  it('refuses a second credit note for the same provider refund', async () => {
    const { invoice } = await makeWorld('idempotent')

    const first = await issueCreditNoteForRefund({
      payload,
      invoiceId: Number(invoice.id),
      currency: 'CZK',
      amountMinor: 34_900,
      providerRefundId: `${RUN}-re-2`,
      reason: 'First delivery',
      now: new Date('2026-06-10T00:00:00.000Z'),
      allocate: allocateInTestYear,
    })
    const second = await issueCreditNoteForRefund({
      payload,
      invoiceId: Number(invoice.id),
      currency: 'CZK',
      amountMinor: 34_900,
      providerRefundId: `${RUN}-re-2`,
      reason: 'Redelivery',
      now: new Date('2026-06-10T00:00:00.000Z'),
      allocate: allocateInTestYear,
    })

    assert.equal(first.issued, true)
    assert.equal(second.issued, false)
    assert.equal(second.number, first.number)

    const notes = await payload.find({
      collection: 'credit-notes',
      where: { providerRefundId: { equals: `${RUN}-re-2` } },
      overrideAccess: true,
      pagination: false,
      depth: 0,
    })

    assert.equal(notes.docs.length, 1)
  })

  it('cannot produce two credit notes for one refund even concurrently', async () => {
    // The read-before-write in `issueCreditNoteForRefund` has a window: two
    // concurrent deliveries can both find nothing and both proceed. The
    // unique index is what actually closes it, and only the real database can
    // prove the index is there and doing its job.
    const { invoice } = await makeWorld('concurrent')

    const attempts = await Promise.allSettled(
      Array.from({ length: 4 }, (_unused, index) =>
        issueCreditNoteForRefund({
          payload,
          invoiceId: Number(invoice.id),
          currency: 'CZK',
          amountMinor: 34_900,
          providerRefundId: `${RUN}-re-3`,
          reason: `Concurrent delivery ${String(index)}`,
          now: new Date('2026-06-10T00:00:00.000Z'),
          allocate: allocateInTestYear,
        }),
      ),
    )

    const notes = await payload.find({
      collection: 'credit-notes',
      where: { providerRefundId: { equals: `${RUN}-re-3` } },
      overrideAccess: true,
      pagination: false,
      depth: 0,
    })

    assert.equal(
      notes.docs.length,
      1,
      `expected exactly one credit note, got ${String(notes.docs.length)}`,
    )

    // At least one attempt had to succeed; the rest either saw the existing
    // note or were rejected by the index. Either is fine — what matters is
    // that the money was credited once.
    assert.ok(
      attempts.some(
        (attempt) =>
          attempt.status === 'fulfilled' && attempt.value.issued === true,
      ),
      'no attempt managed to issue the credit note',
    )
  })

  it('still refuses to change an invoice amount after crediting', async () => {
    const { invoice } = await makeWorld('immutable')

    await issueCreditNoteForRefund({
      payload,
      invoiceId: Number(invoice.id),
      currency: 'CZK',
      amountMinor: 10_000,
      providerRefundId: `${RUN}-re-4`,
      reason: 'Partial',
      now: new Date('2026-06-10T00:00:00.000Z'),
      allocate: allocateInTestYear,
    })

    // The credit note exists, and the invoice is STILL immutable. Writing the
    // refund back into the invoice total is the mistake this prevents: the
    // document somebody already has in their accounting would stop matching
    // ours.
    await assert.rejects(
      () =>
        payload.update({
          collection: 'invoices',
          id: invoice.id,
          overrideAccess: true,
          data: { totalMinor: 24_900 },
        }),
      /immutable/i,
    )

    const after = await payload.findByID({
      collection: 'invoices',
      id: invoice.id,
      overrideAccess: true,
      depth: 0,
    })

    assert.equal(after.totalMinor, 34_900)
  })
})

/* ========================================================================== */

describe('a dispute suspends entitlements', () => {
  it('withholds every feature while the dispute is open', async () => {
    const { customer, subscription, invoice } = await makeWorld('dispute')

    const now = new Date('2026-06-15T12:00:00.000Z')

    // Before: an ACTIVE subscription inside its period grants the plan.
    const beforeState = await loadCustomerEntitlementState({
      payload,
      customerId: Number(customer.id),
    })
    const beforeFeatures = resolveEntitlements(beforeState, now)

    assert.ok(
      beforeFeatures.size > 0,
      'fixture is wrong: the subscription granted nothing to begin with',
    )

    await payload.create({
      collection: 'disputes',
      overrideAccess: true,
      depth: 0,
      data: {
        customer: Number(customer.id),
        subscription: Number(subscription.id),
        invoice: Number(invoice.id),
        status: 'OPEN',
        reason: 'fraudulent',
        amountMinor: 34_900,
        currency: 'CZK',
        openedAt: new Date('2026-06-10T00:00:00.000Z').toISOString(),
        evidenceDueAt: new Date('2026-06-24T00:00:00.000Z').toISOString(),
        provider: 'STRIPE',
        providerDisputeId: `${RUN}-dp-1`,
        providerChargeId: `ch_${RUN}`,
      },
    })

    const afterState = await loadCustomerEntitlementState({
      payload,
      customerId: Number(customer.id),
    })

    // The subscription is untouched and still ACTIVE — which is exactly why
    // the suspension cannot be inferred from the subscription.
    const stillActive = await payload.findByID({
      collection: 'subscriptions',
      id: subscription.id,
      overrideAccess: true,
      depth: 0,
    })
    assert.equal(stillActive.status, 'ACTIVE')

    assert.equal(
      resolveEntitlements(afterState, now).size,
      0,
      'a customer with an open chargeback still had entitlements',
    )
  })

  it('restores entitlements when the dispute is won', async () => {
    const { customer, subscription, invoice } = await makeWorld('dispute-won')

    const dispute = await payload.create({
      collection: 'disputes',
      overrideAccess: true,
      depth: 0,
      data: {
        customer: Number(customer.id),
        subscription: Number(subscription.id),
        invoice: Number(invoice.id),
        status: 'OPEN',
        reason: 'product_not_received',
        amountMinor: 34_900,
        currency: 'CZK',
        openedAt: new Date('2026-06-10T00:00:00.000Z').toISOString(),
        provider: 'STRIPE',
        providerDisputeId: `${RUN}-dp-2`,
        providerChargeId: `ch_${RUN}-2`,
      },
    })

    const now = new Date('2026-06-15T12:00:00.000Z')

    assert.equal(
      resolveEntitlements(
        await loadCustomerEntitlementState({
          payload,
          customerId: Number(customer.id),
        }),
        now,
      ).size,
      0,
    )

    // Resolution is a legitimate update: a dispute is not immutable the way
    // an invoice is, because it genuinely changes state over its life.
    await payload.update({
      collection: 'disputes',
      id: dispute.id,
      overrideAccess: true,
      data: {
        status: 'WON',
        resolvedAt: new Date('2026-06-14T00:00:00.000Z').toISOString(),
        notes: 'Delivery evidence accepted.',
      },
    })

    assert.ok(
      resolveEntitlements(
        await loadCustomerEntitlementState({
          payload,
          customerId: Number(customer.id),
        }),
        now,
      ).size > 0,
      'winning the dispute did not restore access',
    )
  })

  it('freezes the facts of a dispute while leaving its resolution editable', async () => {
    const { customer, subscription, invoice } = await makeWorld('dispute-lock')

    const dispute = await payload.create({
      collection: 'disputes',
      overrideAccess: true,
      depth: 0,
      data: {
        customer: Number(customer.id),
        subscription: Number(subscription.id),
        invoice: Number(invoice.id),
        status: 'OPEN',
        reason: 'fraudulent',
        amountMinor: 34_900,
        currency: 'CZK',
        openedAt: new Date('2026-06-10T00:00:00.000Z').toISOString(),
        provider: 'STRIPE',
        providerDisputeId: `${RUN}-dp-3`,
        providerChargeId: `ch_${RUN}-3`,
      },
    })

    // The amount clawed back is a fact, not a working note.
    await assert.rejects(
      () =>
        payload.update({
          collection: 'disputes',
          id: dispute.id,
          overrideAccess: true,
          data: { amountMinor: 1 },
        }),
      /immutable/i,
    )

    await assert.rejects(
      () =>
        payload.update({
          collection: 'disputes',
          id: dispute.id,
          overrideAccess: true,
          data: { providerChargeId: 'ch_something_else' },
        }),
      /immutable/i,
    )

    // But the working record is meant to be written.
    const updated = await payload.update({
      collection: 'disputes',
      id: dispute.id,
      overrideAccess: true,
      data: { status: 'UNDER_REVIEW', notes: 'Evidence submitted 12 June.' },
    })

    assert.equal(updated.status, 'UNDER_REVIEW')
  })

  it('refuses to delete a dispute', async () => {
    const { customer, subscription, invoice } = await makeWorld('dispute-del')

    const dispute = await payload.create({
      collection: 'disputes',
      overrideAccess: true,
      depth: 0,
      data: {
        customer: Number(customer.id),
        subscription: Number(subscription.id),
        invoice: Number(invoice.id),
        status: 'LOST',
        reason: 'fraudulent',
        amountMinor: 34_900,
        currency: 'CZK',
        openedAt: new Date('2026-06-10T00:00:00.000Z').toISOString(),
        provider: 'STRIPE',
        providerDisputeId: `${RUN}-dp-4`,
        providerChargeId: `ch_${RUN}-4`,
      },
    })

    // A lost chargeback is a financial fact with a reason attached. Deleting
    // it would erase both the loss and the pattern that led to it.
    await assert.rejects(
      () =>
        payload.delete({
          collection: 'disputes',
          id: dispute.id,
          overrideAccess: true,
        }),
      /cannot be deleted|immutable/i,
    )
  })

  it('rejects a second dispute row for the same provider dispute', async () => {
    const { customer, subscription, invoice } = await makeWorld('dispute-dup')

    const data = {
      customer: Number(customer.id),
      subscription: Number(subscription.id),
      invoice: Number(invoice.id),
      status: 'OPEN' as const,
      reason: 'fraudulent',
      amountMinor: 34_900,
      currency: 'CZK' as const,
      openedAt: new Date('2026-06-10T00:00:00.000Z').toISOString(),
      provider: 'STRIPE' as const,
      providerDisputeId: `${RUN}-dp-5`,
      providerChargeId: `ch_${RUN}-5`,
    }

    await payload.create({
      collection: 'disputes',
      overrideAccess: true,
      depth: 0,
      data,
    })

    // The unique index, not the handler's read-before-write, is what makes
    // concurrent deliveries safe.
    await assert.rejects(() =>
      payload.create({
        collection: 'disputes',
        overrideAccess: true,
        depth: 0,
        data,
      }),
    )
  })
})
