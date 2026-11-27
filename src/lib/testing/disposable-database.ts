import pg from 'pg'

const targetName = /^sc_fixture_[a-z0-9_]{1,40}$/

export function disposableTarget(connectionString: string | undefined) {
  if (process.env.NODE_ENV === 'production' || process.env.PGOPTIONS) {
    throw new Error('Fixture commands require a local test environment.')
  }
  const url =
    connectionString && URL.canParse(connectionString)
      ? new URL(connectionString)
      : undefined
  if (
    !url ||
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    !url.username ||
    !url.password ||
    !targetName.test(url.pathname.slice(1)) ||
    url.hash ||
    (url.search !== '' && url.search !== '?sslmode=disable')
  ) {
    throw new Error(
      'Expected an explicit loopback URL for a named sc_fixture_ database.',
    )
  }
  return url
}

/** Keep this connection open while writers use the same URL. PostgreSQL then
 * refuses to retire or rename the database underneath their connection pools. */
export async function openDisposableDatabase(
  connectionString: string | undefined,
) {
  const url = disposableTarget(connectionString)
  const database = url.pathname.slice(1)
  const client = new pg.Client({
    connectionString: url.href,
    connectionTimeoutMillis: 5000,
  })
  try {
    await client.connect()
    const result = await client.query(
      `
      SELECT pg_catalog.shobj_description(d.oid, 'pg_database') AS marker,
             NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls)
             AND NOT EXISTS (SELECT FROM pg_catalog.pg_auth_members WHERE member = r.oid)
             AND d.datdba <> r.oid
             AND NOT pg_catalog.has_database_privilege(r.oid, d.oid, 'CREATE')
             AND NOT EXISTS (
               SELECT FROM pg_catalog.pg_namespace n WHERE n.nspname IN ('public', 'auth')
                 AND pg_catalog.has_schema_privilege(r.oid, n.oid, 'CREATE')
             )
             AND NOT EXISTS (
               SELECT FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname IN ('public', 'auth') AND (c.relowner = r.oid OR
                 (c.relkind IN ('r', 'p') AND pg_catalog.has_table_privilege(r.oid, c.oid, 'TRUNCATE')))
             ) AS restricted
        FROM pg_catalog.pg_database d, pg_catalog.pg_roles r
       WHERE d.datname = current_database() AND d.datname = $1
         AND r.rolname = current_user AND current_user = session_user AND r.rolname = $2
         AND current_setting('session_replication_role') = 'origin'
    `,
      [database, decodeURIComponent(url.username)],
    )
    if (result.rows[0]?.marker !== `sazejchytre:disposable:v1:${database}`) {
      throw new Error(
        'Database identity or disposable marker was not verified.',
      )
    }
    if (result.rows[0].restricted !== true) {
      throw new Error(
        'Fixtures and DB tests require a separate, restricted application role.',
      )
    }
    return client
  } catch (error) {
    await client.end()
    throw error
  }
}
