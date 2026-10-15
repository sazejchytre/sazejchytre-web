import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Creates the `auth` schema that better-auth owns.
 *
 * SCHEMA OWNERSHIP — the whole point of this migration:
 *
 *   public  → Payload. Managed by `pnpm migrate`, this directory.
 *   auth    → better-auth. Managed by `pnpm auth:migrate`.
 *
 * Two migration systems share one Neon database, and neither understands the
 * other's bookkeeping. Pointed at the same schema they would eventually fight:
 * Payload's differ would see better-auth's tables as drift and offer to drop
 * them, and better-auth's introspection would see Payload's. Separate
 * namespaces make that impossible rather than merely unlikely.
 *
 * The schema is created HERE, by Payload, rather than by better-auth, for two
 * reasons:
 *   - Ordering is explicit. `pnpm migrate` always runs first on a fresh
 *     database, so the namespace exists before anything tries to put a table
 *     in it.
 *   - Creating a schema is a privileged, database-wide act. Keeping it in the
 *     reviewed migration directory means it shows up in a diff.
 *
 * better-auth is configured with `schemaName: 'auth'`, which qualifies every
 * statement it issues. It therefore does not depend on the connection's
 * `search_path` — which matters on Neon, where the pooler is pgBouncer in
 * transaction mode and a session-level `SET search_path` would not reliably
 * survive between statements.
 *
 * No table is created here. This migration owns the namespace and nothing in
 * it; `pnpm auth:migrate` owns the contents.
 */
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS "auth";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  // RESTRICT, not CASCADE: if better-auth tables are still in there, this must
  // fail loudly rather than silently delete every customer account. Roll back
  // better-auth's own migration first if that is really what you intend.
  await db.execute(sql`DROP SCHEMA IF EXISTS "auth" RESTRICT;`)
}
