'use server'

/**
 * The newsletter form's server action.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE CONSENT RECORD IS WRITTEN BEFORE ECOMAIL IS CALLED
 *
 * Same ordering as the contact form, for a different reason. There, the thing
 * that must not be lost is the customer's message. Here it is the EVIDENCE:
 * the person read a sentence and ticked a box, and that fact does not depend
 * on whether our newsletter provider was reachable a moment later.
 *
 * It also means an Ecomail outage never leaves us with a subscriber whose
 * consent we cannot produce — which is the wrong way round to fail, because
 * the subscriber keeps receiving email while the proof is missing.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE WORDING IS SNAPSHOTTED, NOT REFERENCED
 *
 * `consentTextSnapshot` holds the exact sentence displayed. A reference to
 * "the 2026-11 wording" proves what we BELIEVE was on screen; the snapshot is
 * what can be put in front of a regulator. `consent.ts` fingerprints the
 * catalogue string so the wording cannot change without the version changing
 * with it.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY A FAILED SUBSCRIPTION STILL SAYS SO
 *
 * Unlike the contact form, a failure here IS the visitor's problem: nothing
 * will arrive, and they would otherwise sit waiting for a confirmation email
 * that was never sent. So an Ecomail refusal produces an error message, while
 * the consent row stays — it is a record of what they agreed to, not a claim
 * that they are subscribed.
 */
import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { getPayload } from 'payload'

import config from '../../payload.config.ts'
import { DEFAULT_LOCALE } from '../../i18n/config.ts'
import { truncateIpAddress } from '../auth/client-identity.ts'
import { env } from '../env.ts'
import { MARKETING_CONSENT_VERSION, marketingConsentText } from './consent.ts'
import { subscribeToEcomail } from './ecomail.ts'
import { emailHandle, formLog } from './logging.ts'
import { enforceFormRateLimit } from './rate-limit.ts'
import {
  type NewsletterField,
  isHoneypotTripped,
  parseNewsletterForm,
  turnstileToken,
} from './schema.ts'
import { type FormState, errorState, successState } from './state.ts'
import { turnstileAllows, verifyTurnstileToken } from './turnstile.ts'

export type NewsletterFormState = FormState<NewsletterField>

const clientIp = (h: Headers): string | null => {
  const forwarded = h.get('x-forwarded-for')

  return forwarded?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? null
}

export const submitNewsletterForm = async (
  _previous: NewsletterFormState | null,
  formData: FormData,
): Promise<NewsletterFormState> => {
  const t = await getTranslations({
    locale: DEFAULT_LOCALE,
    namespace: 'newsletter',
  })

  if (isHoneypotTripped(formData)) {
    formLog.info('newsletter.honeypot')

    return successState(t('success'))
  }

  const parsed = parseNewsletterForm(formData)

  if (!parsed.ok) {
    const errors: Partial<Record<NewsletterField, string>> = {}

    for (const [field, code] of Object.entries(parsed.errors)) {
      if (code) {
        errors[field as NewsletterField] = t(code)
      }
    }

    return errorState(errors.consent ?? errors.email ?? t('failure'), errors)
  }

  const { email } = parsed.value
  const requestHeaders = await headers()
  const ip = clientIp(requestHeaders)
  const userAgent = requestHeaders.get('user-agent')

  const limit = await enforceFormRateLimit({
    action: 'newsletter',
    ip,
    target: email,
    onDegraded: (error) => {
      formLog.error('newsletter.rate_limit_degraded', {
        reason: error instanceof Error ? error.name : 'unknown',
      })
    },
  })

  if (!limit.allowed) {
    formLog.warn('newsletter.rate_limited', { email: emailHandle(email) })

    return errorState(t('rateLimited'))
  }

  const verdict = await verifyTurnstileToken({
    token: turnstileToken(formData),
    secret: env.TURNSTILE_SECRET_KEY,
    remoteIp: ip,
  })

  const challenge = turnstileAllows(verdict)

  if (!challenge.allowed) {
    formLog.warn('newsletter.turnstile_refused', { outcome: verdict.outcome })

    return errorState(t('turnstileFailed'), undefined, true)
  }

  if (challenge.degraded) {
    formLog.error('newsletter.turnstile_degraded', {
      reason: verdict.outcome === 'unavailable' ? verdict.reason : 'unknown',
    })
  }

  /* The consent, first ---------------------------------------------------- */
  const payload = await getPayload({ config })

  try {
    await payload.create({
      collection: 'consent-records',
      overrideAccess: true,
      data: {
        // No customer: a newsletter signup usually precedes any account, and
        // the collection allows null for exactly this case.
        type: 'MARKETING',
        documentVersion: MARKETING_CONSENT_VERSION,
        // Verbatim, from the catalogue. The authority, not the version.
        consentTextSnapshot: marketingConsentText(),
        grantedAt: new Date().toISOString(),
        // Truncated, like everywhere else in this codebase. The real evidence
        // of who owns the address is Ecomail's double opt-in click; a /24
        // prefix adds "from this network" without storing a person's full
        // address for a mailing list.
        ipAddress: truncateIpAddress(ip),
        userAgent,
      },
    })
  } catch (error) {
    // Without the record we have no evidence, so we do not subscribe. The
    // alternative — subscribe now, record later — is the combination that
    // leaves somebody receiving email we cannot show they asked for.
    formLog.error('newsletter.consent_not_recorded', {
      email: emailHandle(email),
      reason: error instanceof Error ? error.name : 'unknown',
    })

    return errorState(t('failure'))
  }

  /* Then the provider ----------------------------------------------------- */
  const outcome = await subscribeToEcomail({
    email,
    listId: env.ECOMAIL_LIST_ID,
    apiKey: env.ECOMAIL_API_KEY,
  })

  if (!outcome.ok) {
    formLog.error('newsletter.subscribe_failed', {
      email: emailHandle(email),
      reason: outcome.reason,
      detail: outcome.detail,
    })

    return errorState(t('failure'))
  }

  formLog.info('newsletter.subscribed', {
    email: emailHandle(email),
    alreadySubscribed: outcome.alreadySubscribed,
  })

  /**
   * The same message either way.
   *
   * An address already on the list gets "we sent a confirmation" too, because
   * telling a visitor "you are already subscribed" is a membership oracle:
   * anyone could test whether a given person is on our list. The sentence is
   * also still true — Ecomail's double opt-in resends the confirmation.
   */
  return successState(t('success'))
}
