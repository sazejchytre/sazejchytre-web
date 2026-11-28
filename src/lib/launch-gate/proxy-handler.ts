/**
 * The launch gate as a proxy step: one request in, one response out.
 *
 * `src/proxy.ts` is a thin wrapper around this, so the whole behaviour can be
 * exercised in unit tests with real `NextRequest` objects for every route,
 * method and mode without starting a server.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * A REFUSAL IS ANSWERED HERE, COMPLETELY. NOTHING IS DELEGATED.
 *
 * Every refused request — every method, every request kind (document, RSC
 * navigation, prefetch, Server Action, form post) — gets its final response
 * from this function. The framework is never asked to route it anywhere.
 *
 * In particular there is no rewrite to a not-found page. A rewrite target is
 * an absolute URL, and how the framework resolves it depends on the host
 * name and the address the server is bound to. A refusal must not depend on
 * either, so the gate answers with its own self-contained page
 * (`responses.ts`), and `routes.test.ts` pins that no rewrite or redirect
 * is used anywhere in the gate.
 *
 * The closed route itself never runs: the proxy returns before routing, so
 * no page, layout, route handler or Server Action of a closed area is loaded.
 *
 * `x-launch-gate-seen` is set on every response the gate handles, passed or
 * refused. It tells the deployment check that a response came from the
 * application rather than from something in front of it (a reverse proxy's
 * own 403), and it says nothing a visitor could use: not the mode, not the
 * route, not the decision.
 */
import { NextResponse, type NextRequest } from 'next/server.js'

import { decide } from './decide.ts'
import { GATE_SEEN_HEADER, refusalResponse } from './responses.ts'

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
    const response = NextResponse.next()
    response.headers.set(GATE_SEEN_HEADER, '1')
    return response
  }

  return refusalResponse(decision.reason, {
    method: request.method,
    ...(decision.allow === undefined ? {} : { allow: decision.allow }),
  })
}
