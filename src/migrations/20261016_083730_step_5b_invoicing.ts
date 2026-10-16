import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_invoices_delivery_state" AS ENUM('PENDING', 'SENT', 'FAILED');
  CREATE TYPE "public"."enum_credit_notes_delivery_state" AS ENUM('PENDING', 'SENT', 'FAILED');
  DROP INDEX "invoices_provider_payment_id_idx";
  ALTER TABLE "invoices" ADD COLUMN "delivery_state" "enum_invoices_delivery_state" DEFAULT 'PENDING' NOT NULL;
  ALTER TABLE "invoices" ADD COLUMN "delivered_at" timestamp(3) with time zone;
  ALTER TABLE "invoices" ADD COLUMN "delivery_attempts" integer DEFAULT 0 NOT NULL;
  ALTER TABLE "invoices" ADD COLUMN "delivery_error" varchar;
  ALTER TABLE "invoices" ADD COLUMN "service_snapshot_plan_name" varchar NOT NULL;
  ALTER TABLE "invoices" ADD COLUMN "service_snapshot_description" varchar NOT NULL;
  ALTER TABLE "invoices" ADD COLUMN "service_snapshot_period_start" timestamp(3) with time zone NOT NULL;
  ALTER TABLE "invoices" ADD COLUMN "service_snapshot_period_end" timestamp(3) with time zone NOT NULL;
  ALTER TABLE "invoices" ADD COLUMN "payment_snapshot_method" varchar NOT NULL;
  ALTER TABLE "invoices" ADD COLUMN "payment_snapshot_paid_at" timestamp(3) with time zone NOT NULL;
  ALTER TABLE "invoices" ADD COLUMN "payment_snapshot_card_brand" varchar;
  ALTER TABLE "invoices" ADD COLUMN "payment_snapshot_card_last4" varchar;
  ALTER TABLE "credit_notes" ADD COLUMN "delivery_state" "enum_credit_notes_delivery_state" DEFAULT 'PENDING' NOT NULL;
  ALTER TABLE "credit_notes" ADD COLUMN "delivered_at" timestamp(3) with time zone;
  ALTER TABLE "credit_notes" ADD COLUMN "delivery_attempts" integer DEFAULT 0 NOT NULL;
  ALTER TABLE "credit_notes" ADD COLUMN "delivery_error" varchar;
  CREATE INDEX "invoices_delivery_state_idx" ON "invoices" USING btree ("delivery_state");
  CREATE INDEX "credit_notes_delivery_state_idx" ON "credit_notes" USING btree ("delivery_state");
  CREATE UNIQUE INDEX "invoices_provider_payment_id_idx" ON "invoices" USING btree ("provider_payment_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "invoices_delivery_state_idx";
  DROP INDEX "credit_notes_delivery_state_idx";
  DROP INDEX "invoices_provider_payment_id_idx";
  CREATE INDEX "invoices_provider_payment_id_idx" ON "invoices" USING btree ("provider_payment_id");
  ALTER TABLE "invoices" DROP COLUMN "delivery_state";
  ALTER TABLE "invoices" DROP COLUMN "delivered_at";
  ALTER TABLE "invoices" DROP COLUMN "delivery_attempts";
  ALTER TABLE "invoices" DROP COLUMN "delivery_error";
  ALTER TABLE "invoices" DROP COLUMN "service_snapshot_plan_name";
  ALTER TABLE "invoices" DROP COLUMN "service_snapshot_description";
  ALTER TABLE "invoices" DROP COLUMN "service_snapshot_period_start";
  ALTER TABLE "invoices" DROP COLUMN "service_snapshot_period_end";
  ALTER TABLE "invoices" DROP COLUMN "payment_snapshot_method";
  ALTER TABLE "invoices" DROP COLUMN "payment_snapshot_paid_at";
  ALTER TABLE "invoices" DROP COLUMN "payment_snapshot_card_brand";
  ALTER TABLE "invoices" DROP COLUMN "payment_snapshot_card_last4";
  ALTER TABLE "credit_notes" DROP COLUMN "delivery_state";
  ALTER TABLE "credit_notes" DROP COLUMN "delivered_at";
  ALTER TABLE "credit_notes" DROP COLUMN "delivery_attempts";
  ALTER TABLE "credit_notes" DROP COLUMN "delivery_error";
  DROP TYPE "public"."enum_invoices_delivery_state";
  DROP TYPE "public"."enum_credit_notes_delivery_state";`)
}
