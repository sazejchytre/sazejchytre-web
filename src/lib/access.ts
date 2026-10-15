import type { Access, PayloadRequest } from 'payload'

/**
 * Shared access-control predicates.
 *
 * Every collection wires these explicitly. Payload's own defaults are
 * permissive (an access key you forget to set is not "denied by default"), so
 * "we didn't specify it" must never be a reachable state in this codebase.
 */

export const USERS_SLUG = 'users'

function isAuthenticatedAdmin(user: PayloadRequest['user']): boolean {
  return Boolean(user) && user?.collection === USERS_SLUG
}

/** Authenticated user of the `users` collection. Used for all writes. */
export const isAdmin: Access = ({ req }) => isAuthenticatedAdmin(req.user)

/** Gatekeeps the /admin panel itself. Same rule, different Payload signature. */
export const canAccessAdminPanel = ({
  req,
}: {
  req: PayloadRequest
}): boolean => isAuthenticatedAdmin(req.user)

/** Unauthenticated read. Only ever correct for genuinely public assets. */
export const isPublic: Access = () => true

/** Denies everyone, including admins. For fields nothing may write. */
export const denyAll: Access = () => false
