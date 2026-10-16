/**
 * `GET /ucet/doklady/<id>` — download one document's PDF.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY A ROUTE AND NOT A URL
 *
 * The PDF lives under a private R2 prefix that the public CDN domain does not
 * map to, so there is no URL that serves it. This is the only way to get one,
 * and it checks two things before it does:
 *
 *   1. Somebody is signed in and verified.
 *   2. The document belongs to THEM.
 *
 * The second check is the one that matters. Document ids are sequential
 * integers, so without it the route is an enumeration: change the number,
 * read somebody else's invoice, complete with their name, address and what
 * they bought.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * AND IT IS NOT CACHEABLE
 *
 * `no-store`, and the object is stored with `private, no-store` too. A
 * document cached anywhere between R2 and the browser is a document that
 * outlives its access check — and a CDN does not purge on delete, so a leak
 * through a cache cannot be taken back by fixing the code.
 */
import { NextResponse } from 'next/server'

import configPromise from '@payload-config'
import { getPayload } from 'payload'

import {
  EmailNotVerifiedError,
  NotAuthenticatedError,
  requireVerifiedCustomer,
} from '@/lib/auth/customer'
import { getPrivateDocument } from '@/lib/invoicing/storage'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * One response for every refusal.
 *
 * "Not found" whether the document does not exist, belongs to somebody else,
 * or has no PDF yet. Distinguishing them would turn the route into an oracle
 * for which document ids exist and who they belong to.
 */
const notFound = (): NextResponse =>
  NextResponse.json(
    { error: 'Doklad nebyl nalezen.' },
    { status: 404, headers: { 'cache-control': 'no-store' } },
  )

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  // Next 16: route params are async.
  const { id } = await context.params

  const payload = await getPayload({ config: configPromise })

  let customerId: number

  try {
    const { customer } = await requireVerifiedCustomer(request.headers)
    customerId = customer.id
  } catch (error) {
    if (error instanceof NotAuthenticatedError) {
      return NextResponse.json(
        { error: 'Přihlaste se prosím.' },
        { status: 401, headers: { 'cache-control': 'no-store' } },
      )
    }

    if (error instanceof EmailNotVerifiedError) {
      return NextResponse.json(
        { error: 'Potvrďte prosím svůj e-mail.' },
        { status: 403, headers: { 'cache-control': 'no-store' } },
      )
    }

    throw error
  }

  const numericId = Number(id)

  if (!Number.isInteger(numericId) || numericId <= 0) {
    return notFound()
  }

  // Filtered by customer in the QUERY rather than fetched and then checked.
  // A query that cannot return another customer's row is harder to get wrong
  // than a comparison somebody can later forget to make.
  const found = await payload.find({
    collection: 'invoices',
    depth: 0,
    limit: 1,
    pagination: false,
    overrideAccess: true,
    where: {
      and: [
        { id: { equals: numericId } },
        { customer: { equals: customerId } },
      ],
    },
  })

  const invoice = found.docs[0]

  if (!invoice?.pdfStorageKey) {
    // Either it is not theirs, or the PDF has not been rendered yet. Both are
    // "not found" to the caller; the retry sweep deals with the second.
    return notFound()
  }

  let pdf: Buffer

  try {
    pdf = await getPrivateDocument(invoice.pdfStorageKey)
  } catch (error) {
    payload.logger.error(
      {
        scope: 'invoicing',
        event: 'document.download_failed',
        invoiceId: invoice.id,
      },
      `Could not read a stored document: ${error instanceof Error ? error.message : 'unknown'}`,
    )

    return NextResponse.json(
      { error: 'Doklad se nepodařilo načíst.' },
      { status: 502, headers: { 'cache-control': 'no-store' } },
    )
  }

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      // The document number, not the row id: that is what the customer and
      // their accountant will look for on disk.
      'content-disposition': `attachment; filename="${invoice.number}.pdf"`,
      'content-length': String(pdf.length),
      // Never cached. See the note at the top.
      'cache-control': 'no-store, private',
      'x-content-type-options': 'nosniff',
    },
  })
}
