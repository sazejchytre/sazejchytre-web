import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_legal_pages_page_slug" AS ENUM('obchodni-podminky', 'ochrana-osobnich-udaju', 'cookies', 'metodika');
  CREATE TYPE "public"."enum_site_settings_social_links_platform" AS ENUM('x', 'facebook', 'instagram', 'youtube', 'discord', 'telegram');
  CREATE TABLE "legal_pages" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"page_slug" "enum_legal_pages_page_slug" NOT NULL,
  	"title" varchar NOT NULL,
  	"version" varchar NOT NULL,
  	"effective_from" timestamp(3) with time zone,
  	"published" boolean DEFAULT false NOT NULL,
  	"summary" varchar,
  	"body" jsonb NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "faq_entries" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"question" varchar NOT NULL,
  	"answer" varchar NOT NULL,
  	"sort_order" integer DEFAULT 0 NOT NULL,
  	"published" boolean DEFAULT true NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "contact_submissions" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"email" varchar NOT NULL,
  	"subject" varchar NOT NULL,
  	"message" varchar NOT NULL,
  	"notified_at" timestamp(3) with time zone,
  	"notify_error" varchar,
  	"ip_prefix" varchar,
  	"turnstile_degraded" boolean DEFAULT false,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "site_settings_social_links" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"platform" "enum_site_settings_social_links_platform" NOT NULL,
  	"url" varchar NOT NULL
  );
  
  CREATE TABLE "site_settings" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"contact_email" varchar DEFAULT 'podpora@sazejchytre.cz' NOT NULL,
  	"notification_email" varchar,
  	"helpline_name" varchar DEFAULT 'Národní linka pro odvykání' NOT NULL,
  	"helpline_phone" varchar DEFAULT '800 350 000' NOT NULL,
  	"helpline_url" varchar DEFAULT 'https://www.narodnilinka.cz/',
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "legal_pages_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "faq_entries_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "contact_submissions_id" integer;
  ALTER TABLE "site_settings_social_links" ADD CONSTRAINT "site_settings_social_links_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."site_settings"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "legal_pages_page_slug_idx" ON "legal_pages" USING btree ("page_slug");
  CREATE INDEX "legal_pages_effective_from_idx" ON "legal_pages" USING btree ("effective_from");
  CREATE INDEX "legal_pages_published_idx" ON "legal_pages" USING btree ("published");
  CREATE INDEX "legal_pages_updated_at_idx" ON "legal_pages" USING btree ("updated_at");
  CREATE INDEX "legal_pages_created_at_idx" ON "legal_pages" USING btree ("created_at");
  CREATE UNIQUE INDEX "pageSlug_version_idx" ON "legal_pages" USING btree ("page_slug","version");
  CREATE INDEX "pageSlug_published_idx" ON "legal_pages" USING btree ("page_slug","published");
  CREATE INDEX "faq_entries_published_idx" ON "faq_entries" USING btree ("published");
  CREATE INDEX "faq_entries_updated_at_idx" ON "faq_entries" USING btree ("updated_at");
  CREATE INDEX "faq_entries_created_at_idx" ON "faq_entries" USING btree ("created_at");
  CREATE INDEX "published_sortOrder_idx" ON "faq_entries" USING btree ("published","sort_order");
  CREATE INDEX "contact_submissions_email_idx" ON "contact_submissions" USING btree ("email");
  CREATE INDEX "contact_submissions_turnstile_degraded_idx" ON "contact_submissions" USING btree ("turnstile_degraded");
  CREATE INDEX "contact_submissions_updated_at_idx" ON "contact_submissions" USING btree ("updated_at");
  CREATE INDEX "contact_submissions_created_at_idx" ON "contact_submissions" USING btree ("created_at");
  CREATE INDEX "notifiedAt_idx" ON "contact_submissions" USING btree ("notified_at");
  CREATE INDEX "site_settings_social_links_order_idx" ON "site_settings_social_links" USING btree ("_order");
  CREATE INDEX "site_settings_social_links_parent_id_idx" ON "site_settings_social_links" USING btree ("_parent_id");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_legal_pages_fk" FOREIGN KEY ("legal_pages_id") REFERENCES "public"."legal_pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_faq_entries_fk" FOREIGN KEY ("faq_entries_id") REFERENCES "public"."faq_entries"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_contact_submissions_fk" FOREIGN KEY ("contact_submissions_id") REFERENCES "public"."contact_submissions"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_legal_pages_id_idx" ON "payload_locked_documents_rels" USING btree ("legal_pages_id");
  CREATE INDEX "payload_locked_documents_rels_faq_entries_id_idx" ON "payload_locked_documents_rels" USING btree ("faq_entries_id");
  CREATE INDEX "payload_locked_documents_rels_contact_submissions_id_idx" ON "payload_locked_documents_rels" USING btree ("contact_submissions_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "legal_pages" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "faq_entries" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "contact_submissions" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "site_settings_social_links" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "site_settings" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "legal_pages" CASCADE;
  DROP TABLE "faq_entries" CASCADE;
  DROP TABLE "contact_submissions" CASCADE;
  DROP TABLE "site_settings_social_links" CASCADE;
  DROP TABLE "site_settings" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_legal_pages_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_faq_entries_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_contact_submissions_fk";
  
  DROP INDEX "payload_locked_documents_rels_legal_pages_id_idx";
  DROP INDEX "payload_locked_documents_rels_faq_entries_id_idx";
  DROP INDEX "payload_locked_documents_rels_contact_submissions_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "legal_pages_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "faq_entries_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "contact_submissions_id";
  DROP TYPE "public"."enum_legal_pages_page_slug";
  DROP TYPE "public"."enum_site_settings_social_links_platform";`)
}
