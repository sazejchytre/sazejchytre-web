/**
 * The responses the launch gate answers with when it refuses a request.
 *
 * Plain, short and identical for every path with the same reason, so that a
 * refusal carries no information about what the path would have served.
 * Every refusal is `no-store` (no shared cache may keep it and replay it
 * after the mode changes) and `noindex` (no crawler may keep the URL).
 *
 * `x-launch-gate` names the reason. It is there for the deployment check in
 * `src/scripts/verify-launch-gate.ts`, which has to tell a refusal by the
 * gate from a 404 the application produced itself, and it says nothing a
 * visitor could not read off the status code.
 *
 * Built on the standard `Response` so the Payload API guard can use the same
 * answers outside the proxy.
 */
import type { RefusalReason } from './decide.ts'
import type { HttpMethod } from './routes.ts'

export const GATE_HEADER = 'x-launch-gate'

const BASE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow',
  'content-type': 'text/plain; charset=utf-8',
})

/** robots.txt while the site is private: stay out of everything. */
export const PRIVATE_ROBOTS_TXT = 'User-agent: *\nDisallow: /\n'

const STATUS: Readonly<Record<RefusalReason, number>> = Object.freeze({
  private: 503,
  'private-robots': 200,
  'not-found': 404,
  method: 405,
})

const BODY: Readonly<Record<RefusalReason, string>> = Object.freeze({
  private: 'Service Unavailable\n',
  'private-robots': PRIVATE_ROBOTS_TXT,
  'not-found': 'Not Found\n',
  method: 'Method Not Allowed\n',
})

export const refusalStatus = (reason: RefusalReason): number => STATUS[reason]

export const refusalHeaders = (
  reason: RefusalReason,
  allow?: readonly HttpMethod[],
): Headers => {
  const headers = new Headers(BASE_HEADERS)
  headers.set(GATE_HEADER, reason)

  if (reason === 'method' && allow !== undefined) {
    headers.set('allow', allow.join(', '))
  }

  return headers
}

export const refusalResponse = (
  reason: RefusalReason,
  options: { method?: string; allow?: readonly HttpMethod[] } = {},
): Response =>
  new Response(options.method?.toUpperCase() === 'HEAD' ? null : BODY[reason], {
    status: STATUS[reason],
    headers: refusalHeaders(reason, options.allow),
  })
