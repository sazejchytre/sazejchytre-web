import config from '@payload-config'
import { getPayload } from 'payload'
import { NextResponse } from 'next/server'

/**
 * Liveness / readiness probe.
 *
 * Lives at /healthz, not /api/health: Payload mounts a catch-all at
 * /api/[...slug] and owns that namespace entirely.
 *
 * The response is deliberately dull. It reports whether the database answered,
 * nothing about how it is reached — no connection string, no host, no driver
 * error text, no stack. A health endpoint is unauthenticated by definition, so
 * anything it prints is public.
 */

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Inlined at build time. `npm_package_version` is not set in the serverless
// runtime, so reading package.json directly is the only reliable source.
import { version as APP_VERSION } from '../../../package.json'

type HealthResponse = {
  status: 'ok' | 'degraded'
  version: string
  database: 'up' | 'down'
  timestamp: string
}

async function isDatabaseReachable(): Promise<boolean> {
  try {
    const payload = await getPayload({ config })

    // Cheapest possible round-trip that still proves the pool is live and the
    // schema is readable.
    await payload.count({
      collection: 'users',
      overrideAccess: true,
    })

    return true
  } catch (error) {
    // Log the detail server-side; never put it in the response body.
    console.error('[healthz] database check failed:', error)
    return false
  }
}

export async function GET(): Promise<NextResponse<HealthResponse>> {
  const databaseUp = await isDatabaseReachable()

  const body: HealthResponse = {
    status: databaseUp ? 'ok' : 'degraded',
    version: APP_VERSION,
    database: databaseUp ? 'up' : 'down',
    timestamp: new Date().toISOString(),
  }

  return NextResponse.json(body, {
    status: databaseUp ? 200 : 503,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  })
}
