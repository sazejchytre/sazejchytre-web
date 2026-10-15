import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_auth_lockouts_reason" AS ENUM('SIGN_IN_FAILURES', 'TOTP_FAILURES');
  CREATE TABLE "auth_lockouts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"identifier" varchar NOT NULL,
  	"failures" numeric NOT NULL,
  	"lock_seconds" numeric NOT NULL,
  	"locked_until" timestamp(3) with time zone NOT NULL,
  	"ip_country" varchar,
  	"reason" "enum_auth_lockouts_reason" DEFAULT 'SIGN_IN_FAILURES' NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "auth_lockouts_id" integer;
  CREATE INDEX "auth_lockouts_identifier_idx" ON "auth_lockouts" USING btree ("identifier");
  CREATE INDEX "auth_lockouts_locked_until_idx" ON "auth_lockouts" USING btree ("locked_until");
  CREATE INDEX "auth_lockouts_updated_at_idx" ON "auth_lockouts" USING btree ("updated_at");
  CREATE INDEX "auth_lockouts_created_at_idx" ON "auth_lockouts" USING btree ("created_at");
  CREATE INDEX "identifier_lockedUntil_idx" ON "auth_lockouts" USING btree ("identifier","locked_until");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_auth_lockouts_fk" FOREIGN KEY ("auth_lockouts_id") REFERENCES "public"."auth_lockouts"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_auth_lockouts_id_idx" ON "payload_locked_documents_rels" USING btree ("auth_lockouts_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "auth_lockouts" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "auth_lockouts" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_auth_lockouts_fk";
  
  DROP INDEX "payload_locked_documents_rels_auth_lockouts_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "auth_lockouts_id";
  DROP TYPE "public"."enum_auth_lockouts_reason";`)
}
