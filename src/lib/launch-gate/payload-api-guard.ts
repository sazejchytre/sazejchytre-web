/**
 * Wraps Payload's REST route handlers with the launch gate's REST guard
 * (`rest-guard.ts`): the PRIVATE-mode rule from `payload-api.ts`, and the
 * session cache headers from `session-headers.ts` on every response, in
 * every mode.
 *
 * The administrator check is Payload's own: `payload.auth` runs the
 * configured auth strategies against the request headers and returns the
 * user they resolve to, or none. No header, cookie or parameter is
 * interpreted here, and anything that goes wrong while checking — an
 * unreachable database included — is a refusal, not a pass.
 */
import { getPayload, type SanitizedConfig } from 'payload'

import { USERS_SLUG } from '@/lib/access'
import { env } from '../env.ts'

import { guardRestHandler, type RestHandler } from './rest-guard'

const administratorCheck =
  (config: Promise<SanitizedConfig> | SanitizedConfig) =>
  async (request: Request): Promise<boolean> => {
    try {
      const payload = await getPayload({ config })
      const { user } = await payload.auth({ headers: request.headers })

      return user?.collection === USERS_SLUG
    } catch (error) {
      console.error('[launch-gate] administrator check failed:', error)
      return false
    }
  }

export const withLaunchGate = <Args>(
  config: Promise<SanitizedConfig> | SanitizedConfig,
  handler: RestHandler<Args>,
): RestHandler<Args> =>
  guardRestHandler(handler, {
    mode: env.LAUNCH_MODE,
    isAdministrator: administratorCheck(config),
  })
