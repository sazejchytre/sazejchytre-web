import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_tip_corrections_new_outcome" AS ENUM('PENDING', 'WON', 'LOST', 'VOID', 'HALF_WON', 'HALF_LOST');
  CREATE TYPE "public"."enum_tip_corrections_previous_outcome" AS ENUM('PENDING', 'WON', 'LOST', 'VOID', 'HALF_WON', 'HALF_LOST');
  CREATE TABLE "tip_corrections" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"selection_id" integer NOT NULL,
  	"tip_id" integer NOT NULL,
  	"new_outcome" "enum_tip_corrections_new_outcome" NOT NULL,
  	"new_closing_odds" integer,
  	"reason" varchar NOT NULL,
  	"actor" varchar NOT NULL,
  	"previous_outcome" "enum_tip_corrections_previous_outcome" NOT NULL,
  	"previous_closing_odds" integer,
  	"recorded_at" timestamp(3) with time zone NOT NULL,
  	"database_role" varchar,
  	"transaction_id" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "sports" ADD COLUMN "record_locked_at" timestamp(3) with time zone;
  ALTER TABLE "competitions" ADD COLUMN "record_locked_at" timestamp(3) with time zone;
  ALTER TABLE "sporting_events" ADD COLUMN "record_locked_at" timestamp(3) with time zone;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "tip_corrections_id" integer;
  ALTER TABLE "tip_corrections" ADD CONSTRAINT "tip_corrections_selection_id_tip_selections_id_fk" FOREIGN KEY ("selection_id") REFERENCES "public"."tip_selections"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "tip_corrections" ADD CONSTRAINT "tip_corrections_tip_id_tips_id_fk" FOREIGN KEY ("tip_id") REFERENCES "public"."tips"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "tip_corrections_selection_idx" ON "tip_corrections" USING btree ("selection_id");
  CREATE INDEX "tip_corrections_tip_idx" ON "tip_corrections" USING btree ("tip_id");
  CREATE INDEX "tip_corrections_recorded_at_idx" ON "tip_corrections" USING btree ("recorded_at");
  CREATE INDEX "tip_corrections_updated_at_idx" ON "tip_corrections" USING btree ("updated_at");
  CREATE INDEX "tip_corrections_created_at_idx" ON "tip_corrections" USING btree ("created_at");
  CREATE INDEX "selection_transactionId_idx" ON "tip_corrections" USING btree ("selection_id","transaction_id");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_tip_corrections_fk" FOREIGN KEY ("tip_corrections_id") REFERENCES "public"."tip_corrections"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "sports_record_locked_at_idx" ON "sports" USING btree ("record_locked_at");
  CREATE INDEX "competitions_record_locked_at_idx" ON "competitions" USING btree ("record_locked_at");
  CREATE INDEX "sporting_events_record_locked_at_idx" ON "sporting_events" USING btree ("record_locked_at");
  CREATE INDEX "payload_locked_documents_rels_tip_corrections_id_idx" ON "payload_locked_documents_rels" USING btree ("tip_corrections_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "tip_corrections" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "tip_corrections" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_tip_corrections_fk";
  
  DROP INDEX "sports_record_locked_at_idx";
  DROP INDEX "competitions_record_locked_at_idx";
  DROP INDEX "sporting_events_record_locked_at_idx";
  DROP INDEX "payload_locked_documents_rels_tip_corrections_id_idx";
  ALTER TABLE "sports" DROP COLUMN "record_locked_at";
  ALTER TABLE "competitions" DROP COLUMN "record_locked_at";
  ALTER TABLE "sporting_events" DROP COLUMN "record_locked_at";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "tip_corrections_id";
  DROP TYPE "public"."enum_tip_corrections_new_outcome";
  DROP TYPE "public"."enum_tip_corrections_previous_outcome";`)
}
