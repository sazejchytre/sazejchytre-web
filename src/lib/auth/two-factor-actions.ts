'use server'

/**
 * TOTP two-factor authentication.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ENROLMENT: NOTHING IS ACTIVE UNTIL A CODE IS PROVED
 *
 * `enableTwoFactor` returns the secret and the backup codes but leaves the
 * factor UNVERIFIED (`skipVerificationOnEnable: false`). It only becomes
 * required at sign-in once `verifyTOTP` has accepted one code.
 *
 * That ordering is the whole point. If an unconfirmed secret were activated
 * immediately, a customer who scanned the QR into the wrong app, or onto a
 * phone they then lost, would be locked out of their own account by a factor
 * they never successfully used. Proving one code first means the authenticator
 * demonstrably works before it becomes mandatory.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * REPLAY
 *
 * A TOTP code is valid for its whole 30-second period, and the accepted skew
 * window makes the real figure closer to 90 seconds. So the same six digits
 * work more than once unless something remembers them. `claimTotpCode` is that
 * something: a Redis `SET NX EX` keyed on (user, code), claimed before the code
 * is verified. The second presentation of a code finds the key taken and is
 * refused. It fails CLOSED — if Redis is unreachable we cannot prove the code
 * is unused, so we decline rather than accept a possible replay.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * DISABLING NEEDS BOTH FACTORS
 *
 * Turning 2FA off requires the password AND a working second factor. Password
 * alone would mean a stolen password is enough to strip the protection that
 * exists precisely because passwords get stolen.
 */
import { headers } from 'next/headers'

import { isProduction } from '../env.ts'
import { type ActionResult, fail, ok } from './action-result.ts'
import { auth } from './config.ts'
import { getCustomerSession } from './customer.ts'
import {
  backupCodesRegeneratedTemplate,
  twoFactorDisabledTemplate,
  twoFactorEnabledTemplate,
} from './email-templates.ts'
import { sendSecurityNotice } from './email.ts'
import { authLog } from './logging.ts'
import {
  AccountLockedError,
  RateLimitedError,
  claimTotpCode,
  enforceRateLimit,
} from './rate-limit.ts'

const clientIp = (h: Headers): string | null => {
  const forwarded = h.get('x-forwarded-for')

  return forwarded?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? null
}

const readCode = (formData: FormData): string =>
  String(formData.get('code') ?? '')
    .replace(/[\s-]/g, '')
    .trim()

const throttled = (error: unknown): ActionResult | null => {
  if (
    error instanceof AccountLockedError ||
    error instanceof RateLimitedError
  ) {
    return fail(
      error instanceof RateLimitedError && error.failedClosed
        ? error.message
        : 'Příliš mnoho pokusů. Zkuste to prosím později.',
      'code',
      true,
    )
  }

  return null
}

/* -------------------------------------------------------------------------- */
/* Enrolment                                                                  */
/* -------------------------------------------------------------------------- */

export type EnrolmentStart = {
  ok: boolean
  message: string
  /** `otpauth://` URI for the QR code. */
  totpUri?: string
  /** The shared secret in text, for manual entry. */
  secret?: string
  /** Shown EXACTLY ONCE. Never retrievable again in this form. */
  backupCodes?: string[]
}

/**
 * Begin enrolment: generate a secret and backup codes.
 *
 * The factor is not yet active — `confirmTwoFactorAction` activates it.
 */
export const startTwoFactorEnrolmentAction = async (
  _previous: EnrolmentStart | null,
  formData: FormData,
): Promise<EnrolmentStart> => {
  const h = await headers()
  const session = await getCustomerSession(h)

  if (!session) {
    return { ok: false, message: 'Pro tuto akci je potřeba se přihlásit.' }
  }

  const password = String(formData.get('password') ?? '')

  if (password.length === 0) {
    return { ok: false, message: 'Zadejte své heslo.' }
  }

  try {
    const result = await auth.api.enableTwoFactor({
      body: { password },
      headers: h,
    })

    const totpUri = (result as { totpURI?: string }).totpURI
    const backupCodes = (result as { backupCodes?: string[] }).backupCodes ?? []

    // Pull the secret out of the otpauth URI so it can also be typed in by
    // hand — some authenticators cannot scan, and a customer on a desktop has
    // no camera.
    const secret = totpUri
      ? new URL(totpUri.replace('otpauth://', 'https://')).searchParams.get(
          'secret',
        )
      : null

    authLog.info('two_factor.enrolment_started', {
      userId: session.authUserId,
      backupCodeCount: backupCodes.length,
    })

    return {
      ok: true,
      message:
        'Naskenujte QR kód v aplikaci a potvrďte ho jedním kódem. Dokud ho nepotvrdíte, dvoufázové ověření není aktivní.',
      ...(totpUri ? { totpUri } : {}),
      ...(secret ? { secret } : {}),
      backupCodes,
    }
  } catch (error) {
    authLog.warn('two_factor.enrolment_failed', {
      userId: session.authUserId,
      reason: error instanceof Error ? error.name : 'unknown',
    })

    return { ok: false, message: 'Heslo je nesprávné.' }
  }
}

/** Activate 2FA by proving one code from the authenticator. */
export const confirmTwoFactorAction = async (
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> => {
  const h = await headers()
  const session = await getCustomerSession(h)

  if (!session) {
    return fail('Pro tuto akci je potřeba se přihlásit.', 'form')
  }

  const code = readCode(formData)

  if (!/^\d{6}$/.test(code)) {
    return fail('Kód má šest číslic.', 'code')
  }

  try {
    await enforceRateLimit({
      action: 'totpVerify',
      ip: clientIp(h),
      identifier: session.email,
    })
  } catch (error) {
    const limited = throttled(error)
    if (limited) return limited
    throw error
  }

  if (!(await claimTotpCode(session.authUserId, code))) {
    // Either a replay inside the validity window, or Redis is down and we
    // cannot prove it is not. Both are refusals.
    authLog.warn('two_factor.code_replay_or_unverifiable', {
      userId: session.authUserId,
    })

    return fail(
      'Tento kód už byl použit. Vyčkejte na nový kód v aplikaci.',
      'code',
    )
  }

  try {
    await auth.api.verifyTOTP({ body: { code }, headers: h })
  } catch (error) {
    authLog.warn('two_factor.confirm_failed', {
      userId: session.authUserId,
      reason: error instanceof Error ? error.name : 'unknown',
    })

    return fail('Kód je nesprávný. Zkuste aktuální kód z aplikace.', 'code')
  }

  await sendSecurityNotice({
    to: session.email,
    kind: 'two_factor_enabled',
    email: twoFactorEnabledTemplate({ isProduction }),
  })

  authLog.info('two_factor.enabled', { userId: session.authUserId })

  return ok('Dvoufázové ověření je aktivní.')
}

/* -------------------------------------------------------------------------- */
/* Sign-in challenge                                                          */
/* -------------------------------------------------------------------------- */

/** Complete a sign-in that is waiting on a TOTP code. */
export const verifyTwoFactorAction = async (
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> => {
  const h = await headers()
  const code = readCode(formData)
  const trustDevice = formData.get('trustDevice') === 'on'

  if (!/^\d{6}$/.test(code)) {
    return fail('Kód má šest číslic.', 'code')
  }

  // No session yet, so the account cannot be named here. The IP budget is what
  // applies; the account budget is enforced once better-auth resolves the
  // pending challenge.
  try {
    await enforceRateLimit({
      action: 'totpVerify',
      ip: clientIp(h),
      identifier: null,
    })
  } catch (error) {
    const limited = throttled(error)
    if (limited) return limited
    throw error
  }

  try {
    await auth.api.verifyTOTP({ body: { code, trustDevice }, headers: h })
  } catch (error) {
    authLog.warn('two_factor.challenge_failed', {
      reason: error instanceof Error ? error.name : 'unknown',
    })

    return fail('Kód je nesprávný nebo mu vypršela platnost.', 'code')
  }

  return ok('Přihlášení proběhlo.', '/ucet')
}

/** Complete a sign-in using one single-use backup code. */
export const verifyBackupCodeAction = async (
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> => {
  const h = await headers()
  const code = readCode(formData)

  if (code.length === 0) {
    return fail('Zadejte záložní kód.', 'code')
  }

  try {
    await enforceRateLimit({
      action: 'backupCodeVerify',
      ip: clientIp(h),
      identifier: null,
    })
  } catch (error) {
    const limited = throttled(error)
    if (limited) return limited
    throw error
  }

  try {
    // better-auth marks the code consumed on success, so a second use fails.
    await auth.api.verifyBackupCode({ body: { code }, headers: h })
  } catch (error) {
    authLog.warn('two_factor.backup_code_failed', {
      reason: error instanceof Error ? error.name : 'unknown',
    })

    return fail('Záložní kód je neplatný nebo už byl použit.', 'code')
  }

  authLog.info('two_factor.backup_code_used', {})

  return ok(
    'Přihlášení proběhlo. Použitý záložní kód už nelze použít znovu.',
    '/ucet/zabezpeceni',
  )
}

/* -------------------------------------------------------------------------- */
/* Backup codes                                                               */
/* -------------------------------------------------------------------------- */

export type BackupCodeResult = {
  ok: boolean
  message: string
  /** Shown exactly once. */
  backupCodes?: string[]
}

/** Issue a fresh set, invalidating every previous code. */
export const regenerateBackupCodesAction = async (
  _previous: BackupCodeResult | null,
  formData: FormData,
): Promise<BackupCodeResult> => {
  const h = await headers()
  const session = await getCustomerSession(h)

  if (!session) {
    return { ok: false, message: 'Pro tuto akci je potřeba se přihlásit.' }
  }

  const password = String(formData.get('password') ?? '')

  if (password.length === 0) {
    return { ok: false, message: 'Zadejte své heslo.' }
  }

  try {
    const result = await auth.api.generateBackupCodes({
      body: { password },
      headers: h,
    })

    const backupCodes = (result as { backupCodes?: string[] }).backupCodes ?? []

    await sendSecurityNotice({
      to: session.email,
      kind: 'backup_codes_regenerated',
      email: backupCodesRegeneratedTemplate({ isProduction }),
    })

    authLog.info('two_factor.backup_codes_regenerated', {
      userId: session.authUserId,
      count: backupCodes.length,
    })

    return {
      ok: true,
      message:
        'Nové záložní kódy jsou níže. Předchozí sada už neplatí. Uložte si je — znovu je nezobrazíme.',
      backupCodes,
    }
  } catch (error) {
    authLog.warn('two_factor.backup_codes_failed', {
      userId: session.authUserId,
      reason: error instanceof Error ? error.name : 'unknown',
    })

    return { ok: false, message: 'Heslo je nesprávné.' }
  }
}

/* -------------------------------------------------------------------------- */
/* Disable                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Turn 2FA off. Requires the password AND a valid TOTP or backup code.
 *
 * better-auth's `disableTwoFactor` asks only for the password, so the second
 * factor is checked here first. Without that, a stolen password would be
 * enough to remove the protection that exists because passwords get stolen.
 */
export const disableTwoFactorAction = async (
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> => {
  const h = await headers()
  const session = await getCustomerSession(h)

  if (!session) {
    return fail('Pro tuto akci je potřeba se přihlásit.', 'form')
  }

  const password = String(formData.get('password') ?? '')
  const code = readCode(formData)

  if (password.length === 0) {
    return fail('Zadejte své heslo.', 'password')
  }

  if (code.length === 0) {
    return fail('Zadejte kód z aplikace nebo jeden záložní kód.', 'code')
  }

  try {
    await enforceRateLimit({
      action: 'totpVerify',
      ip: clientIp(h),
      identifier: session.email,
    })
  } catch (error) {
    const limited = throttled(error)
    if (limited) return limited
    throw error
  }

  // 1. The password.
  try {
    await auth.api.verifyPassword({ body: { password }, headers: h })
  } catch {
    return fail('Heslo je nesprávné.', 'password')
  }

  // 2. The second factor — a six-digit TOTP, or a backup code.
  const looksLikeTotp = /^\d{6}$/.test(code)
  let secondFactorOk = false

  if (looksLikeTotp) {
    if (!(await claimTotpCode(session.authUserId, code))) {
      return fail(
        'Tento kód už byl použit. Vyčkejte na nový kód v aplikaci.',
        'code',
      )
    }

    try {
      await auth.api.verifyTOTP({ body: { code }, headers: h })
      secondFactorOk = true
    } catch {
      secondFactorOk = false
    }
  } else {
    try {
      await auth.api.verifyBackupCode({ body: { code }, headers: h })
      secondFactorOk = true
    } catch {
      secondFactorOk = false
    }
  }

  if (!secondFactorOk) {
    authLog.warn('two_factor.disable_second_factor_failed', {
      userId: session.authUserId,
    })

    return fail('Kód je nesprávný.', 'code')
  }

  // 3. Only now.
  try {
    await auth.api.disableTwoFactor({ body: { password }, headers: h })
  } catch (error) {
    authLog.warn('two_factor.disable_failed', {
      userId: session.authUserId,
      reason: error instanceof Error ? error.name : 'unknown',
    })

    return fail('Dvoufázové ověření se nepodařilo vypnout.', 'form')
  }

  await sendSecurityNotice({
    to: session.email,
    kind: 'two_factor_disabled',
    email: twoFactorDisabledTemplate({ isProduction }),
  })

  authLog.info('two_factor.disabled', { userId: session.authUserId })

  return ok('Dvoufázové ověření je vypnuté.')
}
