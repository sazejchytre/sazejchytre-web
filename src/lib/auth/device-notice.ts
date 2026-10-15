/**
 * "Nové přihlášení k účtu" — the email that lets a customer notice a takeover.
 *
 * WHAT COUNTS AS A NEW DEVICE
 *
 * The pair (truncated-IP hash, device label). Both are already stored on the
 * session for the account page, so recognising a device costs one query and no
 * extra data collection. A session whose pair has never appeared before for
 * this user triggers the notice.
 *
 * This is coarse on purpose. A customer on a mobile network changes /24 often,
 * so they will occasionally get a notice for their own phone — which is the
 * right way to be wrong. The failure that matters is the other one: staying
 * quiet while somebody else signs in. A false alarm is an annoyance; a missed
 * alarm is an account nobody noticed losing.
 *
 * THE FIRST SESSION IS NEVER NOTIFIED. Emailing "new sign-in" to someone who
 * just created their account trains people to ignore the message.
 */
import { sql } from 'kysely'

import { isProduction } from '../env.ts'
import { AUTH_SCHEMA, authDb } from './config.ts'
import { newDeviceSignInTemplate } from './email-templates.ts'
import { sendSecurityNotice } from './email.ts'
import { authLog } from './logging.ts'

type SessionRow = {
  userId?: unknown
  id?: unknown
  ipPrefixHash?: unknown
  deviceLabel?: unknown
  ipCountry?: unknown
}

/**
 * Send the notice if this session's device is one we have not seen.
 *
 * Never throws: the caller is a `session.create.after` hook, and a failure to
 * send a notice must not undo a successful sign-in.
 */
export const notifyIfNewDevice = async (session: SessionRow): Promise<void> => {
  const userId = typeof session.userId === 'string' ? session.userId : null
  const sessionId = typeof session.id === 'string' ? session.id : null

  if (!userId || !sessionId) {
    return
  }

  const prefixHash =
    typeof session.ipPrefixHash === 'string' ? session.ipPrefixHash : null
  const deviceLabel =
    typeof session.deviceLabel === 'string' ? session.deviceLabel : null
  const ipCountry =
    typeof session.ipCountry === 'string' ? session.ipCountry : null

  try {
    // How many OTHER sessions exist for this user, and how many of those match
    // this device? One query answers both "is this their first session" and
    // "have we seen this device".
    const seen = await sql<{ others: number; matching: number }>`
      select
        count(*)::int as others,
        count(*) filter (
          where "ipPrefixHash" is not distinct from ${prefixHash}
            and "deviceLabel" is not distinct from ${deviceLabel}
        )::int as matching
      from ${sql.table(`${AUTH_SCHEMA}.session`)}
      where "userId" = ${userId}
        and "id" <> ${sessionId}
    `.execute(authDb)

    const row = seen.rows[0]

    if (!row || row.others === 0) {
      // First session on the account: registration, not a new device.
      return
    }

    if (row.matching > 0) {
      return
    }

    const user = await sql<{ email: string }>`
      select "email" from ${sql.table(`${AUTH_SCHEMA}.user`)}
      where "id" = ${userId} limit 1
    `.execute(authDb)

    const email = user.rows[0]?.email

    if (!email) {
      return
    }

    await sendSecurityNotice({
      to: email,
      kind: 'new_device_sign_in',
      email: newDeviceSignInTemplate({
        device: deviceLabel ?? 'Neznámé zařízení',
        country: ipCountry,
        signedInAt: new Date(),
        isProduction,
      }),
    })
  } catch (error) {
    authLog.error('device_notice.failed', {
      userId,
      reason: error instanceof Error ? error.name : 'unknown',
    })
  }
}
