/**
 * The launch gate's decision for one request: pass it on, or refuse it.
 *
 * A pure function of three inputs — the configured mode, the HTTP method and
 * the raw pathname — plus whether this is the development server. Nothing
 * else: no header, cookie or query parameter is read, so there is nothing a
 * caller can add to a request to change the answer.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT A REFUSAL LOOKS LIKE
 *
 *   PRIVATE        every path outside operations and administration gets the
 *                  same `private` refusal (503), whether it exists or not, so
 *                  a closed site does not reveal its own route list. The one
 *                  exception is `robots.txt`, which answers "disallow
 *                  everything" so that a crawler is told to stay away rather
 *                  than left to retry.
 *   INFORMATIONAL  a closed area or an unknown path gets `not-found` (404),
 *                  identical to a URL that never existed.
 *   any mode       an open route called with a method it does not accept gets
 *                  `method` (405) with the methods it does accept.
 *
 * FULL passes everything through untouched: that mode exists to be today's
 * behaviour, and the gate adds nothing to it.
 */
import { isSurfaceOpen, resolveLaunchMode, type LaunchMode } from './modes.ts'
import {
  classifyPath,
  isHttpMethod,
  type HttpMethod,
  type RouteRule,
} from './routes.ts'

export type GateRequest = {
  /** The configured mode. Anything that is not a valid mode means PRIVATE. */
  mode: unknown
  method: string
  /** Raw pathname, as received. Not decoded, not normalised. */
  pathname: string
  /** True only under `next dev`. Opens the dev server's own endpoints. */
  development: boolean
}

export type RefusalReason =
  'private' | 'private-robots' | 'not-found' | 'method'

export type GateDecision =
  | { action: 'pass'; mode: LaunchMode; rule: RouteRule | undefined }
  | {
      action: 'refuse'
      mode: LaunchMode
      reason: RefusalReason
      rule: RouteRule | undefined
      /** Only for `method`: what the route does accept. */
      allow?: readonly HttpMethod[]
    }

const isAreaOpen = (
  mode: LaunchMode,
  rule: RouteRule,
  development: boolean,
): boolean => {
  switch (rule.area) {
    case 'operations':
    case 'administration':
    case 'framework':
      return true
    case 'development':
      return development
    case 'public':
    case 'accounts':
    case 'payments':
      return isSurfaceOpen(mode, rule.area)
  }
}

export const decide = ({
  mode: configured,
  method,
  pathname,
  development,
}: GateRequest): GateDecision => {
  const mode = resolveLaunchMode(configured)
  const rule = classifyPath(pathname)

  if (mode === 'FULL') {
    return { action: 'pass', mode, rule }
  }

  if (rule === undefined || !isAreaOpen(mode, rule, development)) {
    if (mode === 'PRIVATE') {
      return {
        action: 'refuse',
        mode,
        reason: rule?.name === 'robots' ? 'private-robots' : 'private',
        rule,
      }
    }

    return { action: 'refuse', mode, reason: 'not-found', rule }
  }

  const upper = method.toUpperCase()

  if (
    rule.methods !== 'ANY' &&
    !(isHttpMethod(upper) && rule.methods.includes(upper))
  ) {
    return {
      action: 'refuse',
      mode,
      reason: 'method',
      rule,
      allow: rule.methods,
    }
  }

  return { action: 'pass', mode, rule }
}
