/**
 * Where a document lives, as a path.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT IN `storage.ts`
 *
 * Because it is pure, and `storage.ts` is not: that module reads R2
 * credentials, so importing it drags the whole validated environment in.
 * Anything that only needs to KNOW a key — the issuing flow, the download
 * route, a test — would then need a full environment to do it.
 *
 * Splitting it also keeps the traversal guard testable without credentials,
 * which matters more than the tidiness: that guard is the only thing standing
 * between a provider-supplied document number and a path outside the private
 * prefix.
 */
/**
 * The prefix documents live under.
 *
 * Deliberately not `media/`, which the public domain maps to. Changing this
 * to anything the CDN serves would be a privacy incident, so it is a constant
 * rather than configuration.
 */
export const PRIVATE_DOCUMENT_PREFIX = 'private/documents'

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
  // A key is derived from the number, so a number containing a slash, a dot
  // segment or a backslash must never be allowed to produce a path outside
  // the private prefix.
  //
  // This used to assert our own `FA2026-000001` format exactly. It cannot any
  // more: the number now comes from the accounting provider, which uses its
  // own series and may change its format without consulting us. So the check
  // is on what makes a key SAFE rather than on what we expect it to look
  // like — a whitelist of filename characters, which refuses traversal
  // without pretending to know the provider's numbering scheme.
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(documentNumber)) {
    throw new RangeError(
      `Document number ${JSON.stringify(documentNumber)} is not safe to use ` +
        'as an object key.',
    )
  }

  if (documentNumber.includes('..')) {
    throw new RangeError(
      `Document number ${JSON.stringify(documentNumber)} contains a path ` +
        'traversal.',
    )
  }

  return `${PRIVATE_DOCUMENT_PREFIX}/${kind}/${String(year)}/${documentNumber}.pdf`
}
