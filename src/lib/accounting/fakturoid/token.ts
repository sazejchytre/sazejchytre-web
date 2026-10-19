/**
 * The OAuth 2 client-credentials token, cached.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY CACHING IS A CORRECTNESS CONCERN, NOT AN OPTIMISATION
 *
 * A token lasts two hours. Requesting one per API call would mean two
 * requests for every one that does work, and the account's rate limit is 150
 * requests per minute — so issuing a handful of invoices would spend half the
 * budget on authentication and then get the real work throttled. Worse, the
 * throttling would land on the document-creating call, which is the one
 * request that must not be retried carelessly.
 *
 * So the token is fetched once and reused until it is nearly expired.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY IT REFRESHES EARLY, AND WHY ONE REFRESH AT A TIME
 *
 * Refreshing at the exact expiry means a token that passes the check here and
 * is rejected by the time the request arrives. The skew below buys enough
 * margin for a slow request plus any clock difference between us and them.
 *
 * The in-flight promise is shared rather than refetched: a cold serverless
 * instance handling several concurrent requests would otherwise ask for a
 * token several times at once. Each would succeed, so nothing would break
 * visibly — it would just quietly burn the rate limit at the worst moment.
 */
import { AccountingConfigurationError } from '../port.ts'
import { FAKTUROID_TOKEN_URL, type FakturoidConfig } from './config.ts'

/**
 * Refresh this long before the token actually expires.
 *
 * Sixty seconds: comfortably longer than any single request plus plausible
 * clock skew, and trivial against a two-hour lifetime.
 */
const EXPIRY_SKEW_MS = 60_000

type CachedToken = {
  accessToken: string
  /** Epoch milliseconds, already reduced by the skew. */
  usableUntil: number
}

export type TokenSource = {
  /** A valid bearer token, fetched or cached. */
  accessToken(): Promise<string>
  /** Drop the cached token, so the next call fetches a fresh one. */
  invalidate(): void
}

export type TokenSourceOptions = {
  config: FakturoidConfig
  /** Injected for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch
  now?: () => number
}

export const createTokenSource = (options: TokenSourceOptions): TokenSource => {
  const { config } = options
  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? (() => Date.now())

  let cached: CachedToken | null = null
  let inFlight: Promise<CachedToken> | null = null

  const fetchToken = async (): Promise<CachedToken> => {
    // Basic auth with the client id and secret, per the client-credentials
    // grant. `Buffer` rather than `btoa` because the secret may contain
    // characters outside Latin-1 and `btoa` would throw on them.
    const basic = Buffer.from(
      `${config.clientId}:${config.clientSecret}`,
      'utf8',
    ).toString('base64')

    let response: Response

    try {
      response = await fetchImpl(FAKTUROID_TOKEN_URL, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/json',
          // NOT optional, and its absence does not look like what it is.
          //
          // Without it Fakturoid answers 415 Unsupported Media Type, which
          // reads like a problem with the body we SENT — the one thing it is
          // not. The body is fine; they will simply not answer in anything
          // but JSON unless asked. Cost one live run to find out.
          Accept: 'application/json',
          // Required on EVERY request, including this one. Fakturoid answers
          // 400 without it, which reads like malformed credentials.
          'User-Agent': config.userAgent,
        },
        body: JSON.stringify({ grant_type: 'client_credentials' }),
      })
    } catch (cause) {
      // Rethrown as unreachable by the HTTP layer; here it is the token
      // endpoint specifically, so the message says so.
      throw new Error('Could not reach the Fakturoid token endpoint.', {
        cause,
      })
    }

    if (response.status === 401) {
      // Not a transient. A wrong client id or secret will be wrong next time
      // too, so this must not look retryable.
      throw new AccountingConfigurationError(
        'Fakturoid rejected the client credentials (401). Check ' +
          'FAKTUROID_CLIENT_ID and FAKTUROID_CLIENT_SECRET.',
      )
    }

    if (!response.ok) {
      // The body carries their explanation, and for the two headers this
      // endpoint is fussy about it says exactly which one is missing. Worth
      // more than the status on its own.
      const detail = await response.text().catch(() => '')

      throw new Error(
        `Fakturoid token request failed with ${String(response.status)}` +
          (detail ? `: ${detail.slice(0, 300)}` : '.'),
      )
    }

    const payload: unknown = await response.json()

    if (
      typeof payload !== 'object' ||
      payload === null ||
      typeof (payload as { access_token?: unknown }).access_token !== 'string'
    ) {
      // Validated here rather than trusted: a token-shaped response with no
      // token would produce an `Authorization: Bearer undefined` header and a
      // confusing 401 on the next call instead of here.
      throw new Error('Fakturoid token response had no access_token.')
    }

    const { access_token: accessToken, expires_in: expiresIn } = payload as {
      access_token: string
      expires_in?: unknown
    }

    // Default to the documented two hours if they stop sending the field.
    const lifetimeSeconds =
      typeof expiresIn === 'number' && expiresIn > 0 ? expiresIn : 7_200

    return {
      accessToken,
      usableUntil: now() + lifetimeSeconds * 1_000 - EXPIRY_SKEW_MS,
    }
  }

  return {
    async accessToken(): Promise<string> {
      if (cached && now() < cached.usableUntil) {
        return cached.accessToken
      }

      // Share the refresh. Several concurrent callers on a cold instance must
      // not each spend a request from the rate-limit budget.
      inFlight ??= fetchToken()
        .then((token) => {
          cached = token

          return token
        })
        .finally(() => {
          inFlight = null
        })

      const token = await inFlight

      return token.accessToken
    },

    invalidate(): void {
      cached = null
    },
  }
}
