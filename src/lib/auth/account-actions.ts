'use server'

/**
 * Account management actions: password, email and session control.
 *
 * None of these is enumeration-sensitive — the caller is already signed in and
 * acting on their own account — so errors here are specific and useful.
 *
 * WHY A CHANGE REVOKES OTHER SESSIONS
 *
 * Changing a password or an email address is what someone does after
 * suspecting a compromise. If the other sessions survived it, the change would
 * accomplish nothing: whoever stole the cookie still has it, and now they also
 * know the owner is trying to lock them out. So the sessions go, and the
 * notice goes to the PREVIOUS address — the one the attacker does not control.
 */
import { headers } from 'next/headers'

import { isProduction } from '../env.ts'
import { type ActionResult, fail, ok } from './action-result.ts'
import { auth } from './config.ts'
import { emailChangedTemplate } from './email-templates.ts'
import { notifyPasswordChanged, sendSecurityNotice } from './email.ts'
import { getCustomerSession } from './customer.ts'
import { authLog } from './logging.ts'
import { checkPassword } from './password-policy.ts'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/* -------------------------------------------------------------------------- */
/* Password                                                                   */
/* -------------------------------------------------------------------------- */

export const changePasswordAction = async (
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> => {
  const h = await headers()
  const session = await getCustomerSession(h)

  if (!session) {
    return fail('Pro tuto akci je potřeba se přihlásit.', 'form')
  }

  const currentPassword = String(formData.get('currentPassword') ?? '')
  const newPassword = String(formData.get('newPassword') ?? '')

  if (currentPassword.length === 0) {
    return fail('Zadejte současné heslo.', 'password')
  }

  const policy = checkPassword(newPassword)

  if (!policy.ok) {
    return fail(policy.message, 'password')
  }

  if (currentPassword === newPassword) {
    return fail('Nové heslo musí být jiné než současné.', 'password')
  }

  try {
    await auth.api.changePassword({
      body: {
        currentPassword,
        newPassword,
        /** Every other device is signed out. See the note at the top. */
        revokeOtherSessions: true,
      },
      headers: h,
    })
  } catch (error) {
    authLog.warn('password_change.failed', {
      userId: session.authUserId,
      reason: error instanceof Error ? error.name : 'unknown',
    })

    return fail('Současné heslo je nesprávné.', 'password')
  }

  // To the address on record, which for a password change is the current one.
  // Best effort: a failed notice must not undo a completed security action.
  //
  // `notifyPasswordChanged` rather than an inline send, because better-auth
  // has no hook for `changePassword` — so this is the single place the notice
  // can be guaranteed from, and it is testable on its own.
  const notice = await notifyPasswordChanged(session.email)

  authLog.info('password_change.succeeded', {
    userId: session.authUserId,
    noticeDelivered: notice.delivered,
  })

  return ok(
    notice.delivered
      ? 'Heslo jsme změnili a odhlásili vás na ostatních zařízeních.'
      : 'Heslo jsme změnili a odhlásili vás na ostatních zařízeních. Potvrzovací e-mail se nepodařilo odeslat.',
  )
}

/* -------------------------------------------------------------------------- */
/* Email                                                                      */
/* -------------------------------------------------------------------------- */

export const changeEmailAction = async (
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> => {
  const h = await headers()
  const session = await getCustomerSession(h)

  if (!session) {
    return fail('Pro tuto akci je potřeba se přihlásit.', 'form')
  }

  const newEmail = String(formData.get('newEmail') ?? '')
    .trim()
    .toLowerCase()

  if (!EMAIL_PATTERN.test(newEmail)) {
    return fail('Zadejte platnou e-mailovou adresu.', 'email')
  }

  if (newEmail === session.email) {
    return fail('Toto už je vaše současná adresa.', 'email')
  }

  try {
    await auth.api.changeEmail({
      body: { newEmail, callbackURL: '/ucet?email-zmenen=1' },
      headers: h,
    })
  } catch (error) {
    authLog.warn('email_change.failed', {
      userId: session.authUserId,
      reason: error instanceof Error ? error.name : 'unknown',
    })

    return fail('Změnu e-mailu se nepodařilo zahájit.', 'email')
  }

  // The confirmation link went to the CURRENT address, so the real owner has
  // to approve the move. Also tell them plainly what was requested.
  await sendSecurityNotice({
    to: session.email,
    kind: 'email_change_requested',
    email: emailChangedTemplate({
      newEmail,
      changedAt: new Date(),
      isProduction,
    }),
  })

  authLog.info('email_change.requested', { userId: session.authUserId })

  return ok(
    'Na vaši současnou adresu jsme poslali odkaz pro potvrzení změny. ' +
      'Dokud ho nepotvrdíte, adresa se nezmění.',
  )
}

/* -------------------------------------------------------------------------- */
/* Sessions                                                                   */
/* -------------------------------------------------------------------------- */

export type SessionSummary = {
  id: string
  token: string
  current: boolean
  device: string
  country: string | null
  lastSeen: Date
  expiresAt: Date
  remembered: boolean
}

/**
 * Active sessions for the account page.
 *
 * Shows the coarse device label and the country only. The stored address is a
 * keyed hash of a truncated prefix and is deliberately not rendered — it would
 * mean nothing to the customer and everything to anyone who got the page.
 */
export const listSessionsAction = async (): Promise<SessionSummary[]> => {
  const h = await headers()
  const current = await getCustomerSession(h)

  if (!current) {
    return []
  }

  const sessions = await auth.api.listSessions({ headers: h })

  return (sessions ?? []).map((raw) => {
    const row = raw as typeof raw & {
      deviceLabel?: string | null
      ipCountry?: string | null
      rememberMe?: boolean | null
    }

    return {
      id: row.id,
      token: row.token,
      current: row.id === current.sessionId,
      device: row.deviceLabel ?? 'Neznámé zařízení',
      country: row.ipCountry ?? null,
      // `updatedAt` moves on each sliding refresh, so it is the last-seen time.
      lastSeen: new Date(row.updatedAt ?? row.createdAt),
      expiresAt: new Date(row.expiresAt),
      remembered: row.rememberMe === true,
    }
  })
}

export const revokeSessionAction = async (
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> => {
  const h = await headers()
  const session = await getCustomerSession(h)

  if (!session) {
    return fail('Pro tuto akci je potřeba se přihlásit.', 'form')
  }

  const token = String(formData.get('token') ?? '')

  if (token.length === 0) {
    return fail('Chybí identifikace přihlášení.', 'form')
  }

  try {
    await auth.api.revokeSession({ body: { token }, headers: h })
  } catch (error) {
    authLog.warn('session_revoke.failed', {
      userId: session.authUserId,
      reason: error instanceof Error ? error.name : 'unknown',
    })

    return fail('Přihlášení se nepodařilo odhlásit.', 'form')
  }

  authLog.info('session_revoke.succeeded', { userId: session.authUserId })

  return ok('Zařízení bylo odhlášeno.')
}

export const revokeOtherSessionsAction = async (
  _previous?: ActionResult | null,
  _formData?: FormData,
): Promise<ActionResult> => {
  const h = await headers()
  const session = await getCustomerSession(h)

  if (!session) {
    return fail('Pro tuto akci je potřeba se přihlásit.', 'form')
  }

  try {
    await auth.api.revokeOtherSessions({ headers: h })
  } catch (error) {
    authLog.warn('session_revoke_others.failed', {
      userId: session.authUserId,
      reason: error instanceof Error ? error.name : 'unknown',
    })

    return fail('Ostatní přihlášení se nepodařilo odhlásit.', 'form')
  }

  authLog.info('session_revoke_others.succeeded', {
    userId: session.authUserId,
  })

  return ok('Všechna ostatní zařízení byla odhlášena.')
}
