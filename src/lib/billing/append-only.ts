/**
 * Hook factories for append-only and immutable collections.
 *
 * WHY HOOKS AND NOT ACCESS CONTROL ALONE
 *
 * Access control answers "may this caller update this collection at all". That
 * is the right tool for an audit log nobody may ever touch, and it is used
 * there as well. But it cannot express "this document may be updated, but only
 * its `status` field", which is exactly what an issued invoice needs: the
 * document is frozen, yet it still has to be markable as credited.
 *
 * So both are applied, and they answer different questions:
 *
 *  - `access.update` / `access.delete` — can anyone do this, ever.
 *  - the hooks below — given that an update is allowed, is this particular
 *    change permitted.
 *
 * WHY THIS IS NOT A DATABASE GUARANTEE
 *
 * Immutability of this kind is not expressible as a Postgres constraint; it
 * needs a row trigger comparing OLD and NEW. A trigger would be stronger — it
 * would also stop a direct `psql` UPDATE — but it would live outside Payload's
 * generated migrations, making the schema no longer single-source, and it
 * would silently diverge from the field list as fields are added. The hook is
 * the weaker but maintainable choice, and the audit trail (SubscriptionEvent)
 * is what detects tampering that bypasses it. This trade-off is called out in
 * the step report rather than hidden here.
 */
import type {
  CollectionBeforeDeleteHook,
  CollectionBeforeValidateHook,
} from 'payload'
import { APIError } from 'payload'

/** Fields Payload manages itself; a change to these is never a user edit. */
const ALWAYS_IGNORED = new Set(['id', 'updatedAt', 'createdAt'])

/**
 * Compare two field values for "did the caller actually change this".
 *
 * Dates need special handling: the stored document carries an ISO string while
 * an incoming payload may carry a `Date`, and a naive `!==` would read every
 * untouched date field as modified — which would make the admin panel unable
 * to save even a permitted change.
 */
const isSameValue = (a: unknown, b: unknown): boolean => {
  if (a === b) {
    return true
  }

  // Treat null and undefined as the same absence.
  if ((a === null || a === undefined) && (b === null || b === undefined)) {
    return true
  }

  if (a instanceof Date || b instanceof Date) {
    const timeA =
      a instanceof Date ? a.getTime() : new Date(String(a)).getTime()
    const timeB =
      b instanceof Date ? b.getTime() : new Date(String(b)).getTime()

    if (!Number.isNaN(timeA) && !Number.isNaN(timeB)) {
      return timeA === timeB
    }
  }

  // A relationship may arrive as an id or as a populated document.
  const idA =
    typeof a === 'object' && a !== null && 'id' in a
      ? (a as { id: unknown }).id
      : a
  const idB =
    typeof b === 'object' && b !== null && 'id' in b
      ? (b as { id: unknown }).id
      : b

  if (idA !== a || idB !== b) {
    return String(idA) === String(idB)
  }

  if (typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b)
  }

  // Dates that arrived as two differently formatted strings.
  if (typeof a === 'string' && typeof b === 'string') {
    const timeA = new Date(a).getTime()
    const timeB = new Date(b).getTime()

    if (!Number.isNaN(timeA) && !Number.isNaN(timeB)) {
      return timeA === timeB
    }
  }

  return false
}

/**
 * Reject an update that touches anything outside `mutableFields`.
 *
 * Pass an empty list for a strictly append-only collection.
 *
 * REGISTERED AS `beforeValidate`, AND FIRST, deliberately. Payload runs
 * `beforeValidate` ahead of field validation and `beforeChange`, so putting the
 * lock here means an immutable document is refused before anything inspects
 * what the new values would have been. Registered later, a rejected edit
 * reports whichever content rule happened to trip first — "totals do not add
 * up" rather than "this document is immutable" — which tells the caller to fix
 * their arithmetic when the real answer is that the document cannot change at
 * all. The document was protected either way; the diagnosis was wrong.
 */
export const lockFieldsAfterCreate = (
  what: string,
  mutableFields: readonly string[] = [],
): CollectionBeforeValidateHook => {
  const allowed = new Set(mutableFields)

  return ({ data, operation, originalDoc }) => {
    if (operation !== 'update' || !originalDoc) {
      return data
    }

    const offending = Object.keys(data ?? {}).filter((field) => {
      if (ALWAYS_IGNORED.has(field) || allowed.has(field)) {
        return false
      }

      return !isSameValue(
        (data as Record<string, unknown>)[field],
        (originalDoc as Record<string, unknown>)[field],
      )
    })

    if (offending.length > 0) {
      throw new APIError(
        `${what} is immutable once created. Attempted to change: ${offending.join(', ')}. ` +
          (allowed.size > 0
            ? `Only ${[...allowed].join(', ')} may be modified.`
            : 'No field may be modified; corrections are recorded as new documents.'),
        403,
      )
    }

    return data
  }
}

/** Reject every delete, whatever the caller's permissions say. */
export const blockDeletes = (what: string): CollectionBeforeDeleteHook => {
  return () => {
    throw new APIError(
      `${what} cannot be deleted. It is part of an append-only record; ` +
        'corrections are made by issuing a new document, never by removing one.',
      403,
    )
  }
}
