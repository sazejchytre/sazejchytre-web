/**
 * The notification sent to the operator when a contact form arrives.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THIS EMAIL IS A POINTER, NOT A COPY
 *
 * It carries the sender's address and subject, and the message body, because
 * an operator who has to open an admin panel to find out what somebody asked
 * will answer more slowly than one who can read it on a phone.
 *
 * What it does NOT do is become the record. The row in `contact-submissions`
 * is written first and is the thing that must not be lost; this is a
 * notification about that row. If Resend is down, the message is still safe —
 * that ordering is the whole design, and `notifiedAt` records which half
 * happened.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * REPLY-TO IS NOT SET, AND THAT IS DELIBERATE
 *
 * It would be convenient. It would also mean the operator replying from our
 * sending domain to an address a stranger typed into a public form, with the
 * stranger's text quoted beneath — which is how a contact form becomes a spam
 * relay with our domain's reputation attached. The operator replies from
 * their own mailbox.
 */
import { wrap } from '../auth/email-templates.ts'
import type { RenderedEmail } from '../auth/email-templates.ts'

export type ContactNotificationArgs = {
  name: string
  email: string
  subject: string
  message: string
  /** The row's id, so the operator can find it in the admin panel. */
  submissionId: number | string
  /** True when the bot check could not be performed. */
  turnstileDegraded: boolean
  isProduction: boolean
}

export const contactNotificationTemplate = ({
  name,
  email,
  subject,
  message,
  submissionId,
  turnstileDegraded,
  isProduction,
}: ContactNotificationArgs): RenderedEmail => {
  const paragraphs = [
    `Od: ${name} <${email}>`,
    `Předmět: ${subject}`,
    '',
    message,
  ]

  const closing = [`Záznam č. ${String(submissionId)} v administraci.`]

  if (turnstileDegraded) {
    // Said plainly, because it changes how the operator should read the
    // message: the bot check did not run, so this one is less trustworthy
    // than the rest.
    closing.push(
      'Pozor: ověření proti robotům se u této zprávy nepodařilo provést ' +
        '(služba Cloudflare neodpověděla). Zpráva prošla, ale může být ' +
        'automatická.',
    )
  }

  const { html, text } = wrap({
    heading: 'Nová zpráva z kontaktního formuláře',
    paragraphs,
    closing,
    isProduction,
  })

  return {
    // The sender's own subject, prefixed so it is filterable. Not
    // interpolated into anything that is parsed — `wrap` escapes it.
    subject: `[Kontakt] ${subject}`,
    html,
    text,
  }
}
