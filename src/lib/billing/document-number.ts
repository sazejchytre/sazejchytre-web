/**
 * Sequential document numbering for invoices and credit notes.
 *
 * Requirements this has to meet, in order of how badly each one hurts if it is
 * missed:
 *
 *  - NO DUPLICATES. Two documents with one number is an accounting defect that
 *    is painful to unwind after the fact.
 *  - NO GAPS. A Czech tax inspection expects a contiguous series per year. A
 *    missing number has to be explained, and "our code crashed" is not a good
 *    explanation.
 *  - PER YEAR, PER SERIES. Invoices and credit notes each run their own
 *    series, and both restart at 1 each calendar year.
 *  - ALLOCATED ONLY AFTER PAYMENT IS CONFIRMED. An abandoned checkout must not
 *    burn a number.
 *
 * HOW THE GUARANTEES ARE MET
 *
 * The counter lives in one row per (series, year) and is advanced by a single
 * `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` statement. That one
 * statement is atomic: Postgres either inserts the first row or takes a row
 * lock, increments and returns. Concurrent callers serialise on that lock, so
 * each gets a distinct, consecutive number — no read-modify-write race, and no
 * `SELECT max(number) + 1`, which is the usual way this goes wrong.
 *
 * Gaps are avoided by allocating inside the *same transaction* that writes the
 * document. If that transaction rolls back, the counter rolls back with it and
 * the number is handed to the next caller instead of being lost. This is why
 * the function takes the request: it has to join the caller's transaction, not
 * open its own.
 *
 * The trade-off is deliberate: holding the counter row for the length of the
 * document-writing transaction serialises concurrent issuance for that series.
 * At this volume that is free, and correctness is worth more than the
 * throughput an optimistic scheme would buy.
 */
import type { Payload, PayloadRequest } from 'payload'

import { type DocumentSeries } from './constants.ts'

/** Table and column names of the counter. Must match the Payload collection. */
const COUNTER_TABLE = 'invoice_number_counters'

/**
 * Human-readable prefix per series.
 *
 * `FA` is faktura, `OD` is opravný daňový doklad — the Czech terms the
 * operator's accountant will be looking for.
 */
export const SERIES_PREFIX: Readonly<Record<DocumentSeries, string>> = {
  INVOICE: 'FA',
  CREDIT_NOTE: 'OD',
}

/** Digits in the sequence part. Six carries us to 999 999 documents a year. */
export const SEQUENCE_DIGITS = 6

const MAX_SEQUENCE = 10 ** SEQUENCE_DIGITS - 1

/**
 * Render a document number.
 *
 * Format: `FA2026-000001`. Prefix identifies the series, the year is explicit
 * so a number is self-describing, and the zero-padded sequence sorts
 * lexicographically in the same order as numerically.
 *
 * Pure.
 */
export const formatDocumentNumber = (
  series: DocumentSeries,
  year: number,
  sequence: number,
): string => {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) {
    throw new RangeError(`Invalid document year: ${String(year)}`)
  }

  if (!Number.isInteger(sequence) || sequence < 1 || sequence > MAX_SEQUENCE) {
    throw new RangeError(
      `Invalid document sequence: ${String(sequence)} (expected 1..${MAX_SEQUENCE})`,
    )
  }

  return `${SERIES_PREFIX[series]}${year}-${String(sequence).padStart(SEQUENCE_DIGITS, '0')}`
}

/** Inverse of `formatDocumentNumber`, for tests and for reconciliation. */
export const parseDocumentNumber = (
  value: string,
): { series: DocumentSeries; year: number; sequence: number } => {
  const match = /^([A-Z]{2})(\d{4})-(\d{6})$/.exec(value)

  if (!match) {
    throw new RangeError(`Malformed document number: ${value}`)
  }

  const [, prefix, year, sequence] = match

  const series = (Object.keys(SERIES_PREFIX) as DocumentSeries[]).find(
    (key) => SERIES_PREFIX[key] === prefix,
  )

  if (!series) {
    throw new RangeError(`Unknown document series prefix: ${prefix}`)
  }

  return { series, year: Number(year), sequence: Number(sequence) }
}

/**
 * Assert that a list of sequence numbers is a contiguous run starting at 1.
 *
 * Used by the concurrency test, and useful as a periodic integrity check
 * against the real series. Pure.
 */
export const isContiguousFromOne = (sequences: readonly number[]): boolean => {
  const sorted = [...sequences].sort((a, b) => a - b)

  return sorted.every((value, index) => value === index + 1)
}

/* -------------------------------------------------------------------------- */
/* Allocation (impure — touches the database)                                 */
/* -------------------------------------------------------------------------- */

type DrizzleLike = {
  execute: (query: unknown) => Promise<unknown>
}

/**
 * Resolve the drizzle handle to use, preferring the request's transaction.
 *
 * Joining the caller's transaction is what makes the series gap-free: the
 * counter advance and the document insert commit or roll back together.
 */
const resolveDb = (payload: Payload, req?: PayloadRequest): DrizzleLike => {
  const adapter = payload.db as unknown as {
    drizzle: DrizzleLike
    sessions?: Record<string, { db: DrizzleLike } | undefined>
  }

  const transactionID = req?.transactionID

  if (transactionID !== undefined && transactionID !== null) {
    const session = adapter.sessions?.[String(transactionID)]

    if (session?.db) {
      return session.db
    }
  }

  return adapter.drizzle
}

/** Rows come back shaped differently depending on the driver wrapper. */
const firstRow = (result: unknown): Record<string, unknown> | undefined => {
  if (Array.isArray(result)) {
    return result[0] as Record<string, unknown> | undefined
  }

  const rows = (result as { rows?: unknown[] } | undefined)?.rows

  return Array.isArray(rows)
    ? (rows[0] as Record<string, unknown> | undefined)
    : undefined
}

export type AllocateDocumentNumberArgs = {
  payload: Payload
  series: DocumentSeries
  /** Calendar year of the series. Defaults to the year of `now`. */
  year?: number
  /** Injected clock, so tests do not depend on the real date. */
  now?: Date
  /** Pass the request so the allocation joins its transaction. */
  req?: PayloadRequest
}

export type AllocatedDocumentNumber = {
  series: DocumentSeries
  year: number
  sequence: number
  number: string
}

/**
 * Take the next number in a series, atomically.
 *
 * Call this only once a payment is confirmed. The returned sequence is unique
 * and consecutive within (series, year).
 */
export const allocateDocumentNumber = async ({
  payload,
  series,
  year,
  now = new Date(),
  req,
}: AllocateDocumentNumberArgs): Promise<AllocatedDocumentNumber> => {
  const targetYear = year ?? now.getUTCFullYear()
  const db = resolveDb(payload, req)

  // Imported lazily: `@payloadcms/db-postgres` pulls in the adapter, and this
  // module is also imported by pure tests that must not load it.
  const { sql } = await import('@payloadcms/db-postgres')

  const result = await db.execute(sql`
    INSERT INTO ${sql.identifier(COUNTER_TABLE)}
      ("series", "year", "last_number", "updated_at", "created_at")
    VALUES (${series}, ${targetYear}, 1, now(), now())
    ON CONFLICT ("series", "year") DO UPDATE
      SET "last_number" = ${sql.identifier(COUNTER_TABLE)}."last_number" + 1,
          "updated_at" = now()
    RETURNING "last_number"
  `)

  const row = firstRow(result)
  const raw = row?.last_number

  // The column is `integer`, but node-postgres can hand back a string for some
  // numeric types; normalise rather than trust the driver.
  const sequence = typeof raw === 'number' ? raw : Number(raw)

  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error(
      `Document number allocation returned no usable sequence for ${series}/${targetYear}`,
    )
  }

  return {
    series,
    year: targetYear,
    sequence,
    number: formatDocumentNumber(series, targetYear, sequence),
  }
}
