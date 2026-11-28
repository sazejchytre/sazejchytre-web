import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { disposableTarget } from './disposable-database.ts'

/** The owner supplies the target URL, exact confirmation and a maintenance
 * database on the same local server. No other sessions are disconnected. */
export async function disposeDatabase(
  connectionString: string | undefined,
  confirmation: string | undefined,
  maintenance: string | undefined,
) {
  const url = disposableTarget(connectionString)
  const database = url.pathname.slice(1)
  if (
    confirmation !== database ||
    !maintenance ||
    !/^[a-z][a-z0-9_]{0,62}$/.test(maintenance) ||
    maintenance === database
  ) {
    throw new Error(
      'Set DISPOSABLE_DROP_DATABASE to the entire database to retire and DISPOSABLE_MAINTENANCE_DATABASE to the local control database.',
    )
  }
  url.pathname = '/' + maintenance
  const client = new pg.Client({
    connectionString: url.href,
    connectionTimeoutMillis: 5000,
  })
  const retired = 'sc_retired_' + randomUUID().replaceAll('-', '')
  try {
    await client.connect()
    await client.query('BEGIN')
    const verify = (name: string) =>
      client.query<{ oid: number }>(
        `
      SELECT d.oid FROM pg_catalog.pg_database d
       WHERE d.datname = $1 AND NOT d.datistemplate
         AND pg_catalog.shobj_description(d.oid, 'pg_database') = $2
         AND pg_catalog.pg_get_userbyid(d.datdba) = current_user
         AND current_user = session_user AND current_user = $3 AND current_database() = $4
    `,
        [
          name,
          `sazejchytre:disposable:v1:${database}`,
          decodeURIComponent(url.username),
          maintenance,
        ],
      )
    const target = (await verify(database)).rows[0]
    if (!target)
      throw new Error(
        'Database owner, identity or disposable marker was not verified.',
      )

    // RENAME takes the database lock. Verify the same object under that lock
    // before committing. A racing replacement leaves the transaction uncommitted.
    await client.query(`ALTER DATABASE "${database}" RENAME TO "${retired}"`)
    if ((await verify(retired)).rows[0]?.oid !== target.oid) {
      throw new Error('Disposable database identity changed during retirement.')
    }
    process.stdout.write(
      `Retiring ${database} (OID ${target.oid}) as ${retired}.\n`,
    )
    await client.query('COMMIT')
    // DROP DATABASE is a standalone statement. An interruption here leaves a
    // retired database with its original marker, data and protections intact.
    await client.query(`DROP DATABASE "${retired}"`)
  } finally {
    // Closing the session rolls back any open retirement transaction.
    await client.end()
  }
}
