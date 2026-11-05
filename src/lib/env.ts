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

  /* --- Accounting documents (Fakturoid) ----------------------------------- */
  /**
   * Which accounting provider issues documents: FAKTUROID or FAKE.
   *
   * ───────────────────────────────────────────────────────────────────────
   * THE DEFAULT IS **FAKE**, AND THAT IS NOT AN OVERSIGHT
   *
   * `BILLING_PROVIDER` defaults to STRIPE because a Stripe test key is
   * harmless. This cannot: there is no Fakturoid sandbox. The credentials
   * below point at the operator's real accounting account, where every
   * document created is real, permanently numbered in a statutory series,
   * and impossible to remove without leaving a gap that has to be explained
   * to a tax inspection.
   *
   * So the real provider has to be asked for by name. The cost of the default
   * being wrong is a document that was never issued, which the retry cron
   * fixes. The cost of the opposite default being wrong is a real document in
   * real books, which nothing fixes.
   */
  ACCOUNTING_PROVIDER: z.enum(['FAKTUROID', 'FAKE']).default('FAKE'),

  /**
   * Fakturoid OAuth 2 client credentials and account slug.
   *
   * Declared here so a deploy that means to issue documents fails at boot
   * rather than on the first sale. `readFakturoidConfig()` reads
   * `process.env` itself rather than importing this module, so that the unit
   * tests and the opt-in live script can run without the whole server
   * schema — this declaration is the deploy-time gate, that function is the
   * runtime reader, and they look at the same four variables.
   */
  FAKTUROID_CLIENT_ID: secret(1),
  FAKTUROID_CLIENT_SECRET: secret(1),
  /** The account slug. Appears in every API path. */
  FAKTUROID_SLUG: secret(1),
  /**
   * Identifies us to Fakturoid, with a contact address.
   *
   * Fakturoid answers 400 to any request without a `User-Agent`, and that 400
   * does not mention headers — so it reads like malformed input. Required to
   * contain an email address because that is what the requirement is for: a
   * human they can contact when our integration misbehaves.
   */
  FAKTUROID_USER_AGENT: secret(1).refine(
    (value) => /[^@\s]+@[^@\s]+\.[^@\s]+/.test(value),
    {
      error:
        'must contain a contact email, e.g. "sazejchytre.cz (kontakt@sazejchytre.cz)"',
    },
  ),

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

  /* --- Cloudflare Turnstile (public form bot defence) --------------------- */
  /**
   * The widget's site key.
   *
   * World-readable — it identifies the widget and authorises nothing — so it
   * could have gone in `env.public.ts` as a `NEXT_PUBLIC_*` name. It is here
   * instead because `NEXT_PUBLIC_*` values are inlined at BUILD time, and
   * rotating a Turnstile widget should not require a rebuild. The server
   * component that renders a form reads it here and passes it to the widget
   * as a prop, which puts the same string in the same HTML.
   */
  TURNSTILE_SITE_KEY: z
    .string()
    .min(1, { error: 'must be set — the widget cannot render without it' }),

  /**
   * Server-side verification key for Turnstile.
   *
   * This is the one that makes the check real: the site key proves nothing on
   * its own, and a form that renders the widget without verifying the token
   * server-side is protected by nothing at all. Required rather than
   * optional, because a missing secret must fail the boot rather than quietly
   * disable the defence while the widget keeps spinning reassuringly.
   *
   * Cloudflare publishes always-pass and always-fail test keys for local use;
   * see .env.example.
   */
  TURNSTILE_SECRET_KEY: secret(1),

  /* --- Ecomail (newsletter) ----------------------------------------------- */
  /**
   * API key for Ecomail, sent in the `key` header.
   *
   * Required rather than optional for the same reason as every other
   * integration here: a newsletter form that silently does nothing because a
   * variable was never set is worse than a deploy that refuses to start. The
   * consent record is written to our own database either way, so a failed
   * Ecomail call never loses the consent — see `src/lib/forms/newsletter.ts`.
   */
  ECOMAIL_API_KEY: secret(1),

  /**
   * The list subscribers are added to. A numeric list id, not a list name.
   *
   * Checked for digits because the id goes straight into the request path,
   * and a name there produces a 404 that reads like an auth failure.
   */
  ECOMAIL_LIST_ID: z
    .string()
    .min(1, { error: 'must be set' })
    .refine((value) => /^\d+$/.test(value.trim()), {
      error: 'must be a numeric Ecomail list id, e.g. "7"',
    }),

  /* --- NOT WIRED YET ------------------------------------------------------
   * Add these to the schema in the step that actually consumes them, so a
   * deploy never demands a secret the code cannot use.
   *
   * Stripe and Resend have both landed and are declared above; there is no
   * STRIPE_PRICE_ID_MONTHLY because price ids live in the `prices` table and
   * are reconciled into Stripe by `pnpm sync:prices`, not configured by hand.
   *
   * Turnstile and Ecomail landed with the public site. The browser half of
   * Turnstile — NEXT_PUBLIC_TURNSTILE_SITE_KEY — lives in env.public.ts,
   * because only `NEXT_PUBLIC_*` names are inlined into the client bundle.
   *
   * Nothing is pending here today.
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
