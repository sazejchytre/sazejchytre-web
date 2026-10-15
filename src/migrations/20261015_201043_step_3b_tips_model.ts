import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_sporting_events_status" AS ENUM('SCHEDULED', 'LIVE', 'FINISHED', 'POSTPONED', 'CANCELLED');
  CREATE TYPE "public"."enum_tips_status" AS ENUM('DRAFT', 'PUBLISHED', 'SETTLED', 'VOIDED');
  CREATE TYPE "public"."enum_tips_required_feature_key" AS ENUM('TIPS_REALTIME', 'TIPS_ALL_SPORTS', 'FULL_RATIONALE', 'VALUE_RATING', 'PUSH_NOTIFICATIONS', 'ARCHIVE_EXPORT', 'API_ACCESS', 'EARLY_ACCESS');
  CREATE TYPE "public"."enum_tip_selections_outcome" AS ENUM('PENDING', 'WON', 'LOST', 'VOID', 'HALF_WON', 'HALF_LOST');
  CREATE TYPE "public"."enum_tip_audit_events_type" AS ENUM('CREATED', 'PUBLISHED', 'SELECTION_SETTLED', 'SETTLED', 'VOIDED', 'CLOSING_ODDS_RECORDED', 'EDIT_REJECTED');
  CREATE TABLE "sports" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"code" varchar NOT NULL,
  	"name" varchar NOT NULL,
  	"active" boolean DEFAULT true NOT NULL,
  	"sort_order" integer DEFAULT 0 NOT NULL,
  	"seed_marker" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "competitions" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"sport_id" integer NOT NULL,
  	"name" varchar NOT NULL,
  	"country" varchar,
  	"external_refs" jsonb,
  	"seed_marker" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "sporting_events" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"competition_id" integer NOT NULL,
  	"home_name" varchar NOT NULL,
  	"away_name" varchar NOT NULL,
  	"starts_at" timestamp(3) with time zone NOT NULL,
  	"status" "enum_sporting_events_status" DEFAULT 'SCHEDULED' NOT NULL,
  	"final_score" jsonb,
  	"external_refs" jsonb,
  	"seed_marker" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "tips" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"slug" varchar NOT NULL,
  	"sport_id" integer NOT NULL,
  	"title" varchar NOT NULL,
  	"status" "enum_tips_status" DEFAULT 'DRAFT' NOT NULL,
  	"published_at" timestamp(3) with time zone,
  	"public_at" timestamp(3) with time zone,
  	"required_feature_key" "enum_tips_required_feature_key" DEFAULT 'TIPS_REALTIME' NOT NULL,
  	"stake_units" integer DEFAULT 1 NOT NULL,
  	"confidence" integer,
  	"rationale" jsonb,
  	"sources_summary" jsonb,
  	"settled_at" timestamp(3) with time zone,
  	"ingestion_external_id" varchar,
  	"seed_marker" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "tip_selections" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"tip_id" integer NOT NULL,
  	"sporting_event_id" integer NOT NULL,
  	"market" varchar NOT NULL,
  	"selection" varchar NOT NULL,
  	"line" integer,
  	"odds_at_publication" integer NOT NULL,
  	"minimum_odds" integer NOT NULL,
  	"closing_odds" integer,
  	"outcome" "enum_tip_selections_outcome" DEFAULT 'PENDING' NOT NULL,
  	"settled_at" timestamp(3) with time zone,
  	"seed_marker" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "tip_audit_events" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"tip_id" integer NOT NULL,
  	"type" "enum_tip_audit_events_type" NOT NULL,
  	"occurred_at" timestamp(3) with time zone NOT NULL,
  	"actor" varchar NOT NULL,
  	"before" jsonb,
  	"after" jsonb,
  	"note" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "sports_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "competitions_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "sporting_events_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "tips_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "tip_selections_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "tip_audit_events_id" integer;
  ALTER TABLE "competitions" ADD CONSTRAINT "competitions_sport_id_sports_id_fk" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sporting_events" ADD CONSTRAINT "sporting_events_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "tips" ADD CONSTRAINT "tips_sport_id_sports_id_fk" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "tip_selections" ADD CONSTRAINT "tip_selections_tip_id_tips_id_fk" FOREIGN KEY ("tip_id") REFERENCES "public"."tips"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "tip_selections" ADD CONSTRAINT "tip_selections_sporting_event_id_sporting_events_id_fk" FOREIGN KEY ("sporting_event_id") REFERENCES "public"."sporting_events"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "tip_audit_events" ADD CONSTRAINT "tip_audit_events_tip_id_tips_id_fk" FOREIGN KEY ("tip_id") REFERENCES "public"."tips"("id") ON DELETE set null ON UPDATE no action;
  CREATE UNIQUE INDEX "sports_code_idx" ON "sports" USING btree ("code");
  CREATE INDEX "sports_seed_marker_idx" ON "sports" USING btree ("seed_marker");
  CREATE INDEX "sports_updated_at_idx" ON "sports" USING btree ("updated_at");
  CREATE INDEX "sports_created_at_idx" ON "sports" USING btree ("created_at");
  CREATE INDEX "competitions_sport_idx" ON "competitions" USING btree ("sport_id");
  CREATE INDEX "competitions_seed_marker_idx" ON "competitions" USING btree ("seed_marker");
  CREATE INDEX "competitions_updated_at_idx" ON "competitions" USING btree ("updated_at");
  CREATE INDEX "competitions_created_at_idx" ON "competitions" USING btree ("created_at");
  CREATE INDEX "sport_name_idx" ON "competitions" USING btree ("sport_id","name");
  CREATE INDEX "sporting_events_competition_idx" ON "sporting_events" USING btree ("competition_id");
  CREATE INDEX "sporting_events_starts_at_idx" ON "sporting_events" USING btree ("starts_at");
  CREATE INDEX "sporting_events_status_idx" ON "sporting_events" USING btree ("status");
  CREATE INDEX "sporting_events_seed_marker_idx" ON "sporting_events" USING btree ("seed_marker");
  CREATE INDEX "sporting_events_updated_at_idx" ON "sporting_events" USING btree ("updated_at");
  CREATE INDEX "sporting_events_created_at_idx" ON "sporting_events" USING btree ("created_at");
  CREATE INDEX "competition_startsAt_idx" ON "sporting_events" USING btree ("competition_id","starts_at");
  CREATE INDEX "status_startsAt_idx" ON "sporting_events" USING btree ("status","starts_at");
  CREATE UNIQUE INDEX "tips_slug_idx" ON "tips" USING btree ("slug");
  CREATE INDEX "tips_sport_idx" ON "tips" USING btree ("sport_id");
  CREATE INDEX "tips_status_idx" ON "tips" USING btree ("status");
  CREATE INDEX "tips_published_at_idx" ON "tips" USING btree ("published_at");
  CREATE INDEX "tips_settled_at_idx" ON "tips" USING btree ("settled_at");
  CREATE UNIQUE INDEX "tips_ingestion_external_id_idx" ON "tips" USING btree ("ingestion_external_id");
  CREATE INDEX "tips_seed_marker_idx" ON "tips" USING btree ("seed_marker");
  CREATE INDEX "tips_updated_at_idx" ON "tips" USING btree ("updated_at");
  CREATE INDEX "tips_created_at_idx" ON "tips" USING btree ("created_at");
  CREATE INDEX "status_publishedAt_idx" ON "tips" USING btree ("status","published_at");
  CREATE INDEX "sport_status_idx" ON "tips" USING btree ("sport_id","status");
  CREATE INDEX "tip_selections_tip_idx" ON "tip_selections" USING btree ("tip_id");
  CREATE INDEX "tip_selections_sporting_event_idx" ON "tip_selections" USING btree ("sporting_event_id");
  CREATE INDEX "tip_selections_outcome_idx" ON "tip_selections" USING btree ("outcome");
  CREATE INDEX "tip_selections_seed_marker_idx" ON "tip_selections" USING btree ("seed_marker");
  CREATE INDEX "tip_selections_updated_at_idx" ON "tip_selections" USING btree ("updated_at");
  CREATE INDEX "tip_selections_created_at_idx" ON "tip_selections" USING btree ("created_at");
  CREATE INDEX "tip_outcome_idx" ON "tip_selections" USING btree ("tip_id","outcome");
  CREATE INDEX "sportingEvent_idx" ON "tip_selections" USING btree ("sporting_event_id");
  CREATE INDEX "tip_audit_events_tip_idx" ON "tip_audit_events" USING btree ("tip_id");
  CREATE INDEX "tip_audit_events_occurred_at_idx" ON "tip_audit_events" USING btree ("occurred_at");
  CREATE INDEX "tip_audit_events_updated_at_idx" ON "tip_audit_events" USING btree ("updated_at");
  CREATE INDEX "tip_audit_events_created_at_idx" ON "tip_audit_events" USING btree ("created_at");
  CREATE INDEX "tip_occurredAt_idx" ON "tip_audit_events" USING btree ("tip_id","occurred_at");
  CREATE INDEX "type_occurredAt_idx" ON "tip_audit_events" USING btree ("type","occurred_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_sports_fk" FOREIGN KEY ("sports_id") REFERENCES "public"."sports"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_competitions_fk" FOREIGN KEY ("competitions_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_sporting_events_fk" FOREIGN KEY ("sporting_events_id") REFERENCES "public"."sporting_events"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_tips_fk" FOREIGN KEY ("tips_id") REFERENCES "public"."tips"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_tip_selections_fk" FOREIGN KEY ("tip_selections_id") REFERENCES "public"."tip_selections"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_tip_audit_events_fk" FOREIGN KEY ("tip_audit_events_id") REFERENCES "public"."tip_audit_events"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_sports_id_idx" ON "payload_locked_documents_rels" USING btree ("sports_id");
  CREATE INDEX "payload_locked_documents_rels_competitions_id_idx" ON "payload_locked_documents_rels" USING btree ("competitions_id");
  CREATE INDEX "payload_locked_documents_rels_sporting_events_id_idx" ON "payload_locked_documents_rels" USING btree ("sporting_events_id");
  CREATE INDEX "payload_locked_documents_rels_tips_id_idx" ON "payload_locked_documents_rels" USING btree ("tips_id");
  CREATE INDEX "payload_locked_documents_rels_tip_selections_id_idx" ON "payload_locked_documents_rels" USING btree ("tip_selections_id");
  CREATE INDEX "payload_locked_documents_rels_tip_audit_events_id_idx" ON "payload_locked_documents_rels" USING btree ("tip_audit_events_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "sports" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "competitions" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sporting_events" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "tips" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "tip_selections" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "tip_audit_events" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "sports" CASCADE;
  DROP TABLE "competitions" CASCADE;
  DROP TABLE "sporting_events" CASCADE;
  DROP TABLE "tips" CASCADE;
  DROP TABLE "tip_selections" CASCADE;
  DROP TABLE "tip_audit_events" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_sports_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_competitions_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_sporting_events_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_tips_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_tip_selections_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_tip_audit_events_fk";
  
  DROP INDEX "payload_locked_documents_rels_sports_id_idx";
  DROP INDEX "payload_locked_documents_rels_competitions_id_idx";
  DROP INDEX "payload_locked_documents_rels_sporting_events_id_idx";
  DROP INDEX "payload_locked_documents_rels_tips_id_idx";
  DROP INDEX "payload_locked_documents_rels_tip_selections_id_idx";
  DROP INDEX "payload_locked_documents_rels_tip_audit_events_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "sports_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "competitions_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "sporting_events_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "tips_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "tip_selections_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "tip_audit_events_id";
  DROP TYPE "public"."enum_sporting_events_status";
  DROP TYPE "public"."enum_tips_status";
  DROP TYPE "public"."enum_tips_required_feature_key";
  DROP TYPE "public"."enum_tip_selections_outcome";
  DROP TYPE "public"."enum_tip_audit_events_type";`)
}
