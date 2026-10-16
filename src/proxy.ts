import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Next.js 16 proxy (the file formerly known as `middleware.ts`).
 *
 * Next resolves `(?:src/)?proxy` and prefers a named `proxy` export. Do NOT
 * add `src/middleware.ts` — with both present the behaviour is ambiguous.
 *
 * Currently a pass-through. It exists now so later steps have one obvious
 * place to put edge-level concerns:
 *   - locale negotiation and `/cs` `/en` rewrites (i18n step)
 *   - subscription gating for premium routes (auth step)
 *   - per-request CSP nonce generation (CSP step)
 *
 * Keep it cheap. This runs before every matched request, and anything slow
 * here is slow for the whole site.
 *
 * The matcher deliberately excludes /admin and /api: Payload owns both, and
 * routing them through here buys nothing but latency.
 *
 * It also excludes /webhooks, and that one is not about latency. The planned
 * "subscription gating" above would redirect an unauthenticated request, and
 * a provider webhook is by definition unauthenticated in session terms. The
 * result would be Stripe receiving a 307 for every event, our subscription
 * records silently drifting, and nothing in the billing code to explain it.
 * Excluding the path now costs one word and removes the trap before anybody
 * can fall into it.
 */
export function proxy(_request: NextRequest): NextResponse {
  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Everything except:
     *   admin      — Payload admin panel
     *   api        — Payload REST API
     *   healthz    — health probe, must stay as fast and dumb as possible
     *   webhooks   — provider callbacks; never session-authenticated, and a
     *                redirect here would break payments silently
     *   _next/*    — build output
     *   static file requests (anything with a file extension)
     */
    '/((?!admin|api|healthz|webhooks|_next/static|_next/image|.*\\.[\\w]+$).*)',
  ],
}
