/**
 * Payload hooks on `users` that keep the administrator rule true from inside
 * the application.
 *
 *   refuseUnauthorisedAdministratorCreation   beforeOperation, `create`
 *   refuseLastAdministratorRemoval            beforeDelete
 *
 * Hooks rather than access rules: collection hooks run for every operation,
 * including calls made with `overrideAccess: true`, so one rule covers the
 * REST API, the admin panel and server code alike.
 *
 * Both hooks take the same transaction-scoped advisory lock before they count,
 * so two transactions cannot each see "another administrator remains" and
 * both remove one, or both see "none exists yet" and both create one. The
 * lock is released when the transaction ends.
 */
import { sql } from '@payloadcms/db-postgres/drizzle'
import {
  APIError,
  Forbidden,
  type CollectionBeforeDeleteHook,
  type CollectionBeforeOperationHook,
  type PayloadRequest,
} from 'payload'

import { USERS_SLUG } from '../access.ts'
import { isDevelopment } from '../env.ts'

import { isBootstrapContext } from './bootstrap.ts'
import {
  ADMINISTRATOR_LOCK_KEY,
  VERIFIED_ADMINISTRATOR_CONDITION,
  decideCreation,
  decideRemoval,
} from './policy.ts'

type Executor = { execute: (query: unknown) => Promise<unknown> }

/**
 * A 409 whose message reaches the client. The name is set explicitly:
 * Payload only includes a message when the error has a name, and the
 * production bundle minifies class names to an empty string.
 */
const conflict = (message: string) => {
  const error = new APIError(message, 409, null, true)
  error.name = 'AdministratorConflict'

  return error
}

const rowsOf = (result: unknown): Record<string, unknown>[] => {
  if (Array.isArray(result)) return result as Record<string, unknown>[]
  const rows = (result as { rows?: unknown[] } | undefined)?.rows

  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []
}

/**
 * The request's own transaction. Without one the advisory lock would be
 * released at the end of its own statement and protect nothing, so the
 * change is refused instead of being made unprotected.
 */
const transactionOf = async (req: PayloadRequest): Promise<Executor> => {
  const adapter = req.payload.db as unknown as {
    sessions?: Record<string, { db?: Executor } | undefined>
  }
  const transactionID =
    req.transactionID === undefined ? undefined : await req.transactionID
  const session =
    transactionID === undefined || transactionID === null
      ? undefined
      : adapter.sessions?.[String(transactionID)]

  if (!session?.db) {
    throw new APIError(
      'Administrator accounts can only be changed inside a transaction.',
      500,
    )
  }

  return session.db
}

const lockAdministrators = (db: Executor) =>
  db.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${ADMINISTRATOR_LOCK_KEY}))`,
  )

const verifiedCondition = sql.raw(VERIFIED_ADMINISTRATOR_CONDITION)

const isAdministratorRequest = (req: PayloadRequest): boolean =>
  req.user?.collection === USERS_SLUG

/* -------------------------------------------------------------------------- */
/* Creation                                                                   */
/* -------------------------------------------------------------------------- */

export const refuseUnauthorisedAdministratorCreation: CollectionBeforeOperationHook =
  async ({ args, context, operation, req }) => {
    if (operation !== 'create') return args

    const verdict = decideCreation({
      development: isDevelopment,
      actorIsAdministrator: isAdministratorRequest(req),
      bootstrap: isBootstrapContext(context),
    })

    if (verdict.action === 'allow') return args
    if (verdict.action === 'refuse') throw new Forbidden(req.t)

    // Initialization command: only while no verified administrator exists.
    const db = await transactionOf(req)
    await lockAdministrators(db)
    const [row] = rowsOf(
      await db.execute(
        sql`SELECT count(*)::int AS "count" FROM "users" WHERE ${verifiedCondition}`,
      ),
    )

    if (Number(row?.count) !== 0) {
      throw conflict(
        'An administrator already exists. Further administrators are created by a signed-in administrator.',
      )
    }

    return args
  }

/* -------------------------------------------------------------------------- */
/* Removal                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Per-request state for removals.
 *
 * A bulk delete runs `beforeDelete` for all of its documents concurrently,
 * inside ONE transaction. The advisory lock is re-entrant within a
 * transaction, so it cannot order those calls against each other: two of
 * them could both count "one other administrator remains" before either row
 * is gone, and the request would remove both. So calls for the same request
 * run one at a time, and each counts as already removed every record an
 * earlier call in the same request approved.
 */
type RemovalState = { queue: Promise<unknown>; approved: Set<string> }

const removalStates = new WeakMap<PayloadRequest, RemovalState>()

const removalStateOf = (req: PayloadRequest): RemovalState => {
  let state = removalStates.get(req)

  if (!state) {
    state = { queue: Promise.resolve(), approved: new Set() }
    removalStates.set(req, state)
  }

  return state
}

const checkRemoval = async (
  req: PayloadRequest,
  id: number | string,
  approved: ReadonlySet<string>,
): Promise<'allow' | 'refuse'> => {
  const db = await transactionOf(req)
  await lockAdministrators(db)

  const excluded = [...approved].map(Number).filter(Number.isFinite)
  const exclusion =
    excluded.length > 0
      ? sql` AND "id" NOT IN (${sql.join(
          excluded.map((value) => sql`${value}`),
          sql`, `,
        )})`
      : sql``

  const [row] = rowsOf(
    await db.execute(
      sql`SELECT
            count(*) FILTER (WHERE "id" <> ${Number(id)})::int AS "others",
            coalesce(bool_or("id" = ${Number(id)}), false) AS "target"
          FROM "users"
          WHERE ${verifiedCondition}${exclusion}`,
    ),
  )

  return decideRemoval({
    targetIsVerified: row?.target === true,
    otherVerified: Number(row?.others ?? 0),
  })
}

export const refuseLastAdministratorRemoval: CollectionBeforeDeleteHook =
  async ({ id, req }) => {
    const state = removalStateOf(req)

    const decision = state.queue.then(async () => {
      const verdict = await checkRemoval(req, id, state.approved)

      // Recorded before the next call may start. If this removal later fails
      // for another reason, later calls under-count: they refuse more, never
      // less.
      if (verdict === 'allow') state.approved.add(String(id))

      return verdict
    })
    // The next call waits for this one, whatever its outcome.
    state.queue = decision.catch(() => undefined)

    if ((await decision) === 'refuse') {
      throw conflict('The last administrator account cannot be removed.')
    }
  }
