/**
 * Cache headers for responses that depend on who is asking.
 *
 * Every Payload REST response is one of those. Payload evaluates access
 * control against the request's session for every read, so the same URL can
 * answer an administrator's data to one caller and a refusal or a reduced
 * document to the next. A shared cache that stored one of those answers
 * would replay it to everybody, and a cache keyed on the URL alone — the
 * default of most reverse proxies — would do exactly that the moment a
 * response arrived without instructions. Payload sends none.
 *
 * So every REST response leaves with:
 *
 *   Cache-Control: private, no-store
 *       `no-store`: no cache, shared or private, may keep it at all.
 *       `private`: for any cache that honours only part of the header, the
 *       response is not for a shared cache.
 *   Vary: …, Authorization, Cookie
 *       Appended to whatever `Vary` already says (the framework's own values
 *       stay), so a cache that ignores `no-store` still cannot answer one
 *       caller's credentials with another caller's response.
 *
 * This is the application's own guarantee. It does not depend on purging a
 * cache when `LAUNCH_MODE` changes, and it holds in every mode.
 *
 * Dependency-free so it runs under Node's native type stripping in the unit
 * tests.
 */

export const SESSION_CACHE_CONTROL = 'private, no-store'

/** The request headers a REST response's content can depend on. */
export const SESSION_VARY: readonly string[] = ['Authorization', 'Cookie']

/**
 * `existing` plus `additions`, keeping existing values and their order and
 * adding each missing one once, case-insensitively. `*` already varies on
 * everything and is kept as it is.
 */
export const mergeVary = (
  existing: string | null,
  additions: readonly string[],
): string => {
  const values = (existing ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '')

  if (values.includes('*')) {
    return '*'
  }

  const seen = new Set(values.map((value) => value.toLowerCase()))

  for (const addition of additions) {
    if (!seen.has(addition.toLowerCase())) {
      values.push(addition)
      seen.add(addition.toLowerCase())
    }
  }

  return values.join(', ')
}

/** Apply the session cache headers to a set of response headers, in place. */
export const applySessionCacheHeaders = (headers: Headers): Headers => {
  headers.set('cache-control', SESSION_CACHE_CONTROL)
  headers.set('vary', mergeVary(headers.get('vary'), SESSION_VARY))
  return headers
}

/**
 * The same response with the session cache headers. A new `Response`, so it
 * works on responses whose headers are immutable; the body is passed through
 * unread.
 */
export const withSessionCacheHeaders = (response: Response): Response =>
  new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: applySessionCacheHeaders(new Headers(response.headers)),
  })
