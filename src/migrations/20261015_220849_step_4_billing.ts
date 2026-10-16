import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_disputes_status" AS ENUM('OPEN', 'UNDER_REVIEW', 'WON', 'LOST');
  CREATE TYPE "public"."enum_disputes_currency" AS ENUM('CZK', 'EUR');
  CREATE TYPE "public"."enum_disputes_provider" AS ENUM('STRIPE');
  ALTER TYPE "public"."enum_subscription_events_type" ADD VALUE 'REFUNDED';
  ALTER TYPE "public"."enum_subscription_events_type" ADD VALUE 'DISPUTE_OPENED';
  ALTER TYPE "public"."enum_subscription_events_type" ADD VALUE 'DISPUTE_RESOLVED';
  CREATE TABLE "disputes" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"customer_id" integer NOT NULL,
  	"subscription_id" integer,
  	"invoice_id" integer,
  	"status" "enum_disputes_status" DEFAULT 'OPEN' NOT NULL,
  	"reason" varchar NOT NULL,
  	"amount_minor" integer NOT NULL,
  	"currency" "enum_disputes_currency" NOT NULL,
  	"opened_at" timestamp(3) with time zone NOT NULL,
  	"evidence_due_at" timestamp(3) with time zone,
  	"resolved_at" timestamp(3) with time zone,
  	"provider" "enum_disputes_provider" NOT NULL,
  	"provider_dispute_id" varchar NOT NULL,
  	"provider_charge_id" varchar NOT NULL,
  	"notes" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "subscriptions" ADD COLUMN "provider_updated_at" timestamp(3) with time zone;
  ALTER TABLE "invoices" ADD COLUMN "provider_payment_id" varchar;
  ALTER TABLE "credit_notes" ADD COLUMN "provider_refund_id" varchar;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "disputes_id" integer;
  ALTER TABLE "disputes" ADD CONSTRAINT "disputes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "disputes" ADD CONSTRAINT "disputes_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "disputes" ADD CONSTRAINT "disputes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "disputes_customer_idx" ON "disputes" USING btree ("customer_id");
  CREATE INDEX "disputes_subscription_idx" ON "disputes" USING btree ("subscription_id");
  CREATE INDEX "disputes_invoice_idx" ON "disputes" USING btree ("invoice_id");
  CREATE INDEX "disputes_status_idx" ON "disputes" USING btree ("status");
  CREATE INDEX "disputes_opened_at_idx" ON "disputes" USING btree ("opened_at");
  CREATE INDEX "disputes_updated_at_idx" ON "disputes" USING btree ("updated_at");
  CREATE INDEX "disputes_created_at_idx" ON "disputes" USING btree ("created_at");
  CREATE UNIQUE INDEX "provider_providerDisputeId_idx" ON "disputes" USING btree ("provider","provider_dispute_id");
  CREATE INDEX "customer_status_1_idx" ON "disputes" USING btree ("customer_id","status");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_disputes_fk" FOREIGN KEY ("disputes_id") REFERENCES "public"."disputes"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "invoices_provider_payment_id_idx" ON "invoices" USING btree ("provider_payment_id");
  CREATE UNIQUE INDEX "credit_notes_provider_refund_id_idx" ON "credit_notes" USING btree ("provider_refund_id");
  CREATE INDEX "payload_locked_documents_rels_disputes_id_idx" ON "payload_locked_documents_rels" USING btree ("disputes_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "disputes" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "disputes" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_disputes_fk";
  
  ALTER TABLE "subscription_events" ALTER COLUMN "type" SET DATA TYPE text;
  DROP TYPE "public"."enum_subscription_events_type";
  CREATE TYPE "public"."enum_subscription_events_type" AS ENUM('CREATED', 'ACTIVATED', 'RENEWED', 'PAYMENT_FAILED', 'PAYMENT_RECOVERED', 'CANCELLATION_SCHEDULED', 'CANCELLATION_REVOKED', 'CANCELED', 'EXPIRED', 'PLAN_CHANGED', 'PROVIDER_SYNC');
  ALTER TABLE "subscription_events" ALTER COLUMN "type" SET DATA TYPE "public"."enum_subscription_events_type" USING "type"::"public"."enum_subscription_events_type";
  DROP INDEX "invoices_provider_payment_id_idx";
  DROP INDEX "credit_notes_provider_refund_id_idx";
  DROP INDEX "payload_locked_documents_rels_disputes_id_idx";
  ALTER TABLE "subscriptions" DROP COLUMN "provider_updated_at";
  ALTER TABLE "invoices" DROP COLUMN "provider_payment_id";
  ALTER TABLE "credit_notes" DROP COLUMN "provider_refund_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "disputes_id";
  DROP TYPE "public"."enum_disputes_status";
  DROP TYPE "public"."enum_disputes_currency";
  DROP TYPE "public"."enum_disputes_provider";`)
}
