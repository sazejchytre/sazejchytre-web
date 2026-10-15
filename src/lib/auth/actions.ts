'use server'

/**
 * Server actions for the customer authentication flows.
 *
 * Every export here is reachable by a direct POST, not only through our own
 * forms, so each one validates its own input and enforces its own rate limit.
 * Nothing assumes it was called from the page that renders it.
 *
 * The enumeration-sensitive actions (register, sign in, reset request, resend)
 * all return one of the shared messages from `./action-result.ts` and run
 * under a duration floor. See that file for why all three of message, shape
 * and timing have to match.
 */
import { headers } from 'next/headers'

import {
  ENUMERATION_FLOOR_MS,
  REGISTRATION_MESSAGE,
  RESEND_MESSAGE,
  RESET_REQUEST_MESSAGE,
  SIGN_IN_FAILED_MESSAGE,
  THROTTLED_MESSAGE,
  type ActionResult,
  fail,
  ok,
  withMinimumDuration,
} from './action-result.ts'
import { auth } from './config.ts'
import { EmailDeliveryError } from './email.ts'
import { authLog } from './logging.ts'
import { checkPassword } from './password-policy.ts'
import { recordLockoutForSupport } from './lockout-record.ts'
import {
  AccountLockedError,
  RateLimitedError,
  clearAuthFailures,
  enforceRateLimit,
  recordAuthFailure,
} from './rate-limit.ts'

/* -------------------------------------------------------------------------- */
/* Request context                                                            */
/* -------------------------------------------------------------------------- */

/** Client address, as the edge reported it. */
const clientIp = (h: Headers): string | null => {
  const forwarded = h.get('x-forwarded-for')

  return forwarded?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? null
}

const readEmail = (formData: FormData): string =>
  String(formData.get('email') ?? '')
    .trim()
    .toLowerCase()

const readPassword = (formData: FormData): string =>
  String(formData.get('password') ?? '')

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Translate a limiter refusal into the shared throttled message.
 *
 * A lockout and an exhausted budget are reported identically: telling an
 * attacker "this account is locked" confirms the account exists.
 */
const throttleResult = (error: unknown): ActionResult | null => {
  if (error instanceof AccountLockedError) {
    return fail(THROTTLED_MESSAGE, 'form', true)
  }

  if (error instanceof RateLimitedError) {
    return fail(
      error.failedClosed ? error.message : THROTTLED_MESSAGE,
      'form',
      true,
    )
  }

  return null
}

/* -------------------------------------------------------------------------- */
/* Registration                                                               */
/* -------------------------------------------------------------------------- */

export const registerAction = async (
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> =>
  withMinimumDuration(ENUMERATION_FLOOR_MS, async () => {
    const h = await headers()
    const email = readEmail(formData)
    const password = readPassword(formData)
    const name = String(formData.get('name') ?? '').trim()

    if (!EMAIL_PATTERN.test(email)) {
      return fail('Zadejte platnou e-mailovou adresu.', 'email')
    }

    // The password policy is NOT enumeration-sensitive: the user already knows
    // what they typed, so a specific reason is safe and more useful.
    const policy = checkPassword(password)

    if (!policy.ok) {
      return fail(policy.message, 'password')
    }

    try {
      await enforceRateLimit({
        action: 'signUp',
        ip: clientIp(h),
        identifier: email,
      })
    } catch (error) {
      const throttled = throttleResult(error)
      if (throttled) return throttled
      throw error
    }

    try {
      // With `autoSignIn: false`, better-auth answers an already-registered
      // address with a synthetic success rather than an error — so this call
      // succeeds either way and the message below is the same either way.
      await auth.api.signUpEmail({
        body: { email, password, name: name || email },
        headers: h,
      })

      return ok(REGISTRATION_MESSAGE, '/overeni-emailu?odeslano=1')
    } catch (error) {
      if (error instanceof EmailDeliveryError) {
        // The account may well have been created; what failed is the email.
        // Say so and offer a retry rather than implying the sign-up failed.
        authLog.error('register.email_failed', { email })

        return fail(
          'Účet jsme vytvořili, ale potvrzovací e-mail se nepodařilo odeslat. Zkuste ho poslat znovu.',
          'form',
          true,
        )
      }

      authLog.error('register.failed', {
        email,
        reason: error instanceof Error ? error.name : 'unknown',
      })

      // Any other failure is reported with the SAME message as success. An
      // error that only appears for existing addresses would be an
      // enumeration oracle on its own.
      return ok(REGISTRATION_MESSAGE, '/overeni-emailu?odeslano=1')
    }
  })

/* -------------------------------------------------------------------------- */
/* Sign in                                                                    */
/* -------------------------------------------------------------------------- */

export const signInAction = async (
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> =>
  withMinimumDuration(ENUMERATION_FLOOR_MS, async () => {
    const h = await headers()
    const email = readEmail(formData)
    const password = readPassword(formData)
    /** Per-session choice, not an account setting. */
    const rememberMe = formData.get('rememberMe') === 'on'

    if (!EMAIL_PATTERN.test(email) || password.length === 0) {
      return fail(SIGN_IN_FAILED_MESSAGE, 'form')
    }

    try {
      await enforceRateLimit({
        action: 'signIn',
        ip: clientIp(h),
        identifier: email,
      })
    } catch (error) {
      const throttled = throttleResult(error)
      if (throttled) return throttled
      throw error
    }

    try {
      const result = await auth.api.signInEmail({
        body: { email, password, rememberMe },
        headers: h,
        asResponse: false,
      })

      await clearAuthFailures(email)

      // A 2FA-enabled account does not get a session yet: better-auth returns
      // a challenge and sets a short-lived cookie instead.
      const twoFactorRedirect = (result as { twoFactorRedirect?: boolean })
        ?.twoFactorRedirect

      if (twoFactorRedirect) {
        return ok('Zadejte kód z aplikace.', '/prihlaseni/dvoufazove')
      }

      authLog.info('signin.success', { email, rememberMe })

      return ok('Přihlášení proběhlo.', '/ucet')
    } catch {
      // Count the failure against the account, then answer with the one
      // message used for every failure reason. The reason itself is
      // deliberately not inspected: branching on it is how a specific error
      // message — and an enumeration oracle — gets reintroduced.
      const outcome = await recordAuthFailure(email)

      authLog.warn('signin.failed', {
        email,
        failures: outcome.failures,
        lockedForSeconds: outcome.lockedForSeconds,
      })

      if (outcome.lockedForSeconds > 0) {
        // Durable copy for support. Redis holds the enforcement and expires on
        // its own, which leaves "why could I not sign in yesterday?"
        // unanswerable — so the lock is also written where it survives.
        await recordLockoutForSupport({
          identifier: email,
          failures: outcome.failures,
          lockSeconds: outcome.lockedForSeconds,
          ipCountry: h.get('cf-ipcountry'),
          reason: 'SIGN_IN_FAILURES',
        })
      }

      return fail(SIGN_IN_FAILED_MESSAGE, 'form')
    }
  })

/* -------------------------------------------------------------------------- */
/* Sign out                                                                   */
/* -------------------------------------------------------------------------- */

export const signOutAction = async (
  _previous?: ActionResult | null,
  _formData?: FormData,
): Promise<ActionResult> => {
  const h = await headers()

  try {
    await auth.api.signOut({ headers: h })
  } catch {
    // Already signed out, or the session was revoked elsewhere. Either way the
    // user's intent is satisfied.
  }

  return ok('Odhlášeno.', '/prihlaseni')
}

/* -------------------------------------------------------------------------- */
/* Email verification                                                         */
/* -------------------------------------------------------------------------- */

export const resendVerificationAction = async (
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> =>
  withMinimumDuration(ENUMERATION_FLOOR_MS, async () => {
    const h = await headers()
    const email = readEmail(formData)

    if (!EMAIL_PATTERN.test(email)) {
      return fail('Zadejte platnou e-mailovou adresu.', 'email')
    }

    try {
      await enforceRateLimit({
        action: 'verificationResend',
        ip: clientIp(h),
        identifier: email,
      })
    } catch (error) {
      const throttled = throttleResult(error)
      if (throttled) return throttled
      throw error
    }

    try {
      await auth.api.sendVerificationEmail({
        body: { email, callbackURL: '/prihlaseni?overeno=1' },
        headers: h,
      })
    } catch (error) {
      if (error instanceof EmailDeliveryError) {
        authLog.error('resend.email_failed', { email })

        return fail(
          'E-mail se nepodařilo odeslat. Zkuste to prosím znovu.',
          'form',
          true,
        )
      }

      // Unknown or already-verified address: same message as success.
      authLog.info('resend.no_action', { email })
    }

    return ok(RESEND_MESSAGE)
  })

/* -------------------------------------------------------------------------- */
/* Password reset                                                             */
/* -------------------------------------------------------------------------- */

export const requestPasswordResetAction = async (
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> =>
  withMinimumDuration(ENUMERATION_FLOOR_MS, async () => {
    const h = await headers()
    const email = readEmail(formData)

    if (!EMAIL_PATTERN.test(email)) {
      return fail('Zadejte platnou e-mailovou adresu.', 'email')
    }

    try {
      await enforceRateLimit({
        action: 'passwordResetRequest',
        ip: clientIp(h),
        identifier: email,
      })
    } catch (error) {
      const throttled = throttleResult(error)
      if (throttled) return throttled
      throw error
    }

    try {
      await auth.api.requestPasswordReset({
        body: { email, redirectTo: '/obnova-hesla' },
        headers: h,
      })
    } catch (error) {
      if (error instanceof EmailDeliveryError) {
        authLog.error('reset_request.email_failed', { email })

        return fail(
          'E-mail se nepodařilo odeslat. Zkuste to prosím znovu.',
          'form',
          true,
        )
      }

      // Unknown address. Same message as the success path.
      authLog.info('reset_request.no_account', { email })
    }

    return ok(RESET_REQUEST_MESSAGE)
  })

export const resetPasswordAction = async (
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> => {
  const h = await headers()
  const token = String(formData.get('token') ?? '')
  const password = readPassword(formData)

  if (token.length === 0) {
    return fail('Odkaz je neplatný nebo mu vypršela platnost.', 'form')
  }

  const policy = checkPassword(password)

  if (!policy.ok) {
    return fail(policy.message, 'password')
  }

  try {
    await auth.api.resetPassword({
      body: { newPassword: password, token },
      headers: h,
    })
  } catch (error) {
    authLog.warn('reset.failed', {
      reason: error instanceof Error ? error.name : 'unknown',
    })

    return fail(
      'Odkaz je neplatný nebo mu vypršela platnost. Vyžádejte si nový.',
      'form',
    )
  }

  // `revokeSessionsOnPasswordReset` drops every session, and `onPasswordReset`
  // has already sent the notification email.
  return ok(
    'Heslo jsme změnili a odhlásili vás na všech zařízeních. Přihlaste se znovu.',
    '/prihlaseni?heslo-zmeneno=1',
  )
}
