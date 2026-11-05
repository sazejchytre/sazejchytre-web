/**
 * Form validation. Zod, plus the honeypot.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THREE DEFENCES, EACH CATCHING SOMETHING THE OTHERS DO NOT
 *
 *   TURNSTILE catches automation that runs a real browser engine. It is the
 *   primary defence and the only one a competent bot has to work at.
 *
 *   THE HONEYPOT catches the dumb, high-volume end: a script that posts every
 *   field it can find in the HTML. It costs one hidden input and it filters
 *   most of the traffic that ever reaches a public form. It is not security —
 *   it is a free first pass.
 *
 *   ZOD catches everything else, including the case neither of the others
 *   addresses: a HUMAN posting a 400kB message, or a crafted body with
 *   `message` as an array. A form body is attacker-controlled regardless of
 *   how convinced we are that a browser sent it.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THE MESSAGES ARE CODES, NOT CZECH SENTENCES
 *
 * Because the Czech sentences live in `src/i18n/messages/cs.ts`, where a test
 * enforces the copy rules over them. A schema that carried its own user-
 * facing strings would put user-facing copy outside that test, and the
 * catalogue would stop being the single place a reviewer has to read.
 *
 * So validation returns a CODE per field and the caller resolves it through
 * the catalogue. The codes are the catalogue's own key names, so the mapping
 * is a lookup rather than a switch somebody has to keep in step.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE HIDDEN FIELD IS NOT CALLED "honeypot"
 *
 * It is called `website`, because a bot filling in a field called `honeypot`
 * is a bot whose author read the HTML. It is hidden with CSS and marked
 * `aria-hidden` plus `tabIndex={-1}`, so neither a screen reader nor a Tab
 * key ever reaches it — a honeypot that traps a keyboard user is a honeypot
 * that blocks the people it was meant to protect.
 */
import { z } from 'zod'

/** The hidden input's name. Must stay in step with the form component. */
export const HONEYPOT_FIELD = 'website'

/** Turnstile's own field name. Fixed by the widget, not by us. */
export const TURNSTILE_FIELD = 'cf-turnstile-response'

/** Catalogue keys under `contact.form` / `newsletter`. */
export type FieldErrorCode =
  'required' | 'invalidEmail' | 'tooLong' | 'tooShort' | 'consentRequired'

export type FieldErrors<TField extends string> = Partial<
  Record<TField, FieldErrorCode>
>

export type ParseResult<TValue, TField extends string> =
  { ok: true; value: TValue } | { ok: false; errors: FieldErrors<TField> }

/* -------------------------------------------------------------------------- */
/* Shared field shapes                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Caps, chosen to be generous for a person and hostile to a flood.
 *
 * 5000 characters is a long support message and a short spam payload. The
 * limit exists because the column is `textarea` and a request body is not
 * bounded by anything else in the path.
 */
const MAX_NAME = 120
const MAX_EMAIL = 254
const MAX_SUBJECT = 160
const MAX_MESSAGE = 5_000
const MIN_MESSAGE = 10

/** 254 is the practical maximum length of an address, per RFC 5321. */
const emailField = z
  .string()
  .trim()
  .min(1, { error: 'required' })
  .max(MAX_EMAIL, { error: 'tooLong' })
  .pipe(z.email({ error: 'invalidEmail' }))

const requiredText = (max: number) =>
  z.string().trim().min(1, { error: 'required' }).max(max, { error: 'tooLong' })

/* -------------------------------------------------------------------------- */
/* Contact                                                                    */
/* -------------------------------------------------------------------------- */

export const contactSchema = z.object({
  name: requiredText(MAX_NAME),
  email: emailField,
  subject: requiredText(MAX_SUBJECT),
  message: z
    .string()
    .trim()
    .min(1, { error: 'required' })
    .min(MIN_MESSAGE, { error: 'tooShort' })
    .max(MAX_MESSAGE, { error: 'tooLong' }),
})

export type ContactInput = z.infer<typeof contactSchema>
export type ContactField = keyof ContactInput | 'form'

/* -------------------------------------------------------------------------- */
/* Newsletter                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The consent checkbox is its own required field, and it is NOT pre-ticked.
 *
 * A pre-ticked marketing consent is not consent under the GDPR, and a
 * `ConsentRecord` created from one is evidence of nothing. The schema demands
 * the literal `'on'` an unchecked box never sends, so a missing box is a
 * validation error rather than a silent `false`.
 */
export const newsletterSchema = z.object({
  email: emailField,
  consent: z.literal('on', { error: 'consentRequired' }),
})

export type NewsletterInput = z.infer<typeof newsletterSchema>
export type NewsletterField = keyof NewsletterInput | 'form'

/* -------------------------------------------------------------------------- */
/* FormData → values                                                          */
/* -------------------------------------------------------------------------- */

/**
 * One form field as a string.
 *
 * A `File` entry — which is what a crafted multipart body can put in a text
 * field — becomes an empty string rather than `[object File]`, so it fails
 * `required` instead of passing as a nine-character name.
 */
const text = (data: FormData, field: string): string => {
  const value = data.get(field)

  return typeof value === 'string' ? value : ''
}

/**
 * Was the honeypot filled in?
 *
 * Any non-empty value trips it. A caller is expected to answer with the same
 * message a success produces — telling a bot it was caught is telling the
 * author which field to leave alone next time.
 */
export const isHoneypotTripped = (data: FormData): boolean =>
  text(data, HONEYPOT_FIELD).trim() !== ''

/** The Turnstile token, or null when the widget never ran. */
export const turnstileToken = (data: FormData): string | null => {
  const value = text(data, TURNSTILE_FIELD).trim()

  return value === '' ? null : value
}

/**
 * Collapse a Zod error into one code per field.
 *
 * First error wins. A field with three problems only needs the first one
 * fixed, and showing three messages under one input is how a form becomes
 * unreadable.
 */
const toFieldErrors = <TField extends string>(
  error: z.ZodError,
): FieldErrors<TField> => {
  const errors: Record<string, FieldErrorCode> = {}

  for (const issue of error.issues) {
    const field = issue.path[0]

    if (typeof field !== 'string' || errors[field] !== undefined) {
      continue
    }

    // The schema's `error` strings ARE the codes. Anything unrecognised
    // becomes `required`, which is the safe default: it says "this field is
    // the problem" without inventing a reason.
    const code = issue.message as FieldErrorCode

    errors[field] = (
      [
        'required',
        'invalidEmail',
        'tooLong',
        'tooShort',
        'consentRequired',
      ] as const
    ).includes(code)
      ? code
      : 'required'
  }

  return errors as FieldErrors<TField>
}

export const parseContactForm = (
  data: FormData,
): ParseResult<ContactInput, ContactField> => {
  const parsed = contactSchema.safeParse({
    name: text(data, 'name'),
    email: text(data, 'email'),
    subject: text(data, 'subject'),
    message: text(data, 'message'),
  })

  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, errors: toFieldErrors<ContactField>(parsed.error) }
}

export const parseNewsletterForm = (
  data: FormData,
): ParseResult<NewsletterInput, NewsletterField> => {
  const parsed = newsletterSchema.safeParse({
    email: text(data, 'email'),
    consent: text(data, 'consent'),
  })

  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, errors: toFieldErrors<NewsletterField>(parsed.error) }
}
