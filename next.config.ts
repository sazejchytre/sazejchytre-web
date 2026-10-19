import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'

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

export default withPayload(nextConfig, { devBundleServerPackages: false })
