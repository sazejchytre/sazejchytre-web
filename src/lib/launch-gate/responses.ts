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
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE PRIVATE-MODE PAGE IS CZECH, AND LIVES HERE RATHER THAN IN `cs.ts`
 *
 * It is the one refusal a person is likely to read: anybody who opens the
 * address while the site is private gets it. So it is a small Czech HTML
 * page, not a status line.
 *
 * It is kept in this module, not in the message catalogue, on purpose. The
 * proxy answers before any page renders, so the catalogue's machinery is not
 * there to load it from, and the module stays dependency-free for the unit
 * tests. The copy follows the same rules as the catalogue, and
 * `responses.test.ts` enforces them for it: it says what is true (the site is
 * not available for now), promises no date, urges nothing, and names no one.
 *
 * No script, no stylesheet, no image, nothing fetched: a refusal must not
 * depend on any other path, all of which are refused too.
 */
import type { RefusalReason } from './decide.ts'
import type { HttpMethod } from './routes.ts'

export const GATE_HEADER = 'x-launch-gate'

const COMMON_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow',
})

const TEXT = 'text/plain; charset=utf-8'
const HTML = 'text/html; charset=utf-8'

/** robots.txt while the site is private: stay out of everything. */
export const PRIVATE_ROBOTS_TXT = 'User-agent: *\nDisallow: /\n'

/** The page anyone opening the site sees while it is private. */
export const PRIVATE_MAINTENANCE_HTML = `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Sázej chytře – web je dočasně nedostupný</title>
</head>
<body>
<main>
<h1>Web je dočasně nedostupný</h1>
<p>Na webu právě probíhají přípravy a údržba. Zkuste to prosím později.</p>
</main>
</body>
</html>
`

const STATUS: Readonly<Record<RefusalReason, number>> = Object.freeze({
  private: 503,
  'private-robots': 200,
  'not-found': 404,
  method: 405,
})

const BODY: Readonly<Record<RefusalReason, string>> = Object.freeze({
  private: PRIVATE_MAINTENANCE_HTML,
  'private-robots': PRIVATE_ROBOTS_TXT,
  'not-found': 'Not Found\n',
  method: 'Method Not Allowed\n',
})

const CONTENT_TYPE: Readonly<Record<RefusalReason, string>> = Object.freeze({
  private: HTML,
  'private-robots': TEXT,
  'not-found': TEXT,
  method: TEXT,
})

export const refusalStatus = (reason: RefusalReason): number => STATUS[reason]

export const refusalHeaders = (
  reason: RefusalReason,
  allow?: readonly HttpMethod[],
): Headers => {
  const headers = new Headers(COMMON_HEADERS)
  headers.set('content-type', CONTENT_TYPE[reason])
  headers.set(GATE_HEADER, reason)

  if (reason === 'private') {
    headers.set('content-language', 'cs')
  }

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
