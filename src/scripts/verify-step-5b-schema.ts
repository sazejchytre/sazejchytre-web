/**
 * Verify the step 5b schema against Neon itself.
 *
 * Migration output says what Payload believes it ran. This asks the database
 * what is actually there — same reason every earlier step has one of these.
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
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(56)} ${detail}`)
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
console.log('Step 5b schema verification (information_schema, live)')
console.log('')

/* --- 1. Snapshot columns, and that they are NOT NULL ---------------------- */

const columns = await rowsOf(sql`
  SELECT table_name, column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name IN ('invoices', 'credit_notes')
  ORDER BY table_name, column_name
`)

const column = (table: string, name: string) =>
  columns.find((row) => row.table_name === table && row.column_name === name)

for (const name of [
  'service_snapshot_plan_name',
  'service_snapshot_description',
  'service_snapshot_period_start',
  'service_snapshot_period_end',
  'payment_snapshot_method',
  'payment_snapshot_paid_at',
]) {
  const found = column('invoices', name)
  check(
    `invoices.${name} exists and is NOT NULL`,
    Boolean(found) && found?.is_nullable === 'NO',
    `${String(found?.data_type ?? 'missing')} / nullable=${String(found?.is_nullable ?? '?')}`,
  )
}

// The card tail is optional (a non-card payment has none) but must exist.
for (const name of [
  'payment_snapshot_card_brand',
  'payment_snapshot_card_last4',
]) {
  check(
    `invoices.${name} exists and is nullable`,
    column('invoices', name)?.is_nullable === 'YES',
    'optional by design',
  )
}

/* --- 2. Delivery state on both document tables --------------------------- */

for (const table of ['invoices', 'credit_notes']) {
  check(
    `${table}.delivery_state is NOT NULL`,
    column(table, 'delivery_state')?.is_nullable === 'NO',
    String(column(table, 'delivery_state')?.data_type ?? 'missing'),
  )

  const attempts = column(table, 'delivery_attempts')
  check(
    `${table}.delivery_attempts is integer, not numeric`,
    attempts?.data_type === 'integer',
    String(attempts?.data_type ?? 'missing'),
  )
}

/* --- 3. One payment, one invoice ----------------------------------------- */

const indexes = await rowsOf(sql`
  SELECT indexname, indexdef
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename IN ('invoices', 'credit_notes')
`)

const indexDef = (name: string): string =>
  String(indexes.find((row) => row.indexname === name)?.indexdef ?? '')

const paymentIndex = indexDef('invoices_provider_payment_id_idx')
check(
  'invoices.provider_payment_id is UNIQUE',
  paymentIndex.includes('UNIQUE'),
  // This index IS the idempotency guarantee: the application read-then-write
  // has a window that two concurrent deliveries can both pass.
  paymentIndex ? 'enforces one invoice per payment' : 'MISSING',
)

check(
  'credit_notes.provider_refund_id is UNIQUE',
  indexDef('credit_notes_provider_refund_id_idx').includes('UNIQUE'),
  'one credit note per provider refund',
)

/* --- 4. The over-credit trigger ------------------------------------------ */

const triggers = await rowsOf(sql`
  SELECT tgname, pg_get_triggerdef(oid) AS def
  FROM pg_trigger
  WHERE NOT tgisinternal
    AND tgrelid = 'public.credit_notes'::regclass
`)

const overCredit = triggers.find(
  (row) => row.tgname === 'credit_notes_total_within_invoice',
)

check(
  'credit_notes over-credit trigger exists',
  Boolean(overCredit),
  overCredit ? 'BEFORE INSERT OR UPDATE' : 'MISSING',
)
check(
  'the trigger fires on UPDATE as well as INSERT',
  String(overCredit?.def ?? '').includes('UPDATE'),
  // An update that raises an amount is as capable of over-crediting as an
  // insert.
  'an amount can also be raised by an update',
)

/* --- 5. Enum values the code writes ------------------------------------- */

const enumValues = await rowsOf(sql`
  SELECT t.typname AS enum_name, e.enumlabel AS value
  FROM pg_type t
  JOIN pg_enum e ON e.enumtypid = t.oid
  WHERE t.typname IN (
    'enum_invoices_delivery_state',
    'enum_credit_notes_delivery_state'
  )
  ORDER BY t.typname, e.enumsortorder
`)

for (const name of [
  'enum_invoices_delivery_state',
  'enum_credit_notes_delivery_state',
]) {
  const values = enumValues
    .filter((row) => row.enum_name === name)
    .map((row) => String(row.value))

  check(
    `${name} has PENDING/SENT/FAILED`,
    ['PENDING', 'SENT', 'FAILED'].every((value) => values.includes(value)),
    values.join(', ') || 'missing',
  )
}

/* --- 6. Numbering is untouched by this step ------------------------------- */

const counters = await rowsOf(sql`
  SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'invoice_number_counters'
  ORDER BY column_name
`)

check(
  'invoice_number_counters still has year and last_number',
  ['year', 'last_number'].every((name) =>
    counters.some((row) => row.column_name === name),
  ),
  // Step 5b deliberately changed nothing about numbering.
  counters.map((row) => String(row.column_name)).join(', '),
)

/* --- Summary -------------------------------------------------------------- */

console.log('')

if (failures > 0) {
  console.error(`  ${String(failures)} check(s) FAILED`)
  process.exit(1)
}

console.log('  all checks passed')
console.log('')
process.exit(0)
