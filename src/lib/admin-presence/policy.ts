/**
 * Administrator presence: the policy, as pure functions.
 *
 * A production deployment serves traffic only while at least one VERIFIED
 * administrator exists, and administrator accounts come into existence only
 * through an existing administrator or the private initialization command
 * (`src/scripts/admin-init.ts`). This file holds every decision behind that
 * rule; the modules next to it only connect the decisions to Payload, to the
 * database and to the server process.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT COUNTS AS A VERIFIED ADMINISTRATOR
 *
 * A row in `users` (the only auth-enabled Payload collection, and every one
 * of its users is a full administrator) that can actually sign in: a
 * non-empty email plus a stored password hash and salt. A row that cannot
 * authenticate — inserted by hand, half-restored, or stripped of its
 * credentials — keeps nobody in control of the panel, so it does not count.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE WINDOW
 *
 * The server checks once at boot, before it is ready for requests, and then
 * every `CHECK_INTERVAL_MS`, each check bounded by `CHECK_TIMEOUT_MS`.
 * Nothing is cached between checks, so a removal that commits at any moment
 * is acted on by the next check: within `ABSENCE_WINDOW_MS` (8 s). A
 * database that stops answering is tolerated for `UNAVAILABLE_GRACE_MS`
 * after the last successful check, so a short network blip or a cold start
 * does not take the site down; after that the server stops as well.
 *
 * Dependency-free: unit tests run it under Node's type stripping.
 */

/** Time between the end of one check and the start of the next. */
export const CHECK_INTERVAL_MS = 5_000

/** Upper bound on one check, connection included. */
export const CHECK_TIMEOUT_MS = 3_000

/** Worst case from a committed removal to the server refusing. */
export const ABSENCE_WINDOW_MS = CHECK_INTERVAL_MS + CHECK_TIMEOUT_MS

/** How long an unreachable database is tolerated after the last good check. */
export const UNAVAILABLE_GRACE_MS = 15_000

/**
 * Process exit code when the server stops for lack of a verified
 * administrator. Distinct from a crash (1), so an operator reading
 * `docker ps -a` can tell the two apart.
 */
export const NO_ADMINISTRATOR_EXIT_CODE = 78

/** Key for the advisory lock that serialises every change to the count. */
export const ADMINISTRATOR_LOCK_KEY = 'sazejchytre:administrator-presence'

/**
 * SQL condition for a verified administrator row in `users`.
 *
 * One definition, used by the server's presence check, by the removal guard
 * and by the initialization command, so they cannot disagree about what is
 * being counted.
 */
export const VERIFIED_ADMINISTRATOR_CONDITION =
  `"email" <> '' AND "hash" IS NOT NULL AND "hash" <> '' ` +
  `AND "salt" IS NOT NULL AND "salt" <> ''`

/** The presence check's query. Returns one row with `count` as an integer. */
export const COUNT_VERIFIED_ADMINISTRATORS_SQL = `SELECT count(*)::int AS "count" FROM "users" WHERE ${VERIFIED_ADMINISTRATOR_CONDITION}`

/* -------------------------------------------------------------------------- */
/* Where the rule is enforced                                                 */
/* -------------------------------------------------------------------------- */

export type EnforcementContext = {
  /** True only under `next dev` (`NODE_ENV=development`). */
  development: boolean
  /** `process.env.NEXT_PHASE`, set by Next while it builds. */
  nextPhase?: string | undefined
  /** `process.env.NEXT_RUNTIME`: 'nodejs' or 'edge'. */
  runtime?: string | undefined
}

/**
 * Does this server process have to prove an administrator exists?
 *
 * Everything except the development server and the build. Fail closed: an
 * unknown NODE_ENV is not development, so it is enforced.
 */
export const isPresenceEnforced = ({
  development,
  nextPhase,
  runtime,
}: EnforcementContext): boolean => {
  if (development) return false
  // `next build` evaluates route modules to prerender them; there is no
  // database at build time and nothing is served from the build process.
  if (nextPhase === 'phase-production-build') return false
  // The check needs a database driver, which only the Node.js runtime has.
  // Nothing in this application runs on the Edge runtime.
  if (runtime !== undefined && runtime !== 'nodejs') return false

  return true
}

/* -------------------------------------------------------------------------- */
/* The presence check                                                         */
/* -------------------------------------------------------------------------- */

export type PresenceProbe =
  | { kind: 'present'; count: number }
  /** The query ran and found no verified administrator. */
  | { kind: 'absent' }
  /** The database answered, but has no `users` table: an empty restore. */
  | { kind: 'schema-missing' }
  /** No answer: connection refused, timed out, or the server is restarting. */
  | { kind: 'unavailable'; detail: string }

/** Build a probe result from the count the query returned. */
export const probeFromCount = (count: unknown): PresenceProbe => {
  const value = typeof count === 'string' ? Number(count) : count

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    // A result we cannot read is not evidence of an administrator.
    return { kind: 'absent' }
  }

  return value > 0 ? { kind: 'present', count: value } : { kind: 'absent' }
}

/**
 * SQLSTATE codes that mean "this database has no administrator table", as
 * opposed to "the database did not answer". A database that answers with
 * these has been replaced or emptied underneath the running server.
 */
const SCHEMA_MISSING_CODES = new Set([
  '42P01', // undefined_table
  '3F000', // invalid_schema_name
  '3D000', // invalid_catalog_name: the database itself is gone
])

/** Classify an error thrown by the presence query. */
export const probeFromError = (error: unknown): PresenceProbe => {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : undefined

  if (code !== undefined && SCHEMA_MISSING_CODES.has(code)) {
    return { kind: 'schema-missing' }
  }

  // Only the code and class of the error, never its message: driver messages
  // can carry host names and user names.
  const name = error instanceof Error ? error.name : typeof error

  return { kind: 'unavailable', detail: code ? `${name} ${code}` : name }
}

export type PresenceVerdict =
  | { action: 'serve' }
  | { action: 'refuse'; reason: 'absent' | 'schema-missing' | 'unavailable' }

/** The answer at boot: anything short of a confirmed administrator refuses. */
export const verdictAtBoot = (probe: PresenceProbe): PresenceVerdict =>
  probe.kind === 'present'
    ? { action: 'serve' }
    : { action: 'refuse', reason: probe.kind }

/**
 * The answer while running.
 *
 * Confirmed absence refuses at once. An unreachable database is tolerated
 * until `graceMs` have passed since the last check that confirmed an
 * administrator.
 */
export const verdictWhileRunning = (
  probe: PresenceProbe,
  {
    now,
    lastConfirmedAt,
    graceMs = UNAVAILABLE_GRACE_MS,
  }: { now: number; lastConfirmedAt: number; graceMs?: number },
): PresenceVerdict => {
  switch (probe.kind) {
    case 'present':
      return { action: 'serve' }
    case 'absent':
    case 'schema-missing':
      return { action: 'refuse', reason: probe.kind }
    case 'unavailable':
      return now - lastConfirmedAt >= graceMs
        ? { action: 'refuse', reason: 'unavailable' }
        : { action: 'serve' }
  }
}

/* -------------------------------------------------------------------------- */
/* Creating and removing administrators                                       */
/* -------------------------------------------------------------------------- */

export type CreationRequest = {
  /** True only under `next dev` / `NODE_ENV=development`. */
  development: boolean
  /** The request is authenticated as an administrator. */
  actorIsAdministrator: boolean
  /** The private initialization command is the caller. */
  bootstrap: boolean
}

export type CreationVerdict =
  | { action: 'allow' }
  /** Allowed only if no verified administrator exists, checked under lock. */
  | { action: 'allow-if-none-exist' }
  | { action: 'refuse' }

/**
 * May this request create an administrator account?
 *
 * Outside development, only an administrator, or the initialization command
 * while the administrator table is empty. The rule is applied to every
 * create operation on `users`, whichever route it comes through.
 */
export const decideCreation = ({
  development,
  actorIsAdministrator,
  bootstrap,
}: CreationRequest): CreationVerdict => {
  if (development) return { action: 'allow' }
  if (actorIsAdministrator) return { action: 'allow' }
  if (bootstrap) return { action: 'allow-if-none-exist' }

  return { action: 'refuse' }
}

/**
 * May this record be removed?
 *
 * Refused when it is a verified administrator and no other verified
 * administrator would remain. Applies in every environment: a development
 * database without an administrator is merely inconvenient, but there is no
 * reason to make the rule depend on where it runs.
 */
export const decideRemoval = ({
  targetIsVerified,
  otherVerified,
}: {
  targetIsVerified: boolean
  otherVerified: number
}): 'allow' | 'refuse' =>
  targetIsVerified && otherVerified < 1 ? 'refuse' : 'allow'

/* -------------------------------------------------------------------------- */
/* Initialization command                                                     */
/* -------------------------------------------------------------------------- */

/** Minimum length for an administrator password set by the command. */
export const ADMINISTRATOR_MIN_PASSWORD_LENGTH = 16
