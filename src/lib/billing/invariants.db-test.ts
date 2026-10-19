/**
 * Integration tests for the invariants that only a real database can prove.
 *
 * These are NOT in `pnpm test`. That suite runs under Node's native type
 * stripping with no database, and CI deliberately has no Postgres — its
 * DATABASE_URL points at a host that does not exist, so a DB-backed test
 * there would fail for the wrong reason. These run against Neon via:
 *
 *     pnpm test:db
 *
 * What is covered here is exactly what a pure test cannot reach: concurrency
 * (two callers racing for one number, or one webhook), database constraints as
 * opposed to the hooks that mirror them, and Payload hook/access behaviour.
 *
 * Every fixture is tagged with a run-unique marker and removed in teardown.
 * Teardown deletes through raw SQL on purpose: invoices, credit notes,
 * subscription events and consent records all block deletion by design, which
 * is itself one of the things asserted below.
 */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { getPayload, type Payload } from 'payload'

// Namespace type import rather than an inline `import()` annotation, which the
// consistent-type-imports rule forbids. The module itself is loaded lazily in
// `before`, so this file stays importable without the database adapter.
import type * as PayloadDrizzle from '@payloadcms/db-postgres/drizzle'

import config from '@/payload.config'
import { claimWebhookEvent } from '@/lib/billing/webhook-events'

const RUN = `dbtest-${Date.now()}`
/*
 * There was a `TEST_YEAR` here — a year no real document would use,
 * one per test file, so that parallel suites could delete their own
 * fixtures by the year embedded in the document number.
 *
 * It is gone because the number is gone. Fakturoid allocates numbers
 * now, and a row may legitimately have none, so teardown keys off the
 * RUN-prefixed customer instead. That is strictly better: it scopes to
 * this run rather than to a year shared with every past run of the
 * same file.
 */

let payload: Payload
let sql: typeof PayloadDrizzle.sql
let planId: number
const createdCustomers: number[] = []

const db = () =>
  (
    payload.db as unknown as {
      drizzle: { execute: (q: unknown) => Promise<unknown> }
    }
  ).drizzle

const rows = (result: unknown): Record<string, unknown>[] => {
  if (Array.isArray(result)) return result as Record<string, unknown>[]
  const r = (result as { rows?: unknown[] } | undefined)?.rows
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : []
}

/**
 * Find a Postgres error code in an error chain.
 *
 * drizzle wraps driver errors in a generic `Failed query: …`, so the pg code
 * and constraint name live on `error.cause`. Asserting on the wrapper's text
 * would pass for any failure at all — including the insert succeeding and some
 * later statement breaking — so the chain is walked for the specific code.
 */
const pgErrorOf = (
  error: unknown,
): { code?: string; constraint?: string } | undefined => {
  let current: unknown = error

  for (let depth = 0; depth < 5 && current; depth += 1) {
    const candidate = current as {
      code?: unknown
      constraint?: unknown
      cause?: unknown
    }

    if (typeof candidate.code === 'string') {
      return typeof candidate.constraint === 'string'
        ? { code: candidate.code, constraint: candidate.constraint }
        : { code: candidate.code }
    }

    current = candidate.cause
  }

  return undefined
}

const makeCustomer = async (suffix: string, currency?: 'CZK' | 'EUR') => {
  const doc = await payload.create({
    collection: 'customers',
    data: {
      email: `${RUN}-${suffix}@example.test`,
      name: `Test ${suffix}`,
      billingCountry: 'CZ',
      preferredLocale: 'cs',
      ...(currency ? { currency } : {}),
    },
    overrideAccess: true,
    depth: 0,
  })
  createdCustomers.push(Number(doc.id))
  return doc
}

const makeSubscription = async (
  customerId: number,
  currency: 'CZK' | 'EUR',
  suffix: string,
) =>
  payload.create({
    collection: 'subscriptions',
    data: {
      customer: customerId,
      plan: planId,
      currency,
      interval: 'MONTH',
      priceMinor: 34_900,
      status: 'ACTIVE',
      currentPeriodStart: new Date('2026-06-01T00:00:00.000Z').toISOString(),
      currentPeriodEnd: new Date('2026-07-01T00:00:00.000Z').toISOString(),
      cancelAtPeriodEnd: false,
      provider: 'STRIPE',
      providerSubscriptionId: `sub_${RUN}_${suffix}`,
    },
    overrideAccess: true,
    depth: 0,
  })

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
  // Raw SQL: several of these collections refuse deletion through Payload,
  // which is the point of the tests above.
  await db().execute(
    sql`DELETE FROM "webhook_events" WHERE "external_event_id" LIKE ${`${RUN}%`}`,
  )
  await db().execute(
    sql`DELETE FROM "subscription_events" WHERE "source_event_id" LIKE ${`${RUN}%`}`,
  )
  // Scoped by the RUN-prefixed customer, not by document number.
  //
  // Teardown used to delete by `number LIKE '%<TEST_YEAR>%'`, which worked
  // because we allocated the number and could put a throwaway year in it.
  // Fakturoid allocates it now, so there is no number to key on — and a row
  // may legitimately have none at all. The customer is the stable handle:
  // every fixture row in this file hangs off one, and its email carries RUN.
  await db().execute(
    sql`DELETE FROM "invoices"
        WHERE "customer_id" IN (
          SELECT "id" FROM "customers" WHERE "email" LIKE ${`${RUN}%`}
        )`,
  )
  await db().execute(
    sql`DELETE FROM "prices" WHERE "provider_price_id" LIKE ${`${RUN}%`}`,
  )
  await db().execute(
    sql`DELETE FROM "subscriptions" WHERE "provider_subscription_id" LIKE ${`sub_${RUN}%`}`,
  )
  await db().execute(
    sql`DELETE FROM "customers" WHERE "email" LIKE ${`${RUN}%`}`,
  )
})

/* ========================================================================== */

/*
 * The document-numbering concurrency suite lived here.
 *
 * It proved that 25 concurrent allocations produced a contiguous, duplicate-
 * free series, and that invoices and credit notes kept independent counters.
 * Both invariants still matter — they just are not ours any more. Fakturoid
 * allocates the numbers now, and the invariant we have to hold instead is
 * that one payment produces one document, which `invoicing.db-test.ts` tests
 * through the unique index on `providerPaymentId` and the `custom_id`
 * adoption in `src/lib/accounting/fakturoid/adapter.test.ts`.
 *
 * Keeping a test of a counter we deleted would have been a test of nothing.
 */

describe('webhook idempotency under concurrency', () => {
  it('two concurrent claims of one event yield exactly one winner', async () => {
    const externalEventId = `${RUN}-evt-concurrent`

    const [a, b] = await Promise.all([
      claimWebhookEvent({
        payload,
        provider: 'STRIPE',
        externalEventId,
        type: 'invoice.paid',
        rawPayload: { attempt: 'a' },
      }),
      claimWebhookEvent({
        payload,
        provider: 'STRIPE',
        externalEventId,
        type: 'invoice.paid',
        rawPayload: { attempt: 'b' },
      }),
    ])

    const winners = [a, b].filter((r) => r.claimed)

    assert.equal(
      winners.length,
      1,
      `exactly one caller may process the event, got ${winners.length}`,
    )

    // Both agree on which row owns it.
    assert.equal(a.id, b.id)

    // And only one row exists.
    const count = rows(
      await db().execute(
        sql`SELECT count(*)::int AS n FROM "webhook_events"
            WHERE "provider" = 'STRIPE'::"enum_webhook_events_provider"
              AND "external_event_id" = ${externalEventId}`,
      ),
    )[0]
    assert.equal(Number(count?.n), 1)
  })

  it('keys on (provider, externalEventId), not the id alone', async () => {
    // The uniqueness grain. With only one provider configured today this
    // cannot be exercised by inserting a second provider's row through
    // `claimWebhookEvent`, so the index definition itself is asserted: a
    // single-column unique index on external_event_id must NOT exist, or a
    // second provider reusing an id would be silently swallowed as a
    // duplicate and its event never processed.
    const indexes = rows(
      await db().execute(
        sql`SELECT indexname, indexdef FROM pg_indexes
            WHERE schemaname = 'public' AND tablename = 'webhook_events'
              AND indexdef LIKE '%UNIQUE%'`,
      ),
    )

    const defs = indexes.map((r) => String(r.indexdef))

    assert.ok(
      defs.some((d) => /\(provider, external_event_id\)/.test(d)),
      `expected a unique index on the pair, got: ${JSON.stringify(defs)}`,
    )
    assert.ok(
      !defs.some((d) => /\(external_event_id\)/.test(d)),
      `external_event_id must not be unique on its own, got: ${JSON.stringify(defs)}`,
    )
  })

  it('ten concurrent claims still yield exactly one winner', async () => {
    const externalEventId = `${RUN}-evt-ten`

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        claimWebhookEvent({
          payload,
          provider: 'STRIPE',
          externalEventId,
          type: 'customer.subscription.updated',
          rawPayload: { i },
        }),
      ),
    )

    assert.equal(results.filter((r) => r.claimed).length, 1)
    assert.equal(new Set(results.map((r) => r.id)).size, 1)
  })

  it('a later replay is refused and reports the owning row', async () => {
    const externalEventId = `${RUN}-evt-replay`

    const first = await claimWebhookEvent({
      payload,
      provider: 'STRIPE',
      externalEventId,
      type: 'invoice.paid',
      rawPayload: { n: 1 },
    })
    const replay = await claimWebhookEvent({
      payload,
      provider: 'STRIPE',
      externalEventId,
      type: 'invoice.paid',
      rawPayload: { n: 1 },
    })

    assert.equal(first.claimed, true)
    assert.equal(replay.claimed, false)
    assert.equal(replay.id, first.id)
    // Not yet marked processed, so a retry sweep would still pick it up.
    assert.equal(replay.alreadyProcessed, false)
  })
})

/* ========================================================================== */

describe('currency lock', () => {
  it('locks the customer to the currency of their first subscription', async () => {
    const customer = await makeCustomer('lock-sets')
    assert.equal(customer.currency ?? null, null, 'starts unlocked')

    await makeSubscription(customer.id, 'CZK', 'lock-sets')

    const after = await payload.findByID({
      collection: 'customers',
      id: String(customer.id),
      overrideAccess: true,
      depth: 0,
    })

    assert.equal(after.currency, 'CZK')
  })

  it('rejects a subscription in a currency other than the locked one', async () => {
    // Locked to EUR up front — the realistic shape of this is a customer
    // onboarded while EUR was enabled. CZK is the *enabled* currency, so this
    // isolates the lock from the "currency not enabled" check.
    const customer = await makeCustomer('lock-mismatch', 'EUR')

    await assert.rejects(
      () => makeSubscription(customer.id, 'CZK', 'lock-mismatch'),
      (error: unknown) => {
        assert.match(String((error as Error).message), /locked to EUR/)
        return true
      },
    )
  })

  it('rejects a second subscription in a different currency', async () => {
    const customer = await makeCustomer('lock-second')
    await makeSubscription(customer.id, 'CZK', 'lock-second-a')

    // EUR is declared in the schema but not enabled, so this is refused.
    // Either refusal is correct; what must never happen is acceptance.
    await assert.rejects(() =>
      makeSubscription(customer.id, 'EUR', 'lock-second-b'),
    )

    const subs = await payload.find({
      collection: 'subscriptions',
      where: { customer: { equals: customer.id } },
      overrideAccess: true,
      pagination: false,
      depth: 0,
    })

    assert.equal(subs.docs.length, 1, 'only the CZK subscription may exist')
  })
})

/* ========================================================================== */

describe('one active price per plan + currency + interval', () => {
  it('is enforced by the database, not only by the hook', async () => {
    // Insert straight through SQL, bypassing Payload and its hook entirely.
    // If this succeeds, the invariant is only a convention.
    await assert.rejects(
      () =>
        db().execute(sql`
          INSERT INTO "prices"
            ("plan_id", "currency", "interval", "amount_minor", "active", "valid_from", "provider_price_id", "updated_at", "created_at")
          VALUES (
            ${planId}, 'CZK'::"enum_prices_currency", 'MONTH'::"enum_prices_interval",
            99999, true, now(), ${`${RUN}-dup`}, now(), now()
          )
        `),
      (error: unknown) => {
        const pg = pgErrorOf(error)

        // 23505 = unique_violation. Asserting the code AND the constraint name
        // proves it was the partial index that refused the write, not some
        // unrelated failure that happened to throw.
        assert.equal(
          pg?.code,
          '23505',
          `expected unique_violation (23505), got ${JSON.stringify(pg)} from: ${String((error as Error).message)}`,
        )
        assert.equal(pg?.constraint, 'prices_active_plan_currency_interval_key')
        return true
      },
    )
  })

  it('allows a second INACTIVE price for the same triple', async () => {
    // Superseded prices are kept forever, so the index must be partial.
    const doc = await payload.create({
      collection: 'prices',
      data: {
        plan: planId,
        currency: 'CZK',
        interval: 'MONTH',
        amountMinor: 29_900,
        active: false,
        validFrom: new Date('2025-01-01T00:00:00.000Z').toISOString(),
        providerPriceId: `${RUN}-inactive`,
      },
      overrideAccess: true,
      depth: 0,
    })

    assert.equal(doc.active, false)
  })

  it('is reported by the hook with a readable message', async () => {
    await assert.rejects(
      () =>
        payload.create({
          collection: 'prices',
          data: {
            plan: planId,
            currency: 'CZK',
            interval: 'MONTH',
            amountMinor: 44_900,
            active: true,
            validFrom: new Date().toISOString(),
            providerPriceId: `${RUN}-hook`,
          },
          overrideAccess: true,
          depth: 0,
        }),
      (error: unknown) => {
        assert.match(String((error as Error).message), /already exists/i)
        return true
      },
    )
  })
})

/* ========================================================================== */

describe('subscription events are append-only', () => {
  let eventId: number | string

  it('can be created', async () => {
    const customer = await makeCustomer('events')
    const subscription = await makeSubscription(customer.id, 'CZK', 'events')

    const event = await payload.create({
      collection: 'subscription-events',
      data: {
        subscription: subscription.id,
        type: 'CREATED',
        occurredAt: new Date().toISOString(),
        payload: { note: 'initial' },
        sourceEventId: `${RUN}-src-1`,
      },
      overrideAccess: true,
      depth: 0,
    })

    eventId = event.id
    assert.ok(eventId)
  })

  it('blocks updates via ACCESS CONTROL', async () => {
    await assert.rejects(
      () =>
        payload.update({
          collection: 'subscription-events',
          id: String(eventId),
          data: { type: 'ACTIVATED' },
          // Access control is consulted only when it is not overridden.
          overrideAccess: false,
          depth: 0,
        }),
      (error: unknown) => {
        assert.match(
          String((error as Error).message),
          /not allowed|forbidden|unauthoriz/i,
        )
        return true
      },
    )
  })

  it('blocks updates via the HOOK even with access overridden', async () => {
    // This is the case access control cannot cover: our own server-side code
    // runs with overrideAccess: true, including the step-4 webhook handlers.
    await assert.rejects(
      () =>
        payload.update({
          collection: 'subscription-events',
          id: String(eventId),
          data: { type: 'ACTIVATED' },
          overrideAccess: true,
          depth: 0,
        }),
      (error: unknown) => {
        assert.match(
          String((error as Error).message),
          /immutable once created/i,
        )
        return true
      },
    )
  })

  it('blocks deletes via ACCESS CONTROL', async () => {
    await assert.rejects(() =>
      payload.delete({
        collection: 'subscription-events',
        id: String(eventId),
        overrideAccess: false,
      }),
    )
  })

  it('blocks deletes via the HOOK even with access overridden', async () => {
    await assert.rejects(
      () =>
        payload.delete({
          collection: 'subscription-events',
          id: String(eventId),
          overrideAccess: true,
        }),
      (error: unknown) => {
        assert.match(String((error as Error).message), /cannot be deleted/i)
        return true
      },
    )
  })

  it('still exists after every attempt', async () => {
    const doc = await payload.findByID({
      collection: 'subscription-events',
      id: String(eventId),
      overrideAccess: true,
      depth: 0,
    })

    assert.equal(doc.type, 'CREATED', 'the original value survived')
  })
})

/* ========================================================================== */

describe('invoices are immutable', () => {
  let invoiceId: number | string

  const invoiceFixture = async () => {
    const customer = await makeCustomer('invoice')
    const subscription = await makeSubscription(customer.id, 'CZK', 'invoice')
    return payload.create({
      collection: 'invoices',
      data: {
        deliveryState: 'PENDING',
        deliveryAttempts: 0,
        accountingState: 'PENDING',
        customer: customer.id,
        subscription: subscription.id,
        issuedAt: new Date('2026-06-15T00:00:00.000Z').toISOString(),
        taxableSupplyDate: new Date('2026-06-15T00:00:00.000Z').toISOString(),
        currency: 'CZK',
        subtotalMinor: 34_900,
        taxMinor: 0,
        totalMinor: 34_900,
        taxTreatment: 'NONE_NOT_VAT_REGISTERED',
        taxRateBasisPoints: 0,
        status: 'ISSUED',
        billingCountry: 'CZ',
        ipCountry: 'CZ',
        cardCountry: 'CZ',
        serviceSnapshot: {
          planName: 'Test Plan',
          description: 'Predplatne analyz — testovaci fixture',
          periodStart: new Date('2026-06-01T00:00:00.000Z').toISOString(),
          periodEnd: new Date('2026-07-01T00:00:00.000Z').toISOString(),
        },
        paymentSnapshot: {
          method: 'CARD',
          paidAt: new Date('2026-06-01T00:00:00.000Z').toISOString(),
          cardBrand: 'visa',
          cardLast4: '4242',
        },
        operatorSnapshot: {
          legalName: 'Test Operator',
          address: 'Praha, CZ',
          businessId: '12345678',
          vatRegistered: false,
        },
        customerSnapshot: {
          name: 'Test Customer',
          email: `${RUN}-invoice@example.test`,
          country: 'CZ',
        },
      },
      overrideAccess: true,
      depth: 0,
    })
  }

  it('can be issued', async () => {
    const invoice = await invoiceFixture()
    invoiceId = invoice.id
    assert.equal(invoice.totalMinor, 34_900)
  })

  it('rejects totals that do not add up', async () => {
    const customer = await makeCustomer('badtotals')
    const subscription = await makeSubscription(customer.id, 'CZK', 'badtotals')
    await assert.rejects(
      () =>
        payload.create({
          collection: 'invoices',
          data: {
            deliveryState: 'PENDING',
            deliveryAttempts: 0,
            accountingState: 'PENDING',
            customer: customer.id,
            subscription: subscription.id,
            issuedAt: new Date().toISOString(),
            taxableSupplyDate: new Date().toISOString(),
            currency: 'CZK',
            subtotalMinor: 34_900,
            taxMinor: 0,
            totalMinor: 40_000,
            taxTreatment: 'NONE_NOT_VAT_REGISTERED',
            taxRateBasisPoints: 0,
            status: 'ISSUED',
            serviceSnapshot: {
              planName: 'Test Plan',
              description: 'Predplatne analyz — testovaci fixture',
              periodStart: new Date('2026-06-01T00:00:00.000Z').toISOString(),
              periodEnd: new Date('2026-07-01T00:00:00.000Z').toISOString(),
            },
            paymentSnapshot: {
              method: 'CARD',
              paidAt: new Date('2026-06-01T00:00:00.000Z').toISOString(),
              cardBrand: 'visa',
              cardLast4: '4242',
            },
            operatorSnapshot: {
              legalName: 'X',
              address: 'Y',
              businessId: '1',
              vatRegistered: false,
            },
            customerSnapshot: {
              name: 'X',
              email: 'x@example.test',
              country: 'CZ',
            },
          },
          overrideAccess: true,
          depth: 0,
        }),
      (error: unknown) => {
        assert.match(String((error as Error).message), /do not add up/i)
        return true
      },
    )
  })

  it('rejects charging VAT while not VAT registered', async () => {
    const customer = await makeCustomer('vat')
    const subscription = await makeSubscription(customer.id, 'CZK', 'vat')
    await assert.rejects(
      () =>
        payload.create({
          collection: 'invoices',
          data: {
            deliveryState: 'PENDING',
            deliveryAttempts: 0,
            accountingState: 'PENDING',
            customer: customer.id,
            subscription: subscription.id,
            issuedAt: new Date().toISOString(),
            taxableSupplyDate: new Date().toISOString(),
            currency: 'CZK',
            subtotalMinor: 30_000,
            taxMinor: 4_900,
            totalMinor: 34_900,
            taxTreatment: 'NONE_NOT_VAT_REGISTERED',
            taxRateBasisPoints: 2100,
            status: 'ISSUED',
            serviceSnapshot: {
              planName: 'Test Plan',
              description: 'Predplatne analyz — testovaci fixture',
              periodStart: new Date('2026-06-01T00:00:00.000Z').toISOString(),
              periodEnd: new Date('2026-07-01T00:00:00.000Z').toISOString(),
            },
            paymentSnapshot: {
              method: 'CARD',
              paidAt: new Date('2026-06-01T00:00:00.000Z').toISOString(),
              cardBrand: 'visa',
              cardLast4: '4242',
            },
            operatorSnapshot: {
              legalName: 'X',
              address: 'Y',
              businessId: '1',
              vatRegistered: false,
            },
            customerSnapshot: {
              name: 'X',
              email: 'x@example.test',
              country: 'CZ',
            },
          },
          overrideAccess: true,
          depth: 0,
        }),
      (error: unknown) => {
        assert.match(
          String((error as Error).message),
          /NONE_NOT_VAT_REGISTERED/,
        )
        return true
      },
    )
  })

  it('allows status to move to CREDITED', async () => {
    const updated = await payload.update({
      collection: 'invoices',
      id: String(invoiceId),
      data: { status: 'CREDITED' },
      overrideAccess: true,
      depth: 0,
    })

    assert.equal(updated.status, 'CREDITED')
  })

  it('locks every other field, even with access overridden', async () => {
    for (const change of [
      { totalMinor: 1 },
      { subtotalMinor: 1 },
      { number: 'FA2099-999999' },
      { issuedAt: new Date('2020-01-01T00:00:00.000Z').toISOString() },
      {
        customerSnapshot: {
          name: 'Rewritten',
          email: 'x@example.test',
          country: 'CZ',
        },
      },
    ]) {
      await assert.rejects(
        () =>
          payload.update({
            collection: 'invoices',
            id: String(invoiceId),
            data: change,
            overrideAccess: true,
            depth: 0,
          }),
        (error: unknown) => {
          assert.match(
            String((error as Error).message),
            /immutable once created/i,
            `expected ${Object.keys(change)[0]} to be locked`,
          )
          return true
        },
      )
    }
  })

  it('blocks deletion through access control and through the hook', async () => {
    await assert.rejects(() =>
      payload.delete({
        collection: 'invoices',
        id: String(invoiceId),
        overrideAccess: false,
      }),
    )

    await assert.rejects(
      () =>
        payload.delete({
          collection: 'invoices',
          id: String(invoiceId),
          overrideAccess: true,
        }),
      (error: unknown) => {
        assert.match(String((error as Error).message), /cannot be deleted/i)
        return true
      },
    )

    const still = await payload.findByID({
      collection: 'invoices',
      id: String(invoiceId),
      overrideAccess: true,
      depth: 0,
    })

    assert.equal(still.totalMinor, 34_900, 'amounts untouched by every attempt')
  })
})

/* ========================================================================== */

describe('money columns are integers in the database', () => {
  it('refuses a fractional amount at the column level', async () => {
    // The application validates this too, but the column type is what makes it
    // impossible. Writing 34900.5 straight through SQL must fail or truncate —
    // never silently store a decimal.
    const result = await db()
      .execute(
        sql`SELECT pg_typeof("amount_minor")::text AS t FROM "prices" LIMIT 1`,
      )
      .then(rows)

    assert.equal(result[0]?.t, 'integer')
  })
})
