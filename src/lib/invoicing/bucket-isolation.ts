/**
 * The rule that keeps documents out of the publicly-served bucket.
 *
 * Its own module, with no environment import, so the rule can be tested
 * without a configured environment — and so there is one statement of it
 * rather than a condition buried in a storage function.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS AT ALL
 *
 * The first version of document storage used a `private/` prefix inside the
 * media bucket, on the assumption that the public domain only served
 * `media/`. That assumption was wrong and was proven wrong by fetching one:
 * `R2_PUBLIC_BASE_URL` is bound to the bucket at its ROOT, so the document
 * came back over the public domain with HTTP 200.
 *
 * Object keys are not secrets and document numbers are sequential, so a
 * document in a publicly-bound bucket is readable by anyone who can count.
 * And the CDN cache does not purge on delete, so the leak would outlive the
 * fix.
 *
 * Hence a check that fails loudly rather than a convention that can be
 * misread the same way twice.
 */

/** Raised when documents would be stored somewhere publicly reachable. */
export class DocumentBucketNotIsolatedError extends Error {
  readonly code = 'DOCUMENT_BUCKET_NOT_ISOLATED'

  constructor(bucket: string) {
    super(
      `Documents may not be stored in "${bucket}": it is the bucket that ` +
        'R2_PUBLIC_BASE_URL is bound to, so anything in it is publicly ' +
        'fetchable by URL regardless of the prefix — and the CDN cache does ' +
        'not purge on delete, so a leak outlives the fix. Create a separate ' +
        'bucket with no public domain and no r2.dev access, and point ' +
        'R2_DOCUMENTS_BUCKET at it.',
    )
    this.name = 'DocumentBucketNotIsolatedError'
  }
}

/**
 * Refuse to proceed unless the documents bucket is a different bucket.
 *
 * Compared case-insensitively and trimmed: R2 bucket names are
 * case-sensitive, but a name differing only in case or whitespace is a typo
 * rather than an intended second bucket, and treating it as isolation would
 * be exactly the silent misconfiguration this guards against.
 *
 * @throws {DocumentBucketNotIsolatedError}
 */
export const assertBucketsDiffer = (
  documentsBucket: string,
  publicMediaBucket: string,
): void => {
  const documents = documentsBucket.trim().toLowerCase()
  const media = publicMediaBucket.trim().toLowerCase()

  if (documents.length === 0) {
    throw new DocumentBucketNotIsolatedError('(empty)')
  }

  if (documents === media) {
    throw new DocumentBucketNotIsolatedError(documentsBucket)
  }
}
