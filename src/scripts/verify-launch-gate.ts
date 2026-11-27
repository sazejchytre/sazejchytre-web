/**
 * Probe a running deployment and report what every route answers.
 *
 *   node src/scripts/verify-launch-gate.ts --base-url <origin> --mode <MODE>
 *        [--build-dir .next] [--include-unsafe-methods]
 *
 * The expected outcome of each request comes from the launch gate's own
 * decision (`src/lib/launch-gate/decide.ts`) for the mode the deployment is
 * SUPPOSED to be in; the script compares that with what the server actually
 * answers. Any difference is printed and makes the exit code 1. Run it after
 * every deploy and after every change to `LAUNCH_MODE` (SC-009).
 *
 * What it probes:
 *   - every sample path of every route under `src/app`;
 *   - with `--build-dir`, every route in the build's own route manifest, so a
 *     route the build exposes but the source tree does not is reported;
 *   - other spellings of closed paths, sent RAW (not normalised by a URL
 *     parser) so the reverse proxy and the server see exactly these bytes;
 *   - the Payload REST API's PRIVATE-mode rule (one content read, one
 *     administrator sign-in read).
 *
 * Methods: GET, HEAD and OPTIONS everywhere. POST, PUT, PATCH and DELETE only
 * with `--include-unsafe-methods`, and only against a local or staging
 * deployment: every request is anonymous with an empty body, but against an
 * OPEN route it does reach the handler (a webhook, an auth endpoint).
 *
 * "Pass" means "not refused by the gate": the response carries no
 * `x-launch-gate` header. A passing route can still answer 404 or 500 on its
 * own, and the table shows that status so it can be read for what it is.
 *
 * Read-only by design for GET/HEAD/OPTIONS. Never point it at production
 * with `--include-unsafe-methods`.
 */
import { existsSync, readFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { decide, type GateDecision } from '../lib/launch-gate/decide.ts'
import { LAUNCH_MODES, type LaunchMode } from '../lib/launch-gate/modes.ts'
import { payloadApiAccess } from '../lib/launch-gate/payload-api.ts'
import { discoverAppRoutes } from '../lib/launch-gate/route-inventory.ts'
import { GATE_HEADER } from '../lib/launch-gate/responses.ts'

type Probe = { method: string; path: string; origin: string }
type Observation = {
  status: number
  gate: string | null
  location: string | null
}
type Expectation =
  | { pass: true }
  /** `gate: null` = refused by the framework itself, before any handler. */
  | { pass: false; status: number; gate: string | null }

/**
 * Methods `src/app/(payload)/api/[...slug]/route.ts` exports (HEAD is
 * derived from GET). Any other method is answered 405 by Next before the
 * PRIVATE-mode wrapper or Payload ever runs.
 */
const PAYLOAD_API_METHODS = new Set([
  'GET',
  'HEAD',
  'POST',
  'PATCH',
  'DELETE',
  'OPTIONS',
])

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'] as const
const UNSAFE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const

/** Raw spellings of closed paths; sent byte for byte. */
const RAW_SPELLINGS = [
  '/prihl%61seni',
  '/PRIHLASENI',
  '/prihlaseni/',
  '//prihlaseni',
  '/prihlaseni;x=1',
  '/historie/../prihlaseni',
  '/historie/%2e%2e/prihlaseni',
  '/auth/sample/%2e%2e',
  '/auth/sample/../sample',
  '/auth/sign-in/email/%2e%2e/%2e%2e',
  '/ucet/doklady/1/%2e%2e',
  '/ucet%2Fdoklady',
  '/tipy/..%2Fprihlaseni',
  '/predplatne.json',
  '/_launch-gate/not-found',
  '/does-not-exist',
]

const usage = (message: string): never => {
  console.error(message)
  console.error(
    'usage: node src/scripts/verify-launch-gate.ts --base-url <origin> ' +
      `--mode <${LAUNCH_MODES.join('|')}> [--build-dir .next] [--include-unsafe-methods]`,
  )
  process.exit(2)
}

const { values } = parseArgs({
  options: {
    'base-url': { type: 'string' },
    mode: { type: 'string' },
    'build-dir': { type: 'string' },
    'include-unsafe-methods': { type: 'boolean', default: false },
  },
})

const baseUrl = values['base-url'] ?? usage('--base-url is required')
const modeArg = values.mode ?? usage('--mode is required')

if (!(LAUNCH_MODES as readonly string[]).includes(modeArg)) {
  usage(`--mode must be one of ${LAUNCH_MODES.join(', ')}`)
}

const mode = modeArg as LaunchMode
const methods: readonly string[] = values['include-unsafe-methods']
  ? [...SAFE_METHODS, ...UNSAFE_METHODS]
  : SAFE_METHODS

const APP_DIR = fileURLToPath(new URL('../app', import.meta.url))

/* -------------------------------------------------------------------------- */
/* What to probe                                                              */
/* -------------------------------------------------------------------------- */

const routes = discoverAppRoutes(APP_DIR)
const probes: Probe[] = []

for (const route of routes) {
  for (const path of route.samples) {
    for (const method of methods) {
      probes.push({ method, path, origin: route.template })
    }
  }
}

for (const path of RAW_SPELLINGS) {
  for (const method of methods) {
    probes.push({ method, path, origin: 'raw spelling' })
  }
}

probes.push(
  { method: 'GET', path: '/api/legal-pages', origin: 'payload content read' },
  { method: 'GET', path: '/api/users/me', origin: 'payload sign-in read' },
)

/* -------------------------------------------------------------------------- */
/* What the build exposes                                                     */
/* -------------------------------------------------------------------------- */

const buildProblems: string[] = []

if (values['build-dir'] !== undefined) {
  const manifestPath = join(
    values['build-dir'],
    'app-path-routes-manifest.json',
  )

  if (!existsSync(manifestPath)) {
    usage(`no route manifest at ${manifestPath}`)
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<
    string,
    string
  >
  const known = new Set(routes.map((route) => route.template))
  // Framework-generated entries that are not routes of ours.
  const generated = new Set(['/_not-found', '/_global-error', '/favicon.ico'])

  const built = [...new Set(Object.values(manifest))].sort()
  console.log(`Build route manifest: ${built.length} routes`)

  for (const template of built) {
    const listed = known.has(template) || generated.has(template)
    console.log(`  ${listed ? 'ok     ' : 'UNKNOWN'} ${template}`)

    if (!listed) buildProblems.push(template)
  }

  console.log('')
}

/* -------------------------------------------------------------------------- */
/* Expectation and observation                                                */
/* -------------------------------------------------------------------------- */

const expectationFor = ({ method, path }: Probe): Expectation => {
  // The server resolves dot segments the way the WHATWG parser does before
  // the gate runs; classify the same normalised path.
  // Concatenated: `new URL('//x', base)` would read `//x` as a host.
  const pathname = new URL(`http://verification.invalid${path}`).pathname
  const decision: GateDecision = decide({
    mode,
    method,
    pathname,
    development: false,
  })

  if (decision.action === 'refuse') {
    const status: Record<string, number> = {
      private: 503,
      'private-robots': 200,
      'not-found': 404,
      method: 405,
    }
    return {
      pass: false,
      status: status[decision.reason] ?? 0,
      gate: decision.reason,
    }
  }

  if (
    decision.rule?.name === 'payload-api' &&
    payloadApiAccess(mode, method, pathname) === 'administrator-only'
  ) {
    return PAYLOAD_API_METHODS.has(method)
      ? { pass: false, status: 503, gate: 'private' }
      : { pass: false, status: 405, gate: null }
  }

  return { pass: true }
}

const send = ({ method, path }: Probe): Promise<Observation> =>
  new Promise((resolve, reject) => {
    const base = new URL(baseUrl)
    const request = base.protocol === 'https:' ? httpsRequest : httpRequest
    const outgoing = request(
      {
        protocol: base.protocol,
        hostname: base.hostname,
        port: base.port,
        method,
        // RAW: deliberately not passed through a URL parser.
        path,
        headers: { 'user-agent': 'launch-gate-verification', accept: '*/*' },
        timeout: 15_000,
      },
      (response) => {
        response.resume()
        response.on('end', () => {
          const gate = response.headers[GATE_HEADER]
          resolve({
            status: response.statusCode ?? 0,
            gate: typeof gate === 'string' ? gate : null,
            location: response.headers.location ?? null,
          })
        })
      },
    )

    outgoing.on('timeout', () => outgoing.destroy(new Error('timeout')))
    outgoing.on('error', reject)
    outgoing.end()
  })

const matches = (expected: Expectation, observed: Observation): boolean =>
  expected.pass
    ? observed.gate === null
    : observed.gate === expected.gate && observed.status === expected.status

/* -------------------------------------------------------------------------- */
/* Run                                                                        */
/* -------------------------------------------------------------------------- */

console.log(
  `Launch gate verification against ${baseUrl}, expected mode ${mode}`,
)
console.log(`Methods: ${methods.join(', ')}; probes: ${probes.length}\n`)

let mismatches = 0
const rows: string[] = []

/**
 * Next answers a non-canonical spelling (`/x/`, `//x`, a resolved dot
 * segment that leaves a trailing slash) with a 308 to the canonical path
 * BEFORE the proxy runs. Such a redirect carries no content; what matters is
 * what the target answers, so it is followed once and judged instead.
 */
const REDIRECTS = new Set([301, 302, 307, 308])

const isSameOriginRedirect = (observed: Observation): boolean =>
  observed.gate === null &&
  REDIRECTS.has(observed.status) &&
  observed.location !== null &&
  new URL(observed.location, baseUrl).origin === new URL(baseUrl).origin

for (const probe of probes) {
  let target = probe
  let expected = expectationFor(probe)
  let observed: Observation
  let hop = ''

  try {
    observed = await send(probe)

    if (isSameOriginRedirect(observed) && observed.location !== null) {
      const location = new URL(observed.location, baseUrl)
      target = { ...probe, path: `${location.pathname}${location.search}` }
      hop = `${observed.status} -> ${target.path}, then `
      expected = expectationFor(target)
      observed = await send(target)
    }
  } catch (error) {
    mismatches += 1
    rows.push(
      `MISMATCH ${probe.method.padEnd(7)} ${probe.path}  request failed: ${String(error)}`,
    )
    continue
  }

  const ok = matches(expected, observed)
  if (!ok) mismatches += 1

  const want = expected.pass
    ? 'pass'
    : `${expected.status} ${expected.gate ?? 'framework'}`
  const got =
    hop +
    (observed.gate === null
      ? `ungated ${observed.status}`
      : `${observed.status} ${observed.gate}`)

  rows.push(
    `${ok ? 'ok      ' : 'MISMATCH'} ${probe.method.padEnd(7)} ${probe.path.padEnd(44)} ` +
      `expected ${want.padEnd(20)} got ${got.padEnd(22)} [${probe.origin}]`,
  )
}

console.log(rows.join('\n'))
console.log('')
console.log(
  `Summary: ${probes.length} probes, ${probes.length - mismatches} as expected, ` +
    `${mismatches} mismatches, ${buildProblems.length} unclassified build routes`,
)

process.exit(mismatches === 0 && buildProblems.length === 0 ? 0 : 1)
