/**
 * Scheduled retention sweep for `auth_lockouts`.
 *
 * Invoked daily by Vercel Cron — see `vercel.json`. The table records the
 * addresses people tried to sign in as, including addresses with no account,
 * so it must not grow without bound.
 *
 * REJECTS ANYTHING THAT IS NOT VERCEL CRON. A cron route is an ordinary public
 * URL; Vercel only calls it on a schedule, it does not make it private. This
 * one deletes audit history, so an open endpoint would be a stranger's delete
 * button. See `src/lib/cron/authorize.ts`.
 *
 * Always answers 200 on success with a small JSON summary, so the Vercel cron
 * log shows what happened rather than only that it ran.
 */
import { getPayload } from 'payload'

import {
  authorizeCronRequest,
  cronForbiddenResponse,
} from '@/lib/cron/authorize'
import { sweepAuthLockouts } from '@/lib/auth/lockout-retention'
import config from '@/payload.config'

/** Never cached, never prerendered: it mutates. */
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const authorization = authorizeCronRequest(request.headers)

  if (!authorization.authorized) {
    return cronForbiddenResponse()
  }

  try {
    const payload = await getPayload({ config })
    const result = await sweepAuthLockouts({ payload })

    return Response.json({
      ok: true,
      task: 'sweep-lockouts',
      cutoff: result.cutoff.toISOString(),
      deleted: result.deleted,
    })
  } catch (error) {
    // 500 so the run shows as failed in Vercel and gets attention. Unlike a
    // webhook, nothing retries this forever — the next day's run is the retry.
    return Response.json(
      {
        ok: false,
        task: 'sweep-lockouts',
        error: error instanceof Error ? error.name : 'UnknownError',
      },
      { status: 500 },
    )
  }
}
