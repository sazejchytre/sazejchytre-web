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

import { formatEnvIssues } from './env-format'

const publicEnvSchema = z.object({
  /** Canonical public origin of the app, e.g. https://sazejchytre.cz */
  NEXT_PUBLIC_SERVER_URL: z
    .url({ error: 'must be an absolute URL, e.g. https://sazejchytre.cz' })
    .refine((value) => !value.endsWith('/'), {
      error: 'must not have a trailing slash',
    }),
})

export type PublicEnv = z.infer<typeof publicEnvSchema>

const parsed = publicEnvSchema.safeParse({
  NEXT_PUBLIC_SERVER_URL: process.env.NEXT_PUBLIC_SERVER_URL,
})

if (!parsed.success) {
  // Fail fast and loudly. No defaults, no placeholders, no silent fallbacks.
  throw new Error(
    `Invalid public environment variables:\n${formatEnvIssues(parsed.error)}`,
  )
}

/** Validated `NEXT_PUBLIC_*` values. Safe to use in client components. */
export const publicEnv: Readonly<PublicEnv> = Object.freeze(parsed.data)
