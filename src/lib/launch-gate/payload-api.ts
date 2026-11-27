/**
 * The Payload REST API under PRIVATE mode.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THE API NEEDS ITS OWN RULE
 *
 * The proxy cannot close `/api/*`: the admin panel calls it, and the panel is
 * the one thing a private deployment exists to keep working. But Payload's
 * access rules let an anonymous caller read the published legal documents,
 * the FAQ, the site settings and media metadata, because the public pages
 * need exactly that. In PRIVATE mode that would leave the informational
 * content readable through the API while every page is closed.
 *
 * So in PRIVATE mode, and only there, the API serves:
 *
 *   - a request authenticated as an administrator (Payload verifies the
 *     session itself; see `payload-api-guard.ts`), and
 *   - the administrator sign-in operations, without which nobody could
 *     authenticate in the first place.
 *
 * Everything else gets the same `private` refusal as a page. In
 * INFORMATIONAL and FULL the API is left exactly as it is: what it serves to
 * an anonymous caller there is what the public pages already show.
 *
 * Hardening of the administrator sign-in itself is SC-019's scope, not this
 * module's; this list only decides what stays reachable.
 *
 * Dependency-free, so the decision is unit-tested on its own.
 */
import { resolveLaunchMode } from './modes.ts'

export type PayloadApiAccess =
  /** Hand the request to Payload unchanged. */
  | 'open'
  /** Only an authenticated administrator may proceed. */
  | 'administrator-only'

/** Payload's own auth endpoints for the administrators' `users` collection. */
const ADMIN_SIGN_IN_OPERATIONS: ReadonlyArray<{
  method: string
  pattern: RegExp
}> = Object.freeze([
  { method: 'GET', pattern: /^\/api\/access$/ },
  { method: 'GET', pattern: /^\/api\/users\/me$/ },
  { method: 'GET', pattern: /^\/api\/users\/init$/ },
  { method: 'POST', pattern: /^\/api\/users\/login$/ },
  { method: 'POST', pattern: /^\/api\/users\/logout$/ },
  { method: 'POST', pattern: /^\/api\/users\/refresh-token$/ },
  { method: 'POST', pattern: /^\/api\/users\/forgot-password$/ },
  { method: 'POST', pattern: /^\/api\/users\/reset-password$/ },
  { method: 'POST', pattern: /^\/api\/users\/first-register$/ },
  { method: 'POST', pattern: /^\/api\/users\/unlock$/ },
  { method: 'POST', pattern: /^\/api\/users\/verify\/[^/]+$/ },
])

export const isAdminSignInOperation = (
  method: string,
  pathname: string,
): boolean => {
  const upper = method.toUpperCase()

  return ADMIN_SIGN_IN_OPERATIONS.some(
    (operation) =>
      // HEAD is answered like GET by the route layer.
      (operation.method === upper ||
        (operation.method === 'GET' && upper === 'HEAD')) &&
      operation.pattern.test(pathname),
  )
}

export const payloadApiAccess = (
  mode: unknown,
  method: string,
  pathname: string,
): PayloadApiAccess => {
  if (resolveLaunchMode(mode) !== 'PRIVATE') {
    return 'open'
  }

  return isAdminSignInOperation(method, pathname)
    ? 'open'
    : 'administrator-only'
}
