/**
 * Probe a running deployment and report what every route answers.
 *
 *   node src/scripts/verify-launch-gate.ts --base-url <origin> --mode <MODE>
 *        [--target app|proxy] [--proxy-policy none|admin|site]
 *        [--host-header <host>] [--build-dir .next]
 *        [--include-unsafe-methods] [--check-links]
 *        [--tolerate-permitted-5xx]
 *
 * The expected answer to each request comes from `src/lib/launch-gate/
 * verification.ts`, which derives it from the gate's own decision for the
 * mode the deployment is SUPPOSED to be in, and from the vantage point:
 *
 *   --target app      (default) talking to the application itself, e.g. the
 *                     container port on the host. Every response must be the
 *                     application's (`x-launch-gate-seen`), as the gate
 *                     decides it.
 *   --target proxy    talking to the public host through the reverse proxy,
 *                     with --proxy-policy:
 *       none          this client is allowed everywhere: same as `app`.
 *       admin         `/admin` and `/api/*` must be refused BY THE PROXY
 *                     (401/403/404 without the gate marker); the application
 *                     answering any of them fails the run. Cron may be either.
 *                     Everything else must reach the application. Run it from
 *                     a client OUTSIDE the admin allowlist.
 *       site          a non-public host: everything but `/healthz` must be
 *                     refused by the proxy.
 *
 * Any difference is printed and makes the exit code 1. Run it after every
 * deploy and after every change to `LAUNCH_MODE` (SC-009).
 *
 * What it probes:
 *   - every sample path of every route under `src/app`, plus the
 *     administrative surface (`/admin`, the Payload sign-in endpoints, two
 *     content reads);
 *   - every GET again as an RSC navigation and as an RSC prefetch, the way
 *     the Next client requests pages;
 *   - with `--include-unsafe-methods`, POST/PUT/PATCH/DELETE, and every POST
 *     again as a Server Action call;
 *   - with `--build-dir`, every route in the build's own route manifest, so a
 *     route the build exposes but the source tree does not is reported;
 *   - other spellings of closed paths, sent RAW (not normalised by a URL
 *     parser) so the reverse proxy and the server see exactly these bytes;
 *   - with `--check-links`, the HTML of every public page the gate serves:
 *     each root-relative `href` in it must be a path the gate also serves.
 *
 * Every REST answer the application gives must carry
 * `Cache-Control: private, no-store`.
 *
 * A route the gate passes that answers 5xx is NOT counted as working: it is
 * listed under "permitted but 5xx" and fails the run, unless
 * `--tolerate-permitted-5xx` is given — for a local build whose pages cannot
 * render for a known, separate reason (operator identity, SC-015). Even then
 * the list is printed. A route the gate must refuse that answers 5xx is a
 * mismatch, always.
 *
 * `--host-header` sends that `Host` on every request (plain HTTP only), to
 * check that the answers do not depend on the host name a request uses.
 *
 * Methods: GET, HEAD and OPTIONS by default. Never point it at production
 * with `--include-unsafe-methods`: every request is anonymous with an empty
 * body, but against an OPEN route it does reach the handler.
 */
import { existsSync, readFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { decide } from '../lib/launch-gate/decide.ts'
import { LAUNCH_MODES, type LaunchMode } from '../lib/launch-gate/modes.ts'
import { discoverAppRoutes } from '../lib/launch-gate/route-inventory.ts'
import { GATE_HEADER, GATE_SEEN_HEADER } from '../lib/launch-gate/responses.ts'
import {
  PROXY_POLICIES,
  VERIFICATION_TARGETS,
  expectationFor,
  isRestPath,
  judge,
  normalisedPath,
  type Observation,
  type ProxyPolicy,
  type VerificationTarget,
} from '../lib/launch-gate/verification.ts'

type Kind = 'plain' | 'rsc' | 'prefetch' | 'action'
type Probe = { method: string; path: string; origin: string; kind: Kind }
type Response = Observation & {
  location: string | null
  contentType: string | null
  body: string | null
}

/** The report goes to stdout; diagnostics and usage go to stderr. */
const print = (line = ''): void => {
  process.stdout.write(`${line}\n`)
}

const MAX_BODY_BYTES = 4 * 1024 * 1024

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'] as const
const UNSAFE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const

const KIND_HEADERS: Readonly<Record<Kind, Record<string, string>>> = {
  plain: {},
  rsc: { rsc: '1' },
  prefetch: { rsc: '1', 'next-router-prefetch': '1' },
  // An id no build contains: the gate must refuse a closed page before Next
  // looks it up, and an open page answers it as an unknown action.
  action: {
    'next-action': '7f00000000000000000000000000000000000000',
    'content-type': 'text/plain;charset=UTF-8',
  },
}

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
  '/historie/../admin',
  '/historie/%2e%2e/api/users/me',
]

/** What the application serves to anyone, in every mode, by design. */
const ADMIN_SURFACE = [
  '/admin',
  '/admin/login',
  '/api/users/init',
  '/api/users/me',
  '/api/access',
  '/api/legal-pages',
  '/api/globals/site-settings',
]

const usage = (message: string): never => {
  console.error(message)
  console.error(
    'usage: node src/scripts/verify-launch-gate.ts --base-url <origin> ' +
      `--mode <${LAUNCH_MODES.join('|')}> [--target ${VERIFICATION_TARGETS.join('|')}] ` +
      `[--proxy-policy ${PROXY_POLICIES.join('|')}] [--host-header <host>] [--build-dir .next] ` +
      '[--include-unsafe-methods] [--check-links] [--tolerate-permitted-5xx]',
  )
  process.exit(2)
}

const { values } = parseArgs({
  options: {
    'base-url': { type: 'string' },
    mode: { type: 'string' },
    target: { type: 'string', default: 'app' },
    'proxy-policy': { type: 'string', default: 'none' },
    'host-header': { type: 'string' },
    'build-dir': { type: 'string' },
    'include-unsafe-methods': { type: 'boolean', default: false },
    'check-links': { type: 'boolean', default: false },
    'tolerate-permitted-5xx': { type: 'boolean', default: false },
  },
})

const baseUrl = values['base-url'] ?? usage('--base-url is required')
const modeArg = values.mode ?? usage('--mode is required')

if (!(LAUNCH_MODES as readonly string[]).includes(modeArg)) {
  usage(`--mode must be one of ${LAUNCH_MODES.join(', ')}`)
}
if (!(VERIFICATION_TARGETS as readonly string[]).includes(values.target)) {
  usage(`--target must be one of ${VERIFICATION_TARGETS.join(', ')}`)
}
if (!(PROXY_POLICIES as readonly string[]).includes(values['proxy-policy'])) {
  usage(`--proxy-policy must be one of ${PROXY_POLICIES.join(', ')}`)
}
if (values.target === 'app' && values['proxy-policy'] !== 'none') {
  usage('--proxy-policy needs --target proxy')
}

const mode = modeArg as LaunchMode
const target = values.target as VerificationTarget
const policy = values['proxy-policy'] as ProxyPolicy
const hostHeader = values['host-header']
const methods: readonly string[] = values['include-unsafe-methods']
  ? [...SAFE_METHODS, ...UNSAFE_METHODS]
  : SAFE_METHODS

const APP_DIR = fileURLToPath(new URL('../app', import.meta.url))

/* -------------------------------------------------------------------------- */
/* What to probe                                                              */
/* -------------------------------------------------------------------------- */

const routes = discoverAppRoutes(APP_DIR)
const probes: Probe[] = []

const addProbes = (
  path: string,
  origin: string,
  probeMethods: readonly string[],
) => {
  for (const method of probeMethods) {
    probes.push({ method, path, origin, kind: 'plain' })

    if (method === 'GET') {
      probes.push({ method, path, origin, kind: 'rsc' })
      probes.push({ method, path, origin, kind: 'prefetch' })
    }
    if (method === 'POST') {
      probes.push({ method, path, origin, kind: 'action' })
    }
  }
}

for (const route of routes) {
  for (const path of route.samples) addProbes(path, route.template, methods)
}
for (const path of RAW_SPELLINGS) addProbes(path, 'raw spelling', methods)
for (const path of ADMIN_SURFACE) addProbes(path, 'admin surface', ['GET'])

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
  print(`Build route manifest: ${built.length} routes`)

  for (const template of built) {
    const listed = known.has(template) || generated.has(template)
    print(`  ${listed ? 'ok     ' : 'UNKNOWN'} ${template}`)

    if (!listed) buildProblems.push(template)
  }

  print('')
}

/* -------------------------------------------------------------------------- */
/* Sending                                                                    */
/* -------------------------------------------------------------------------- */

const send = (
  { method, path, kind }: Pick<Probe, 'method' | 'path' | 'kind'>,
  { withBody = false }: { withBody?: boolean } = {},
): Promise<Response> =>
  new Promise((resolve, reject) => {
    const base = new URL(baseUrl)
    const request = base.protocol === 'https:' ? httpsRequest : httpRequest
    const origin =
      hostHeader === undefined ? base.origin : `${base.protocol}//${hostHeader}`
    const outgoing = request(
      {
        protocol: base.protocol,
        hostname: base.hostname,
        port: base.port,
        method,
        // RAW: deliberately not passed through a URL parser.
        path,
        headers: {
          'user-agent': 'launch-gate-verification',
          accept: '*/*',
          ...(hostHeader === undefined ? {} : { host: hostHeader }),
          ...KIND_HEADERS[kind],
          ...(kind === 'action' ? { origin } : {}),
        },
        timeout: 20_000,
      },
      (response) => {
        const chunks: Buffer[] = []
        let size = 0

        response.on('data', (chunk: Buffer) => {
          if (withBody && size < MAX_BODY_BYTES) {
            chunks.push(chunk)
            size += chunk.length
          }
        })
        response.on('end', () => {
          const gate = response.headers[GATE_HEADER]
          const seen = response.headers[GATE_SEEN_HEADER]
          const cacheControl = response.headers['cache-control']
          resolve({
            status: response.statusCode ?? 0,
            gate: typeof gate === 'string' ? gate : null,
            seen: seen === '1',
            cacheControl:
              typeof cacheControl === 'string' ? cacheControl : null,
            location: response.headers.location ?? null,
            contentType: response.headers['content-type'] ?? null,
            body: withBody ? Buffer.concat(chunks).toString('utf8') : null,
          })
        })
      },
    )

    if (kind === 'action') outgoing.write('[]')
    outgoing.on('timeout', () => outgoing.destroy(new Error('timeout')))
    outgoing.on('error', reject)
    outgoing.end()
  })

/**
 * Redirects the framework issues on its own, which carry no content:
 *
 *   - a 308 to the canonical path for a non-canonical spelling (`/x/`,
 *     `//x`, a resolved dot segment), sent BEFORE the proxy runs, so without
 *     the gate marker;
 *   - a 307 to `?_rsc=…` for an RSC request without the cache-busting
 *     parameter, sent after the gate passed it.
 *
 * What matters is what the target answers, so one same-origin redirect is
 * followed and the target is judged by the same rules — an administrative
 * target is still administrative. A gate refusal is never a redirect.
 */
const REDIRECTS = new Set([301, 302, 307, 308])

const isPreGateRedirect = (observed: Response): boolean =>
  observed.gate === null &&
  REDIRECTS.has(observed.status) &&
  observed.location !== null &&
  new URL(observed.location, baseUrl).origin === new URL(baseUrl).origin

/* -------------------------------------------------------------------------- */
/* Run                                                                        */
/* -------------------------------------------------------------------------- */

print(
  `Launch gate verification against ${baseUrl}` +
    (hostHeader === undefined ? '' : ` (Host: ${hostHeader})`) +
    `, expected mode ${mode}, target ${target}` +
    (target === 'proxy' ? `, proxy policy ${policy}` : ''),
)
print(`Methods: ${methods.join(', ')}; probes: ${probes.length}\n`)

let mismatches = 0
const permitted5xx: string[] = []
const rows: string[] = []

for (const probe of probes) {
  let path = probe.path
  let observed: Response
  let hop = ''

  try {
    observed = await send(probe)

    if (isPreGateRedirect(observed) && observed.location !== null) {
      const location = new URL(observed.location, baseUrl)
      path = `${location.pathname}${location.search}`
      hop = `${observed.status} -> ${path}, then `
      observed = await send({ ...probe, path })
    }
  } catch (error) {
    mismatches += 1
    rows.push(
      `MISMATCH ${probe.method.padEnd(7)} ${probe.kind.padEnd(8)} ${probe.path}  request failed: ${String(error)}`,
    )
    continue
  }

  const expected = expectationFor({
    mode,
    method: probe.method,
    rawPath: path,
    target,
    policy,
  })
  const result = judge(expected, observed, {
    restResponse: isRestPath(normalisedPath(path)),
  })

  if (!result.ok) mismatches += 1

  const serverError = result.ok && result.serverError
  const label = !result.ok ? 'MISMATCH' : serverError ? 'PASS-5XX' : 'ok      '

  if (serverError) {
    permitted5xx.push(
      `${probe.method} ${probe.kind} ${probe.path} -> ${observed.status}`,
    )
  }

  rows.push(
    `${label} ${probe.method.padEnd(7)} ${probe.kind.padEnd(8)} ${probe.path.padEnd(40)} ` +
      `${hop}${result.note} [${probe.origin}]`,
  )
}

print(rows.join('\n'))
print('')

/* -------------------------------------------------------------------------- */
/* Rendered links                                                             */
/* -------------------------------------------------------------------------- */

/** Root-relative `href`s in an HTML document, entity-decoded, deduplicated. */
const internalLinks = (html: string): string[] => {
  const found = new Set<string>()

  for (const match of html.matchAll(/\shref="(\/(?![/\\])[^"]*)"/g)) {
    found.add((match[1] ?? '').replaceAll('&amp;', '&'))
  }

  return [...found].sort()
}

let deadLinks = 0
let pagesChecked = 0

if (values['check-links']) {
  const pages = [
    ...new Set(
      routes
        .filter((route) => route.kind === 'page')
        .flatMap((route) => route.samples),
    ),
  ].filter((path) => {
    const decision = decide({
      mode,
      method: 'GET',
      pathname: path,
      development: false,
    })
    return decision.action === 'pass' && decision.rule?.area === 'public'
  })

  print(`Rendered links on ${pages.length} public pages served in ${mode}:`)

  for (const path of pages) {
    let observed: Response

    try {
      observed = await send(
        { method: 'GET', path, kind: 'plain' },
        { withBody: true },
      )
    } catch (error) {
      deadLinks += 1
      print(`  MISMATCH ${path}  request failed: ${String(error)}`)
      continue
    }

    if (
      observed.status !== 200 ||
      !observed.contentType?.includes('text/html')
    ) {
      print(`  skipped  ${path.padEnd(28)} ${observed.status}, no page to read`)
      continue
    }

    pagesChecked += 1
    const links = internalLinks(observed.body ?? '')
    const refused = links.filter(
      (href) =>
        decide({
          mode,
          method: 'GET',
          pathname: normalisedPath(href),
          development: false,
        }).action === 'refuse',
    )

    deadLinks += refused.length
    print(
      `  ${refused.length === 0 ? 'ok      ' : 'MISMATCH'} ${path.padEnd(28)} ` +
        `${links.length} internal links` +
        (refused.length === 0
          ? ''
          : `, refused by the gate: ${refused.join(', ')}`),
    )
  }

  print('')
}

/* -------------------------------------------------------------------------- */
/* Summary                                                                    */
/* -------------------------------------------------------------------------- */

if (permitted5xx.length > 0) {
  print(
    `Permitted by the gate but answered 5xx (${permitted5xx.length}); NOT evidence these routes work:`,
  )
  for (const line of permitted5xx) print(`  ${line}`)
  print('')
}

// Asked to check links and read no page: nothing was verified.
const linksUnverified =
  values['check-links'] && pagesChecked === 0 && mode !== 'PRIVATE'

print(
  `Summary: ${probes.length} probes, ${probes.length - mismatches - permitted5xx.length} as expected, ` +
    `${mismatches} mismatches, ${permitted5xx.length} permitted-but-5xx` +
    (values['tolerate-permitted-5xx'] ? ' (tolerated)' : '') +
    `, ${buildProblems.length} unclassified build routes` +
    (values['check-links']
      ? `, ${pagesChecked} pages link-checked, ${deadLinks} links to refused paths` +
        (linksUnverified ? ' (NO PAGE COULD BE READ)' : '')
      : ''),
)

process.exit(
  mismatches === 0 &&
    buildProblems.length === 0 &&
    deadLinks === 0 &&
    !linksUnverified &&
    (permitted5xx.length === 0 || values['tolerate-permitted-5xx'])
    ? 0
    : 1,
)
