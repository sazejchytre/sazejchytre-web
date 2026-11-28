/**
 * Launch modes: which parts of the application this deployment serves.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THREE MODES, ONE DIRECTION
 *
 *   PRIVATE        nothing public. Only the health check, the bearer-protected
 *                  cron routes and the administration area answer. Every page,
 *                  including the informational ones, is refused.
 *   INFORMATIONAL  the public informational site (Phase A1): home, history,
 *                  analyses as published, methodology, pricing as information,
 *                  legal pages, contact. No customer accounts, no checkout,
 *                  no payment entry points.
 *   FULL           everything the code base contains, i.e. today's behaviour.
 *
 * Each mode is a strict superset of the one before it. That is what makes
 * "fail closed" a single rule: when in doubt, take the narrowest mode.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE DEFAULT IS PRIVATE, AND AN INVALID VALUE IS NOT A DEFAULT
 *
 * `src/lib/env.ts` declares `LAUNCH_MODE` with this list and a default of
 * PRIVATE, so an environment that forgets the variable serves nothing public.
 * A value that is present but not on the list fails the boot there, like
 * every other malformed setting.
 *
 * `resolveLaunchMode` below is the second line: the gate itself never trusts
 * that it was handed a valid mode, and maps anything else to PRIVATE. A typo
 * can therefore cost an outage, never a wider surface.
 *
 * This module is dependency-free so it can be imported by the proxy, by
 * `env.ts` and by tests running under Node's native type stripping.
 */

export const LAUNCH_MODES = ['PRIVATE', 'INFORMATIONAL', 'FULL'] as const
export type LaunchMode = (typeof LAUNCH_MODES)[number]

/** The narrowest mode. Used whenever the configured value is absent. */
export const DEFAULT_LAUNCH_MODE: LaunchMode = 'PRIVATE'

/**
 * The parts of the application a mode can open or close.
 *
 *   public    informational pages and their machine-readable outputs
 *   accounts  customer registration, sign-in, password flows, account area
 *   payments  checkout and payment-provider callbacks
 *
 * Operations (health, cron) and administration are not in this list because
 * no mode closes them; see `routes.ts`.
 */
export const GATED_SURFACES = ['public', 'accounts', 'payments'] as const
export type GatedSurface = (typeof GATED_SURFACES)[number]

const OPEN_SURFACES: Readonly<Record<LaunchMode, readonly GatedSurface[]>> =
  Object.freeze({
    PRIVATE: Object.freeze([]),
    INFORMATIONAL: Object.freeze(['public'] as const),
    FULL: Object.freeze(['public', 'accounts', 'payments'] as const),
  })

export const isLaunchMode = (value: unknown): value is LaunchMode =>
  typeof value === 'string' &&
  (LAUNCH_MODES as readonly string[]).includes(value)

/**
 * The mode to enforce for a configured value.
 *
 * Exact match only: no trimming, no case folding. `full` or ` FULL` is not
 * FULL, it is a configuration error, and a configuration error must not widen
 * anything. `env.ts` refuses such a value at boot; this is the fallback for
 * any code path that reaches the gate without going through it.
 */
export const resolveLaunchMode = (value: unknown): LaunchMode =>
  isLaunchMode(value) ? value : DEFAULT_LAUNCH_MODE

/** Does this mode serve this surface? Unknown modes serve nothing. */
export const isSurfaceOpen = (mode: unknown, surface: GatedSurface): boolean =>
  OPEN_SURFACES[resolveLaunchMode(mode)].includes(surface)
