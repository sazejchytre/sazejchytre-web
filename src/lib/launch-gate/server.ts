/**
 * The configured launch mode, for server components.
 *
 * Navigation reads this to leave out links to areas the mode closes, so the
 * public site has no dead ends. That is presentation only: the proxy refuses
 * those areas whether or not a link points at them.
 */
import { env } from '../env.ts'

import { isSurfaceOpen, type GatedSurface, type LaunchMode } from './modes'

export const launchMode = (): LaunchMode => env.LAUNCH_MODE

/** Is this surface served in the configured mode? */
export const isSurfaceServed = (surface: GatedSurface): boolean =>
  isSurfaceOpen(env.LAUNCH_MODE, surface)
