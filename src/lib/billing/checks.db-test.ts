/**
 * Proof that the row-local billing invariants are DATABASE constraints, not
 * just Payload hooks.
 *
 * Every case here writes straight through SQL, bypassing Payload and its hooks
 * entirely. If one of these inserts succeeds, that invariant is a convention
 * rather than a guarantee — a migration, a support script or a `psql` session
 * could violate it and nothing would notice.
 *
 * Each rejection is asserted on BOTH the SQLSTATE (`23514`, check_violation)
 * AND the constraint name. Matching on the message alone would pass for any
 * failure at all, including the insert succeeding and some unrelated statement
 * breaking afterwards.
 *
 * Run with `pnpm test:db`. Not part of `pnpm test`, which is pure and has no
 * database — see the note at the top of `invariants.db-test.ts`.
 */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { getPayload, type Payload } from 'payload'

import type * as PayloadDrizzle from '@payloadcms/db-postgres/drizzle'

import config from '@/payload.config'
import { env } from '@/lib/env'
import { openDisposableDatabase } from '@/lib/testing/disposable-database'

const guard = await openDisposableDatabase(env.DATABASE_URL)
const RUN = `chk-${Date.now()}`
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
let adminUserId: number

const db = () =>
  (
    payload.db as unknown as {
      drizzle: { execute: (q: unknown) => Promise<unknown> }
    }
  ).drizzle

/**
 * Find a Postgres error code in an error chain.
 *
 * drizzle wraps driver errors in a generic `Failed query: …`, so the SQLSTATE
 * and constraint name live on `error.cause`.
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

const expectCheckViolation = async (
  constraint: string,
  run: () => Promise<unknown>,
) => {
  await assert.rejects(run, (error: unknown) => {
    const pg = pgErrorOf(error)

    assert.equal(
      pg?.code,
      '23514',
      `expected check_violation (23514) on ${constraint}, got ${JSON.stringify(pg)}: ${String((error as Error).message)}`,
    )
    assert.equal(pg?.constraint, constraint)
    return true
  })
}

const makeCustomer = async (suffix: string): Promise<number> => {
  const doc = await payload.create({
    collection: 'customers',
    data: {
      email: `${RUN}-${suffix}@example.test`,
      name: `Check ${suffix}`,
      billingCountry: 'CZ',
      preferredLocale: 'cs',
    },
    overrideAccess: true,
    depth: 0,
  })

  return Number(doc.id)
}

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

  // `entitlement_grants.granted_by_id` is NOT NULL and references users.
  const admins = await payload.find({
    collection: 'users',
    limit: 1,
    pagination: false,
    overrideAccess: true,
    depth: 0,
  })

  adminUserId = admins.docs[0]
    ? Number(admins.docs[0].id)
    : Number(
        (
          await payload.create({
            collection: 'users',
            data: {
              email: `${RUN}-admin@example.test`,
              password: `${RUN}-not-a-real-password-0000`,
              name: 'Check fixture admin',
            },
            overrideAccess: true,
            depth: 0,
          })
        ).id,
      )
})

after(async () => {
  // Raw SQL: invoices and consent records refuse deletion through Payload.
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
    sql`DELETE FROM "consent_records" WHERE "document_version" LIKE ${`${RUN}%`}`,
  )
  await db().execute(
    sql`DELETE FROM "entitlement_grants" WHERE "reason" LIKE ${`${RUN}%`}`,
  )
  await db().execute(
    sql`DELETE FROM "subscriptions" WHERE "provider_subscription_id" LIKE ${`sub_${RUN}%`}`,
  )
  await db().execute(
    sql`DELETE FROM "customers" WHERE "email" LIKE ${`${RUN}%`}`,
  )
  await db().execute(sql`DELETE FROM "users" WHERE "email" LIKE ${`${RUN}%`}`)
})

after(() => guard.end())

/* -------------------------------------------------------------------------- */
/* Invoice arithmetic and tax treatment                                       */
/* -------------------------------------------------------------------------- */

/** Minimal raw invoice insert. `overrides` replaces any column expression. */
const rawInvoice = async (
  customerId: number,
  overrides: Record<string, string> = {},
): Promise<unknown> => {
  const columns: Record<string, string> = {
    // No number: Fakturoid allocates it, and this row is deliberately created
    // before any accounting document exists.
    accounting_state: `'PENDING'::"enum_invoices_accounting_state"`,
    customer_id: String(customerId),
    issued_at: 'now()',
    taxable_supply_date: 'now()',
    currency: `'CZK'::"enum_invoices_currency"`,
    subtotal_minor: '34900',
    tax_minor: '0',
    total_minor: '34900',
    tax_treatment: `'NONE_NOT_VAT_REGISTERED'::"enum_invoices_tax_treatment"`,
    tax_rate_basis_points: '0',
    status: `'ISSUED'::"enum_invoices_status"`,
    operator_snapshot_legal_name: `'Op'`,
    operator_snapshot_address: `'Praha'`,
    operator_snapshot_business_id: `'1'`,
    operator_snapshot_vat_registered: 'false',
    customer_snapshot_name: `'C'`,
    customer_snapshot_email: `'c@example.test'`,
    customer_snapshot_country: `'CZ'`,
    // Added in step 5b and NOT NULL, so every insert path has to supply them
    // — including this one, which bypasses Payload to test the database's
    // own CHECK constraints.
    service_snapshot_plan_name: `'Start'`,
    service_snapshot_description: `'Předplatné'`,
    service_snapshot_period_start: 'now()',
    service_snapshot_period_end: 'now()',
    payment_snapshot_method: `'CARD'`,
    payment_snapshot_paid_at: 'now()',
    delivery_state: `'PENDING'::"enum_invoices_delivery_state"`,
    delivery_attempts: '0',
    updated_at: 'now()',
    created_at: 'now()',
    ...overrides,
  }

  const names = Object.keys(columns)
    .map((column) => `"${column}"`)
    .join(', ')
  const values = Object.values(columns).join(', ')

  return db().execute(
    sql.raw(`INSERT INTO "invoices" (${names}) VALUES (${values})`),
  )
}

describe('invoices_totals_add_up', () => {
  it('rejects a total that disagrees with its parts', async () => {
    const customer = await makeCustomer('totals')

    await expectCheckViolation('invoices_totals_add_up', () =>
      rawInvoice(customer, { total_minor: '40000' }),
    )
  })

  it('accepts a total that agrees', async () => {
    // Same path with valid data, so the rejection above is not vacuous — it is
    // the arithmetic being refused, not raw inserts in general.
    const customer = await makeCustomer('totals-ok')

    await rawInvoice(customer, {
      subtotal_minor: '30000',
      tax_minor: '0',
      total_minor: '30000',
    })
  })
})

describe('invoices_no_vat_when_not_registered', () => {
  it('rejects a tax amount under NONE_NOT_VAT_REGISTERED', async () => {
    const customer = await makeCustomer('vat-amount')

    await expectCheckViolation('invoices_no_vat_when_not_registered', () =>
      rawInvoice(customer, {
        subtotal_minor: '30000',
        tax_minor: '4900',
        total_minor: '34900',
        tax_rate_basis_points: '2100',
      }),
    )
  })

  it('rejects a non-zero rate even with zero tax', async () => {
    const customer = await makeCustomer('vat-rate')

    await expectCheckViolation('invoices_no_vat_when_not_registered', () =>
      rawInvoice(customer, { tax_rate_basis_points: '2100' }),
    )
  })

  it('allows VAT under a VAT-charging treatment', async () => {
    // The constraint is conditional on the treatment, not a blanket ban — it
    // must not block the operator from charging VAT once registered.
    const customer = await makeCustomer('vat-ok')

    await rawInvoice(customer, {
      tax_treatment: `'CZ_VAT_STANDARD'::"enum_invoices_tax_treatment"`,
      subtotal_minor: '30000',
      tax_minor: '6300',
      total_minor: '36300',
      tax_rate_basis_points: '2100',
    })
  })
})

describe('invoice tax rate is in basis points', () => {
  it('stores a fractional percentage exactly', async () => {
    // The whole point of the change from whole percent: 12.5% has to be
    // representable without a decimal column.
    const customer = await makeCustomer('bps')

    await rawInvoice(customer, {
      tax_treatment: `'CZ_VAT_REDUCED'::"enum_invoices_tax_treatment"`,
      subtotal_minor: '10000',
      tax_minor: '1250',
      total_minor: '11250',
      tax_rate_basis_points: '1250',
    })

    const stored = await payload.find({
      collection: 'invoices',
      where: { customer: { equals: customer } },
      limit: 1,
      pagination: false,
      overrideAccess: true,
      depth: 0,
    })

    assert.equal(stored.docs[0]?.taxRateBasisPoints, 1250)
  })

  it('is an integer column, so no decimal can be stored', async () => {
    const result = await db().execute(
      sql`SELECT data_type FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'invoices'
            AND column_name = 'tax_rate_basis_points'`,
    )

    const rows = Array.isArray(result)
      ? (result as Record<string, unknown>[])
      : ((result as { rows?: Record<string, unknown>[] }).rows ?? [])

    assert.equal(rows[0]?.data_type, 'integer')
  })
})

describe('invoices.subscription is nullable', () => {
  it('accepts an invoice with no subscription, for a one-off charge', async () => {
    const customer = await makeCustomer('nullsub')

    // Raw insert omitting the column entirely.
    await rawInvoice(customer, {})

    // And through Payload, which is what application code will do.
    const doc = await payload.create({
      collection: 'invoices',
      data: {
        deliveryState: 'PENDING',
        deliveryAttempts: 0,
        accountingState: 'PENDING',
        customer,
        issuedAt: new Date().toISOString(),
        taxableSupplyDate: new Date().toISOString(),
        currency: 'CZK',
        subtotalMinor: 10_000,
        taxMinor: 0,
        totalMinor: 10_000,
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
          legalName: 'Op',
          address: 'Praha',
          businessId: '1',
          vatRegistered: false,
        },
        customerSnapshot: {
          name: 'C',
          email: 'c@example.test',
          country: 'CZ',
        },
      },
      overrideAccess: true,
      depth: 0,
    })

    assert.equal(doc.subscription ?? null, null)
  })
})

/* -------------------------------------------------------------------------- */
/* Entitlement grant shape and window                                         */
/* -------------------------------------------------------------------------- */

describe('entitlement_grants_exactly_one_target', () => {
  it('rejects a grant naming both a feature and a plan', async () => {
    const customer = await makeCustomer('both')

    await expectCheckViolation('entitlement_grants_exactly_one_target', () =>
      db().execute(sql`
        INSERT INTO "entitlement_grants"
          ("customer_id", "feature_key", "plan_id", "granted_by_id", "reason",
           "starts_at", "updated_at", "created_at")
        VALUES (${customer},
                'API_ACCESS'::"enum_entitlement_grants_feature_key",
                ${planId}, ${adminUserId}, ${`${RUN} both`},
                now(), now(), now())
      `),
    )
  })

  it('rejects a grant naming neither', async () => {
    const customer = await makeCustomer('neither')

    await expectCheckViolation('entitlement_grants_exactly_one_target', () =>
      db().execute(sql`
        INSERT INTO "entitlement_grants"
          ("customer_id", "granted_by_id", "reason",
           "starts_at", "updated_at", "created_at")
        VALUES (${customer}, ${adminUserId}, ${`${RUN} neither`},
                now(), now(), now())
      `),
    )
  })

  it('accepts a grant naming exactly one', async () => {
    const customer = await makeCustomer('one')

    await db().execute(sql`
      INSERT INTO "entitlement_grants"
        ("customer_id", "feature_key", "granted_by_id", "reason",
         "starts_at", "updated_at", "created_at")
      VALUES (${customer},
              'API_ACCESS'::"enum_entitlement_grants_feature_key",
              ${adminUserId}, ${`${RUN} feature only`}, now(), now(), now())
    `)
  })
})

describe('entitlement_grants_window_ordered', () => {
  it('rejects endsAt before startsAt', async () => {
    const customer = await makeCustomer('window')

    await expectCheckViolation('entitlement_grants_window_ordered', () =>
      db().execute(sql`
        INSERT INTO "entitlement_grants"
          ("customer_id", "feature_key", "granted_by_id", "reason",
           "starts_at", "ends_at", "updated_at", "created_at")
        VALUES (${customer},
                'API_ACCESS'::"enum_entitlement_grants_feature_key",
                ${adminUserId}, ${`${RUN} backwards`},
                '2026-06-01T00:00:00Z'::timestamptz,
                '2026-05-01T00:00:00Z'::timestamptz,
                now(), now())
      `),
    )
  })

  it('allows an open-ended grant', async () => {
    // A CHECK that evaluates to NULL passes, which is what lets `ends_at IS
    // NULL` mean open-ended rather than invalid.
    const customer = await makeCustomer('window-open')

    await db().execute(sql`
      INSERT INTO "entitlement_grants"
        ("customer_id", "feature_key", "granted_by_id", "reason",
         "starts_at", "updated_at", "created_at")
      VALUES (${customer},
              'API_ACCESS'::"enum_entitlement_grants_feature_key",
              ${adminUserId}, ${`${RUN} open ended`}, now(), now(), now())
    `)
  })
})

/* -------------------------------------------------------------------------- */
/* The same window rule wherever a start/end pair exists                      */
/* -------------------------------------------------------------------------- */

describe('subscriptions_period_ordered', () => {
  it('rejects a period ending before it starts', async () => {
    const customer = await makeCustomer('period')

    await expectCheckViolation('subscriptions_period_ordered', () =>
      db().execute(sql`
        INSERT INTO "subscriptions"
          ("customer_id", "plan_id", "currency", "interval", "price_minor",
           "status", "current_period_start", "current_period_end",
           "cancel_at_period_end", "provider", "provider_subscription_id",
           "updated_at", "created_at")
        VALUES (${customer}, ${planId},
                'CZK'::"enum_subscriptions_currency",
                'MONTH'::"enum_subscriptions_interval", 34900,
                'ACTIVE'::"enum_subscriptions_status",
                '2026-07-01T00:00:00Z'::timestamptz,
                '2026-06-01T00:00:00Z'::timestamptz,
                false, 'STRIPE'::"enum_subscriptions_provider",
                ${`sub_${RUN}_period`}, now(), now())
      `),
    )
  })
})

describe('consent_records_withdrawal_ordered', () => {
  it('rejects a withdrawal dated before the consent', async () => {
    await expectCheckViolation('consent_records_withdrawal_ordered', () =>
      db().execute(sql`
        INSERT INTO "consent_records"
          ("type", "document_version", "consent_text_snapshot", "granted_at",
           "withdrawn_at", "updated_at", "created_at")
        VALUES ('TERMS'::"enum_consent_records_type",
                ${`${RUN}-v1`}, 'text',
                '2026-06-01T00:00:00Z'::timestamptz,
                '2026-05-01T00:00:00Z'::timestamptz,
                now(), now())
      `),
    )
  })

  it('allows consent that has not been withdrawn', async () => {
    await db().execute(sql`
      INSERT INTO "consent_records"
        ("type", "document_version", "consent_text_snapshot", "granted_at",
         "updated_at", "created_at")
      VALUES ('TERMS'::"enum_consent_records_type",
              ${`${RUN}-v2`}, 'text', now(), now(), now())
    `)
  })
})

/* ========================================================================== */

/**
 * The shape step 5c left behind.
 *
 * Asserted against `information_schema` rather than trusted, because every one
 * of these is load-bearing and none of them is visible from the application:
 *
 *   - the new columns must be NULLABLE, or a row could not be written while
 *     Fakturoid is unreachable, and then a provider outage would mean losing a
 *     payment or revoking a paid-for entitlement;
 *   - the old numbering columns must be GONE, or something could still write a
 *     second series alongside Fakturoid's;
 *   - the document id and number must be UNIQUE, so two of our rows can never
 *     point at one statutory document.
 */
describe('accounting document columns (step 5c)', () => {
  const columns = async (table: string) => {
    const result = await db().execute(
      sql`SELECT column_name, is_nullable, data_type
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = ${table}`,
    )

    const rows = Array.isArray(result)
      ? (result as Record<string, unknown>[])
      : ((result as { rows?: Record<string, unknown>[] }).rows ?? [])

    return new Map(
      rows.map((row) => [
        String(row.column_name),
        { nullable: row.is_nullable === 'YES', type: String(row.data_type) },
      ]),
    )
  }

  const uniqueIndexes = async (table: string) => {
    const result = await db().execute(
      sql`SELECT indexname, indexdef FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = ${table}`,
    )

    const rows = Array.isArray(result)
      ? (result as Record<string, unknown>[])
      : ((result as { rows?: Record<string, unknown>[] }).rows ?? [])

    return rows
      .filter((row) => String(row.indexdef).includes('CREATE UNIQUE INDEX'))
      .map((row) => String(row.indexdef))
  }

  for (const table of ['invoices', 'credit_notes'] as const) {
    it(`${table} carries a nullable Fakturoid id and number`, async () => {
      const found = await columns(table)

      for (const column of ['fakturoid_document_id', 'fakturoid_number']) {
        const definition = found.get(column)

        assert.ok(definition, `${table}.${column} is missing`)
        assert.equal(
          definition.nullable,
          true,
          `${table}.${column} must be nullable — the row exists before the document does`,
        )
      }
    })

    it(`${table}.accounting_state is NOT NULL and defaults to PENDING`, async () => {
      const found = await columns(table)
      const definition = found.get('accounting_state')

      assert.ok(definition, `${table}.accounting_state is missing`)
      assert.equal(definition.nullable, false)
    })

    it(`${table} no longer has our own numbering columns`, async () => {
      const found = await columns(table)

      for (const column of ['number', 'number_year', 'number_sequence']) {
        assert.ok(
          !found.has(column),
          `${table}.${column} still exists — Fakturoid owns the numbering now`,
        )
      }
    })

    it(`${table} cannot point two rows at one document`, async () => {
      const unique = await uniqueIndexes(table)

      for (const column of ['fakturoid_document_id', 'fakturoid_number']) {
        assert.ok(
          unique.some((definition) => definition.includes(`(${column})`)),
          `${table}.${column} has no unique index`,
        )
      }
    })
  }

  it('customers cannot hold two Fakturoid subjects for one customer', async () => {
    const unique = await uniqueIndexes('customers')

    assert.ok(
      unique.some((definition) =>
        definition.includes('(fakturoid_subject_id)'),
      ),
      'customers.fakturoid_subject_id has no unique index — two subjects for ' +
        'one customer would split their documents in two',
    )
  })

  it('the number counter table is gone', async () => {
    const result = await db().execute(
      sql`SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'invoice_number_counters'`,
    )

    const rows = Array.isArray(result)
      ? (result as Record<string, unknown>[])
      : ((result as { rows?: Record<string, unknown>[] }).rows ?? [])

    assert.equal(rows.length, 0, 'invoice_number_counters still exists')
  })
})
