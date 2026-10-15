/**
 * Runs better-auth's own migrations into the `auth` schema.
 *
 * WHY A SCRIPT AND NOT `@better-auth/cli`
 *
 * The published CLI tracks a different release line (1.4.x against our 1.7.10)
 * and would have to re-resolve the config on its own. `getMigrations()` is the
 * same function the CLI drives, called against the exact config the running
 * application uses — so what gets migrated cannot drift from what the app
 * expects, and there is no second place where the schema name is configured.
 *
 * USAGE
 *   pnpm auth:migrate          apply pending changes
 *   pnpm auth:migrate --dry    print the SQL and change nothing
 *
 * ORDERING: `pnpm migrate` (Payload) must run first on a fresh database — it
 * creates the `auth` schema this writes into. See the README.
 */
/* eslint-disable no-console -- this is a CLI; stdout is its interface. */
import { getMigrations } from 'better-auth/db/migration'
import { sql } from 'kysely'

import { AUTH_SCHEMA, auth, authDb } from '../lib/auth/config.ts'

const dry = process.argv.includes('--dry')

const main = async (): Promise<void> => {
  // Confirm the namespace exists before touching it. If it does not, the
  // Payload migration has not run and the correct fix is to run it — not to
  // create the schema from here, which would put two owners on one object.
  const probe = await sql<{ present: boolean }>`
    select exists(
      select 1 from information_schema.schemata where schema_name = ${AUTH_SCHEMA}
    ) as present
  `.execute(authDb)

  if (!probe.rows[0]?.present) {
    throw new Error(
      `Postgres schema "${AUTH_SCHEMA}" does not exist. Run \`pnpm migrate\` first: ` +
        'the Payload migration 20261015_180000_create_auth_schema creates it. ' +
        'This script deliberately does not create it, so the schema has exactly one owner.',
    )
  }

  const plan = await getMigrations(auth.options, { throwOnUnsafe: !dry })

  if (plan.schemaProblems.length > 0) {
    console.error('Schema problems reported by better-auth:')
    for (const problem of plan.schemaProblems) {
      console.error(`  - ${problem}`)
    }
  }

  if (plan.unsafeChanges.length > 0) {
    console.error('Changes better-auth considers unsafe:')
    for (const change of plan.unsafeChanges) {
      console.error(`  - ${change}`)
    }
  }

  const creating = plan.toBeCreated.map((entry) => entry.table)
  const altering = plan.toBeAdded.map((entry) => entry.table)

  console.log(`Target schema: ${AUTH_SCHEMA}`)
  console.log(
    `Tables to create: ${creating.length > 0 ? creating.join(', ') : '(none)'}`,
  )
  console.log(
    `Tables to alter:  ${altering.length > 0 ? altering.join(', ') : '(none)'}`,
  )
  console.log(
    `Indexes to add:   ${plan.toBeAddedIndexes.length > 0 ? plan.toBeAddedIndexes.map((i) => i.name).join(', ') : '(none)'}`,
  )

  if (dry) {
    const sql = await plan.compileMigrations()
    console.log('\n--- SQL (not executed) ---')
    console.log(sql.trim().length > 0 ? sql : '(nothing to do)')
    return
  }

  if (
    creating.length === 0 &&
    altering.length === 0 &&
    plan.toBeAddedIndexes.length === 0
  ) {
    console.log('\nNothing to migrate.')
    return
  }

  await plan.runMigrations()
  console.log('\nbetter-auth migrations applied.')
}

main()
  .then(async () => {
    await authDb.destroy()
    process.exit(0)
  })
  .catch(async (error: unknown) => {
    console.error(
      error instanceof Error ? `${error.name}: ${error.message}` : error,
    )
    await authDb.destroy().catch(() => undefined)
    process.exit(1)
  })
