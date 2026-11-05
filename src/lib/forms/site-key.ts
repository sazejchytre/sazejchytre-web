/**
 * The Turnstile site key, and nothing else.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY A FUNCTION FOR ONE STRING
 *
 * Because a page should not import `env`. That module is the whole server
 * environment — database URL, Stripe secret, signing keys — and the lint rule
 * that keeps it out of `src/app` is there because a server component is one
 * `'use client'` away from being a client component. The day somebody adds
 * that directive to a page, the import either breaks the build or, worse,
 * drags the schema into a bundle.
 *
 * This exposes exactly one value, and it is a value that is world-readable by
 * design: the site key identifies a Turnstile widget and authorises nothing.
 * Even if it did end up in client code, nothing would leak — which is the
 * property that makes it safe to hand to a page, and which `env` as a whole
 * does not have.
 *
 * Its counterpart, `TURNSTILE_SECRET_KEY`, is read only by
 * `verifyTurnstileToken`'s callers in the server actions. There is
 * deliberately no accessor for it here.
 */
import { env } from '../env.ts'

export const turnstileSiteKey = (): string => env.TURNSTILE_SITE_KEY
