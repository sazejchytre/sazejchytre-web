'use server'

/**
 * The contact form's server action.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE ORDER OF OPERATIONS IS THE DESIGN
 *
 *   1. honeypot      — free, catches the dumb half of the traffic
 *   2. zod           — cheap, and the body is attacker-controlled
 *   3. rate limit    — one Redis round trip, before anything expensive
 *   4. Turnstile     — one Cloudflare round trip
 *   5. WRITE THE ROW — the thing that must not be lost
 *   6. notify        — Resend, afterwards, allowed to fail
 *
 * Steps 1–4 are ordered cheapest-first so a flood costs us as little as
 * possible per request. Steps 5 and 6 are ordered by what we cannot afford to
 * lose: a customer who writes in about a billing problem and gets silence
 * because an email provider had a bad minute is the exact failure this
 * ordering prevents. `notifiedAt` and `notifyError` record which half
 * happened.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * A TRIPPED HONEYPOT LOOKS LIKE SUCCESS
 *
 * The bot is told the same thing a person is told. Saying "you filled in a
 * hidden field" tells the author which field to leave alone next time, and
 * costs us nothing to withhold.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * `overrideAccess: true` ON THE WRITE, DELIBERATELY
 *
 * `contact-submissions` denies `create` to EVERYONE through the API,
 * including admins. This action is the only writer. That is stricter than it
 * needs to be and the reason is in the collection's header: an API that can
 * forge a submission is an API that can make our domain send a notification
 * email with a stranger's text in it.
 */
import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { getPayload } from 'payload'

import config from '../../payload.config.ts'
import { DEFAULT_LOCALE } from '../../i18n/config.ts'
import { truncateIpAddress } from '../auth/client-identity.ts'
import { sendEmail } from '../auth/email.ts'
import { loadSiteSettings } from '../content/loaders.ts'
import { env, isProduction } from '../env.ts'
import { contactNotificationTemplate } from './email-templates.ts'
import { emailHandle, formLog } from './logging.ts'
import { enforceFormRateLimit } from './rate-limit.ts'
import {
  type ContactField,
  isHoneypotTripped,
  parseContactForm,
  turnstileToken,
} from './schema.ts'
import { type FormState, errorState, successState } from './state.ts'
import { turnstileAllows, verifyTurnstileToken } from './turnstile.ts'

export type ContactFormState = FormState<ContactField>

/** First entry of `x-forwarded-for`, which is the client on Vercel. */
const clientIp = (h: Headers): string | null => {
  const forwarded = h.get('x-forwarded-for')

  return forwarded?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? null
}

export const submitContactForm = async (
  _previous: ContactFormState | null,
  formData: FormData,
): Promise<ContactFormState> => {
  const t = await getTranslations({
    locale: DEFAULT_LOCALE,
    namespace: 'contact.form',
  })
  const settings = await loadSiteSettings(DEFAULT_LOCALE)

  /* 1. Honeypot --------------------------------------------------------- */
  if (isHoneypotTripped(formData)) {
    formLog.info('contact.honeypot')

    // Indistinguishable from a real success. See the header.
    return successState(t('success'))
  }

  /* 2. Shape ------------------------------------------------------------ */
  const parsed = parseContactForm(formData)

  if (!parsed.ok) {
    const errors: Partial<Record<ContactField, string>> = {}

    for (const [field, code] of Object.entries(parsed.errors)) {
      if (code) {
        // The schema returns catalogue KEYS, so this is a lookup rather than
        // a switch that has to be kept in step with the schema.
        errors[field as ContactField] = t(code)
      }
    }

    return errorState(t('required'), errors)
  }

  const { name, email, subject, message } = parsed.value
  // The address is used for the rate-limit bucket and, truncated, as
  // evidence on the row. The user agent is deliberately NOT collected: it
  // would be one more identifying field on a table of other people's
  // messages, and nothing here has a use for it.
  const ip = clientIp(await headers())

  /* 3. Rate limit ------------------------------------------------------- */
  const limit = await enforceFormRateLimit({
    action: 'contact',
    ip,
    target: email,
    onDegraded: (error) => {
      // FAILS OPEN — see the module header of rate-limit.ts. Logged at error
      // so an outage is visible rather than inferred from a spam spike.
      formLog.error('contact.rate_limit_degraded', {
        reason: error instanceof Error ? error.name : 'unknown',
      })
    },
  })

  if (!limit.allowed) {
    formLog.warn('contact.rate_limited', { email: emailHandle(email) })

    return errorState(t('rateLimited', { email: settings.contactEmail }))
  }

  /* 4. Turnstile -------------------------------------------------------- */
  const verdict = await verifyTurnstileToken({
    token: turnstileToken(formData),
    secret: env.TURNSTILE_SECRET_KEY,
    remoteIp: ip,
  })

  const challenge = turnstileAllows(verdict)

  if (!challenge.allowed) {
    formLog.warn('contact.turnstile_refused', {
      outcome: verdict.outcome,
      ...(verdict.outcome === 'rejected' ? { codes: verdict.codes } : {}),
    })

    // `resetChallenge` matters here: a Turnstile token is single use, so a
    // retry with the same one fails as a duplicate and the visitor is stuck.
    return errorState(t('turnstileFailed'), undefined, true)
  }

  if (challenge.degraded) {
    formLog.error('contact.turnstile_degraded', {
      reason: verdict.outcome === 'unavailable' ? verdict.reason : 'unknown',
    })
  }

  /* 5. Write the row ---------------------------------------------------- */
  const payload = await getPayload({ config })

  let submissionId: number | string

  try {
    const created = await payload.create({
      collection: 'contact-submissions',
      // The only writer. See the header.
      overrideAccess: true,
      data: {
        name,
        email,
        subject,
        message,
        // A /24 or /64 prefix, never the full address: enough to recognise a
        // flood from one network, not enough to identify a person.
        ipPrefix: truncateIpAddress(ip),
        turnstileDegraded: challenge.degraded,
      },
    })

    submissionId = created.id
  } catch (error) {
    // The row did not land, so there is nothing to notify about and nothing
    // was kept. This is the one path where the visitor must be told to use
    // the direct address — their message genuinely is not saved.
    formLog.error('contact.store_failed', {
      email: emailHandle(email),
      reason: error instanceof Error ? error.name : 'unknown',
    })

    return errorState(t('failure', { email: settings.contactEmail }))
  }

  formLog.info('contact.stored', {
    submissionId,
    email: emailHandle(email),
    turnstileDegraded: challenge.degraded,
  })

  /* 6. Notify ----------------------------------------------------------- */
  try {
    await sendEmail({
      to: settings.notificationEmail,
      email: contactNotificationTemplate({
        name,
        email,
        subject,
        message,
        submissionId,
        turnstileDegraded: challenge.degraded,
        isProduction,
      }),
      kind: 'contact-notification',
    })

    await payload.update({
      collection: 'contact-submissions',
      id: submissionId,
      overrideAccess: true,
      data: { notifiedAt: new Date().toISOString() },
    })
  } catch (error) {
    /**
     * The message is already stored, so this is not a failure the visitor
     * needs to hear about — telling them to write again would produce a
     * duplicate of a message we already have.
     *
     * It IS a failure the operator needs to hear about, because nobody has
     * been told a message arrived. It goes on the row rather than only into a
     * log, so the admin panel's "notifiedAt is empty" view is the queue.
     */
    const reason = error instanceof Error ? error.name : 'unknown'

    formLog.error('contact.notify_failed', { submissionId, reason })

    try {
      await payload.update({
        collection: 'contact-submissions',
        id: submissionId,
        overrideAccess: true,
        data: { notifyError: reason },
      })
    } catch (updateError) {
      // Nothing left to do but say so. The row with the message survives,
      // which is the thing that mattered.
      formLog.error('contact.notify_error_not_recorded', {
        submissionId,
        reason: updateError instanceof Error ? updateError.name : 'unknown',
      })
    }
  }

  return successState(t('success'))
}
