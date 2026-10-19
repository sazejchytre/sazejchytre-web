/**
 * Fakturoid connection details, read once and checked.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE USER AGENT IS NOT OPTIONAL
 *
 * Fakturoid rejects any request without a `User-Agent` identifying the
 * application and a contact address, with a 400 that says nothing useful. So
 * it is validated here, at boot, rather than discovered on the first call —
 * and it is required to contain an email address, because that is what the
 * requirement is actually for: a human they can contact when our integration
 * misbehaves.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THESE CREDENTIALS POINT AT REAL BOOKS
 *
 * There is no sandbox. The account behind these variables is the operator's
 * actual accounting account, and every document created in it is a real
 * document in a real statutory number series. Deleting one leaves a gap that
 * has to be explained to a tax inspection.
 *
 * That is why nothing here has a default and nothing falls back. An adapter
 * that quietly connected to "some" account would be worse than one that
 * refuses to start.
 */
import { AccountingConfigurationError } from '../port.ts'

export type FakturoidConfig = {
  clientId: string
  clientSecret: string
  /** The account slug. Appears in every path: /accounts/{slug}/… */
  slug: string
  userAgent: string
  baseUrl: string
}

/** API v3. Versioned in the path, so an upgrade is a visible diff. */
export const FAKTUROID_BASE_URL = 'https://app.fakturoid.cz/api/v3'

/** Where the client-credentials token comes from. Not under /api/v3. */
export const FAKTUROID_TOKEN_URL = 'https://app.fakturoid.cz/api/v3/oauth/token'

const required = (name: string, value: string | undefined): string => {
  const trimmed = value?.trim() ?? ''

  if (trimmed.length === 0) {
    throw new AccountingConfigurationError(
      `${name} is not set. The Fakturoid adapter cannot start without it.`,
    )
  }

  return trimmed
}

/**
 * Read the configuration from the environment.
 *
 * Takes `process.env` rather than importing the validated `env` module so
 * that the opt-in live test script can load it without dragging the whole
 * server env schema — and its unrelated secrets — into a test run.
 */
export const readFakturoidConfig = (
  source: NodeJS.ProcessEnv = process.env,
): FakturoidConfig => {
  const userAgent = required(
    'FAKTUROID_USER_AGENT',
    source.FAKTUROID_USER_AGENT,
  )

  if (!/[^@\s]+@[^@\s]+\.[^@\s]+/.test(userAgent)) {
    // Fakturoid asks for a contact address in the agent string so they can
    // reach a human. A string without one is accepted by our code and then
    // rejected by theirs, which is the worst of both.
    throw new AccountingConfigurationError(
      'FAKTUROID_USER_AGENT must contain a contact email address, ' +
        'e.g. "sazejchytre.cz (kontakt@sazejchytre.cz)". Fakturoid rejects ' +
        'requests whose User-Agent does not identify a contactable owner.',
    )
  }

  const slug = required('FAKTUROID_SLUG', source.FAKTUROID_SLUG)

  if (!/^[a-z0-9][a-z0-9-]*$/i.test(slug)) {
    // The slug is interpolated into every path. A value with a slash or a
    // space in it would silently address a different endpoint.
    throw new AccountingConfigurationError(
      `FAKTUROID_SLUG ${JSON.stringify(slug)} is not a bare account slug.`,
    )
  }

  return {
    clientId: required('FAKTUROID_CLIENT_ID', source.FAKTUROID_CLIENT_ID),
    clientSecret: required(
      'FAKTUROID_CLIENT_SECRET',
      source.FAKTUROID_CLIENT_SECRET,
    ),
    slug,
    userAgent,
    baseUrl: source.FAKTUROID_BASE_URL?.trim() ?? FAKTUROID_BASE_URL,
  }
}

/** The account-scoped path prefix: /accounts/{slug} */
export const accountPath = (config: FakturoidConfig, path: string): string =>
  `${config.baseUrl}/accounts/${config.slug}${path}`
