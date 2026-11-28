/**
 * The REST guard's logic, free of Payload so it runs in the unit tests.
 * `payload-api-guard.ts` binds it to Payload's own administrator check.
 *
 * For every request to the Payload REST mount:
 *
 *   1. `payloadApiAccess` decides whether the request needs an administrator
 *      (PRIVATE mode, anything but the sign-in operations) or is open.
 *   2. If it needs one and the caller is not one, the PRIVATE refusal.
 *      Otherwise Payload's handler.
 *   3. Whatever came back — Payload's success or error, the refusal, or a
 *      generic 500 if anything above threw — leaves with the session cache
 *      headers (`session-headers.ts`). No REST response is cacheable by a
 *      shared cache, in any mode.
 */
import { payloadApiAccess } from './payload-api.ts'
import { refusalResponse } from './responses.ts'
import { withSessionCacheHeaders } from './session-headers.ts'

export type RestHandler<Args> = (
  request: Request,
  args: Args,
) => Promise<Response>

export type RestGuardOptions = {
  /** The configured launch mode; anything invalid is treated as PRIVATE. */
  mode: unknown
  /** True only for an authenticated administrator. Must not throw to pass. */
  isAdministrator: (request: Request) => Promise<boolean>
  /** Where a thrown error is reported. */
  log?: (message: string, error: unknown) => void
}

/** What a client sees when a handler throws: no detail, nothing cacheable. */
const internalError = (): Response =>
  Response.json(
    { errors: [{ message: 'Internal Server Error' }] },
    { status: 500 },
  )

export const guardRestHandler =
  <Args>(
    handler: RestHandler<Args>,
    { mode, isAdministrator, log = console.error }: RestGuardOptions,
  ): RestHandler<Args> =>
  async (request, args) => {
    let response: Response

    try {
      const access = payloadApiAccess(
        mode,
        request.method,
        new URL(request.url).pathname,
      )

      response =
        access === 'open' || (await isAdministrator(request))
          ? await handler(request, args)
          : refusalResponse('private', { method: request.method })
    } catch (error) {
      log('[launch-gate] REST handler failed:', error)
      response = internalError()
    }

    return withSessionCacheHeaders(response)
  }
