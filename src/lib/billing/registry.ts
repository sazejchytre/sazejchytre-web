/**
 * Resolves the active billing adapter from configuration.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY A REGISTRY RATHER THAN AN IMPORT
 *
 * If application code imported the Stripe adapter directly, "switch provider"
 * would mean finding every call site. With the registry there is exactly one
 * place that knows which provider is live, and it reads that from config.
 *
 * Adding a provider is one adapter file plus one line in the map below. The
 * line is unavoidable and deliberately not hidden: a convention-based dynamic
 * `import(`./${provider}/adapter.ts`)` would remove it, at the cost of
 * defeating the bundler's static analysis — Turbopack would have to bundle
 * every directory that matches, and a typo would become a runtime failure in
 * production instead of a type error here. One honest line is the better deal.
 *
 * (The provider also has to exist in `BILLING_PROVIDERS`, which is a Payload
 * select option and therefore a database migration regardless. There is no
 * arrangement of this file that avoids that.)
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THE LOADERS ARE LAZY
 *
 * An adapter module constructs a provider SDK client and reads credentials at
 * import time. Loading all of them eagerly would mean every environment needs
 * every provider's keys — including the ones it does not use. Dynamic import
 * keeps the inactive adapters, and their secrets, out of the picture.
 */
import { type BillingProvider } from './constants.ts'
import { BillingConfigurationError, type BillingPort } from './port.ts'

type AdapterLoader = () => Promise<BillingPort>

/**
 * Provider → adapter. The one line a new provider adds.
 *
 * Not typed as a total `Record<BillingProvider, …>`: that would make adding a
 * provider to the enum a compile error here, forcing the adapter and the enum
 * to land in the same commit. Tempting, but it also blocks declaring a
 * provider in the domain model before its adapter is written, which is the
 * normal order of work. The miss is caught below with a clear message.
 */
const ADAPTERS: Partial<Record<BillingProvider, AdapterLoader>> = {
  STRIPE: async () => {
    const { createStripeBillingPort } = await import('./stripe/adapter.ts')

    return createStripeBillingPort()
  },
}

/** Resolved adapters, so the SDK client is constructed once per process. */
const cache = new Map<BillingProvider, Promise<BillingPort>>()

/**
 * A port installed by tests, bypassing config and the cache entirely.
 *
 * Module-level mutable state, which is normally a smell. The alternative is
 * threading a port through every caller purely for testability, which spreads
 * the seam across the whole application instead of containing it here.
 */
let override: BillingPort | null = null

/**
 * Install a port for the duration of a test. Pass `null` to restore.
 *
 * Named so that it is obvious in a diff if it ever appears in application
 * code, where it has no business being.
 */
export const setBillingPortForTesting = (port: BillingPort | null): void => {
  override = port
}

/**
 * Load the adapter for a specific provider.
 *
 * Throws `BillingConfigurationError` for an unknown provider: being asked for
 * a provider with no adapter is a programming or deployment fault, not a
 * billing outcome, so it is not a `BillingResult`.
 */
export const getBillingPortFor = async (
  provider: BillingProvider,
): Promise<BillingPort> => {
  if (override) return override

  const cached = cache.get(provider)

  if (cached) return cached

  const loader = ADAPTERS[provider]

  if (!loader) {
    throw new BillingConfigurationError(
      `No billing adapter is registered for provider "${provider}". ` +
        'Add one to ADAPTERS in src/lib/billing/registry.ts.',
    )
  }

  // Cache the promise, not the resolved value: two concurrent requests during
  // a cold start would otherwise each construct their own SDK client.
  const loading = loader().catch((error: unknown) => {
    cache.delete(provider)
    throw error
  })

  cache.set(provider, loading)

  return loading
}

/**
 * Load the adapter for the configured provider.
 *
 * The env import is deliberately inside the function. At module scope it
 * would make `registry.ts` unloadable without a full environment, which would
 * drag the whole env schema into the pure test suite.
 */
export const getBillingPort = async (): Promise<BillingPort> => {
  if (override) return override

  const { env } = await import('../env.ts')

  return getBillingPortFor(env.BILLING_PROVIDER)
}

/** Forget cached adapters. For tests that swap configuration. */
export const resetBillingPortCache = (): void => {
  cache.clear()
}
