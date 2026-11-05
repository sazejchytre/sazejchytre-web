/**
 * Cloudflare Turnstile, verified SERVER-SIDE.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE WIDGET IS NOT THE CHECK
 *
 * Turnstile renders a widget that puts a token in a hidden input. A form that
 * only renders the widget and never verifies the token is protected by
 * nothing at all: the token is a string in a form body, and a script that
 * posts the form without ever loading the widget simply sends an empty one.
 * The check is this request, to Cloudflare, with the secret key.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * REJECTED IS NOT THE SAME AS UNREACHABLE, AND THEY ARE HANDLED DIFFERENTLY
 *
 *   REJECTED — Cloudflare answered, and the answer is no. Refuse the
 *   submission. This is the normal bot case.
 *
 *   UNAVAILABLE — Cloudflare did not answer: a timeout, a 5xx, a DNS
 *   failure. ALLOW the submission, flagged as unverified.
 *
 * That second one deserves its reasoning in writing, because "fail closed"
 * is the reflex and it is wrong here. The decisive argument is the same one
 * that made the public-form rate limiter fail open: a person who cannot sign
 * in must still be able to write to support about not being able to sign in.
 * Making the contact form unusable during a Cloudflare incident turns their
 * outage into our support blackout.
 *
 * The cost of being wrong is also asymmetric. Failing open during an outage
 * admits some spam into a Payload collection, which an admin deletes. Failing
 * closed loses a customer's message. And in practice the window is small: if
 * Cloudflare is unreachable from our server it is usually unreachable from
 * the browser too, so no token was issued and there is nothing to verify.
 *
 * A degraded verification is logged at ERROR and recorded on the row, so
 * "where did this spam come from" has an answer rather than a theory.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ONE MORE THING THAT IS EASY TO MISS
 *
 * A Turnstile token is SINGLE USE and expires in about five minutes.
 * Verifying the same token twice fails with `timeout-or-duplicate`, which
 * means a retry after a failed submission must fetch a fresh token — the
 * widget has to be reset, not reused. The client component does that; this
 * module reports the code so the failure is attributable rather than
 * mysterious.
 */

export const TURNSTILE_VERIFY_ENDPOINT =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/*
 * Cloudflare's always-pass and always-fail test keys are documented in
 * .env.example, next to the variables they go in — not exported from here.
 * A pair of exported constants nothing imports is a pair of constants that
 * eventually gets imported by production code "just for a moment".
 */

const VERIFY_TIMEOUT_MS = 5_000

export type TurnstileVerdict =
  /** Cloudflare said yes. */
  | { readonly outcome: 'ok' }
  /** No token in the form body at all. Treated as a refusal, not an outage. */
  | { readonly outcome: 'missing-token' }
  /** Cloudflare said no. */
  | { readonly outcome: 'rejected'; readonly codes: readonly string[] }
  /** Cloudflare could not be reached or did not answer usefully. */
  | { readonly outcome: 'unavailable'; readonly reason: string }

export type VerifyArgs = {
  /** The `cf-turnstile-response` value from the form body. */
  token: string | null | undefined
  /** `TURNSTILE_SECRET_KEY`. Never the site key. */
  secret: string
  /** Client address, when known. Improves Cloudflare's scoring. */
  remoteIp?: string | null
  /** Injected for tests. */
  fetchImpl?: typeof fetch
}

type SiteVerifyResponse = {
  success?: unknown
  'error-codes'?: unknown
}

/**
 * Did Cloudflare accept this token?
 *
 * Never throws. Every failure mode is a verdict, because a thrown exception
 * inside a server action becomes a 500 and the caller loses the ability to
 * tell "you are a bot" from "our bot check is down" — which is exactly the
 * distinction the whole module exists to make.
 */
export const verifyTurnstileToken = async ({
  token,
  secret,
  remoteIp = null,
  fetchImpl = fetch,
}: VerifyArgs): Promise<TurnstileVerdict> => {
  if (typeof token !== 'string' || token.trim() === '') {
    return { outcome: 'missing-token' }
  }

  const body = new URLSearchParams({ secret, response: token })

  if (remoteIp) {
    body.set('remoteip', remoteIp)
  }

  let response: Response

  try {
    response = await fetchImpl(TURNSTILE_VERIFY_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    })
  } catch (error) {
    return {
      outcome: 'unavailable',
      reason: error instanceof Error ? error.name : 'FetchFailed',
    }
  }

  if (!response.ok) {
    // A 5xx is an outage. A 4xx here means we sent something malformed —
    // also not the visitor's fault, and also not evidence that they are a
    // bot, so it is reported as unavailable rather than as a rejection.
    return { outcome: 'unavailable', reason: `HTTP ${response.status}` }
  }

  let parsed: SiteVerifyResponse

  try {
    parsed = (await response.json()) as SiteVerifyResponse
  } catch {
    return { outcome: 'unavailable', reason: 'MalformedResponse' }
  }

  if (parsed.success === true) {
    return { outcome: 'ok' }
  }

  const codes = Array.isArray(parsed['error-codes'])
    ? parsed['error-codes'].filter(
        (code): code is string => typeof code === 'string',
      )
    : []

  /**
   * One class of error code is OUR fault, not the visitor's.
   *
   * `internal-error` is Cloudflare telling us it failed; a bad or missing
   * secret is a deployment mistake. Reporting either as "you look like a
   * bot" would blame the visitor for a misconfiguration and — worse — make
   * a missing secret look like working bot protection, which is the failure
   * mode where everyone believes the form is protected and it is not.
   */
  const ourFault = codes.some((code) =>
    [
      'internal-error',
      'missing-input-secret',
      'invalid-input-secret',
      'bad-request',
    ].includes(code),
  )

  if (ourFault) {
    return { outcome: 'unavailable', reason: codes.join(',') }
  }

  return { outcome: 'rejected', codes }
}

/**
 * May the submission proceed, and was the check degraded?
 *
 * Collapses the verdict into the two booleans a caller actually needs, so a
 * call site cannot accidentally treat `unavailable` as a refusal (locking
 * customers out during an outage) or `rejected` as degraded (letting bots
 * through).
 */
export const turnstileAllows = (
  verdict: TurnstileVerdict,
): { allowed: boolean; degraded: boolean } => {
  switch (verdict.outcome) {
    case 'ok':
      return { allowed: true, degraded: false }
    case 'unavailable':
      return { allowed: true, degraded: true }
    case 'rejected':
    case 'missing-token':
    default:
      return { allowed: false, degraded: false }
  }
}
