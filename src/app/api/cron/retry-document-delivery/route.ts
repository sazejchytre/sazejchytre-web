/**
 * `GET /api/cron/retry-document-delivery` — finish what a sale started.
 *
 * Recording a sale, issuing its accounting document and delivering it are
 * three separate acts, and each can fail without undoing the ones before it.
 * This picks up whatever did not finish.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THIS IS THE OTHER HALF OF THE OUTAGE GUARANTEE
 *
 * A sale is recorded unconditionally, the moment Stripe confirms payment. If
 * Fakturoid is unreachable at that moment the row is written anyway and left
 * on `accountingState: 'PENDING'` — nothing is lost and no entitlement is
 * rolled back. That guarantee is only worth anything because something comes
 * back later and issues the document. This is that something.
 *
 * So it covers three failure points, in order:
 *   - `accountingState: 'PENDING'` — no accounting document yet. The provider
 *     was down, throttling, or in maintenance when the sale happened.
 *   - `pdfStorageKey` empty — issued, but our copy of the PDF is outstanding,
 *     which is also what a bounded PDF poll giving up leaves behind.
 *   - `deliveryState: 'FAILED'` — the email was refused.
 *
 * Rows on `accountingState: 'FAILED'` are deliberately NOT retried. That state
 * means the provider refused our data or the provider account is blocked, so
 * another attempt sends the same request and gets the same answer. They are
 * counted and logged as needing a human instead.
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
  ensureCreditNoteDocument,
  ensureInvoiceDocument,
} from '@/lib/invoicing/accounting-document'
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
    /** Null while the accounting document has not been issued yet. */
    number: string | null
    /** What issuing the accounting document did on this run, if it ran. */
    accounting?: string
    delivered: boolean
    reason?: string
  }[] = []

  let exhausted = 0
  let unissuable = 0

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
          // Not FAILED: that means the provider refused our data or the
          // provider account is blocked, and retrying sends the same request
          // for the same answer. Counted separately below.
          { accountingState: { not_equals: 'FAILED' } },
        ],
      },
    })

    for (const doc of pending.docs) {
      let accounting: string | undefined

      // The accounting document first. Delivery needs a document number, so
      // trying to deliver before this would always report "nothing to send".
      if (doc.accountingState !== 'ISSUED') {
        const issued =
          collection === 'invoices'
            ? await ensureInvoiceDocument({ payload, id: doc.id })
            : await ensureCreditNoteDocument({ payload, id: doc.id })

        accounting = issued.reason

        if (!issued.number) {
          // Still no document — the provider is still unreachable, still
          // throttling, or has refused us. Reported verbatim, never flattened
          // into "failed": the reason is what decides whether tomorrow's run
          // will do any better.
          results.push({
            collection,
            id: doc.id,
            number: null,
            accounting,
            delivered: false,
          })

          continue
        }
      }

      const outcome = await deliverDocument({
        payload,
        collection,
        id: doc.id,
      })

      // Re-read the number when issuing just ran: `doc` predates it.
      const number =
        accounting === undefined
          ? (doc.fakturoidNumber ?? null)
          : ((
              await payload.findByID({
                collection,
                id: doc.id,
                depth: 0,
                overrideAccess: true,
              })
            ).fakturoidNumber ?? null)

      results.push({
        collection,
        id: doc.id,
        number,
        ...(accounting ? { accounting } : {}),
        delivered: outcome.delivered,
        ...(outcome.reason ? { reason: outcome.reason } : {}),
      })
    }

    const refused = await payload.count({
      collection,
      overrideAccess: true,
      where: { accountingState: { equals: 'FAILED' } },
    })

    unissuable += refused.totalDocs

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

  if (unissuable > 0) {
    // An alert, not a statistic. These are recorded sales with no accounting
    // document, which no amount of retrying will fix: either our payload is
    // wrong or somebody has to pay a Fakturoid bill. Both need a person.
    payload.logger.error(
      {
        scope: 'invoicing',
        event: 'accounting.refused',
        unissuable,
      },
      `${String(unissuable)} document(s) were refused by the accounting ` +
        'provider and will not be retried. Check accountingState=FAILED rows.',
    )
  }

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
      unissuable,
    },
    `Document delivery sweep: ${String(delivered)}/${String(results.length)} delivered.`,
  )

  return Response.json({
    ok: true,
    task: 'retry-document-delivery',
    attempted: results.length,
    delivered,
    exhausted,
    unissuable,
    results,
  })
}
