/**
 * The launch gate as a proxy step: one request in, one response out.
 *
 * `src/proxy.ts` is a thin wrapper around this, so the whole behaviour can be
 * exercised in unit tests with real `NextRequest` objects for every route,
 * method and mode without starting a server.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY A `not-found` GET IS A REWRITE
 *
 * A visitor who types a closed address, or follows an old bookmark to one,
 * should land on the site's own 404 page with its navigation, not on a bare
 * status line: the public site has no dead ends. So a GET or HEAD refused as
 * `not-found` is rewritten to `NOT_FOUND_PATH`, which no route serves —
 * it sits under an underscore segment, which the App Router never routes —
 * and Next answers it with `global-not-found.tsx` and status 404. The closed
 * page itself is never rendered: a rewrite replaces the route, it does not
 * wrap it. `routes.test.ts` asserts that nothing in `src/app` can match the
 * rewrite target.
 *
 * Every other method gets the plain 404 from `responses.ts`. A POST is how a
 * Server Function is invoked, and the safe answer to one aimed at a closed
 * area is to process nothing at all.
 */
import { NextResponse, type NextRequest } from 'next/server.js'

import { decide } from './decide.ts'
import { GATE_HEADER, refusalResponse } from './responses.ts'

/** Rewrite target for a refused GET/HEAD in INFORMATIONAL mode. */
export const NOT_FOUND_PATH = '/_launch-gate/not-found'

export type LaunchGateOptions = {
  /** True only under `next dev`. */
  development: boolean
}

export const runLaunchGate = (
  request: NextRequest,
  mode: unknown,
  { development }: LaunchGateOptions,
): Response => {
  const decision = decide({
    mode,
    method: request.method,
    pathname: request.nextUrl.pathname,
    development,
  })

  if (decision.action === 'pass') {
    return NextResponse.next()
  }

  const method = request.method.toUpperCase()

  if (
    decision.reason === 'not-found' &&
    (method === 'GET' || method === 'HEAD')
  ) {
    const response = NextResponse.rewrite(
      new URL(NOT_FOUND_PATH, request.nextUrl.origin),
    )
    response.headers.set(GATE_HEADER, decision.reason)
    response.headers.set('cache-control', 'no-store')
    response.headers.set('x-robots-tag', 'noindex, nofollow')

    return response
  }

  return refusalResponse(decision.reason, {
    method,
    ...(decision.allow === undefined ? {} : { allow: decision.allow }),
  })
}
