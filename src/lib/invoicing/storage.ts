/**
 * Storing documents in R2, privately.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY NOT THE MEDIA BINDING
 *
 * `media` is served straight from `cdn.sazejchytre.cz` with
 * `disablePayloadAccessControl: true`, because serving public images through a
 * serverless function is a waste. Invoices are the opposite case: they carry
 * both parties' names and addresses and what somebody bought, and an object
 * key is not a secret. A document reachable by URL is a document reachable by
 * anybody who guesses, scrapes or is forwarded that URL.
 *
 * So documents go under a prefix that the public domain does not map to, and
 * reach the customer only through an authenticated route that checks the
 * document is theirs.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * AND THE CDN CACHE DOES NOT PURGE ON DELETE
 *
 * This is the part that makes the mistake unrecoverable rather than
 * embarrassing. If a document is ever served through the public binding, the
 * CDN caches it at the edge; deleting the object in R2 does not evict that
 * copy. The leak then outlives the fix by however long the cache lives, and
 * there is no deploy that takes it back.
 *
 * Which is why this is a separate prefix and a separate code path rather than
 * a flag on the existing one. There is no configuration mistake that can
 * quietly make these public.
 */
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'

import { env } from '../env.ts'

/**
 * The prefix documents live under.
 *
 * Deliberately not `media/`, which the public domain maps to. Changing this
 * to anything the CDN serves would be a privacy incident, so it is a constant
 * rather than configuration.
 */
export const PRIVATE_DOCUMENT_PREFIX = 'private/documents'

let client: S3Client | null = null

/**
 * The S3 client for R2.
 *
 * Its own client rather than Payload's: this writes to a prefix Payload does
 * not manage, and sharing the plugin's instance would couple document storage
 * to the media configuration — exactly the coupling the note above warns
 * about.
 */
const getClient = (): S3Client => {
  if (client) return client

  client = new S3Client({
    // R2 is S3-compatible but has no regions.
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  })

  return client
}

/** For tests that swap configuration. */
export const resetDocumentStorageClient = (): void => {
  client = null
}

export type DocumentStorageKind = 'invoices' | 'credit-notes'

/**
 * The object key for a document.
 *
 * Partitioned by year because that is how documents are retrieved for an
 * accountant and for a tax inspection, and because a flat prefix with ten
 * years of documents in it is unpleasant to list.
 *
 * The number is the filename, so an object found loose in a bucket is
 * identifiable without a database.
 */
export const documentStorageKey = (
  kind: DocumentStorageKind,
  year: number,
  documentNumber: string,
): string => {
  if (!/^[A-Z]{2}\d{4}-\d{6}$/.test(documentNumber)) {
    // A key is derived from the number, so a malformed number must not be
    // allowed to produce a path with a slash or a traversal in it.
    throw new RangeError(`Malformed document number: ${documentNumber}`)
  }

  return `${PRIVATE_DOCUMENT_PREFIX}/${kind}/${String(year)}/${documentNumber}.pdf`
}

/** Store a document. Returns the key it was stored under. */
export const putPrivateDocument = async (
  key: string,
  body: Buffer,
): Promise<string> => {
  if (!key.startsWith(`${PRIVATE_DOCUMENT_PREFIX}/`)) {
    // Belt and braces against a future caller building its own key.
    throw new RangeError(
      `Refusing to store a document outside ${PRIVATE_DOCUMENT_PREFIX}/: ${key}`,
    )
  }

  await getClient().send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: 'application/pdf',
      // Belongs to nobody but the account holder, and must never be cached by
      // anything between R2 and the customer's browser.
      CacheControl: 'private, no-store',
      ContentDisposition: 'attachment',
    }),
  )

  return key
}

/** Read a document back, for the authenticated download route. */
export const getPrivateDocument = async (key: string): Promise<Buffer> => {
  const result = await getClient().send(
    new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }),
  )

  const body = result.Body

  if (!body) {
    throw new Error(`Document ${key} has no body in storage.`)
  }

  return Buffer.from(await body.transformToByteArray())
}
