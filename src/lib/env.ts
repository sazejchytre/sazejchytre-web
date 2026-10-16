/**
 * Server-side environment schema — validated once, at module load, or the
 * process dies.
 *
 * RULES
 *  1. No secret has a default value. A missing secret MUST crash the boot.
 *     A placeholder that "works" in production is worse than an outage.
 *  2. Nothing in here is ever exposed to the browser. See the guard below.
 *  3. Public (`NEXT_PUBLIC_*`) variables live in `./env.public.ts` and are
 *     validated by a separate schema.
 *
 * WHY NO `import 'server-only'`?
 * The `server-only` package resolves to a throwing module unless the importing
 * runtime sets the `react-server` export condition. The Payload CLI (migrations,
 * type generation) loads `payload.config.ts` — and therefore this file — in
 * plain Node, where that condition is absent, so the import would break every
 * CLI command. The guard below plus Next.js' own inlining rules give the same
 * protection:
 *
 *   - Next.js only inlines `NEXT_PUBLIC_*` into client bundles. Every variable
 *     here resolves to `undefined` in a browser, so the schema below cannot
 *     pass there — the module throws instead of leaking anything.
 *   - `assertServerOnly()` turns that into an explicit, readable failure.
 */
import { z } from 'zod'

import { BILLING_PROVIDERS } from './billing/constants.ts'
import { formatEnvIssues } from './env-format.ts'

/* -------------------------------------------------------------------------- */
/* Runtime guard                                                              */
/* -------------------------------------------------------------------------- */

function assertServerOnly(): void {
  if (typeof window !== 'undefined') {
    throw new Error(
      'src/lib/env.ts was imported from client code. This module holds server ' +
        'secrets and must never reach the browser. Import `publicEnv` from ' +
        '"@/lib/env.public" instead.',
    )
  }
}

assertServerOnly()

/* -------------------------------------------------------------------------- */
/* Schema                                                                     */
/* -------------------------------------------------------------------------- */

/** A required secret: present, non-empty, and not obviously a placeholder. */
const secret = (minLength = 1) =>
  z
    .string()
    .min(minLength, { error: `must be at least ${minLength} characters` })
    .refine(
      (value) => !/^(changeme|placeholder|todo|xxx+)$/i.test(value.trim()),
      {
        error: 'looks like a placeholder — set a real value',
      },
    )

const serverEnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  /* --- Database (Neon Postgres) ------------------------------------------ */
  DATABASE_URL: secret(1).refine((value) => /^postgres(ql)?:\/\//.test(value), {
    error: 'must be a postgres:// or postgresql:// connection string',
  }),

  /* --- Payload ------------------------------------------------------------ */
  // Used to sign auth tokens. Rotating it invalidates every session.
  PAYLOAD_SECRET: secret(32),

  /* --- Cloudflare R2 (media storage) -------------------------------------- */
  R2_ACCOUNT_ID: secret(1),
  R2_ACCESS_KEY_ID: secret(1),
  R2_SECRET_ACCESS_KEY: secret(1),
  R2_BUCKET: secret(1),

  /**
   * A SEPARATE bucket for invoices and credit notes.
   *
   * Not a prefix inside `R2_BUCKET`. That was the original design and it was
   * wrong: `R2_PUBLIC_BASE_URL` is bound to the media bucket at its ROOT, so
   * every prefix in it — including one called `private/` — is served over
   * the public domain. A document stored there is fetchable by anyone who
   * knows or guesses the key, which for sequential document numbers is
   * anyone at all.
   *
   * This bucket must have NO public domain and NO r2.dev access enabled.
   * `assertDocumentBucketIsolated()` refuses to store anything if it is the
   * same bucket as the media one, so the mistake cannot recur quietly.
   *
   * No default: a wrong guess here is a privacy incident, and the CDN cache
   * does not purge on delete, so a leak outlives the fix.
   */
  R2_DOCUMENTS_BUCKET: secret(1),
  // Public CDN origin the bucket is served from. No trailing slash.
  R2_PUBLIC_BASE_URL: z
    .url({ error: 'must be an absolute URL' })
    .refine((value) => !value.endsWith('/'), {
      error: 'must not have a trailing slash',
    }),

  /* --- Upstash Redis ------------------------------------------------------ */
  // Defined now so deploys fail fast if they are missing; not consumed yet.
  UPSTASH_REDIS_REST_URL: z.url({ error: 'must be an absolute URL' }),
  UPSTASH_REDIS_REST_TOKEN: secret(1),

  /* --- Customer authentication (better-auth) ------------------------------ */
  /**
   * Signs better-auth session cookies and tokens.
   *
   * No default, like every other secret here: a predictable signing key means
   * forgeable sessions, and a placeholder that "works" in production is worse
   * than a failed boot. Rotating it invalidates every customer session.
   *
   * Distinct from PAYLOAD_SECRET on purpose. Payload's auth is for admins and
   * better-auth's is for customers; sharing one key would mean a compromise of
   * either system hands over both.
   */
  BETTER_AUTH_SECRET: secret(32),

  /**
   * Canonical origin better-auth builds links and cookie scopes from.
   *
   * Must match the origin the customer actually browses, or verification and
   * reset links land on the wrong host and cookies are rejected.
   */
  BETTER_AUTH_URL: z
    .url({ error: 'must be an absolute URL, e.g. https://sazejchytre.cz' })
    .refine((value) => !value.endsWith('/'), {
      error: 'must not have a trailing slash',
    }),

  /* --- Transactional email (Resend) --------------------------------------- */
  /** API key for Resend. Sends verification, reset and security notices. */
  RESEND_API_KEY: secret(1),
  /**
   * Envelope sender. Must be on a domain verified in Resend, or every send is
   * rejected at the API rather than silently dropped.
   */
  RESEND_FROM_EMAIL: z
    .string()
    .refine((value) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim()), {
      error: 'must be a bare email address, e.g. no-reply@sazejchytre.cz',
    }),

  /* --- Stripe (payments) -------------------------------------------------- */
  /**
   * Secret API key. No default, like every secret here.
   *
   * The `sk_` prefix is checked but `sk_live_` is NOT rejected: production has
   * to be able to hold a live key. Telling test from live is a *runtime*
   * decision, made by `isLiveStripeKey` — a schema that refused live keys
   * would simply be wrong the day this goes live, and a schema that ignored
   * the distinction would let a reconciliation script run against real
   * customers by accident.
   */
  STRIPE_SECRET_KEY: secret(10).refine((value) => value.startsWith('sk_'), {
    error: 'must be a Stripe secret key (sk_test_… or sk_live_…)',
  }),

  /** Publishable key, used by the Payment Element in step 5. Not a secret. */
  STRIPE_PUBLISHABLE_KEY: z
    .string()
    .min(10)
    .refine((value) => value.startsWith('pk_'), {
      error: 'must be a Stripe publishable key (pk_test_… or pk_live_…)',
    }),

  /**
   * Signing secret for the webhook endpoint.
   *
   * Per-endpoint, not per-account: a secret from the dashboard will not verify
   * events forwarded by `stripe listen`, and vice versa. Getting these two
   * confused produces "signature verification failed" on every event, which
   * looks like a code fault and is not one.
   */
  STRIPE_WEBHOOK_SECRET: secret(10).refine(
    (value) => value.startsWith('whsec_'),
    { error: 'must be a Stripe webhook signing secret (whsec_…)' },
  ),

  /* --- Vercel Cron -------------------------------------------------------- */
  /**
   * Shared secret Vercel Cron presents as `Authorization: Bearer …`.
   *
   * Vercel injects this into the request for scheduled invocations. Without
   * it, a cron route is a public endpoint anybody can call — which for a
   * retention sweep means anybody can delete our audit history.
   */
  CRON_SECRET: secret(32),

  /* --- Billing ------------------------------------------------------------ */
  /**
   * Which payment provider is live.
   *
   * Defaulted rather than required, like the country list and unlike every
   * secret above: it is configuration with one correct value today, and there
   * is nothing dangerous about the default. The point of having it at all is
   * that the registry resolves the adapter from config instead of from a
   * hard-coded import, so a second provider is an adapter file and a config
   * change rather than a hunt through call sites.
   */
  BILLING_PROVIDER: z.enum(BILLING_PROVIDERS).default('STRIPE'),

  /**
   * Countries we are set up to sell into, as a comma-separated list of ISO
   * 3166-1 alpha-2 codes.
   *
   * This has a default, unlike every secret above, because it is configuration
   * rather than a credential: there is a correct, safe value for the launch
   * market, and failing the boot over an unset list would buy nothing. The
   * default fails *closed* — it admits one country rather than all of them.
   *
   * Widening it is a deliberate act with tax consequences: each new country
   * brings a VAT regime and, past the EU distance-selling threshold, a filing
   * obligation. See `euRevenueTotalMinor`.
   */
  SUPPORTED_BILLING_COUNTRIES: z
    .string()
    .default('CZ')
    .transform((value, ctx) => {
      const codes = value
        .split(',')
        .map((code) => code.trim().toUpperCase())
        .filter((code) => code.length > 0)

      if (codes.length === 0) {
        ctx.addIssue({
          code: 'custom',
          message:
            'must list at least one ISO 3166-1 alpha-2 country code, e.g. "CZ"',
        })

        return z.NEVER
      }

      const malformed = codes.filter((code) => !/^[A-Z]{2}$/.test(code))

      if (malformed.length > 0) {
        ctx.addIssue({
          code: 'custom',
          message: `contains values that are not ISO 3166-1 alpha-2 codes: ${malformed.join(', ')}`,
        })

        return z.NEVER
      }

      return Object.freeze([...new Set(codes)]) as readonly string[]
    }),

  /* --- NOT WIRED YET ------------------------------------------------------
   * Add these to the schema in the step that actually consumes them, so a
   * deploy never demands a secret the code cannot use.
   *
   * Stripe and Resend have both landed and are declared above; there is no
   * STRIPE_PRICE_ID_MONTHLY because price ids live in the `prices` table and
   * are reconciled into Stripe by `pnpm sync:prices`, not configured by hand.
   *
   *   TURNSTILE_SECRET_KEY
   *   NEXT_PUBLIC_TURNSTILE_SITE_KEY       <- goes in env.public.ts
   *   ECOMAIL_API_KEY
   *   ECOMAIL_LIST_ID
   * ---------------------------------------------------------------------- */
})

export type ServerEnv = z.infer<typeof serverEnvSchema>

/* -------------------------------------------------------------------------- */
/* Parse                                                                      */
/* -------------------------------------------------------------------------- */

const parsed = serverEnvSchema.safeParse(process.env)

if (!parsed.success) {
  // Only variable NAMES and reasons are printed — never received values.
  // This message ends up in build and runtime logs.
  throw new Error(
    `Invalid server environment variables:\n${formatEnvIssues(parsed.error)}\n\n` +
      'See .env.example for the full list. No fallback values are supplied ' +
      'on purpose: boot must fail rather than run with a placeholder secret.',
  )
}

const values: Readonly<ServerEnv> = Object.freeze(parsed.data)

/**
 * Validated server environment.
 *
 * Wrapped in a Proxy so that a stray client-side property read throws a clear,
 * attributable error instead of silently yielding `undefined`.
 */
export const env: Readonly<ServerEnv> = new Proxy(values, {
  get(target, property, receiver) {
    assertServerOnly()
    return Reflect.get(target, property, receiver)
  },
  set() {
    throw new Error('env is read-only')
  },
  deleteProperty() {
    throw new Error('env is read-only')
  },
})

/** True in a production deployment. Prefer this over comparing strings. */
export const isProduction = values.NODE_ENV === 'production'

/** True in local development. */
export const isDevelopment = values.NODE_ENV === 'development'
