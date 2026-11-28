/**
 * Fixtures shared by the launch gate's tests. Not imported by the
 * application.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * `EXPECTED_ROUTES` IS WRITTEN BY HAND ON PURPOSE
 *
 * It is the reviewed answer to "what is each route, and when may it be
 * served". The tests compare it against two independent things: the route
 * files that actually exist under `src/app`, and the gate's own route table.
 * Adding a page therefore fails CI twice over until somebody decides, here,
 * in a diff a reviewer reads, which area it belongs to.
 */
import type { RouteArea, HttpMethod } from './routes.ts'

export type ExpectedRoute = {
  area: RouteArea
  /** Methods accepted while the area is open; `ANY` = the route decides. */
  methods: 'ANY' | readonly HttpMethod[]
}

const PAGE: readonly HttpMethod[] = ['GET', 'HEAD', 'POST']
const READ: readonly HttpMethod[] = ['GET', 'HEAD']

const publicPage: ExpectedRoute = { area: 'public', methods: PAGE }
const publicDocument: ExpectedRoute = { area: 'public', methods: READ }
const accounts: ExpectedRoute = { area: 'accounts', methods: 'ANY' }
const payments: ExpectedRoute = { area: 'payments', methods: 'ANY' }
const administration: ExpectedRoute = { area: 'administration', methods: 'ANY' }

/** Keyed by App Router template, as `discoverAppRoutes` reports it. */
export const EXPECTED_ROUTES: Readonly<Record<string, ExpectedRoute>> = {
  // Public informational site (open in INFORMATIONAL and FULL)
  '/': publicPage,
  '/historie': publicPage,
  '/metodika': publicPage,
  '/cenik': publicPage,
  '/kontakt': publicPage,
  '/obchodni-podminky': publicPage,
  '/ochrana-osobnich-udaju': publicPage,
  '/cookies': publicPage,
  '/tipy/[slug]': publicPage,
  '/robots.txt': publicDocument,
  '/sitemap.xml': publicDocument,
  '/llms.txt': publicDocument,

  // Customer accounts (FULL only)
  '/prihlaseni': accounts,
  '/prihlaseni/dvoufazove': accounts,
  '/registrace': accounts,
  '/zapomenute-heslo': accounts,
  '/obnova-hesla': accounts,
  '/overeni-emailu': accounts,
  '/ucet': accounts,
  '/ucet/doklady': accounts,
  '/ucet/doklady/[id]': accounts,
  '/ucet/zabezpeceni': accounts,
  '/auth/[...all]': accounts,

  // Checkout and payment callbacks (FULL only)
  '/predplatne': payments,
  '/webhooks/stripe': payments,

  // Operations (every mode)
  '/healthz': { area: 'operations', methods: READ },
  '/api/cron/retry-document-delivery': { area: 'operations', methods: 'ANY' },
  '/api/cron/sweep-lockouts': { area: 'operations', methods: 'ANY' },

  // Administration (every mode; the REST API has a PRIVATE-mode rule)
  '/admin/[[...segments]]': administration,
  '/api/[...slug]': administration,
}

/**
 * A complete, structurally valid, non-functional server environment — the
 * same placeholders CI builds with (see `.github/workflows/ci.yml`). Lets a
 * test import `env.ts` or `proxy.ts`. Nothing here reaches any service.
 */
export const PLACEHOLDER_ENV: Readonly<Record<string, string>> = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://ci:ci@127.0.0.1:5432/ci?sslmode=disable',
  PAYLOAD_SECRET: 'ci-build-only-value-not-a-real-secret-000000',
  NEXT_PUBLIC_SERVER_URL: 'https://sazejchytre.cz',
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:
    'pk_test_ci_build_only_not_a_real_key_000000',
  R2_ACCOUNT_ID: 'ci',
  R2_ACCESS_KEY_ID: 'ci',
  R2_SECRET_ACCESS_KEY: 'ci',
  R2_BUCKET: 'ci',
  R2_DOCUMENTS_BUCKET: 'ci-documents',
  R2_PUBLIC_BASE_URL: 'https://cdn.sazejchytre.cz',
  UPSTASH_REDIS_REST_URL: 'https://ci.upstash.invalid',
  UPSTASH_REDIS_REST_TOKEN: 'ci',
  BETTER_AUTH_SECRET: 'ci-build-only-value-not-a-real-secret-000000',
  BETTER_AUTH_URL: 'https://sazejchytre.cz',
  RESEND_API_KEY: 'ci',
  RESEND_FROM_EMAIL: 'no-reply@sazejchytre.cz',
  STRIPE_SECRET_KEY: 'sk_test_ci_build_only_not_a_real_key_000000',
  STRIPE_PUBLISHABLE_KEY: 'pk_test_ci_build_only_not_a_real_key_000000',
  STRIPE_WEBHOOK_SECRET: 'whsec_ci_build_only_not_a_real_secret_0000',
  CRON_SECRET: 'ci-build-only-value-not-a-real-secret-000000',
  FAKTUROID_CLIENT_ID: 'ci-build-only-not-a-real-client-id',
  FAKTUROID_CLIENT_SECRET: 'ci-build-only-not-a-real-client-secret',
  FAKTUROID_SLUG: 'ci-build-only',
  FAKTUROID_USER_AGENT: 'sazejchytre.cz-ci (ci@sazejchytre.cz)',
  TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
  ECOMAIL_API_KEY: 'ci-build-only-not-a-real-key',
  ECOMAIL_LIST_ID: '0',
}
