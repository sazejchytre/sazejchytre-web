/**
 * Storing documents in R2, privately.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * A SEPARATE BUCKET, NOT A PREFIX
 *
 * The first version of this used a `private/` prefix inside the media bucket.
 * That was wrong, and it was proven wrong by fetching one: the public domain
 * is bound to the media bucket at its ROOT, so every prefix in it is served
 * publicly. `GET https://cdn.sazejchytre.cz/private/documents/...` returned
 * the PDF with HTTP 200.
 *
 * An object key is not a secret, and document numbers are sequential. So a
 * document in a publicly-bound bucket is readable by anyone who can count.
 *
 * Documents therefore live in a bucket of their own with no public domain and
 * no r2.dev access, and reach the customer only through an authenticated
 * route that checks the document is theirs. The prefix is kept as well, but
 * it is tidiness, not a control.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * AND THE CDN CACHE DOES NOT PURGE ON DELETE
 *
 * This is what makes the mistake unrecoverable rather than embarrassing. A
 * document served through the public binding is cached at the edge; deleting
 * the object in R2 does not evict that copy. The leak outlives the fix by
 * however long the cache lives, and no deploy takes it back.
 *
 * Hence `assertDocumentBucketIsolated()`: the configuration that caused this
 * cannot recur silently, because storing a document fails loudly instead.
 */
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'

import { env } from '../env.ts'
import { assertBucketsDiffer } from './bucket-isolation.ts'

/**
 * The prefix documents live under.
 *
 * Deliberately not `media/`, which the public domain maps to. Changing this
 * to anything the CDN serves would be a privacy incident, so it is a constant
 * rather than configuration.
 */
export const PRIVATE_DOCUMENT_PREFIX = 'private/documents'

/**
 * Refuse to store documents in the publicly-served bucket.
 *
 * The one check that matters. `R2_BUCKET` has a public domain bound to its
 * root; `R2_DOCUMENTS_BUCKET` must not be the same bucket, or every invoice
 * is one guessed URL away from a stranger. Checked on every store and every
 * read rather than once at boot, because the cost is a string comparison and
 * the failure is a privacy incident.
 */
export const assertDocumentBucketIsolated = (): void => {
  assertBucketsDiffer(env.R2_DOCUMENTS_BUCKET, env.R2_BUCKET)
}

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

  assertDocumentBucketIsolated()

  await getClient().send(
    new PutObjectCommand({
      Bucket: env.R2_DOCUMENTS_BUCKET,
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
  assertDocumentBucketIsolated()

  const result = await getClient().send(
    new GetObjectCommand({ Bucket: env.R2_DOCUMENTS_BUCKET, Key: key }),
  )

  const body = result.Body

  if (!body) {
    throw new Error(`Document ${key} has no body in storage.`)
  }

  return Buffer.from(await body.transformToByteArray())
}
