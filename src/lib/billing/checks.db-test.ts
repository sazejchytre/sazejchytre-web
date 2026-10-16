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

import { allocateDocumentNumber } from '@/lib/billing/document-number'
import config from '@/payload.config'

const RUN = `chk-${Date.now()}`
/** A year no real document will ever use, so the real series stay untouched. */
/**
 * One year per test file — these run in parallel and teardown deletes by
 * year. See the note in refunds.db-test.ts for what sharing one costs.
 */
const TEST_YEAR = 2098

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
  await db().execute(
    sql`DELETE FROM "invoices" WHERE "number_year" = ${TEST_YEAR}`,
  )
  await db().execute(
    sql`DELETE FROM "invoice_number_counters" WHERE "year" = ${TEST_YEAR}`,
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

/* -------------------------------------------------------------------------- */
/* Invoice arithmetic and tax treatment                                       */
/* -------------------------------------------------------------------------- */

/** Minimal raw invoice insert. `overrides` replaces any column expression. */
const rawInvoice = async (
  customerId: number,
  overrides: Record<string, string> = {},
): Promise<unknown> => {
  const allocated = await allocateDocumentNumber({
    payload,
    series: 'INVOICE',
    year: TEST_YEAR,
  })

  const columns: Record<string, string> = {
    number: `'${allocated.number}'`,
    number_year: String(allocated.year),
    number_sequence: String(allocated.sequence),
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
    const allocated = await allocateDocumentNumber({
      payload,
      series: 'INVOICE',
      year: TEST_YEAR,
    })

    const doc = await payload.create({
      collection: 'invoices',
      data: {
        deliveryState: 'PENDING',
        deliveryAttempts: 0,
        number: allocated.number,
        numberYear: allocated.year,
        numberSequence: allocated.sequence,
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
