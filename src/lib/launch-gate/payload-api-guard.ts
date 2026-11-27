/**
 * Wraps Payload's REST route handlers with the PRIVATE-mode rule from
 * `payload-api.ts`.
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

import { payloadApiAccess } from './payload-api'
import { refusalResponse } from './responses'

type RestHandler<Args> = (request: Request, args: Args) => Promise<Response>

const isAdministrator = async (
  config: Promise<SanitizedConfig> | SanitizedConfig,
  request: Request,
): Promise<boolean> => {
  try {
    const payload = await getPayload({ config })
    const { user } = await payload.auth({ headers: request.headers })

    return user?.collection === USERS_SLUG
  } catch (error) {
    console.error('[launch-gate] administrator check failed:', error)
    return false
  }
}

export const withLaunchGate =
  <Args>(
    config: Promise<SanitizedConfig> | SanitizedConfig,
    handler: RestHandler<Args>,
  ): RestHandler<Args> =>
  async (request, args) => {
    const access = payloadApiAccess(
      env.LAUNCH_MODE,
      request.method,
      new URL(request.url).pathname,
    )

    if (access === 'open' || (await isAdministrator(config, request))) {
      return handler(request, args)
    }

    return refusalResponse('private', { method: request.method })
  }
