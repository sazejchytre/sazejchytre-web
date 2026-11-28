/**
 * Whether the design preview routes (`/nahled/*`) may render. PURE.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT THIS GUARDS
 *
 * The SC-005 homepage prototype is a proposal for owner decision D-005. It
 * must not be reachable on the public site, so it answers 404 everywhere
 * except a local development server. It is decided from `NODE_ENV` and from
 * nothing else — no new setting (`src/lib/env.ts` belongs to SC-017 and
 * SC-018), and no cookie, header or query parameter. A bypass that a request
 * can switch on is a bypass anyone can switch on.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * TWO READINGS OF NODE_ENV, AND BOTH MUST SAY "development"
 *
 *   - `build`: `process.env.NODE_ENV` as written in source. Next replaces it
 *     with a literal when it compiles the server bundle, so in anything made
 *     by `next build` this is the string "production", whatever the runtime
 *     environment later says. A production build cannot be talked into
 *     serving the preview.
 *   - `runtime`: the value `src/lib/env.ts` validated at boot. A dev build
 *     that is started with NODE_ENV=production refuses as well.
 *
 * Allow-list, fail closed: `test`, `production`, a missing value and any
 * string the schema did not expect all mean NO.
 *
 * Once SC-017's launch gate exists the preview should sit behind it as well;
 * this stays as the floor.
 */

export type NodeEnvReading = string | undefined

export const DESIGN_PREVIEW_MODE = 'development'

export const isDesignPreviewEnabled = ({
  build,
  runtime,
}: {
  build: NodeEnvReading
  runtime: NodeEnvReading
}): boolean => build === DESIGN_PREVIEW_MODE && runtime === DESIGN_PREVIEW_MODE
