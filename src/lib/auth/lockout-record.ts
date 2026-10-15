/**
 * Durable record of a lockout, for support.
 *
 * Separate from `rate-limit.ts` on purpose: that module is the enforcement
 * path and must stay small and Redis-only. This one reaches for Payload, which
 * pulls in the whole config, and is called at most once per lockout.
 *
 * NEVER THROWS. A lockout note that fails to save must not change the outcome
 * of a sign-in — not to allow it, and not to deny it. The enforcement already
 * happened in Redis before this runs.
 */
import { getPayload } from 'payload'

import config from '../../payload.config.ts'
import { normaliseIpCountry } from './client-identity.ts'
import { authLog } from './logging.ts'

export type LockoutRecord = {
  /** The address that was being tried. May have no account. */
  identifier: string
  failures: number
  lockSeconds: number
  ipCountry?: string | null
  reason: 'SIGN_IN_FAILURES' | 'TOTP_FAILURES'
}

export const recordLockoutForSupport = async ({
  identifier,
  failures,
  lockSeconds,
  ipCountry,
  reason,
}: LockoutRecord): Promise<void> => {
  try {
    const payload = await getPayload({ config })
    const country = normaliseIpCountry(ipCountry)

    await payload.create({
      collection: 'auth-lockouts',
      data: {
        identifier: identifier.trim().toLowerCase(),
        failures,
        lockSeconds,
        lockedUntil: new Date(Date.now() + lockSeconds * 1000).toISOString(),
        reason,
        ...(country ? { ipCountry: country } : {}),
      },
      overrideAccess: true,
      depth: 0,
    })
  } catch (error) {
    authLog.error('lockout_record.failed', {
      identifier,
      reason: error instanceof Error ? error.name : 'unknown',
    })
  }
}
