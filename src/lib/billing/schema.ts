/**
 * Postgres schema overrides for the billing domain.
 *
 * Three things Payload's field types cannot express on their own are applied
 * here, through the adapter's `afterSchemaInit`.
 *
 * SCOPE NOTE: this file is named for the billing model, where the integer rule
 * started, but the hook is the single `afterSchemaInit` for the whole schema.
 * The tips columns are here too, for the same reason and under the same rule —
 * a published ROI computed from `numeric` odds would not be reproducible. All of them end up in the
 * generated migration, so the schema stays single-source — nothing is
 * hand-patched into SQL after the fact.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * 1. MONEY IS AN INTEGER COLUMN
 *
 * Payload maps `type: 'number'` to Postgres `numeric`. `numeric` is an
 * arbitrary-precision DECIMAL type, so the house rule — money is an integer
 * count of minor units, never a float and never a decimal — would be violated
 * by the database itself, whatever the application layer does. `numeric`
 * accepts `34900.5`, and node-postgres hands some numerics back as strings,
 * which is how a "price" ends up being string-concatenated somewhere.
 *
 * So every money column is redefined as `integer`. `extendTable` replaces a
 * column of the same name outright, which is what makes this possible without
 * forking the adapter.
 *
 * The ceiling is deliberate: `integer` tops out at 2 147 483 647 minor units,
 * i.e. ~21.4 million CZK on a single row. That is far beyond any plausible
 * subscription invoice, and `isValidMinorAmount` rejects anything larger
 * before it reaches the database. `bigint` was rejected because drizzle
 * surfaces it as a string or a BigInt, neither of which Payload's number field
 * round-trips cleanly.
 *
 * Non-money integers (`sortOrder`, the year/sequence pair,
 * `taxRateBasisPoints`)
 * are converted too: they are counts, and a decimal column for a count invites
 * the same class of bug.
 *
 * NOT CONVERTED: `users.login_attempts`, `media.filesize/width/height` and
 * `payload_migrations.batch`. Those are Payload's own columns from step 1, are
 * not money, and rewriting them would mean a migration that alters tables this
 * step has no business touching.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * 2. ONE ACTIVE PRICE PER PLAN + CURRENCY + INTERVAL
 *
 * A plain unique index cannot say this, because superseded prices are kept
 * forever — (plan, currency, interval) legitimately repeats across inactive
 * rows. A PARTIAL unique index says exactly the right thing:
 *
 *     UNIQUE (plan_id, currency, interval) WHERE active
 *
 * This is the real guarantee behind the invariant. It holds under concurrent
 * writes, against a direct psql session, and against any future code path that
 * does not go through the Payload hook. The hook in `Prices.ts` only turns the
 * resulting error into a readable sentence.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * 3. CHECK CONSTRAINTS FOR THE ARITHMETIC AND SHAPE INVARIANTS
 *
 * These were hook-only until now. A hook protects whatever goes through
 * Payload; it does nothing about a migration, a support script, a `psql`
 * session or a future service that writes the table directly. For invariants
 * that are pure functions of one row, a CHECK says the same thing to everyone
 * who can reach the database.
 *
 * The hooks are KEPT alongside them. The division of labour is:
 *   - the CHECK is the guarantee,
 *   - the hook is the error message. A raw constraint violation tells the
 *     caller "23514 invoices_totals_add_up_check"; the hook tells them which
 *     two numbers disagree and by how much.
 *
 * Only row-local invariants are here. Immutability, append-only and the
 * currency lock all need to compare against another row or a previous version,
 * which a CHECK cannot do — those stay hooks and are still documented as such.
 */
// Imported through Payload's drizzle proxy rather than from `drizzle-orm`
// directly. drizzle-orm is a transitive dependency, so a direct import is not
// resolvable under strict pnpm — and adding our own copy would be worse than
// unresolvable: two drizzle instances break the identity checks drizzle uses
// internally, and the column builders would belong to a different module than
// the schema they are patched into.
import type { PostgresAdapterArgs } from '@payloadcms/db-postgres'
import { sql } from '@payloadcms/db-postgres/drizzle'
import {
  check,
  integer,
  uniqueIndex,
} from '@payloadcms/db-postgres/drizzle/pg-core'

/**
 * The adapter's hook type, reached through `PostgresAdapterArgs`.
 *
 * `PostgresSchemaHook` itself lives in `@payloadcms/drizzle`, a transitive
 * dependency that strict pnpm does not expose at the project root — so it
 * cannot be imported even as a type. Indexing the adapter's own public args
 * type gets us the same thing from a package we do depend on.
 */
type SchemaHook = NonNullable<PostgresAdapterArgs['afterSchemaInit']>[number]

/** The parts of the hook payload this module actually uses. */
type BillingSchemaHookArgs = {
  extendTable: (args: {
    table: unknown
    columns?: Record<string, unknown>
    extraConfig?: (table: Record<string, unknown>) => Record<string, unknown>
  }) => void
  schema: { tables: Record<string, unknown> }
}

/**
 * Money and counter columns to redefine, as
 * `table -> { drizzleProperty: [sqlColumnName, notNull, default] }`.
 *
 * Keyed on the generated names, which are verified by `assertTable` below:
 * a typo must fail the boot loudly rather than silently leave a `numeric`
 * column in place.
 */
const INTEGER_COLUMNS: Record<
  string,
  Record<string, { column: string; notNull: boolean; default?: number }>
> = {
  plans: {
    sortOrder: { column: 'sort_order', notNull: true, default: 0 },
  },
  prices: {
    amountMinor: { column: 'amount_minor', notNull: true },
  },
  subscriptions: {
    priceMinor: { column: 'price_minor', notNull: true },
  },
  invoices: {
    numberYear: { column: 'number_year', notNull: true },
    numberSequence: { column: 'number_sequence', notNull: true },
    // A count, not a measurement.
    deliveryAttempts: {
      column: 'delivery_attempts',
      notNull: true,
      default: 0,
    },
    subtotalMinor: { column: 'subtotal_minor', notNull: true },
    taxMinor: { column: 'tax_minor', notNull: true, default: 0 },
    totalMinor: { column: 'total_minor', notNull: true },
    taxRateBasisPoints: {
      column: 'tax_rate_basis_points',
      notNull: true,
      default: 0,
    },
  },
  credit_notes: {
    numberYear: { column: 'number_year', notNull: true },
    numberSequence: { column: 'number_sequence', notNull: true },
    amountMinor: { column: 'amount_minor', notNull: true },
    deliveryAttempts: {
      column: 'delivery_attempts',
      notNull: true,
      default: 0,
    },
  },
  disputes: {
    amountMinor: { column: 'amount_minor', notNull: true },
  },
  invoice_number_counters: {
    year: { column: 'year', notNull: true },
    lastNumber: { column: 'last_number', notNull: true, default: 0 },
  },
  // Not billing, but the same rule: a count has no business being a decimal.
  auth_lockouts: {
    failures: { column: 'failures', notNull: true },
    lockSeconds: { column: 'lock_seconds', notNull: true },
  },

  /* --- Tips and the track record ---------------------------------------- */
  // These matter for exactly the reason the money columns do: the published
  // ROI is computed from them. `numeric` would let 2.1 into an odds column,
  // and 2.1 has no exact binary representation — so a few hundred of them
  // summed in a different order would give a different last digit, and the
  // track record would stop being reproducible.
  sports: {
    sortOrder: { column: 'sort_order', notNull: true, default: 0 },
  },
  tips: {
    stakeUnits: { column: 'stake_units', notNull: true, default: 1 },
    // Nullable: confidence is optional and presentational.
    confidence: { column: 'confidence', notNull: false },
  },
  tip_selections: {
    // Hundredths. Nullable — many markets have no line.
    line: { column: 'line', notNull: false },
    // Thousandths. The two prices the claim is made at.
    oddsAtPublication: { column: 'odds_at_publication', notNull: true },
    minimumOdds: { column: 'minimum_odds', notNull: true },
    // Thousandths, nullable until recorded at kick-off.
    closingOdds: { column: 'closing_odds', notNull: false },
  },
}

const assertTable = (
  schema: BillingSchemaHookArgs['schema'],
  name: string,
): unknown => {
  const table = schema.tables[name]

  if (!table) {
    throw new Error(
      `Billing schema override expected a table named "${name}" but it is not in the Payload schema. ` +
        `Available: ${Object.keys(schema.tables).sort().join(', ')}. ` +
        'A renamed collection slug must be reflected in src/lib/billing/schema.ts, ' +
        'otherwise money columns silently stay `numeric`.',
    )
  }

  return table
}

/**
 * Apply the billing schema overrides.
 *
 * Wired as `afterSchemaInit` on the postgres adapter in payload.config.ts.
 */
export const applyBillingSchemaOverrides: SchemaHook = (hookArgs) => {
  // One narrow cast at the boundary. The structural contract is stated by
  // BillingSchemaHookArgs above, and `assertTable` turns any drift in table
  // naming into a boot-time failure rather than a silently skipped override.
  const { extendTable, schema } = hookArgs as unknown as BillingSchemaHookArgs

  /* --- 1. integer money / counter columns -------------------------------- */
  for (const [tableName, columns] of Object.entries(INTEGER_COLUMNS)) {
    const table = assertTable(schema, tableName)

    const rebuilt: Record<string, unknown> = {}

    for (const [property, spec] of Object.entries(columns)) {
      // Chained in the same order the generated schema uses (notNull, then
      // default), so the emitted DDL differs only in the column type.
      const base = integer(spec.column)
      const withNotNull = spec.notNull ? base.notNull() : base

      rebuilt[property] =
        spec.default === undefined
          ? withNotNull
          : withNotNull.default(spec.default)
    }

    extendTable({ table, columns: rebuilt })
  }

  /* --- 2. one active price per plan + currency + interval ---------------- */
  extendTable({
    table: assertTable(schema, 'prices'),
    extraConfig: (table) => ({
      pricesOneActivePerPlanCurrencyInterval: uniqueIndex(
        'prices_active_plan_currency_interval_key',
      )
        .on(
          table.plan as never,
          table.currency as never,
          table.interval as never,
        )
        // Partial: superseded prices keep their (plan, currency, interval)
        // triple, so only live rows are constrained.
        .where(sql`${table.active} = true`),
    }),
  })

  /* --- 3. row-local invariants as CHECK constraints ---------------------- */

  // Invoice arithmetic. An invoice whose parts do not sum to its total is a
  // document that contradicts itself, and it is the kind of error that is only
  // noticed by an accountant months later.
  extendTable({
    table: assertTable(schema, 'invoices'),
    extraConfig: (table) => ({
      invoiceTotalsAddUp: check(
        'invoices_totals_add_up',
        sql`${table.subtotalMinor} + ${table.taxMinor} = ${table.totalMinor}`,
      ),
      // The operator is not VAT registered, so a non-zero tax under this
      // treatment would be an invoice claiming to charge VAT that cannot
      // legally be charged.
      invoiceNoVatWhenNotRegistered: check(
        'invoices_no_vat_when_not_registered',
        sql`${table.taxTreatment} <> 'NONE_NOT_VAT_REGISTERED'
            OR (${table.taxMinor} = 0 AND ${table.taxRateBasisPoints} = 0)`,
      ),
    }),
  })

  // A grant must name exactly one target. `<>` on two IS NULL tests is XOR:
  // true only when precisely one side is null. Neither grants nothing; both
  // makes it ambiguous which applies.
  extendTable({
    table: assertTable(schema, 'entitlement_grants'),
    extraConfig: (table) => ({
      grantExactlyOneTarget: check(
        'entitlement_grants_exactly_one_target',
        sql`(${table.featureKey} IS NULL) <> (${table.plan} IS NULL)`,
      ),
      // Window sanity. NULL ends_at means open-ended and is allowed; a CHECK
      // evaluating to NULL passes, which is the behaviour we want here.
      grantWindowOrdered: check(
        'entitlement_grants_window_ordered',
        sql`${table.endsAt} IS NULL OR ${table.endsAt} >= ${table.startsAt}`,
      ),
    }),
  })

  // The same window rule wherever a start/end pair exists.
  extendTable({
    table: assertTable(schema, 'subscriptions'),
    extraConfig: (table) => ({
      subscriptionPeriodOrdered: check(
        'subscriptions_period_ordered',
        sql`${table.currentPeriodEnd} >= ${table.currentPeriodStart}`,
      ),
    }),
  })

  extendTable({
    table: assertTable(schema, 'consent_records'),
    extraConfig: (table) => ({
      consentWithdrawalOrdered: check(
        'consent_records_withdrawal_ordered',
        sql`${table.withdrawnAt} IS NULL OR ${table.withdrawnAt} >= ${table.grantedAt}`,
      ),
    }),
  })

  return hookArgs.schema
}
