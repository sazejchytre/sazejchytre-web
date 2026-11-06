import { withPayload } from '@payloadcms/next/withPayload'
import createNextIntlPlugin from 'next-intl/plugin'
import type { NextConfig } from 'next'

/**
 * next-intl, pointed at the request config.
 *
 * No routing middleware: there is one locale and it is unprefixed, so there
 * is nothing to negotiate. See `src/i18n/request.ts`.
 */
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

/**
 * Baseline security headers.
 *
 * NOTE: Content-Security-Policy is deliberately ABSENT. A nonce-based CSP is
 * its own step — it needs the proxy to mint a per-request nonce and every
 * inline script/style to be threaded through it. Adding a half-working CSP now
 * would either be so loose it protects nothing, or so tight it breaks the
 * Payload admin panel and every feature added after it.
 */
const securityHeaders = [
  {
    // Two years, subdomains included, preload-eligible. Browsers ignore this
    // over plain HTTP, so it is safe in local development.
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    // Stop the browser from second-guessing Content-Type. Directly relevant to
    // user-uploaded media.
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    // No framing at all. Nothing here is meant to be embedded, and the admin
    // panel especially must not be clickjackable.
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    // Send the full URL same-origin, origin-only cross-origin, nothing on
    // downgrade.
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    // Deny the powerful APIs this product has no use for. Extend explicitly if
    // a feature ever needs one.
    key: 'Permissions-Policy',
    value: [
      'accelerometer=()',
      'autoplay=()',
      'camera=()',
      'display-capture=()',
      'encrypted-media=()',
      'fullscreen=(self)',
      'geolocation=()',
      'gyroscope=()',
      'magnetometer=()',
      'microphone=()',
      'midi=()',
      'payment=(self)',
      'usb=()',
      'xr-spatial-tracking=()',
    ].join(', '),
  },
]

const nextConfig: NextConfig = {
  reactStrictMode: true,

  /**
   * `global-not-found.tsx`, which needs this flag.
   *
   * This app has TWO root layouts — `(frontend)` and `(payload)` — so when a
   * request matches no route at all, Next cannot choose which one to render
   * the 404 inside and falls back to its own grey default page. Verified by
   * requesting a nonsense URL before this was added.
   *
   * `experimental.globalNotFound` is the documented way out of exactly that
   * situation. It is experimental, so it is worth knowing why it is here:
   * without it the site has no 404 of its own for a mistyped URL, which is
   * the single most common way anybody arrives at one.
   */
  experimental: {
    globalNotFound: true,
  },
  // Drops the `X-Powered-By: Next.js` fingerprint.
  poweredByHeader: false,

  // A type error must fail the build. Never flip this to true.
  // (Next 16 no longer runs ESLint during `next build`; CI runs it as its own
  // step, which is where a lint failure should surface anyway.)
  typescript: { ignoreBuildErrors: false },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ]
  },
}

const composed = withPayload(withNextIntl(nextConfig), {
  devBundleServerPackages: false,
})

/**
 * Keep Payload's colour-scheme client hint on the admin panel only.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT withPayload DOES, AND WHY IT COSTS THE PUBLIC SITE
 *
 * `withPayload` appends a header block of
 *
 *     Accept-CH:   Sec-CH-Prefers-Color-Scheme
 *     Vary:        Sec-CH-Prefers-Color-Scheme
 *     Critical-CH: Sec-CH-Prefers-Color-Scheme
 *
 * at `source: '/:path*'` — every route on the site. It is there so the admin
 * panel can render in the right theme on the server, which is a real feature
 * and worth having AT `/admin`.
 *
 * `Critical-CH` is the expensive part. It tells the browser that the hint is
 * critical, so on a first visit the browser ABANDONS the response and
 * restarts the request with the hint attached. A Lighthouse run on the home
 * page reported it as "Avoid multiple page redirects — 608 ms", listing the
 * same URL twice, and the extra navigation also produced an intermittent
 * CLS of 0.104 that appeared on some runs and not others.
 *
 * Nothing on the public site reads the hint: the theme there is a CSS
 * `prefers-color-scheme` media query, resolved in the browser with no server
 * involvement at all. So every public visitor was paying a round trip for a
 * header only the admin panel uses.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY IT IS DONE BY REWRITING THE COMPOSED CONFIG
 *
 * Because `withPayload` appends its block AFTER ours and offers no option to
 * scope it. The block is identified by its source rather than by position,
 * so if Payload reorders or renames things this stops matching and the
 * header simply returns to being site-wide — degrading to the previous
 * behaviour rather than silently dropping our own security headers.
 *
 * Revisit on a Payload upgrade: if `withPayload` ever scopes this itself,
 * this wrapper becomes dead weight.
 */
const PAYLOAD_GLOBAL_SOURCE = '/:path*'
const ADMIN_ONLY_SOURCE = '/admin/:path*'

const isPayloadClientHintBlock = (block: {
  source: string
  headers: { key: string }[]
}): boolean =>
  block.source === PAYLOAD_GLOBAL_SOURCE &&
  block.headers.some((header) => header.key === 'Critical-CH')

export default {
  ...composed,
  async headers() {
    const blocks = (await composed.headers?.()) ?? []

    return blocks.map((block) =>
      'source' in block && isPayloadClientHintBlock(block)
        ? { ...block, source: ADMIN_ONLY_SOURCE }
        : block,
    )
  },
} satisfies NextConfig
