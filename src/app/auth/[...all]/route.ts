/**
 * better-auth's HTTP surface, mounted at `/auth/*`.
 *
 * NOT at `/api/auth/*`. Payload owns `/api/[...slug]` (see
 * `src/app/(payload)/api/[...slug]/route.ts`), and two catch-all route
 * handlers overlapping on the same prefix is at best fragile and at worst
 * resolves differently between dev and a production build. `/auth` is
 * unambiguous and leaves Payload's API surface alone.
 *
 * The prefix is declared once, as `basePath` in `src/lib/auth/config.ts`; this
 * file only has to live at the matching path.
 */
import { toNextJsHandler } from 'better-auth/next-js'

import { auth } from '@/lib/auth/config'

export const { GET, POST } = toNextJsHandler(auth)
