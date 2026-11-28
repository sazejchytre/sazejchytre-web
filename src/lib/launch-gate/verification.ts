/**
 * What a deployment SHOULD answer to each probe, and whether what it did
 * answer matches. Used by `src/scripts/verify-launch-gate.ts`; kept here,
 * dependency-free, so the rules are unit-tested rather than trusted.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHO ANSWERED
 *
 * Every response the application produces carries `x-launch-gate-seen: 1`
 * (`proxy-handler.ts` sets it on everything it passes or refuses). A response
 * without it was produced in front of the application: by a reverse proxy.
 * That is the only way to tell "the proxy refused /admin" from "the
 * application answered /admin with a status that happens to be 403", and the
 * difference is the whole point of a proxy restriction: an endpoint the
 * application answered is an endpoint the client could reach.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * TARGETS AND POLICIES
 *
 *   target `app`    the script talks to the application directly (the
 *                   container port). Every response must be the
 *                   application's, as the gate decides it. A proxy answer
 *                   here is a misconfiguration.
 *   target `proxy`  the script talks to the public host, through the
 *                   reverse proxy, with one of these policies:
 *     `none`        the client is allowed everywhere (an allowlisted
 *                   address): exactly as `app`.
 *     `admin`       the SC-009 policy for administration: `/admin` and the
 *                   Payload REST API must be refused BY THE PROXY. The
 *                   application answering any of them is a failure, whatever
 *                   the status. Cron routes may be refused by the proxy or
 *                   answered by the application (they hold their own bearer
 *                   check, and the scheduler may call the container
 *                   directly). Everything else must reach the application:
 *                   a proxy that also refuses public pages is not this
 *                   policy.
 *     `site`        a non-public host (staging, a closed production): every
 *                   path must be refused by the proxy except the health
 *                   check, which must reach the application.
 *
 * A proxy refusal counts only as 401, 403 or 404 without the gate marker. A
 * proxy that answers 200, 500 or a redirect for a restricted path fails.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT DOES NOT COUNT AS EVIDENCE
 *
 * A path the gate passes and the application answers with a 5xx is not
 * evidence that the path works: it is reported separately (`serverError`),
 * never as "as expected". A path the gate must refuse that answers anything
 * other than the gate's own refusal, a 5xx included, is a mismatch.
 */
import { decide } from './decide.ts'
import { resolveLaunchMode, type LaunchMode } from './modes.ts'
import { payloadApiAccess } from './payload-api.ts'
import { classifyPath } from './routes.ts'

export const VERIFICATION_TARGETS = ['app', 'proxy'] as const
export type VerificationTarget = (typeof VERIFICATION_TARGETS)[number]

export const PROXY_POLICIES = ['none', 'admin', 'site'] as const
export type ProxyPolicy = (typeof PROXY_POLICIES)[number]

export type ProbeCategory =
  | 'health'
  | 'cron'
  | 'administration'
  | 'payload-api'
  | 'public'
  | 'accounts'
  | 'payments'
  | 'framework'
  | 'development'
  | 'unknown'

/**
 * Methods `src/app/(payload)/api/[...slug]/route.ts` exports (HEAD is
 * derived from GET). Any other method is answered 405 by the framework,
 * after the gate passed it.
 */
const PAYLOAD_API_METHODS = new Set([
  'GET',
  'HEAD',
  'POST',
  'PATCH',
  'DELETE',
  'OPTIONS',
])

const STATUS_BY_REASON: Readonly<Record<string, number>> = {
  private: 503,
  'private-robots': 200,
  'not-found': 404,
  method: 405,
}

/** What a reverse proxy may answer when it refuses a request. */
export const PROXY_REFUSAL_STATUSES: readonly number[] = [401, 403, 404]

/** The application's answer, as the gate decides it. */
export type AppExpectation =
  | { kind: 'pass' }
  | { kind: 'refused'; status: number; reason: string }
  /** Refused by the framework after the gate passed it (e.g. 405). */
  | { kind: 'framework'; status: number }

export type Expectation =
  | { by: 'app'; app: AppExpectation }
  | { by: 'proxy' }
  /** Either a proxy refusal or the application's answer as given. */
  | { by: 'either'; app: AppExpectation }

export type Observation = {
  status: number
  /** `x-launch-gate`, the refusal reason, or null. */
  gate: string | null
  /** `x-launch-gate-seen` was present: the application answered. */
  seen: boolean
  /** `cache-control`, for the REST cache rule. */
  cacheControl: string | null
}

export type Verdict =
  { ok: true; serverError: boolean; note: string } | { ok: false; note: string }

/** The path the server classifies: dot segments resolved, as Next does. */
export const normalisedPath = (rawPath: string): string =>
  // Concatenated: `new URL('//x', base)` would read `//x` as a host.
  new URL(`http://verification.invalid${rawPath}`).pathname

export const probeCategory = (pathname: string): ProbeCategory => {
  const rule = classifyPath(pathname)

  if (rule === undefined) return 'unknown'
  if (rule.name === 'health') return 'health'
  if (rule.area === 'operations') return 'cron'
  if (rule.name === 'payload-api') return 'payload-api'
  if (rule.area === 'administration') return 'administration'

  return rule.area
}

/** Administration in the policy sense: the panel and the REST API. */
const isAdministrative = (category: ProbeCategory): boolean =>
  category === 'administration' || category === 'payload-api'

export const appExpectation = (
  mode: LaunchMode,
  method: string,
  pathname: string,
): AppExpectation => {
  const decision = decide({ mode, method, pathname, development: false })

  if (decision.action === 'refuse') {
    return {
      kind: 'refused',
      status: STATUS_BY_REASON[decision.reason] ?? 0,
      reason: decision.reason,
    }
  }

  if (decision.rule?.name === 'payload-api') {
    if (!PAYLOAD_API_METHODS.has(method.toUpperCase())) {
      return { kind: 'framework', status: 405 }
    }

    if (payloadApiAccess(mode, method, pathname) === 'administrator-only') {
      // The probes are anonymous: the REST guard refuses them.
      return { kind: 'refused', status: 503, reason: 'private' }
    }
  }

  return { kind: 'pass' }
}

export const expectationFor = ({
  mode: configured,
  method,
  rawPath,
  target,
  policy,
}: {
  mode: unknown
  method: string
  rawPath: string
  target: VerificationTarget
  policy: ProxyPolicy
}): Expectation => {
  const mode = resolveLaunchMode(configured)
  const pathname = normalisedPath(rawPath)
  const category = probeCategory(pathname)
  const app = appExpectation(mode, method, pathname)

  if (target === 'app' || policy === 'none') {
    return { by: 'app', app }
  }

  if (policy === 'site') {
    if (category === 'health') return { by: 'app', app }
    if (category === 'cron') return { by: 'either', app }
    return { by: 'proxy' }
  }

  // policy === 'admin'
  if (isAdministrative(category)) return { by: 'proxy' }
  if (category === 'cron') return { by: 'either', app }

  return { by: 'app', app }
}

const isProxyRefusal = (observed: Observation): boolean =>
  !observed.seen &&
  observed.gate === null &&
  PROXY_REFUSAL_STATUSES.includes(observed.status)

const judgeApp = (
  app: AppExpectation,
  observed: Observation,
  { restCacheRule }: { restCacheRule: boolean },
): Verdict => {
  if (!observed.seen) {
    return {
      ok: false,
      note: `not answered by the application (${observed.status} without the gate marker)`,
    }
  }

  if (restCacheRule) {
    const cacheControl = (observed.cacheControl ?? '').toLowerCase()

    if (
      !cacheControl.includes('no-store') ||
      !cacheControl.includes('private')
    ) {
      return {
        ok: false,
        note: `REST response without "private, no-store" (cache-control: ${observed.cacheControl ?? 'none'})`,
      }
    }
  }

  switch (app.kind) {
    case 'pass':
      if (observed.gate !== null) {
        return {
          ok: false,
          note: `refused by the gate (${observed.gate}) but should pass`,
        }
      }
      if (observed.status >= 500) {
        return {
          ok: true,
          serverError: true,
          note: `passed by the gate, answered ${observed.status}: not evidence the route works`,
        }
      }
      return {
        ok: true,
        serverError: false,
        note: `passed, ${observed.status}`,
      }

    case 'refused':
      return observed.gate === app.reason && observed.status === app.status
        ? {
            ok: true,
            serverError: false,
            note: `refused ${app.status} ${app.reason}`,
          }
        : {
            ok: false,
            note: `expected the gate's ${app.status} ${app.reason}, got ${observed.status} ${observed.gate ?? 'without a gate refusal'}`,
          }

    case 'framework':
      return observed.gate === null && observed.status === app.status
        ? { ok: true, serverError: false, note: `framework ${app.status}` }
        : {
            ok: false,
            note: `expected the framework's ${app.status}, got ${observed.status} ${observed.gate ?? ''}`.trim(),
          }
  }
}

export const judge = (
  expected: Expectation,
  observed: Observation,
  { restResponse = false }: { restResponse?: boolean } = {},
): Verdict => {
  if (expected.by === 'proxy') {
    if (isProxyRefusal(observed)) {
      return {
        ok: true,
        serverError: false,
        note: `refused by the proxy, ${observed.status}`,
      }
    }

    return {
      ok: false,
      note: observed.seen
        ? `REACHABLE: answered by the application (${observed.status}) where the proxy must refuse`
        : `the proxy answered ${observed.status}, which is not a refusal`,
    }
  }

  if (expected.by === 'either' && isProxyRefusal(observed)) {
    return {
      ok: true,
      serverError: false,
      note: `refused by the proxy, ${observed.status}`,
    }
  }

  return judgeApp(expected.app, observed, {
    // A REST answer the application produced must never be cacheable. The
    // framework's own 405 for a method the REST mount does not export is
    // not a REST answer: it is the same for every caller and carries no
    // data, so the rule does not apply to it.
    restCacheRule:
      restResponse && observed.seen && expected.app.kind !== 'framework',
  })
}

/** Is this normalised path one the REST cache rule applies to? */
export const isRestPath = (pathname: string): boolean =>
  probeCategory(pathname) === 'payload-api'
