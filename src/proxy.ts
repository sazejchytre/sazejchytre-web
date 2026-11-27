import type { NextRequest } from 'next/server'

import { env, isDevelopment } from './lib/env.ts'
import { runLaunchGate } from './lib/launch-gate/proxy-handler.ts'

/**
 * Next.js 16 proxy (the file formerly known as `middleware.ts`).
 *
 * Next resolves `(?:src/)?proxy` and prefers a named `proxy` export. Do NOT
 * add `src/middleware.ts` — with both present the behaviour is ambiguous.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE LAUNCH GATE (SC-017)
 *
 * This is the server boundary that decides which parts of the application a
 * deployment serves, from `LAUNCH_MODE` alone: PRIVATE, INFORMATIONAL or
 * FULL. The route table, the decision and the responses live in
 * `src/lib/launch-gate/`; this file only wires them to the request.
 *
 * It runs for EVERY path except `/_next/static`, including `/admin`, `/api`,
 * `/healthz`, `/webhooks` and paths with a file extension. The earlier matcher
 * skipped all of those, which was harmless for a pass-through and would be a
 * hole in a gate: `llms.txt` and `sitemap.xml` publish the record, and a
 * matcher that skips "anything with a dot" skips them. The gate itself keeps
 * operations and administration open in every mode, so including them costs
 * a table lookup, not a behaviour change.
 *
 * Server Functions need no separate handling. They are POSTs to the page
 * that uses them, and when one is invoked against a different page Next
 * forwards it to its owning page with a fresh request, which passes through
 * here again. A closed page therefore closes its Server Functions too.
 *
 * The gate never redirects. It passes a request on, or answers it with a
 * refusal (404, 405 or 503) — so a provider webhook can never receive a 307
 * it does not understand, which was the reason `/webhooks` used to be
 * excluded from this file.
 *
 * Keep it cheap. This runs before every matched request, and anything slow
 * here is slow for the whole site. The gate is a regular-expression lookup
 * with no I/O.
 *
 * Later steps still have this file as their home for edge-level concerns
 * (per-request CSP nonce, locale negotiation). Put them after the gate, so
 * that a refused request never reaches them.
 */
export function proxy(request: NextRequest): Response {
  return runLaunchGate(request, env.LAUNCH_MODE, { development: isDevelopment })
}

export const config = {
  matcher: [
    /*
     * Everything except the hashed build assets under `/_next/static`, which
     * hold no data and are served before any route exists to protect.
     */
    '/((?!_next/static/).*)',
  ],
}
