/**
 * Administrator presence, enforced on the running server.
 *
 * Called once from `src/instrumentation.ts`, which Next runs before the
 * server accepts its first request. Outside development:
 *
 *   - at boot, the server does not start unless a verified administrator
 *     exists (`policy.ts` defines "verified");
 *   - while running, the same check repeats every few seconds, and the
 *     server stops as soon as one finds none — the last administrator
 *     removed by any means, a restore of an empty backup, or a different
 *     database behind the same connection string.
 *
 * "Stops" means the process exits with `NO_ADMINISTRATOR_EXIT_CODE`. That is
 * the one refusal that covers every route at once — pages, the admin panel,
 * the REST API, Server Functions, route handlers and anything added later —
 * without a list of paths that could fall out of date. The container's
 * restart policy then runs the boot check again, which keeps refusing until
 * the private initialization step (`docs/DEPLOYMENT.md`) has created the
 * owner account.
 *
 * The check uses its own single-connection pool rather than Payload's, so it
 * does not depend on Payload having initialised and cannot be starved by a
 * busy application pool. Same `DATABASE_URL`, so it sees the same database.
 */
import { Pool } from 'pg'

import { env, isDevelopment } from '../env.ts'

import {
  ABSENCE_WINDOW_MS,
  CHECK_INTERVAL_MS,
  CHECK_TIMEOUT_MS,
  COUNT_VERIFIED_ADMINISTRATORS_SQL,
  NO_ADMINISTRATOR_EXIT_CODE,
  UNAVAILABLE_GRACE_MS,
  isPresenceEnforced,
  probeFromCount,
  probeFromError,
  type PresenceProbe,
} from './policy.ts'
import { createAdministratorWatch, type RefusalEvent } from './watch.ts'

const LOG_PREFIX = '[admin-presence]'

const describeRefusal = ({ phase, reason, probe }: RefusalEvent): string => {
  const what =
    reason === 'absent'
      ? 'no verified administrator exists'
      : reason === 'schema-missing'
        ? 'the database has no administrator table'
        : phase === 'boot'
          ? 'the database did not answer the administrator check'
          : `the database has not answered for ${UNAVAILABLE_GRACE_MS / 1000} s`
  const detail = probe.kind === 'unavailable' ? ` (${probe.detail})` : ''
  const when = phase === 'boot' ? 'Refusing to start' : 'Stopping the server'
  const next =
    reason === 'unavailable'
      ? 'Check the database connection, then start the server again.'
      : 'Create the owner account with the private initialization step in ' +
        'docs/DEPLOYMENT.md, then start the server again.'

  return `${LOG_PREFIX} ${when}: ${what}${detail}. ${next}`
}

/** One bounded query against the configured database. */
export const createDatabaseProbe = (
  connectionString: string,
): (() => Promise<PresenceProbe>) => {
  const pool = new Pool({
    connectionString,
    max: 1,
    idleTimeoutMillis: CHECK_INTERVAL_MS * 4,
    connectionTimeoutMillis: CHECK_TIMEOUT_MS,
    query_timeout: CHECK_TIMEOUT_MS,
    statement_timeout: CHECK_TIMEOUT_MS,
    allowExitOnIdle: true,
    application_name: 'sazejchytre-admin-presence',
  })

  // An idle client that loses its connection emits on the pool. Unhandled,
  // that event would crash the process with a generic error; handled, the
  // next check reports the database as unavailable and the grace rules apply.
  pool.on('error', (error) => {
    const probe = probeFromError(error)
    console.error(
      `${LOG_PREFIX} connection lost: ${probe.kind === 'unavailable' ? probe.detail : probe.kind}`,
    )
  })

  return async () => {
    try {
      const result = await pool.query<{ count: unknown }>(
        COUNT_VERIFIED_ADMINISTRATORS_SQL,
      )

      return probeFromCount(result.rows[0]?.count)
    } catch (error) {
      return probeFromError(error)
    }
  }
}

let started: Promise<void> | undefined

/**
 * Enforce administrator presence for this server process. Idempotent: Next
 * may evaluate the instrumentation module more than once.
 */
export const enforceAdministratorPresence = (): Promise<void> => {
  started ??= run()

  return started
}

const run = async (): Promise<void> => {
  const enforced = isPresenceEnforced({
    development: isDevelopment,
    nextPhase: process.env.NEXT_PHASE,
    runtime: process.env.NEXT_RUNTIME,
  })

  if (!enforced) {
    if (isDevelopment) {
      console.warn(
        `${LOG_PREFIX} not enforced under the development server. ` +
          'A production server refuses to run without a verified administrator.',
      )
    }

    return
  }

  const watch = createAdministratorWatch({
    probe: createDatabaseProbe(env.DATABASE_URL),
    refuse: (event) => {
      console.error(describeRefusal(event))
      process.exit(NO_ADMINISTRATOR_EXIT_CODE)
    },
    onDegraded: (probe) => {
      if (probe.kind === 'unavailable') {
        console.warn(
          `${LOG_PREFIX} check failed (${probe.detail}); tolerated for up to ` +
            `${UNAVAILABLE_GRACE_MS / 1000} s after the last good check.`,
        )
      }
    },
  })

  if (await watch.start()) {
    console.warn(
      `${LOG_PREFIX} verified administrator present; re-checking every ` +
        `${CHECK_INTERVAL_MS / 1000} s (removal is acted on within ` +
        `${ABSENCE_WINDOW_MS / 1000} s).`,
    )
  }
}
