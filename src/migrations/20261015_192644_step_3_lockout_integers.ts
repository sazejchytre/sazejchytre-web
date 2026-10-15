import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "auth_lockouts" ALTER COLUMN "failures" SET DATA TYPE integer;
  ALTER TABLE "auth_lockouts" ALTER COLUMN "lock_seconds" SET DATA TYPE integer;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "auth_lockouts" ALTER COLUMN "failures" SET DATA TYPE numeric;
  ALTER TABLE "auth_lockouts" ALTER COLUMN "lock_seconds" SET DATA TYPE numeric;`)
}
