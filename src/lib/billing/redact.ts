/**
 * Making payment data safe to log.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT MUST NEVER REACH A LOG, AND WHY
 *
 *   - A card number. Writing a PAN to a log file puts every system that
 *     touches that file — the log aggregator, its backups, whoever has
 *     read access — inside PCI-DSS scope. Nothing we do is worth that.
 *   - A client secret. It is a bearer credential: whoever holds it can
 *     confirm or inspect that payment. Log lines get pasted into tickets.
 *   - A webhook signing secret or an API key. Obvious, and still the most
 *     common thing to find in a log, usually because somebody logged a
 *     whole config object while debugging something else.
 *   - A raw event payload. Not because the payload is itself a credential,
 *     but because it is large, provider-shaped, and contains payment method
 *     detail nobody audited. We store it in `WebhookEvents` deliberately,
 *     with access control; the log is a different place with different rules.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY A FUNCTION RATHER THAN A RULE
 *
 * "Don't log secrets" is a rule, and rules are followed by whoever remembers
 * them at 2am. This is a function that is wrong to omit: every log call in the
 * billing module passes its payload through `redactForLog`, and the test in
 * `redact.test.ts` runs a whole subscription flow and greps the captured
 * output for the actual secret values. A regression fails the build rather
 * than sitting in a log for a year.
 *
 * Redaction is deliberately pattern-based rather than key-based. A key
 * allow-list only protects the keys somebody thought of; a secret pasted into
 * a message string, a URL or an array still gets caught here.
 */

/** What a redacted value is replaced with. Distinctive, so it greps well. */
export const REDACTED = '[redacted]'

/**
 * Patterns for things that must never be logged, whatever key they sit under.
 *
 * Ordered longest-prefix-first where prefixes overlap, because replacement is
 * sequential and a shorter pattern would otherwise eat the longer one.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  // Stripe-style client secrets: <object_id>_secret_<random>. Checked before
  // the key patterns because the id part can itself look benign.
  /\b[A-Za-z0-9_]+_secret_[A-Za-z0-9-]{6,}/g,
  // Webhook signing secrets.
  /\bwhsec_[A-Za-z0-9+/=_-]{8,}/g,
  // Secret and restricted API keys.
  /\b(?:sk|rk)_(?:test|live)_[A-Za-z0-9]{8,}/g,
  // Publishable keys. Not secret, but logging them is noise that teaches
  // people keys belong in logs.
  /\bpk_(?:test|live)_[A-Za-z0-9]{8,}/g,
]

/**
 * Candidate card numbers: 13–19 digits, optionally grouped in fours.
 *
 * Kept out of `SECRET_PATTERNS` because a digit run on its own is not enough
 * to act on — see `looksLikeCardNumber`.
 */
const DIGIT_RUN_PATTERN = /\b(?:\d[ -]?){12,18}\d\b/g

/**
 * Does this digit run pass the Luhn checksum?
 *
 * Every card number does, by definition (ISO/IEC 7812). Almost nothing else in
 * a payment payload does, and that distinction matters here: a 13-digit
 * epoch-millisecond timestamp is exactly as long as a Visa PAN, and redacting
 * every one of them would quietly destroy the timestamps that make
 * out-of-order event handling debuggable. Luhn catches real card numbers and
 * leaves the clocks alone.
 */
export const looksLikeCardNumber = (candidate: string): boolean => {
  const digits = candidate.replace(/[ -]/g, '')

  if (digits.length < 13 || digits.length > 19) return false

  let sum = 0
  let double = false

  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = digits.charCodeAt(index) - 48

    if (double) {
      digit *= 2
      if (digit > 9) digit -= 9
    }

    sum += digit
    double = !double
  }

  return sum % 10 === 0
}

/** Keys whose value is replaced outright, whatever it looks like. */
const SENSITIVE_KEY_PATTERN =
  /^(?:client_secret|clientSecret|secret|webhook_secret|webhookSecret|api_key|apiKey|authorization|cookie|card_number|cardNumber|pan|cvc|cvv|number)$/i

/** Keys whose value is a whole provider payload we do not want in a log. */
const BULK_PAYLOAD_KEY_PATTERN =
  /^(?:rawPayload|raw_payload|payload|body|rawBody|raw_body|event)$/i

/** Mask every character of a string but the last `keep`. */
export const maskTail = (value: string, keep = 4): string => {
  if (value.length <= keep) return '*'.repeat(value.length)

  return `${'*'.repeat(value.length - keep)}${value.slice(-keep)}`
}

/** Replace any secret-shaped substring inside a string. */
export const redactString = (value: string): string => {
  let result = value

  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, REDACTED)
  }

  return result.replace(DIGIT_RUN_PATTERN, (match) =>
    looksLikeCardNumber(match) ? REDACTED : match,
  )
}

/**
 * Deep-copy a value with everything sensitive removed.
 *
 * Returns a new structure; the input is never mutated, because the caller is
 * usually logging something it is also about to use.
 */
export const redactForLog = (value: unknown, depth = 0): unknown => {
  // A provider payload nests deeply. Beyond a few levels it is unreadable in
  // a log anyway, and the deeper it goes the likelier it holds something we
  // did not think about.
  if (depth > 6) return '[truncated]'

  if (value === null || value === undefined) return value

  if (typeof value === 'string') return redactString(value)

  if (typeof value === 'number' || typeof value === 'boolean') return value

  if (typeof value === 'bigint') return value.toString()

  if (value instanceof Date) return value.toISOString()

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      // No stack: it can hold interpolated argument values.
    }
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactForLog(item, depth + 1))
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {}

    for (const [key, item] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        result[key] = REDACTED

        continue
      }

      if (BULK_PAYLOAD_KEY_PATTERN.test(key)) {
        result[key] = '[payload omitted]'

        continue
      }

      result[key] = redactForLog(item, depth + 1)
    }

    return result
  }

  // Functions, symbols and anything else exotic.
  return `[${typeof value}]`
}

/**
 * The part of a provider error that is safe and useful to log.
 *
 * Provider SDK errors carry the whole failing request, headers included. This
 * keeps the four fields that identify the problem and discards the rest.
 */
export const describeProviderError = (
  error: unknown,
): Record<string, unknown> => {
  if (typeof error !== 'object' || error === null) {
    return { message: redactString(String(error)) }
  }

  const candidate = error as {
    type?: unknown
    code?: unknown
    param?: unknown
    requestId?: unknown
    statusCode?: unknown
    message?: unknown
  }

  const described: Record<string, unknown> = {}

  if (typeof candidate.type === 'string') described.type = candidate.type
  if (typeof candidate.code === 'string') described.code = candidate.code
  if (typeof candidate.param === 'string') described.param = candidate.param
  if (typeof candidate.requestId === 'string') {
    // The provider's own request id, which is what support will ask for.
    described.requestId = candidate.requestId
  }
  if (typeof candidate.statusCode === 'number') {
    described.statusCode = candidate.statusCode
  }
  if (typeof candidate.message === 'string') {
    described.message = redactString(candidate.message)
  }

  return described
}
