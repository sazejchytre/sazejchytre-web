import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_plans_features" AS ENUM('TIPS_REALTIME', 'TIPS_ALL_SPORTS', 'FULL_RATIONALE', 'VALUE_RATING', 'PUSH_NOTIFICATIONS', 'ARCHIVE_EXPORT', 'API_ACCESS', 'EARLY_ACCESS');
  CREATE TYPE "public"."enum_plans_code" AS ENUM('START', 'PRO', 'INSIDER');
  CREATE TYPE "public"."enum_prices_currency" AS ENUM('CZK', 'EUR');
  CREATE TYPE "public"."enum_prices_interval" AS ENUM('MONTH', 'YEAR');
  CREATE TYPE "public"."enum_customers_preferred_locale" AS ENUM('cs', 'sk', 'en');
  CREATE TYPE "public"."enum_customers_currency" AS ENUM('CZK', 'EUR');
  CREATE TYPE "public"."enum_billing_provider_refs_provider" AS ENUM('STRIPE');
  CREATE TYPE "public"."enum_subscriptions_currency" AS ENUM('CZK', 'EUR');
  CREATE TYPE "public"."enum_subscriptions_interval" AS ENUM('MONTH', 'YEAR');
  CREATE TYPE "public"."enum_subscriptions_status" AS ENUM('INCOMPLETE', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED');
  CREATE TYPE "public"."enum_subscriptions_provider" AS ENUM('STRIPE');
  CREATE TYPE "public"."enum_subscription_events_type" AS ENUM('CREATED', 'ACTIVATED', 'RENEWED', 'PAYMENT_FAILED', 'PAYMENT_RECOVERED', 'CANCELLATION_SCHEDULED', 'CANCELLATION_REVOKED', 'CANCELED', 'EXPIRED', 'PLAN_CHANGED', 'PROVIDER_SYNC');
  CREATE TYPE "public"."enum_entitlement_grants_feature_key" AS ENUM('TIPS_REALTIME', 'TIPS_ALL_SPORTS', 'FULL_RATIONALE', 'VALUE_RATING', 'PUSH_NOTIFICATIONS', 'ARCHIVE_EXPORT', 'API_ACCESS', 'EARLY_ACCESS');
  CREATE TYPE "public"."enum_invoices_currency" AS ENUM('CZK', 'EUR');
  CREATE TYPE "public"."enum_invoices_tax_treatment" AS ENUM('NONE_NOT_VAT_REGISTERED', 'CZ_VAT_STANDARD', 'CZ_VAT_REDUCED', 'EU_OSS_B2C', 'EU_REVERSE_CHARGE_B2B', 'OUTSIDE_EU_NOT_SUBJECT');
  CREATE TYPE "public"."enum_invoices_status" AS ENUM('ISSUED', 'CREDITED');
  CREATE TYPE "public"."enum_credit_notes_currency" AS ENUM('CZK', 'EUR');
  CREATE TYPE "public"."enum_invoice_number_counters_series" AS ENUM('INVOICE', 'CREDIT_NOTE');
  CREATE TYPE "public"."enum_consent_records_type" AS ENUM('TERMS', 'PRIVACY', 'DIGITAL_CONTENT_WAIVER', 'MARKETING');
  CREATE TYPE "public"."enum_webhook_events_provider" AS ENUM('STRIPE');
  CREATE TABLE "plans_features" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum_plans_features",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "plans" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"code" "enum_plans_code" NOT NULL,
  	"name" varchar NOT NULL,
  	"description" varchar,
  	"sort_order" integer DEFAULT 0 NOT NULL,
  	"active" boolean DEFAULT true NOT NULL,
  	"provider_product_id" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "prices" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"plan_id" integer NOT NULL,
  	"currency" "enum_prices_currency" NOT NULL,
  	"interval" "enum_prices_interval" NOT NULL,
  	"amount_minor" integer NOT NULL,
  	"active" boolean DEFAULT true NOT NULL,
  	"valid_from" timestamp(3) with time zone NOT NULL,
  	"provider_price_id" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "customers" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"email" varchar NOT NULL,
  	"name" varchar NOT NULL,
  	"billing_country" varchar NOT NULL,
  	"preferred_locale" "enum_customers_preferred_locale" DEFAULT 'cs' NOT NULL,
  	"currency" "enum_customers_currency",
  	"auth_user_id" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "billing_provider_refs" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"customer_id" integer NOT NULL,
  	"provider" "enum_billing_provider_refs_provider" NOT NULL,
  	"external_id" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "subscriptions" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"customer_id" integer NOT NULL,
  	"plan_id" integer NOT NULL,
  	"currency" "enum_subscriptions_currency" NOT NULL,
  	"interval" "enum_subscriptions_interval" NOT NULL,
  	"price_minor" integer NOT NULL,
  	"status" "enum_subscriptions_status" DEFAULT 'INCOMPLETE' NOT NULL,
  	"current_period_start" timestamp(3) with time zone NOT NULL,
  	"current_period_end" timestamp(3) with time zone NOT NULL,
  	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
  	"canceled_at" timestamp(3) with time zone,
  	"ended_at" timestamp(3) with time zone,
  	"provider" "enum_subscriptions_provider" NOT NULL,
  	"provider_subscription_id" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "subscription_events" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"subscription_id" integer NOT NULL,
  	"type" "enum_subscription_events_type" NOT NULL,
  	"occurred_at" timestamp(3) with time zone NOT NULL,
  	"payload" jsonb,
  	"source_event_id" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "entitlement_grants" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"customer_id" integer NOT NULL,
  	"feature_key" "enum_entitlement_grants_feature_key",
  	"plan_id" integer,
  	"granted_by_id" integer NOT NULL,
  	"reason" varchar NOT NULL,
  	"starts_at" timestamp(3) with time zone NOT NULL,
  	"ends_at" timestamp(3) with time zone,
  	"revoked_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "invoices" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"number" varchar NOT NULL,
  	"number_year" integer NOT NULL,
  	"number_sequence" integer NOT NULL,
  	"customer_id" integer NOT NULL,
  	"subscription_id" integer NOT NULL,
  	"issued_at" timestamp(3) with time zone NOT NULL,
  	"taxable_supply_date" timestamp(3) with time zone NOT NULL,
  	"currency" "enum_invoices_currency" NOT NULL,
  	"subtotal_minor" integer NOT NULL,
  	"tax_minor" integer DEFAULT 0 NOT NULL,
  	"total_minor" integer NOT NULL,
  	"tax_treatment" "enum_invoices_tax_treatment" DEFAULT 'NONE_NOT_VAT_REGISTERED' NOT NULL,
  	"tax_rate_percent" integer DEFAULT 0 NOT NULL,
  	"pdf_storage_key" varchar,
  	"status" "enum_invoices_status" DEFAULT 'ISSUED' NOT NULL,
  	"billing_country" varchar,
  	"ip_country" varchar,
  	"card_country" varchar,
  	"operator_snapshot_legal_name" varchar NOT NULL,
  	"operator_snapshot_address" varchar NOT NULL,
  	"operator_snapshot_business_id" varchar NOT NULL,
  	"operator_snapshot_tax_id" varchar,
  	"operator_snapshot_vat_registered" boolean DEFAULT false NOT NULL,
  	"operator_snapshot_email" varchar,
  	"customer_snapshot_name" varchar NOT NULL,
  	"customer_snapshot_email" varchar NOT NULL,
  	"customer_snapshot_address" varchar,
  	"customer_snapshot_country" varchar NOT NULL,
  	"customer_snapshot_business_id" varchar,
  	"customer_snapshot_tax_id" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "credit_notes" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"number" varchar NOT NULL,
  	"number_year" integer NOT NULL,
  	"number_sequence" integer NOT NULL,
  	"invoice_id" integer NOT NULL,
  	"currency" "enum_credit_notes_currency" NOT NULL,
  	"amount_minor" integer NOT NULL,
  	"reason" varchar NOT NULL,
  	"issued_at" timestamp(3) with time zone NOT NULL,
  	"billing_country" varchar,
  	"pdf_storage_key" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "invoice_number_counters" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"series" "enum_invoice_number_counters_series" NOT NULL,
  	"year" integer NOT NULL,
  	"last_number" integer DEFAULT 0 NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "consent_records" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"customer_id" integer,
  	"type" "enum_consent_records_type" NOT NULL,
  	"document_version" varchar NOT NULL,
  	"consent_text_snapshot" varchar NOT NULL,
  	"granted_at" timestamp(3) with time zone NOT NULL,
  	"ip_address" varchar,
  	"user_agent" varchar,
  	"withdrawn_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "webhook_events" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"provider" "enum_webhook_events_provider" NOT NULL,
  	"external_event_id" varchar NOT NULL,
  	"type" varchar NOT NULL,
  	"received_at" timestamp(3) with time zone NOT NULL,
  	"processed_at" timestamp(3) with time zone,
  	"processing_error" varchar,
  	"raw_payload" jsonb NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "plans_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "prices_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "customers_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "billing_provider_refs_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "subscriptions_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "subscription_events_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "entitlement_grants_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "invoices_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "credit_notes_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "invoice_number_counters_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "consent_records_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "webhook_events_id" integer;
  ALTER TABLE "plans_features" ADD CONSTRAINT "plans_features_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "prices" ADD CONSTRAINT "prices_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "billing_provider_refs" ADD CONSTRAINT "billing_provider_refs_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "entitlement_grants" ADD CONSTRAINT "entitlement_grants_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "entitlement_grants" ADD CONSTRAINT "entitlement_grants_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "entitlement_grants" ADD CONSTRAINT "entitlement_grants_granted_by_id_users_id_fk" FOREIGN KEY ("granted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "plans_features_order_idx" ON "plans_features" USING btree ("order");
  CREATE INDEX "plans_features_parent_idx" ON "plans_features" USING btree ("parent_id");
  CREATE UNIQUE INDEX "plans_code_idx" ON "plans" USING btree ("code");
  CREATE INDEX "plans_updated_at_idx" ON "plans" USING btree ("updated_at");
  CREATE INDEX "plans_created_at_idx" ON "plans" USING btree ("created_at");
  CREATE INDEX "prices_plan_idx" ON "prices" USING btree ("plan_id");
  CREATE INDEX "prices_updated_at_idx" ON "prices" USING btree ("updated_at");
  CREATE INDEX "prices_created_at_idx" ON "prices" USING btree ("created_at");
  CREATE UNIQUE INDEX "prices_active_plan_currency_interval_key" ON "prices" USING btree ("plan_id","currency","interval") WHERE "prices"."active" = true;
  CREATE UNIQUE INDEX "customers_email_idx" ON "customers" USING btree ("email");
  CREATE INDEX "customers_billing_country_idx" ON "customers" USING btree ("billing_country");
  CREATE UNIQUE INDEX "customers_auth_user_id_idx" ON "customers" USING btree ("auth_user_id");
  CREATE INDEX "customers_updated_at_idx" ON "customers" USING btree ("updated_at");
  CREATE INDEX "customers_created_at_idx" ON "customers" USING btree ("created_at");
  CREATE INDEX "billing_provider_refs_customer_idx" ON "billing_provider_refs" USING btree ("customer_id");
  CREATE INDEX "billing_provider_refs_updated_at_idx" ON "billing_provider_refs" USING btree ("updated_at");
  CREATE INDEX "billing_provider_refs_created_at_idx" ON "billing_provider_refs" USING btree ("created_at");
  CREATE UNIQUE INDEX "provider_externalId_idx" ON "billing_provider_refs" USING btree ("provider","external_id");
  CREATE UNIQUE INDEX "provider_customer_idx" ON "billing_provider_refs" USING btree ("provider","customer_id");
  CREATE INDEX "subscriptions_customer_idx" ON "subscriptions" USING btree ("customer_id");
  CREATE INDEX "subscriptions_plan_idx" ON "subscriptions" USING btree ("plan_id");
  CREATE INDEX "subscriptions_status_idx" ON "subscriptions" USING btree ("status");
  CREATE INDEX "subscriptions_current_period_end_idx" ON "subscriptions" USING btree ("current_period_end");
  CREATE INDEX "subscriptions_updated_at_idx" ON "subscriptions" USING btree ("updated_at");
  CREATE INDEX "subscriptions_created_at_idx" ON "subscriptions" USING btree ("created_at");
  CREATE INDEX "customer_status_idx" ON "subscriptions" USING btree ("customer_id","status");
  CREATE UNIQUE INDEX "provider_providerSubscriptionId_idx" ON "subscriptions" USING btree ("provider","provider_subscription_id");
  CREATE INDEX "subscription_events_subscription_idx" ON "subscription_events" USING btree ("subscription_id");
  CREATE INDEX "subscription_events_occurred_at_idx" ON "subscription_events" USING btree ("occurred_at");
  CREATE INDEX "subscription_events_source_event_id_idx" ON "subscription_events" USING btree ("source_event_id");
  CREATE INDEX "subscription_events_updated_at_idx" ON "subscription_events" USING btree ("updated_at");
  CREATE INDEX "subscription_events_created_at_idx" ON "subscription_events" USING btree ("created_at");
  CREATE INDEX "subscription_occurredAt_idx" ON "subscription_events" USING btree ("subscription_id","occurred_at");
  CREATE INDEX "entitlement_grants_customer_idx" ON "entitlement_grants" USING btree ("customer_id");
  CREATE INDEX "entitlement_grants_plan_idx" ON "entitlement_grants" USING btree ("plan_id");
  CREATE INDEX "entitlement_grants_granted_by_idx" ON "entitlement_grants" USING btree ("granted_by_id");
  CREATE INDEX "entitlement_grants_updated_at_idx" ON "entitlement_grants" USING btree ("updated_at");
  CREATE INDEX "entitlement_grants_created_at_idx" ON "entitlement_grants" USING btree ("created_at");
  CREATE INDEX "customer_revokedAt_idx" ON "entitlement_grants" USING btree ("customer_id","revoked_at");
  CREATE UNIQUE INDEX "invoices_number_idx" ON "invoices" USING btree ("number");
  CREATE INDEX "invoices_customer_idx" ON "invoices" USING btree ("customer_id");
  CREATE INDEX "invoices_subscription_idx" ON "invoices" USING btree ("subscription_id");
  CREATE INDEX "invoices_issued_at_idx" ON "invoices" USING btree ("issued_at");
  CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("status");
  CREATE INDEX "invoices_billing_country_idx" ON "invoices" USING btree ("billing_country");
  CREATE INDEX "invoices_updated_at_idx" ON "invoices" USING btree ("updated_at");
  CREATE INDEX "invoices_created_at_idx" ON "invoices" USING btree ("created_at");
  CREATE UNIQUE INDEX "numberYear_numberSequence_idx" ON "invoices" USING btree ("number_year","number_sequence");
  CREATE INDEX "customer_issuedAt_idx" ON "invoices" USING btree ("customer_id","issued_at");
  CREATE INDEX "billingCountry_issuedAt_idx" ON "invoices" USING btree ("billing_country","issued_at");
  CREATE UNIQUE INDEX "credit_notes_number_idx" ON "credit_notes" USING btree ("number");
  CREATE INDEX "credit_notes_invoice_idx" ON "credit_notes" USING btree ("invoice_id");
  CREATE INDEX "credit_notes_issued_at_idx" ON "credit_notes" USING btree ("issued_at");
  CREATE INDEX "credit_notes_billing_country_idx" ON "credit_notes" USING btree ("billing_country");
  CREATE INDEX "credit_notes_updated_at_idx" ON "credit_notes" USING btree ("updated_at");
  CREATE INDEX "credit_notes_created_at_idx" ON "credit_notes" USING btree ("created_at");
  CREATE UNIQUE INDEX "numberYear_numberSequence_1_idx" ON "credit_notes" USING btree ("number_year","number_sequence");
  CREATE INDEX "invoice_idx" ON "credit_notes" USING btree ("invoice_id");
  CREATE INDEX "invoice_number_counters_updated_at_idx" ON "invoice_number_counters" USING btree ("updated_at");
  CREATE INDEX "invoice_number_counters_created_at_idx" ON "invoice_number_counters" USING btree ("created_at");
  CREATE UNIQUE INDEX "series_year_idx" ON "invoice_number_counters" USING btree ("series","year");
  CREATE INDEX "consent_records_customer_idx" ON "consent_records" USING btree ("customer_id");
  CREATE INDEX "consent_records_granted_at_idx" ON "consent_records" USING btree ("granted_at");
  CREATE INDEX "consent_records_updated_at_idx" ON "consent_records" USING btree ("updated_at");
  CREATE INDEX "consent_records_created_at_idx" ON "consent_records" USING btree ("created_at");
  CREATE INDEX "customer_type_idx" ON "consent_records" USING btree ("customer_id","type");
  CREATE INDEX "type_documentVersion_idx" ON "consent_records" USING btree ("type","document_version");
  CREATE UNIQUE INDEX "webhook_events_external_event_id_idx" ON "webhook_events" USING btree ("external_event_id");
  CREATE INDEX "webhook_events_received_at_idx" ON "webhook_events" USING btree ("received_at");
  CREATE INDEX "webhook_events_updated_at_idx" ON "webhook_events" USING btree ("updated_at");
  CREATE INDEX "webhook_events_created_at_idx" ON "webhook_events" USING btree ("created_at");
  CREATE INDEX "provider_type_idx" ON "webhook_events" USING btree ("provider","type");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_plans_fk" FOREIGN KEY ("plans_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_prices_fk" FOREIGN KEY ("prices_id") REFERENCES "public"."prices"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_customers_fk" FOREIGN KEY ("customers_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_billing_provider_refs_fk" FOREIGN KEY ("billing_provider_refs_id") REFERENCES "public"."billing_provider_refs"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_subscriptions_fk" FOREIGN KEY ("subscriptions_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_subscription_events_fk" FOREIGN KEY ("subscription_events_id") REFERENCES "public"."subscription_events"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_entitlement_grants_fk" FOREIGN KEY ("entitlement_grants_id") REFERENCES "public"."entitlement_grants"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_invoices_fk" FOREIGN KEY ("invoices_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_credit_notes_fk" FOREIGN KEY ("credit_notes_id") REFERENCES "public"."credit_notes"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_invoice_number_counters_fk" FOREIGN KEY ("invoice_number_counters_id") REFERENCES "public"."invoice_number_counters"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_consent_records_fk" FOREIGN KEY ("consent_records_id") REFERENCES "public"."consent_records"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_webhook_events_fk" FOREIGN KEY ("webhook_events_id") REFERENCES "public"."webhook_events"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_plans_id_idx" ON "payload_locked_documents_rels" USING btree ("plans_id");
  CREATE INDEX "payload_locked_documents_rels_prices_id_idx" ON "payload_locked_documents_rels" USING btree ("prices_id");
  CREATE INDEX "payload_locked_documents_rels_customers_id_idx" ON "payload_locked_documents_rels" USING btree ("customers_id");
  CREATE INDEX "payload_locked_documents_rels_billing_provider_refs_id_idx" ON "payload_locked_documents_rels" USING btree ("billing_provider_refs_id");
  CREATE INDEX "payload_locked_documents_rels_subscriptions_id_idx" ON "payload_locked_documents_rels" USING btree ("subscriptions_id");
  CREATE INDEX "payload_locked_documents_rels_subscription_events_id_idx" ON "payload_locked_documents_rels" USING btree ("subscription_events_id");
  CREATE INDEX "payload_locked_documents_rels_entitlement_grants_id_idx" ON "payload_locked_documents_rels" USING btree ("entitlement_grants_id");
  CREATE INDEX "payload_locked_documents_rels_invoices_id_idx" ON "payload_locked_documents_rels" USING btree ("invoices_id");
  CREATE INDEX "payload_locked_documents_rels_credit_notes_id_idx" ON "payload_locked_documents_rels" USING btree ("credit_notes_id");
  CREATE INDEX "payload_locked_documents_rels_invoice_number_counters_id_idx" ON "payload_locked_documents_rels" USING btree ("invoice_number_counters_id");
  CREATE INDEX "payload_locked_documents_rels_consent_records_id_idx" ON "payload_locked_documents_rels" USING btree ("consent_records_id");
  CREATE INDEX "payload_locked_documents_rels_webhook_events_id_idx" ON "payload_locked_documents_rels" USING btree ("webhook_events_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "plans_features" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "plans" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "prices" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "customers" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "billing_provider_refs" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "subscriptions" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "subscription_events" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "entitlement_grants" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "invoices" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "credit_notes" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "invoice_number_counters" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "consent_records" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "webhook_events" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "plans_features" CASCADE;
  DROP TABLE "plans" CASCADE;
  DROP TABLE "prices" CASCADE;
  DROP TABLE "customers" CASCADE;
  DROP TABLE "billing_provider_refs" CASCADE;
  DROP TABLE "subscriptions" CASCADE;
  DROP TABLE "subscription_events" CASCADE;
  DROP TABLE "entitlement_grants" CASCADE;
  DROP TABLE "invoices" CASCADE;
  DROP TABLE "credit_notes" CASCADE;
  DROP TABLE "invoice_number_counters" CASCADE;
  DROP TABLE "consent_records" CASCADE;
  DROP TABLE "webhook_events" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_plans_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_prices_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_customers_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_billing_provider_refs_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_subscriptions_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_subscription_events_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_entitlement_grants_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_invoices_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_credit_notes_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_invoice_number_counters_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_consent_records_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_webhook_events_fk";
  
  DROP INDEX "payload_locked_documents_rels_plans_id_idx";
  DROP INDEX "payload_locked_documents_rels_prices_id_idx";
  DROP INDEX "payload_locked_documents_rels_customers_id_idx";
  DROP INDEX "payload_locked_documents_rels_billing_provider_refs_id_idx";
  DROP INDEX "payload_locked_documents_rels_subscriptions_id_idx";
  DROP INDEX "payload_locked_documents_rels_subscription_events_id_idx";
  DROP INDEX "payload_locked_documents_rels_entitlement_grants_id_idx";
  DROP INDEX "payload_locked_documents_rels_invoices_id_idx";
  DROP INDEX "payload_locked_documents_rels_credit_notes_id_idx";
  DROP INDEX "payload_locked_documents_rels_invoice_number_counters_id_idx";
  DROP INDEX "payload_locked_documents_rels_consent_records_id_idx";
  DROP INDEX "payload_locked_documents_rels_webhook_events_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "plans_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "prices_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "customers_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "billing_provider_refs_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "subscriptions_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "subscription_events_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "entitlement_grants_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "invoices_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "credit_notes_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "invoice_number_counters_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "consent_records_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "webhook_events_id";
  DROP TYPE "public"."enum_plans_features";
  DROP TYPE "public"."enum_plans_code";
  DROP TYPE "public"."enum_prices_currency";
  DROP TYPE "public"."enum_prices_interval";
  DROP TYPE "public"."enum_customers_preferred_locale";
  DROP TYPE "public"."enum_customers_currency";
  DROP TYPE "public"."enum_billing_provider_refs_provider";
  DROP TYPE "public"."enum_subscriptions_currency";
  DROP TYPE "public"."enum_subscriptions_interval";
  DROP TYPE "public"."enum_subscriptions_status";
  DROP TYPE "public"."enum_subscriptions_provider";
  DROP TYPE "public"."enum_subscription_events_type";
  DROP TYPE "public"."enum_entitlement_grants_feature_key";
  DROP TYPE "public"."enum_invoices_currency";
  DROP TYPE "public"."enum_invoices_tax_treatment";
  DROP TYPE "public"."enum_invoices_status";
  DROP TYPE "public"."enum_credit_notes_currency";
  DROP TYPE "public"."enum_invoice_number_counters_series";
  DROP TYPE "public"."enum_consent_records_type";
  DROP TYPE "public"."enum_webhook_events_provider";`)
}
