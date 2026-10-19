import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Fakturoid becomes the system of record for accounting documents.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT THIS GIVES UP, AND WHY IT IS THE RIGHT TRADE
 *
 * Our own numbering goes. `invoices.number`, `number_year`,
 * `number_sequence`, the matching columns on `credit_notes`, and the
 * `invoice_number_counters` table that advanced them all disappear.
 *
 * The reason is not that the allocator was bad — it was correct, and its
 * concurrency test proved a contiguous, duplicate-free series. The reason is
 * that TWO numbering series inside one accounting year is not something an
 * accountant can reconcile, and Fakturoid is now where the documents live.
 * One series, owned by the system that issues the documents.
 *
 * That is also why this migration has to run before the first real invoice is
 * issued, and why it is safe to run now: nothing has been issued yet. Dropping
 * these columns is destructive — the numbers in them cannot be recovered — and
 * it is only acceptable because the rows that carry them are test fixtures. If
 * a real document had ever been issued under one of those numbers, this would
 * have to be a data migration instead, carrying the old numbers into
 * `fakturoid_number` and leaving the series visibly split.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THE NEW COLUMNS ARE NULLABLE WHEN `number` WAS NOT
 *
 * Because our row now exists before the document does, and that ordering is
 * the whole safety property of the design. A sale is recorded the moment money
 * arrives. The accounting document is created afterwards, at a third party
 * that can be unreachable, in maintenance, or throttling us. If the row
 * demanded a document number it could not be written during an outage, and
 * then a Fakturoid outage would mean either losing a payment or revoking an
 * entitlement a customer has already paid for.
 *
 * So `fakturoid_number` is nullable and `accounting_state` says how far the
 * document has got. PENDING is the ordinary resting state right after a sale,
 * not an error.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THE UNIQUE INDEXES STILL MATTER
 *
 * `fakturoid_document_id` and `fakturoid_number` are unique. In Postgres a
 * unique index permits any number of NULLs, so "not issued yet" rows do not
 * collide — but once a row names a document, no second row can name the same
 * one. That is the database-level half of the idempotency story: the adapter
 * adopts an existing document by `custom_id`, and this makes it impossible for
 * two of our rows to end up pointing at one statutory document even so.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  // ---------------------------------------------------------------- enums ---
  await db.execute(sql`
    CREATE TYPE "public"."enum_invoices_accounting_state"
      AS ENUM('PENDING', 'ISSUED', 'FAILED');
  `)
  await db.execute(sql`
    CREATE TYPE "public"."enum_credit_notes_accounting_state"
      AS ENUM('PENDING', 'ISSUED', 'FAILED');
  `)

  // ------------------------------------------------------------ customers ---
  // The customer as Fakturoid knows them, cached so issuing does not look it
  // up every time. Unique: two subjects for one customer would split their
  // documents across two provider records nothing joins back up.
  await db.execute(sql`
    ALTER TABLE "customers"
      ADD COLUMN "fakturoid_subject_id" varchar;
  `)
  await db.execute(sql`
    CREATE UNIQUE INDEX "customers_fakturoid_subject_id_idx"
      ON "customers" USING btree ("fakturoid_subject_id");
  `)

  // ------------------------------------------------------------- invoices ---
  await db.execute(sql`
    ALTER TABLE "invoices"
      ADD COLUMN "accounting_state" "public"."enum_invoices_accounting_state"
        DEFAULT 'PENDING' NOT NULL,
      ADD COLUMN "fakturoid_document_id" varchar,
      ADD COLUMN "fakturoid_number" varchar;
  `)

  // DROP COLUMN takes the indexes that depend on these with it, including the
  // composite unique index on (number_year, number_sequence) that enforced the
  // old series. Named explicitly in the DOWN so the rollback is honest.
  await db.execute(sql`
    ALTER TABLE "invoices"
      DROP COLUMN "number",
      DROP COLUMN "number_year",
      DROP COLUMN "number_sequence";
  `)

  await db.execute(sql`
    CREATE INDEX "invoices_accounting_state_idx"
      ON "invoices" USING btree ("accounting_state");
  `)
  await db.execute(sql`
    CREATE UNIQUE INDEX "invoices_fakturoid_document_id_idx"
      ON "invoices" USING btree ("fakturoid_document_id");
  `)
  await db.execute(sql`
    CREATE UNIQUE INDEX "invoices_fakturoid_number_idx"
      ON "invoices" USING btree ("fakturoid_number");
  `)
  // What the retry cron scans: the rows whose document is not issued yet,
  // oldest first.
  await db.execute(sql`
    CREATE INDEX "accountingState_issuedAt_idx"
      ON "invoices" USING btree ("accounting_state", "issued_at");
  `)

  // --------------------------------------------------------- credit notes ---
  await db.execute(sql`
    ALTER TABLE "credit_notes"
      ADD COLUMN "accounting_state" "public"."enum_credit_notes_accounting_state"
        DEFAULT 'PENDING' NOT NULL,
      ADD COLUMN "fakturoid_document_id" varchar,
      ADD COLUMN "fakturoid_number" varchar;
  `)
  await db.execute(sql`
    ALTER TABLE "credit_notes"
      DROP COLUMN "number",
      DROP COLUMN "number_year",
      DROP COLUMN "number_sequence";
  `)
  await db.execute(sql`
    CREATE INDEX "credit_notes_accounting_state_idx"
      ON "credit_notes" USING btree ("accounting_state");
  `)
  await db.execute(sql`
    CREATE UNIQUE INDEX "credit_notes_fakturoid_document_id_idx"
      ON "credit_notes" USING btree ("fakturoid_document_id");
  `)
  await db.execute(sql`
    CREATE UNIQUE INDEX "credit_notes_fakturoid_number_idx"
      ON "credit_notes" USING btree ("fakturoid_number");
  `)
  await db.execute(sql`
    CREATE INDEX "accountingState_issuedAt_1_idx"
      ON "credit_notes" USING btree ("accounting_state", "issued_at");
  `)

  // ------------------------------------------------ the counters are gone ---
  // The allocator and its table. Nothing reads them: `allocateDocumentNumber`
  // and its tests were removed in the same commit.
  await db.execute(sql`
    ALTER TABLE "payload_locked_documents_rels"
      DROP COLUMN IF EXISTS "invoice_number_counters_id";
  `)
  await db.execute(sql`DROP TABLE IF EXISTS "invoice_number_counters" CASCADE;`)
  await db.execute(
    sql`DROP TYPE IF EXISTS "public"."enum_invoice_number_counters_series";`,
  )
}

/**
 * Rolling back restores the SHAPE, not the data.
 *
 * The old numbers are gone the moment UP runs — a dropped column takes its
 * contents with it. So DOWN recreates the columns as NULLABLE even though they
 * were NOT NULL before, because filling them would mean inventing document
 * numbers, and inventing a number in a statutory series is worse than any
 * schema untidiness.
 *
 * Anyone genuinely rolling this back has to decide what the old series should
 * contain and write that themselves. This gets the schema back; it does not
 * pretend to get the accounting back.
 */
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    CREATE TYPE "public"."enum_invoice_number_counters_series"
      AS ENUM('INVOICE', 'CREDIT_NOTE');
  `)
  await db.execute(sql`
    CREATE TABLE "invoice_number_counters" (
      "id" serial PRIMARY KEY NOT NULL,
      "series" "public"."enum_invoice_number_counters_series" NOT NULL,
      "year" integer NOT NULL,
      "last_number" integer DEFAULT 0 NOT NULL,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
    );
  `)
  await db.execute(sql`
    CREATE UNIQUE INDEX "series_year_idx"
      ON "invoice_number_counters" USING btree ("series", "year");
  `)
  await db.execute(sql`
    CREATE INDEX "invoice_number_counters_updated_at_idx"
      ON "invoice_number_counters" USING btree ("updated_at");
  `)
  await db.execute(sql`
    CREATE INDEX "invoice_number_counters_created_at_idx"
      ON "invoice_number_counters" USING btree ("created_at");
  `)
  await db.execute(sql`
    ALTER TABLE "payload_locked_documents_rels"
      ADD COLUMN "invoice_number_counters_id" integer;
  `)
  await db.execute(sql`
    ALTER TABLE "payload_locked_documents_rels"
      ADD CONSTRAINT "payload_locked_documents_rels_invoice_number_counters_fk"
      FOREIGN KEY ("invoice_number_counters_id")
      REFERENCES "public"."invoice_number_counters"("id")
      ON DELETE cascade ON UPDATE no action;
  `)
  await db.execute(sql`
    CREATE INDEX "payload_locked_documents_rels_invoice_number_counters_id_idx"
      ON "payload_locked_documents_rels"
      USING btree ("invoice_number_counters_id");
  `)

  // Nullable on the way back. See the note above.
  await db.execute(sql`
    ALTER TABLE "invoices"
      ADD COLUMN "number" varchar,
      ADD COLUMN "number_year" integer,
      ADD COLUMN "number_sequence" integer;
  `)
  await db.execute(sql`
    CREATE UNIQUE INDEX "invoices_number_idx"
      ON "invoices" USING btree ("number");
  `)
  await db.execute(sql`
    CREATE UNIQUE INDEX "numberYear_numberSequence_idx"
      ON "invoices" USING btree ("number_year", "number_sequence");
  `)

  await db.execute(sql`
    ALTER TABLE "credit_notes"
      ADD COLUMN "number" varchar,
      ADD COLUMN "number_year" integer,
      ADD COLUMN "number_sequence" integer;
  `)
  await db.execute(sql`
    CREATE UNIQUE INDEX "credit_notes_number_idx"
      ON "credit_notes" USING btree ("number");
  `)
  await db.execute(sql`
    CREATE UNIQUE INDEX "numberYear_numberSequence_1_idx"
      ON "credit_notes" USING btree ("number_year", "number_sequence");
  `)

  await db.execute(sql`DROP INDEX IF EXISTS "accountingState_issuedAt_idx";`)
  await db.execute(sql`DROP INDEX IF EXISTS "accountingState_issuedAt_1_idx";`)
  await db.execute(
    sql`DROP INDEX IF EXISTS "customers_fakturoid_subject_id_idx";`,
  )

  await db.execute(sql`
    ALTER TABLE "customers" DROP COLUMN IF EXISTS "fakturoid_subject_id";
  `)
  await db.execute(sql`
    ALTER TABLE "invoices"
      DROP COLUMN IF EXISTS "accounting_state",
      DROP COLUMN IF EXISTS "fakturoid_document_id",
      DROP COLUMN IF EXISTS "fakturoid_number";
  `)
  await db.execute(sql`
    ALTER TABLE "credit_notes"
      DROP COLUMN IF EXISTS "accounting_state",
      DROP COLUMN IF EXISTS "fakturoid_document_id",
      DROP COLUMN IF EXISTS "fakturoid_number";
  `)

  await db.execute(
    sql`DROP TYPE IF EXISTS "public"."enum_invoices_accounting_state";`,
  )
  await db.execute(
    sql`DROP TYPE IF EXISTS "public"."enum_credit_notes_accounting_state";`,
  )
}
