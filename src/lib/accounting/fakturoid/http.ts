/**
 * Every HTTP request to Fakturoid goes through here.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT THIS LAYER EXISTS TO GET RIGHT
 *
 * Four of Fakturoid's responses look like "it didn't work" and mean entirely
 * different things. Collapsing them is how a morning gets spent on the wrong
 * cause — the same lesson as step 4's webhook refusal reasons, which had to
 * be split apart after exactly that happened:
 *
 *   429  we are being throttled           → wait and retry, it was NOT done
 *   503  Fakturoid is in maintenance      → retry later, it was NOT done
 *   402  the Fakturoid account is blocked → retrying is useless, pay the bill
 *   422  they refused OUR data            → retrying is useless, fix the data
 *
 * Each maps to its own failure code, and only the first two are retryable.
 * Marking 402 or 422 retryable would turn the retry cron into an infinite
 * loop against a request that will be refused every single time.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE USER AGENT
 *
 * Fakturoid answers 400 to any request without one. That failure reads like
 * malformed input, so it is worth knowing: if everything suddenly 400s, look
 * at the header before the body. It is attached here, once, so no call site
 * can forget it.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY A WRITE IS NEVER AUTOMATICALLY RETRIED ON A SERVER ERROR
 *
 * A 429 is safe to retry: it means the request was rejected before it did
 * anything. A 500 is not, because the document may have been created before
 * the error — and a second attempt would put a second document in the
 * operator's statutory number series, where it cannot be cleanly removed.
 *
 * So retries here cover 429 and nothing else. Safety for every other case
 * comes from `custom_id` adoption in the adapter, which makes a retry find
 * the existing document instead of creating another. That is a stronger
 * guarantee than careful retry rules, because it holds even when the retry
 * comes from somewhere else entirely — a cron run an hour later, say.
 */
import {
  type AccountingFailure,
  AccountingProviderUnreachableError,
  accountingFail,
} from '../port.ts'
import { type FakturoidConfig } from './config.ts'
import { type TokenSource } from './token.ts'

/** How many times a 429 is waited out before giving up and reporting it. */
const MAX_THROTTLE_RETRIES = 2

/** Fallback wait when they throttle us without saying for how long. */
const DEFAULT_RETRY_AFTER_SECONDS = 5

/** Longest we will sit inside a single request waiting out a 429. */
const MAX_INLINE_WAIT_SECONDS = 15

export type FakturoidRequest = {
  method: 'GET' | 'POST' | 'PATCH'
  /** Account-relative, e.g. `/invoices.json`. */
  path: string
  query?: Record<string, string | undefined>
  body?: unknown
  /** Ask for a PDF rather than JSON. */
  accept?: 'json' | 'pdf'
}

export type FakturoidOutcome =
  /** 2xx with a body. */
  | { kind: 'json'; status: number; body: unknown }
  /** 2xx with bytes — a PDF. */
  | { kind: 'binary'; status: number; bytes: Buffer }
  /** 204: accepted, nothing to read. For a PDF this means "still generating". */
  | { kind: 'empty'; status: number }
  /** 404. Separate from a failure so callers can treat absence as a value. */
  | { kind: 'missing'; status: 404 }
  | { kind: 'failure'; failure: AccountingFailure }

/** What the last response told us about our remaining budget. */
export type RateLimitState = {
  /** Requests left in the current window. */
  remaining: number | null
  /** Seconds until the window resets. */
  resetsInSeconds: number | null
}

export type FakturoidHttp = {
  request(request: FakturoidRequest): Promise<FakturoidOutcome>
  /** For logging: how close we are to the limit. */
  rateLimit(): RateLimitState
}

/**
 * Parse `X-RateLimit: default;r=149;t=60`.
 *
 * Read rather than ignored so that a run approaching the limit is visible in
 * the logs before it starts failing. The format is a semicolon-separated set
 * of `key=value` pairs after a policy name, so it is parsed loosely: an
 * unexpected shape yields nulls rather than throwing, because failing a real
 * request over an unreadable diagnostic header would be absurd.
 */
export const parseRateLimit = (header: string | null): RateLimitState => {
  if (!header) return { remaining: null, resetsInSeconds: null }

  const number = (key: string): number | null => {
    const match = new RegExp(`(?:^|;)\\s*${key}=(\\d+)`).exec(header)

    return match ? Number(match[1]) : null
  }

  return { remaining: number('r'), resetsInSeconds: number('t') }
}

/**
 * How long to wait after a 429.
 *
 * Prefers what they told us, over anything we would guess. A guess that is
 * too short turns a backoff into a hammer, and being throttled harder is the
 * opposite of what the retry is for.
 */
export const retryAfterSecondsOf = (headers: Headers): number => {
  const retryAfter = headers.get('retry-after')

  if (retryAfter) {
    const seconds = Number(retryAfter)

    if (Number.isFinite(seconds) && seconds >= 0) return seconds
  }

  const { resetsInSeconds } = parseRateLimit(headers.get('x-ratelimit'))

  return resetsInSeconds ?? DEFAULT_RETRY_AFTER_SECONDS
}

/**
 * Flatten Fakturoid's 422 body into one line.
 *
 * They answer `{"errors":{"subject_id":["is required"]}}`. Worth unpacking:
 * the field name is the whole diagnosis, and a log line saying only "422"
 * sends somebody to read our request payload by hand.
 */
export const describeValidationErrors = (body: unknown): string => {
  if (typeof body !== 'object' || body === null) return 'no detail'

  const errors = (body as { errors?: unknown }).errors

  if (typeof errors === 'string') return errors.slice(0, 500)

  if (typeof errors !== 'object' || errors === null) {
    return JSON.stringify(body).slice(0, 500)
  }

  return (
    Object.entries(errors as Record<string, unknown>)
      .map(([field, messages]) => {
        const text = Array.isArray(messages)
          ? messages.map(String).join(', ')
          : String(messages)

        return `${field}: ${text}`
      })
      .join('; ')
      .slice(0, 500) || 'no detail'
  )
}

export type FakturoidHttpOptions = {
  config: FakturoidConfig
  tokens: TokenSource
  fetchImpl?: typeof fetch
  /** Injected so tests do not actually sleep. */
  sleep?: (ms: number) => Promise<void>
}

export const createFakturoidHttp = (
  options: FakturoidHttpOptions,
): FakturoidHttp => {
  const { config, tokens } = options
  const fetchImpl = options.fetchImpl ?? fetch
  const sleep =
    options.sleep ??
    ((ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms)
      }))

  let rateLimitState: RateLimitState = {
    remaining: null,
    resetsInSeconds: null,
  }

  const url = (request: FakturoidRequest): string => {
    const target = new URL(
      `${config.baseUrl}/accounts/${config.slug}${request.path}`,
    )

    for (const [key, value] of Object.entries(request.query ?? {})) {
      if (value !== undefined) target.searchParams.set(key, value)
    }

    return target.toString()
  }

  const send = async (request: FakturoidRequest): Promise<Response> => {
    const token = await tokens.accessToken()

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: request.accept === 'pdf' ? 'application/pdf' : 'application/json',
      // Mandatory. Fakturoid answers 400 without it.
      'User-Agent': config.userAgent,
    }

    if (request.body !== undefined) {
      headers['Content-Type'] = 'application/json'
    }

    try {
      return await fetchImpl(url(request), {
        method: request.method,
        headers,
        ...(request.body === undefined
          ? {}
          : { body: JSON.stringify(request.body) }),
        signal: AbortSignal.timeout(30_000),
      })
    } catch (cause) {
      // DNS, TLS, timeout, socket reset. Not a Fakturoid answer at all, so
      // not a Result: a caller must not be able to ignore it by forgetting to
      // check a field. It must never lose a payment either, which is why the
      // issuing flow catches this and leaves the document PENDING for the
      // retry cron.
      throw new AccountingProviderUnreachableError('FAKTUROID', { cause })
    }
  }

  const interpret = async (
    response: Response,
    request: FakturoidRequest,
  ): Promise<FakturoidOutcome> => {
    rateLimitState = parseRateLimit(response.headers.get('x-ratelimit'))

    const where = `${request.method} ${request.path}`

    if (response.status === 204) {
      // For a PDF this is "still rendering", which is an ordinary answer, not
      // a failure. The adapter turns it into `{ ready: false }`.
      return { kind: 'empty', status: 204 }
    }

    if (response.ok) {
      if (request.accept === 'pdf') {
        const bytes = Buffer.from(await response.arrayBuffer())

        return { kind: 'binary', status: response.status, bytes }
      }

      const text = await response.text()

      if (text.trim().length === 0) {
        return { kind: 'empty', status: response.status }
      }

      try {
        return { kind: 'json', status: response.status, body: JSON.parse(text) }
      } catch {
        // A 200 that is not JSON means we are not talking to the API we think
        // we are — a proxy error page, most likely.
        return {
          kind: 'failure',
          failure: accountingFail(
            'REJECTED_DATA',
            `${where} returned ${String(response.status)} with a body that is not JSON.`,
            { providerDetail: text.slice(0, 200) },
          ),
        }
      }
    }

    if (response.status === 404) {
      return { kind: 'missing', status: 404 }
    }

    // Read the body once, for the diagnostics below.
    const detail = await response.text().catch(() => '')

    switch (response.status) {
      case 400:
        return {
          kind: 'failure',
          failure: accountingFail(
            'REJECTED_DATA',
            `${where}: Fakturoid refused the request as malformed. If every ` +
              'request is failing this way, check that the User-Agent header ' +
              'is being sent — Fakturoid answers 400 without it.',
            { providerDetail: detail.slice(0, 500) },
          ),
        }

      case 401:
        return {
          kind: 'failure',
          failure: accountingFail(
            'REJECTED_DATA',
            `${where}: Fakturoid rejected our token.`,
            { providerDetail: detail.slice(0, 200) },
          ),
        }

      case 402:
        // Their account, not ours to fix in code. Retrying cannot help; a
        // human has to pay a Fakturoid invoice.
        return {
          kind: 'failure',
          failure: accountingFail(
            'ACCOUNT_BLOCKED',
            `${where}: the Fakturoid account is blocked. Documents cannot be ` +
              'issued until it is settled. Retrying will not help.',
            { providerDetail: detail.slice(0, 200) },
          ),
        }

      case 403:
        return {
          kind: 'failure',
          failure: accountingFail(
            'ALREADY_FINALISED',
            `${where}: Fakturoid refused the operation on this document — it ` +
              'is already in the state being requested, or locked against it.',
            { providerDetail: detail.slice(0, 300) },
          ),
        }

      case 415:
        return {
          kind: 'failure',
          failure: accountingFail(
            'REJECTED_DATA',
            `${where}: unsupported content type.`,
            { providerDetail: detail.slice(0, 200) },
          ),
        }

      case 422: {
        let parsed: unknown = detail

        try {
          parsed = JSON.parse(detail)
        } catch {
          /* keep the raw text */
        }

        return {
          kind: 'failure',
          failure: accountingFail(
            'REJECTED_DATA',
            `${where}: Fakturoid rejected our data — ${describeValidationErrors(parsed)}`,
            { providerDetail: detail.slice(0, 500) },
          ),
        }
      }

      case 429:
        return {
          kind: 'failure',
          failure: accountingFail(
            'RATE_LIMITED',
            `${where}: rate limited by Fakturoid.`,
            { retryAfterSeconds: retryAfterSecondsOf(response.headers) },
          ),
        }

      case 503:
        // Their maintenance window. The request was not processed, so a later
        // retry is both safe and the right thing.
        return {
          kind: 'failure',
          failure: accountingFail(
            'PROVIDER_MAINTENANCE',
            `${where}: Fakturoid is in maintenance and not accepting writes.`,
            { retryAfterSeconds: retryAfterSecondsOf(response.headers) },
          ),
        }

      default:
        if (response.status >= 500) {
          // PROVIDER_ERROR, not PROVIDER_MAINTENANCE: both are retryable, but
          // a log line reading "maintenance" for a crash sends somebody to a
          // status page that says everything is fine.
          //
          // Deliberately NOT auto-retried for a write: the document may have
          // been created before the error, and a blind retry would put a
          // second one in the number series. The adapter's `custom_id`
          // adoption makes the eventual retry safe instead.
          return {
            kind: 'failure',
            failure: accountingFail(
              'PROVIDER_ERROR',
              `${where}: Fakturoid returned ${String(response.status)}.`,
              { providerDetail: detail.slice(0, 300) },
            ),
          }
        }

        return {
          kind: 'failure',
          failure: accountingFail(
            'REJECTED_DATA',
            `${where}: unexpected status ${String(response.status)}.`,
            { providerDetail: detail.slice(0, 300) },
          ),
        }
    }
  }

  return {
    async request(request: FakturoidRequest): Promise<FakturoidOutcome> {
      let attempt = 0

      for (;;) {
        const outcome = await interpret(await send(request), request)

        const throttled =
          outcome.kind === 'failure' && outcome.failure.code === 'RATE_LIMITED'

        if (!throttled || attempt >= MAX_THROTTLE_RETRIES) {
          return outcome
        }

        const asked =
          outcome.failure.retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS

        // Bounded on purpose, and NOT clamped. Waiting out a long window
        // inside a webhook handler would hold the request open until the
        // caller times out and retries, which is more load rather than less.
        // Clamping would be worse still: retrying before the window has
        // actually reset just gets us throttled again, harder. So past the
        // bound we hand back the retryable failure and let the cron have it.
        if (asked > MAX_INLINE_WAIT_SECONDS) return outcome

        attempt += 1
        await sleep(asked * 1_000)
      }
    },

    rateLimit(): RateLimitState {
      return rateLimitState
    },
  }
}
