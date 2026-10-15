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

import { formatEnvIssues } from './env-format'

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

  /* --- Billing ------------------------------------------------------------ */
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
   *   STRIPE_SECRET_KEY
   *   STRIPE_WEBHOOK_SECRET
   *   STRIPE_PRICE_ID_MONTHLY
   *   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY   <- goes in env.public.ts
   *   RESEND_API_KEY
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
