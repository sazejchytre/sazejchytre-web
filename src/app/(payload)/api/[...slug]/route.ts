/* THIS FILE IS PART OF THE PAYLOAD API MOUNT.
 *
 * Payload owns everything under /api. Do NOT add sibling route handlers here —
 * the health check deliberately lives at /healthz instead, outside this
 * catch-all, so the two can never collide.
 *
 * GraphQL is disabled in payload.config.ts, so no graphql route is mounted.
 */
import config from '@payload-config'
import {
  REST_DELETE,
  REST_GET,
  REST_OPTIONS,
  REST_PATCH,
  REST_POST,
} from '@payloadcms/next/routes'

export const GET = REST_GET(config)
export const POST = REST_POST(config)
export const DELETE = REST_DELETE(config)
export const PATCH = REST_PATCH(config)
export const OPTIONS = REST_OPTIONS(config)
