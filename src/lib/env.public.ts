/**
 * Public (client-safe) environment schema.
 *
 * ONLY `NEXT_PUBLIC_*` variables belong here. Everything in this file is
 * inlined into the browser bundle and must be treated as world-readable.
 *
 * Server secrets live in `./env.ts` and must never be imported from here.
 *
 * IMPORTANT: `process.env.NEXT_PUBLIC_*` must be referenced as a *static*
 * property access for Next.js to inline the value at build time. Dynamic
 * lookups (`process.env[key]`) are NOT replaced and resolve to `undefined`
 * in the browser — hence the hand-written literal object below.
 */
import { z } from 'zod'

import { formatEnvIssues } from './env-format.ts'

const publicEnvSchema = z.object({
  /** Canonical public origin of the app, e.g. https://sazejchytre.cz */
  NEXT_PUBLIC_SERVER_URL: z
    .url({ error: 'must be an absolute URL, e.g. https://sazejchytre.cz' })
    .refine((value) => !value.endsWith('/'), {
      error: 'must not have a trailing slash',
    }),

  /**
   * Stripe publishable key, for the Payment Element in the browser.
   *
   * World-readable by design — that is what a publishable key is for. It can
   * create payment attempts but cannot read or move money, which is why it is
   * the only Stripe key allowed anywhere near a client bundle. Its secret
   * counterpart lives in `env.ts` and must never appear here.
   *
   * Duplicated with the server-side `STRIPE_PUBLISHABLE_KEY` rather than
   * derived from it, because Next only inlines `NEXT_PUBLIC_*` names into the
   * browser bundle. The two must hold the same value; `assertStripeKeysAgree`
   * checks that on the server, where both are visible.
   */
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z
    .string()
    .min(10)
    .refine((value) => value.startsWith('pk_'), {
      error: 'must be a Stripe publishable key (pk_test_… or pk_live_…)',
    }),

  /* ───────────────────────────────────────────────────────────────────────
     NOTE: the Turnstile SITE key is deliberately NOT here.

     It is world-readable, so it would be legal here — but a `NEXT_PUBLIC_*`
     value is inlined at BUILD time, which means rotating the widget requires
     a rebuild. It lives in `env.ts` as `TURNSTILE_SITE_KEY` instead and is
     handed to the widget as a prop by the server component that renders the
     form. Same visibility to the browser, one fewer variable, and rotatable
     without a deploy.
     ─────────────────────────────────────────────────────────────────────── */
})

export type PublicEnv = z.infer<typeof publicEnvSchema>

const parsed = publicEnvSchema.safeParse({
  NEXT_PUBLIC_SERVER_URL: process.env.NEXT_PUBLIC_SERVER_URL,
  // Static property access, not a lookup — see the note at the top of the file.
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
})

if (!parsed.success) {
  // Fail fast and loudly. No defaults, no placeholders, no silent fallbacks.
  throw new Error(
    `Invalid public environment variables:\n${formatEnvIssues(parsed.error)}`,
  )
}

/** Validated `NEXT_PUBLIC_*` values. Safe to use in client components. */
export const publicEnv: Readonly<PublicEnv> = Object.freeze(parsed.data)
