/**
 * Logging for the public forms.
 *
 * Reuses the redaction built for the auth paths rather than reimplementing
 * it. The reasons it exists apply here too, with one addition: a contact form
 * carries the visitor's own words, which may include an account email, an
 * order number or — occasionally — a password they decided to put in a
 * support message. None of that belongs in a log line.
 *
 * So the rule for this module is narrower than the auth one: a form log
 * records WHAT HAPPENED and never WHAT WAS WRITTEN. There is no `message`
 * field, no `subject` field, and the address appears only as a hash.
 *
 * `scope: 'forms'` rather than `'auth'`, so the two streams can be filtered
 * apart in a log viewer.
 */
import { hashIdentifier, redactFields } from '../auth/logging.ts'

export type FormLogLevel = 'info' | 'warn' | 'error'

export type FormLogSink = (
  level: FormLogLevel,
  event: string,
  fields: Record<string, unknown>,
) => void

const defaultSink: FormLogSink = (level, event, fields) => {
  const line = JSON.stringify({ scope: 'forms', event, ...fields })

  // eslint-disable-next-line no-console
  console[level === 'info' ? 'log' : level](line)
}

/**
 * The sink.
 *
 * A `const`, not a swappable module-level variable. `authLog` has a
 * `setAuthLogSink` because its tests capture log lines to prove a reset token
 * never reaches them; nothing here needs that yet, and an exported setter
 * with no caller is an escape hatch that gets used for the wrong thing before
 * it gets used for the right one. Add it in the step that needs it.
 */
const sink: FormLogSink = defaultSink

const emit =
  (level: FormLogLevel) =>
  (event: string, fields: Record<string, unknown> = {}): void => {
    sink(level, event, redactFields(fields))
  }

export const formLog = {
  info: emit('info'),
  warn: emit('warn'),
  error: emit('error'),
}

/**
 * A stable, non-reversible handle for an address.
 *
 * Lets two events about the same submitter be correlated without the log
 * holding the address itself.
 */
export const emailHandle = (email: string): string => hashIdentifier(email)
