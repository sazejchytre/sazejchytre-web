/**
 * Webhook idempotency: claim an event exactly once.
 *
 * Payment providers deliver at-least-once. A retry, a network hiccup on our
 * side, or two instances receiving the same delivery are all routine, and
 * processing one event twice would double-count a payment, issue a second
 * invoice, or extend a period twice.
 *
 * WHY THIS IS A SINGLE STATEMENT
 *
 * The obvious implementation — "SELECT to see if we have this id, then INSERT
 * if not" — is the bug it is trying to prevent. Two concurrent deliveries both
 * read "not seen" and both proceed. No amount of application-level care fixes
 * it, because the gap between the read and the write is where the race lives.
 *
 * So the claim is one conditional INSERT. The UNIQUE index on
 * (provider, external_event_id) is the arbiter, and Postgres decides the
 * winner:
 *
 *     INSERT ... ON CONFLICT (provider, external_event_id) DO NOTHING RETURNING id
 *
 * The conflict target is the PAIR, because an event id is only unique within
 * the provider that issued it.
 *
 * Exactly one caller gets a row back; every other caller gets nothing and
 * knows someone else owns the event. No advisory locks, no retry loop.
 *
 * `claimed: false` is NOT an error. It is the normal, expected answer to a
 * duplicate delivery, and the caller should acknowledge the webhook with a 2xx
 * so the provider stops retrying.
 *
 * NOTE: claiming only records that the event is ours to process. Marking it
 * finished is a separate write (`markWebhookEventProcessed`), so a crash
 * mid-processing leaves a row with no `processedAt` — which is exactly what a
 * retry sweep needs to find. Step 4 adds that sweep.
 */
import type { Payload, PayloadRequest } from 'payload'

import type { BillingProvider } from './constants.ts'

const TABLE = 'webhook_events'

type DrizzleLike = {
  execute: (query: unknown) => Promise<unknown>
}

/** Prefer the request's transaction so a claim commits with its side effects. */
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

const rowsOf = (result: unknown): Record<string, unknown>[] => {
  if (Array.isArray(result)) {
    return result as Record<string, unknown>[]
  }

  const rows = (result as { rows?: unknown[] } | undefined)?.rows

  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []
}

export type ClaimWebhookEventArgs = {
  payload: Payload
  provider: BillingProvider
  /** The provider's event id. The uniqueness key. */
  externalEventId: string
  /** Provider event type, free text. */
  type: string
  /** The event exactly as received. */
  rawPayload: unknown
  /** Defaults to now; injectable for tests. */
  receivedAt?: Date
  req?: PayloadRequest
}

export type WebhookEventClaim = {
  /** True only for the caller that may process this event. */
  claimed: boolean
  /** Row id of the event, whoever owns it. */
  id: number
  /** Set when the claim was refused: has the owner already finished? */
  alreadyProcessed: boolean
}

/**
 * Insert the event, or report that someone else already has it.
 *
 * @returns `claimed: true` for exactly one caller per `externalEventId`.
 */
export const claimWebhookEvent = async ({
  payload,
  provider,
  externalEventId,
  type,
  rawPayload,
  receivedAt = new Date(),
  req,
}: ClaimWebhookEventArgs): Promise<WebhookEventClaim> => {
  const db = resolveDb(payload, req)

  // Imported lazily so that pure unit tests can import this module's types
  // without pulling in the database adapter.
  const { sql } = await import('@payloadcms/db-postgres/drizzle')

  const inserted = await db.execute(sql`
    INSERT INTO ${sql.identifier(TABLE)}
      ("provider", "external_event_id", "type", "received_at", "raw_payload", "updated_at", "created_at")
    VALUES (
      ${provider}::"enum_webhook_events_provider",
      ${externalEventId},
      ${type},
      ${receivedAt.toISOString()}::timestamptz,
      ${JSON.stringify(rawPayload ?? null)}::jsonb,
      now(),
      now()
    )
    ON CONFLICT ("provider", "external_event_id") DO NOTHING
    RETURNING "id"
  `)

  const insertedRow = rowsOf(inserted)[0]

  if (insertedRow?.id !== undefined) {
    return {
      claimed: true,
      id: Number(insertedRow.id),
      alreadyProcessed: false,
    }
  }

  // Lost the race (or this is a replay). Report who owns it and whether they
  // finished, so the caller can decide between "ignore" and "retry later".
  const existing = await db.execute(sql`
    SELECT "id", "processed_at"
    FROM ${sql.identifier(TABLE)}
    WHERE "provider" = ${provider}::"enum_webhook_events_provider"
      AND "external_event_id" = ${externalEventId}
    LIMIT 1
  `)

  const existingRow = rowsOf(existing)[0]

  if (!existingRow?.id) {
    // Neither inserted nor found: the only ways here are a deleted row in the
    // instant between the two statements, or a conflict on a different
    // constraint. Both are real faults, not a duplicate delivery.
    throw new Error(
      `Webhook event ${provider}/${externalEventId} could neither be claimed nor found. ` +
        'The insert conflicted but no owning row exists.',
    )
  }

  return {
    claimed: false,
    id: Number(existingRow.id),
    alreadyProcessed: existingRow.processed_at !== null,
  }
}

export type MarkWebhookEventProcessedArgs = {
  payload: Payload
  id: number
  /** Omit on success; pass the failure to leave the event retryable. */
  error?: string | null
  processedAt?: Date
  req?: PayloadRequest
}

/**
 * Record the outcome of processing.
 *
 * On success `processed_at` is set and the error cleared. On failure the error
 * is recorded and `processed_at` deliberately left null, so the row stays
 * visible to a retry sweep.
 */
export const markWebhookEventProcessed = async ({
  payload,
  id,
  error = null,
  processedAt = new Date(),
  req,
}: MarkWebhookEventProcessedArgs): Promise<void> => {
  const db = resolveDb(payload, req)
  const { sql } = await import('@payloadcms/db-postgres/drizzle')

  await db.execute(sql`
    UPDATE ${sql.identifier(TABLE)}
    SET "processed_at" = ${error ? null : processedAt.toISOString()}::timestamptz,
        "processing_error" = ${error},
        "updated_at" = now()
    WHERE "id" = ${id}
  `)
}
