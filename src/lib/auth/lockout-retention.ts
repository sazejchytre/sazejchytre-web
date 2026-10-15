/**
 * Retention for `auth_lockouts`.
 *
 * WHY THIS HAS TO EXIST
 *
 * The table records the address that was being tried, in readable form, so
 * support can search for it. Most of those rows are genuine customers having a
 * bad morning — but some are addresses an attacker merely *probed*, belonging
 * to people who have no account here and never consented to anything. Keeping
 * those forever is a liability that grows on its own and answers no support
 * question: a lockout from two years ago tells nobody anything.
 *
 * So the table is swept. Ninety days is long enough to cover "why could I not
 * sign in last quarter?" and short enough that the pile stops growing.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THE DELETE IS RAW SQL
 *
 * The collection denies `delete` in access control AND blocks it in a hook, so
 * a lockout record cannot be removed through the API — by anyone, including an
 * admin. That is deliberate: a history that can be edited is not a history.
 *
 * Retention is the one exception, and it is expressed as raw SQL precisely so
 * it does not have to weaken that rule. There is no code path that deletes one
 * chosen row; there is only this, which deletes by age.
 *
 * The decision of WHAT is expired is pure and tested; only the deletion
 * touches the database.
 */
import type { Payload } from 'payload'

import { authLog } from './logging.ts'

/** How long a lockout record is kept. */
export const LOCKOUT_RETENTION_DAYS = 90

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The timestamp at which a record becomes expired.
 *
 * Anything created strictly before this is swept. Pure.
 */
export const lockoutRetentionCutoff = (
  now: Date,
  retentionDays: number = LOCKOUT_RETENTION_DAYS,
): Date => {
  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    throw new RangeError(
      `retentionDays must be a positive integer, received ${String(retentionDays)}`,
    )
  }

  return new Date(now.getTime() - retentionDays * DAY_MS)
}

/** Is this record past its retention? Pure. */
export const isExpiredLockout = (
  record: { createdAt: Date | string | number },
  now: Date,
  retentionDays: number = LOCKOUT_RETENTION_DAYS,
): boolean => {
  const created =
    record.createdAt instanceof Date
      ? record.createdAt.getTime()
      : new Date(record.createdAt).getTime()

  if (Number.isNaN(created)) {
    // An unreadable timestamp is a data defect. Keeping the row is the safe
    // way to be wrong: it stays visible and can be looked at, rather than
    // being silently destroyed by a sweep that could not read it.
    return false
  }

  return created < lockoutRetentionCutoff(now, retentionDays).getTime()
}

/**
 * Split records into those to keep and those to sweep. Pure.
 *
 * Exported mainly so the decision is testable on its own, without a database
 * and without deleting anything.
 */
export const partitionLockoutsByRetention = <
  T extends { createdAt: Date | string | number },
>(
  records: readonly T[],
  now: Date,
  retentionDays: number = LOCKOUT_RETENTION_DAYS,
): { keep: T[]; sweep: T[] } => {
  const keep: T[] = []
  const sweep: T[] = []

  for (const record of records) {
    if (isExpiredLockout(record, now, retentionDays)) {
      sweep.push(record)
    } else {
      keep.push(record)
    }
  }

  return { keep, sweep }
}

/* -------------------------------------------------------------------------- */
/* The sweep (impure)                                                        */
/* -------------------------------------------------------------------------- */

export type SweepResult = {
  cutoff: Date
  deleted: number
}

/**
 * Delete lockout records older than the retention window.
 *
 * Idempotent and safe to run repeatedly. There is no scheduler yet — this is
 * the callable, invoked by `pnpm sweep:lockouts`.
 */
export const sweepAuthLockouts = async ({
  payload,
  now = new Date(),
  retentionDays = LOCKOUT_RETENTION_DAYS,
}: {
  payload: Payload
  now?: Date
  retentionDays?: number
}): Promise<SweepResult> => {
  const cutoff = lockoutRetentionCutoff(now, retentionDays)

  const { sql } = await import('@payloadcms/db-postgres/drizzle')
  const db = (
    payload.db as unknown as {
      drizzle: { execute: (query: unknown) => Promise<unknown> }
    }
  ).drizzle

  const result = await db.execute(sql`
    DELETE FROM "auth_lockouts"
    WHERE "created_at" < ${cutoff.toISOString()}::timestamptz
    RETURNING "id"
  `)

  const rows = Array.isArray(result)
    ? result
    : ((result as { rows?: unknown[] }).rows ?? [])

  const deleted = rows.length

  authLog.info('lockout_retention.swept', {
    cutoff: cutoff.toISOString(),
    deleted,
    retentionDays,
  })

  return { cutoff, deleted }
}
