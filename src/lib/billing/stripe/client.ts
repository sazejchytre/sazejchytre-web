/**
 * The Stripe SDK client.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE API VERSION IS PINNED HERE, IN CODE
 *
 * Not left to the account default. The account default is a setting in a
 * dashboard that somebody else can change, and Stripe also advances it for
 * accounts that have never pinned one. Either way the shape of every object
 * we parse would change under a running deployment, with no commit, no deploy
 * and no test run — which is the kind of outage that takes a day to diagnose
 * because nothing in the repository changed.
 *
 * Pinned in code, an upgrade is a diff. The literal below is also typed as
 * the SDK's `LatestApiVersion`, so bumping the `stripe` package without
 * revisiting this file is a type error rather than a surprise. That tripwire
 * is deliberate: read the changelog, then change the literal.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT CHANGED IN THIS VERSION, THAT OLDER CODE GETS WRONG
 *
 * Two things, both of which fail silently rather than loudly:
 *
 *   1. `current_period_start` / `current_period_end` are NO LONGER on the
 *      Subscription object. They live on each subscription item. Code written
 *      against an older version reads `subscription.current_period_end`,
 *      gets `undefined`, and stores an invalid date — which is to say it
 *      stores "this subscription grants access until never".
 *   2. `invoice.payment_intent` is gone as the route to a client secret. The
 *      Payment Element now takes `invoice.confirmation_secret.client_secret`,
 *      which has to be expanded explicitly.
 *
 * Both are handled in `adapter.ts`; this note is here because this is the
 * file that says which version we are talking to.
 */
import Stripe from 'stripe'

import { env } from '../../env.ts'
import { BillingConfigurationError } from '../port.ts'

/**
 * The pinned Stripe API version.
 *
 * Typed against the SDK's own latest-version literal on purpose — see above.
 */
export const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2026-09-30.endive'

/** Identifies our integration in Stripe's logs, which helps their support. */
const APP_INFO: Stripe.AppInfo = {
  name: 'sazejchytre.cz',
  url: 'https://sazejchytre.cz',
}

/**
 * Is this a live-mode key?
 *
 * Used by the product reconciliation script, which refuses to touch live data
 * without an explicit confirmation flag. Deliberately a runtime check rather
 * than something the env schema enforces: production genuinely needs a live
 * key, so a schema that rejected one would simply be wrong, and a schema that
 * ignored the distinction would let a script meant for test mode rewrite real
 * prices.
 */
export const isLiveStripeKey = (key: string): boolean =>
  /^(?:sk|rk|pk)_live_/.test(key)

/** True when the configured secret key is a live-mode key. */
export const isLiveMode = (): boolean => isLiveStripeKey(env.STRIPE_SECRET_KEY)

let client: Stripe | null = null

/**
 * The shared Stripe client.
 *
 * Memoised per process: the SDK keeps an HTTP agent with a connection pool,
 * and building a fresh client per request throws that away — on a serverless
 * runtime that is a new TLS handshake on every checkout.
 */
export const getStripeClient = (): Stripe => {
  if (client) return client

  const key = env.STRIPE_SECRET_KEY

  if (!key.startsWith('sk_') && !key.startsWith('rk_')) {
    // The env schema already checks this. Repeated here because a publishable
    // key in this slot would otherwise fail on the first API call with an
    // authentication error, which reads like a revoked key rather than a
    // misconfiguration.
    throw new BillingConfigurationError(
      'STRIPE_SECRET_KEY is not a secret or restricted key.',
    )
  }

  client = new Stripe(key, {
    apiVersion: STRIPE_API_VERSION,
    appInfo: APP_INFO,
    // The SDK attaches an idempotency key to its own retries, so a retried
    // POST cannot double-charge. Two is enough to ride out a blip without
    // making a genuinely failing request take half a minute to find out.
    maxNetworkRetries: 2,
    timeout: 20_000,
    telemetry: false,
  })

  return client
}

/** Drop the memoised client. For tests that swap configuration. */
export const resetStripeClient = (): void => {
  client = null
}
