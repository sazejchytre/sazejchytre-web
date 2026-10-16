/**
 * Verify the step 4 schema against Neon itself.
 *
 * Migration output says what Payload believes it ran. This asks the database
 * what is actually there — the same reason every earlier step has one of
 * these. A migration that reported success while leaving a money column as
 * `numeric` would be invisible until the first rounding complaint.
 */
/* eslint-disable no-console -- this is a CLI; stdout is its interface. */
import { getPayload } from 'payload'
import config from '@payload-config'
import { sql } from '@payloadcms/db-postgres/drizzle'

const payload = await getPayload({ config })
const db = payload.db.drizzle

let failures = 0

const check = (label: string, ok: boolean, detail: string): void => {
  if (!ok) failures += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(52)} ${detail}`)
}

const rowsOf = async (
  query: ReturnType<typeof sql>,
): Promise<Record<string, unknown>[]> => {
  const result = (await db.execute(query)) as unknown as {
    rows?: Record<string, unknown>[]
  }

  return result.rows ?? (result as unknown as Record<string, unknown>[])
}

console.log('')
console.log('Step 4 schema verification (information_schema, live)')
console.log('')

/* --- 1. New columns, with the right types --------------------------------- */

const columns = await rowsOf(sql`
  SELECT table_name, column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND (
      (table_name = 'subscriptions' AND column_name = 'provider_updated_at')
      OR (table_name = 'invoices' AND column_name = 'provider_payment_id')
      OR (table_name = 'credit_notes' AND column_name = 'provider_refund_id')
      OR (table_name = 'disputes' AND column_name = 'amount_minor')
    )
  ORDER BY table_name, column_name
`)

const column = (table: string, name: string) =>
  columns.find((row) => row.table_name === table && row.column_name === name)

const subSeq = column('subscriptions', 'provider_updated_at')
check(
  'subscriptions.provider_updated_at exists',
  Boolean(subSeq),
  String(subSeq?.data_type ?? 'missing'),
)
check(
  'subscriptions.provider_updated_at is a timestamptz',
  subSeq?.data_type === 'timestamp with time zone',
  String(subSeq?.data_type ?? 'missing'),
)
check(
  'subscriptions.provider_updated_at is nullable',
  subSeq?.is_nullable === 'YES',
  String(subSeq?.is_nullable ?? 'missing'),
)

const payRef = column('invoices', 'provider_payment_id')
check(
  'invoices.provider_payment_id exists',
  Boolean(payRef),
  String(payRef?.data_type ?? 'missing'),
)

const refundRef = column('credit_notes', 'provider_refund_id')
check(
  'credit_notes.provider_refund_id exists',
  Boolean(refundRef),
  String(refundRef?.data_type ?? 'missing'),
)

/* --- 2. The disputed amount is an INTEGER, not numeric -------------------- */

// The whole point of `afterSchemaInit`. Payload's `number` field type maps to
// `numeric` by default, and a numeric money column is how 599.00 becomes
// 598.99999999999997 somewhere down the line.
const amount = column('disputes', 'amount_minor')
check(
  'disputes.amount_minor is integer, not numeric',
  amount?.data_type === 'integer',
  String(amount?.data_type ?? 'missing'),
)

/* --- 3. Uniqueness that handlers rely on for idempotency ------------------ */

const indexes = await rowsOf(sql`
  SELECT indexname, indexdef
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename IN ('disputes', 'credit_notes', 'invoices')
  ORDER BY indexname
`)

const indexDef = (name: string): string =>
  String(indexes.find((row) => row.indexname === name)?.indexdef ?? '')

const disputeUnique = indexDef('provider_providerDisputeId_idx')
check(
  'disputes (provider, provider_dispute_id) is UNIQUE',
  disputeUnique.includes('UNIQUE'),
  disputeUnique ? 'present' : 'missing',
)

const refundUnique = indexDef('credit_notes_provider_refund_id_idx')
check(
  'credit_notes.provider_refund_id is UNIQUE',
  refundUnique.includes('UNIQUE'),
  refundUnique ? 'present' : 'missing',
)

check(
  'invoices.provider_payment_id is indexed',
  indexDef('invoices_provider_payment_id_idx').length > 0,
  'lookup from a refund or chargeback',
)

/* --- 4. Enum values the handlers write ----------------------------------- */

const enumValues = await rowsOf(sql`
  SELECT t.typname AS enum_name, e.enumlabel AS value
  FROM pg_type t
  JOIN pg_enum e ON e.enumtypid = t.oid
  WHERE t.typname IN ('enum_subscription_events_type', 'enum_disputes_status')
  ORDER BY t.typname, e.enumsortorder
`)

const valuesOf = (name: string): string[] =>
  enumValues
    .filter((row) => row.enum_name === name)
    .map((row) => String(row.value))

const eventTypes = valuesOf('enum_subscription_events_type')

for (const required of ['REFUNDED', 'DISPUTE_OPENED', 'DISPUTE_RESOLVED']) {
  check(
    `enum_subscription_events_type has ${required}`,
    eventTypes.includes(required),
    required,
  )
}

const disputeStatuses = valuesOf('enum_disputes_status')
check(
  'enum_disputes_status has all four states',
  ['OPEN', 'UNDER_REVIEW', 'WON', 'LOST'].every((value) =>
    disputeStatuses.includes(value),
  ),
  disputeStatuses.join(', '),
)

/* --- 5. The dispute row cannot be orphaned ------------------------------- */

const notNulls = await rowsOf(sql`
  SELECT column_name
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'disputes'
    AND is_nullable = 'NO'
  ORDER BY column_name
`)

const required = notNulls.map((row) => String(row.column_name))

for (const name of [
  'customer_id',
  'status',
  'reason',
  'amount_minor',
  'currency',
  'opened_at',
  'provider',
  'provider_dispute_id',
  'provider_charge_id',
]) {
  check(`disputes.${name} is NOT NULL`, required.includes(name), name)
}

/* --- Summary -------------------------------------------------------------- */

console.log('')

if (failures > 0) {
  console.error(`  ${String(failures)} check(s) FAILED`)
  process.exit(1)
}

console.log(`  all ${String(columns.length > 0 ? 'checks' : 'checks')} passed`)
console.log('')
process.exit(0)
