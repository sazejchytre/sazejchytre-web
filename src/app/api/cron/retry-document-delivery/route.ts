/**
 * `GET /api/cron/retry-document-delivery` — retry documents that did not go out.
 *
 * Issuing a document and delivering it are separate acts. A document exists
 * the moment it is issued; whether its PDF rendered and whether the email was
 * accepted are separate facts that can fail without unissuing anything. This
 * is what picks those up.
 *
 * Covers both failure points:
 *   - FAILED: a render or a send that was refused.
 *   - PENDING with no `pdfStorageKey`: issued, but the follow-up never ran —
 *     which is what a webhook timing out between issuing and delivery leaves
 *     behind.
 *
 * Authorised exactly like the lockout sweep: Vercel Cron's shared secret,
 * compared in constant time, 404 to anybody else. A cron route is an ordinary
 * public URL and this one emails customers.
 */
import configPromise from '@payload-config'
import { getPayload } from 'payload'

import {
  authorizeCronRequest,
  cronForbiddenResponse,
} from '@/lib/cron/authorize'
import {
  deliverDocument,
  type DocumentCollection,
} from '@/lib/invoicing/delivery'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * How many to attempt per run.
 *
 * Bounded because each one renders a PDF and sends an email, and a serverless
 * invocation has a wall-clock limit. Anything left over is picked up tomorrow;
 * the sweep is idempotent, so a partial run costs nothing.
 */
const BATCH = 25

/**
 * Give up loudly rather than retrying for ever.
 *
 * After this many attempts the cause is not transient — a dead address, a
 * rejected domain — and continuing to retry hides it behind noise instead of
 * putting it in front of a human.
 */
const MAX_ATTEMPTS = 8

export async function GET(request: Request): Promise<Response> {
  const authorised = authorizeCronRequest(request.headers)

  if (!authorised.authorized) {
    return cronForbiddenResponse()
  }

  const payload = await getPayload({ config: configPromise })

  const results: {
    collection: DocumentCollection
    id: number
    number: string
    delivered: boolean
    reason?: string
  }[] = []

  let exhausted = 0

  for (const collection of ['invoices', 'credit-notes'] as const) {
    const pending = await payload.find({
      collection,
      depth: 0,
      limit: BATCH,
      pagination: false,
      overrideAccess: true,
      // Oldest first: a customer who has been waiting longest is served first.
      sort: 'issuedAt',
      where: {
        and: [
          { deliveryState: { not_equals: 'SENT' } },
          { deliveryAttempts: { less_than: MAX_ATTEMPTS } },
        ],
      },
    })

    for (const doc of pending.docs) {
      const outcome = await deliverDocument({
        payload,
        collection,
        id: doc.id,
      })

      results.push({
        collection,
        id: doc.id,
        number: doc.number,
        delivered: outcome.delivered,
        ...(outcome.reason ? { reason: outcome.reason } : {}),
      })
    }

    const stuck = await payload.count({
      collection,
      overrideAccess: true,
      where: {
        and: [
          { deliveryState: { not_equals: 'SENT' } },
          { deliveryAttempts: { greater_than_equal: MAX_ATTEMPTS } },
        ],
      },
    })

    exhausted += stuck.totalDocs
  }

  const delivered = results.filter((result) => result.delivered).length

  if (exhausted > 0) {
    // An alert, not a statistic. A document that has stopped retrying is one
    // a customer never received and nobody is going to notice on their own.
    payload.logger.error(
      {
        scope: 'invoicing',
        event: 'delivery.exhausted',
        exhausted,
        maxAttempts: MAX_ATTEMPTS,
      },
      `${String(exhausted)} document(s) have exhausted delivery attempts and ` +
        'will not be retried. Check deliveryError and send them by hand.',
    )
  }

  payload.logger.info(
    {
      scope: 'invoicing',
      event: 'delivery.sweep',
      attempted: results.length,
      delivered,
      exhausted,
    },
    `Document delivery sweep: ${String(delivered)}/${String(results.length)} delivered.`,
  )

  return Response.json({
    ok: true,
    task: 'retry-document-delivery',
    attempted: results.length,
    delivered,
    exhausted,
    results,
  })
}
