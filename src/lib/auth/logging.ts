/**
 * Logging for the authentication paths, with secrets removed by construction.
 *
 * WHY A DEDICATED LOGGER
 *
 * The things that move through these code paths — verification tokens, reset
 * tokens, session ids, TOTP secrets, backup codes — are bearer credentials.
 * Anything holding one can become the user. Logs are the easiest place to leak
 * them: they are copied to a provider, kept far longer than the token's own
 * lifetime, and read by people who are not the customer. A reset token in a
 * log line is an account takeover waiting for anyone with log access.
 *
 * So auth code never calls `console` directly. It calls this, which:
 *
 *  1. Drops any field whose NAME looks like a secret, whatever its value.
 *     This is the primary defence, because it works even for a secret shape
 *     we did not anticipate.
 *  2. Scrubs any VALUE that looks like a token or carries one in a URL. This
 *     catches a secret that arrived under an innocent name, such as a reset
 *     link passed as `url`.
 *  3. Replaces email addresses with a stable hash, so a log can still
 *     correlate events for one account without holding the address.
 *
 * Both layers are deliberate. Name-based filtering alone misses
 * `{ message: 'sent https://…?token=abc' }`; value-based scrubbing alone
 * misses a short secret that does not look like one.
 */
import { createHash } from 'node:crypto'

/** Field names whose values are never logged, matched case-insensitively. */
const SECRET_FIELD_PATTERN =
  /(token|secret|password|passwd|code|otp|totp|backup|hash|salt|cookie|authorization|session_?id|sessionid|credential|key)/i

/** Values that look like a bearer credential regardless of field name. */
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  // A URL carrying a token-ish query parameter.
  /[?&](token|code|secret|otp|key|t)=[^&\s]+/gi,
  // Long opaque strings: base64url / hex of 20+ chars.
  /\b[A-Za-z0-9_-]{20,}\b/g,
  // Grouped numeric codes, e.g. a 6-digit TOTP.
  /\b\d{6,}\b/g,
]

const REDACTED = '[redacted]'

/** Stable, non-reversible identifier for an email address. */
export const hashIdentifier = (value: string): string =>
  `acct_${createHash('sha256').update(value.trim().toLowerCase()).digest('hex').slice(0, 12)}`

const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/g

/**
 * Scrub a single value.
 *
 * Exported so the log-leak test can assert on the same function the logger
 * uses, rather than on a reimplementation of it.
 */
export const redactValue = (value: unknown): unknown => {
  if (typeof value !== 'string') {
    return value
  }

  let out = value.replace(EMAIL_PATTERN, (match) => hashIdentifier(match))

  for (const pattern of SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, (match) =>
      // Keep the parameter name so a log line stays readable.
      /^[?&]/.test(match)
        ? `${match.slice(0, match.indexOf('=') + 1)}${REDACTED}`
        : REDACTED,
    )
  }

  return out
}

/** Scrub a structured field set. */
export const redactFields = (
  fields: Record<string, unknown>,
): Record<string, unknown> => {
  const out: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(fields)) {
    if (SECRET_FIELD_PATTERN.test(key)) {
      out[key] = REDACTED
      continue
    }

    if (key === 'email' || key === 'identifier') {
      out[key] = typeof value === 'string' ? hashIdentifier(value) : REDACTED
      continue
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = redactFields(value as Record<string, unknown>)
      continue
    }

    out[key] = redactValue(value)
  }

  return out
}

export type AuthLogLevel = 'info' | 'warn' | 'error'

/** The sink. Swappable so tests can capture without touching globals. */
export type AuthLogSink = (
  level: AuthLogLevel,
  event: string,
  fields: Record<string, unknown>,
) => void

const defaultSink: AuthLogSink = (level, event, fields) => {
  const line = JSON.stringify({ scope: 'auth', event, ...fields })

  // eslint-disable-next-line no-console
  console[level === 'info' ? 'log' : level](line)
}

let sink: AuthLogSink = defaultSink

/** Replace the sink. Returns a function restoring the previous one. */
export const setAuthLogSink = (next: AuthLogSink): (() => void) => {
  const previous = sink
  sink = next

  return () => {
    sink = previous
  }
}

const emit =
  (level: AuthLogLevel) =>
  (event: string, fields: Record<string, unknown> = {}): void => {
    sink(level, event, redactFields(fields))
  }

/**
 * The only logger auth code may use.
 *
 * Every field passes through `redactFields`, so a caller cannot leak a token
 * by forgetting to think about it.
 */
export const authLog = {
  info: emit('info'),
  warn: emit('warn'),
  error: emit('error'),
}
