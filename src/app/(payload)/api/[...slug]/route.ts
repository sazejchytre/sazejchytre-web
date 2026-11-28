/* THIS FILE IS PART OF THE PAYLOAD API MOUNT.
 *
 * Payload owns everything under /api. Do NOT add sibling route handlers here —
 * the health check deliberately lives at /healthz instead, outside this
 * catch-all, so the two can never collide.
 *
 * GraphQL is disabled in payload.config.ts, so no graphql route is mounted.
 *
 * Every handler is wrapped in the launch gate's REST guard: while the site is
 * private, the API answers administrators and their sign-in operations only;
 * in every mode, every response leaves with `Cache-Control: private,
 * no-store` and `Vary: Authorization, Cookie`, because every REST answer
 * depends on the caller's session. See `src/lib/launch-gate/rest-guard.ts`.
 */
import config from '@payload-config'
import {
  REST_DELETE,
  REST_GET,
  REST_OPTIONS,
  REST_PATCH,
  REST_POST,
} from '@payloadcms/next/routes'

import { withLaunchGate } from '@/lib/launch-gate/payload-api-guard'

export const GET = withLaunchGate(config, REST_GET(config))
export const POST = withLaunchGate(config, REST_POST(config))
export const DELETE = withLaunchGate(config, REST_DELETE(config))
export const PATCH = withLaunchGate(config, REST_PATCH(config))
export const OPTIONS = withLaunchGate(config, REST_OPTIONS(config))
