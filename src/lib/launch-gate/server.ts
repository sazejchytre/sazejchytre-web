/**
 * The launch gate for server components.
 *
 * Navigation and calls to action ask this before rendering a link, so the
 * public site has no dead ends. That is presentation only: the proxy refuses
 * closed areas whether or not a link points at them.
 */
import { env } from '../env.ts'

import { isLinkServedInMode } from './links'

/**
 * Would the gate serve this root-relative link in the configured mode?
 * It asks the gate about the actual destination (`links.ts`), so it cannot
 * drift from the route table.
 */
export const isLinkServed = (href: string): boolean =>
  isLinkServedInMode(env.LAUNCH_MODE, href)
