import type { MetadataRoute } from 'next'

import { absoluteUrl } from '@/lib/seo/base'
import { indexingAllowed } from '@/lib/seo/metadata'
import { DISALLOWED_PREFIXES } from '@/lib/seo/routes'

/**
 * `robots.txt`, generated.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * GENERATED, BECAUSE THE SITEMAP URL IS ABSOLUTE
 *
 * A `robots.txt` has to name its sitemap with a full URL, and that URL is
 * origin-dependent. A static file in `public/` would hardcode the production
 * domain, which is wrong on every preview deployment and in local
 * development — and the one place a hardcoded domain is most likely to stay
 * wrong for months is a file nobody opens.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * A NON-PRODUCTION HOST DISALLOWS EVERYTHING
 *
 * A preview deployment serves the same code against the same database. If it
 * gets indexed it competes with the real site, and the duplicate is often the
 * one that wins. `robots.txt` is not sufficient on its own — a crawler handed
 * a preview URL directly will fetch it anyway — which is why the pages
 * themselves also carry `noindex` off the canonical host. This is the outer
 * layer of the same decision.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * AI CRAWLERS ARE ALLOWED, DELIBERATELY
 *
 * There is no `Disallow` for GPTBot, ClaudeBot, PerplexityBot or anyone else.
 * The product's claim is "here is our record, check it", and an assistant
 * answering "what is their actual return, and do they show the losses?" from
 * the real `/historie` page — which publishes a `Dataset` with its sample
 * size and its method attached — is the best possible outcome for this
 * business. Blocking them would leave the answer to come from somewhere else.
 *
 * `llms.txt` exists for the same reason: see `src/app/llms.txt/route.ts`.
 */
export default function robots(): MetadataRoute.Robots {
  if (!indexingAllowed()) {
    return {
      rules: { userAgent: '*', disallow: '/' },
    }
  }

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Not access control — see the note on DISALLOWED_PREFIXES. Every one
      // of these is protected by its own authentication.
      disallow: [...DISALLOWED_PREFIXES],
    },
    sitemap: absoluteUrl('/sitemap.xml'),
    host: absoluteUrl('/'),
  }
}
