import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

import { NextRequest } from 'next/server.js'

import { LAUNCH_MODES, type LaunchMode } from './modes.ts'
import { NOT_FOUND_PATH, runLaunchGate } from './proxy-handler.ts'
import { PRIVATE_MAINTENANCE_HTML, PRIVATE_ROBOTS_TXT } from './responses.ts'
import { discoverAppRoutes } from './route-inventory.ts'
import { HTTP_METHODS, type HttpMethod } from './routes.ts'
import { EXPECTED_ROUTES, type ExpectedRoute } from './test-fixtures.ts'

/**
 * Route-level behaviour of the gate: every route file under `src/app`, every
 * URL shape it accepts, every method, every mode, through the real proxy
 * handler with real `NextRequest` objects.
 *
 * The expected outcome is derived from `EXPECTED_ROUTES` and the mode policy
 * written out below, NOT from the gate's own decision function, so this
 * suite checks the gate against a statement of intent rather than against
 * itself.
 */

const ORIGIN = 'https://sazejchytre.cz'
const APP_DIR = fileURLToPath(new URL('../../app', import.meta.url))
const ROUTES = discoverAppRoutes(APP_DIR)

type Outcome =
  | { kind: 'pass' }
  | { kind: 'not-found-rewrite' }
  | { kind: 'status'; status: number; reason: string }

/* -------------------------------------------------------------------------- */
/* The policy, written out independently of the implementation               */
/* -------------------------------------------------------------------------- */

const OPEN_AREAS: Record<LaunchMode, ReadonlySet<string>> = {
  PRIVATE: new Set(['operations', 'administration', 'framework']),
  INFORMATIONAL: new Set([
    'operations',
    'administration',
    'framework',
    'public',
  ]),
  FULL: new Set([
    'operations',
    'administration',
    'framework',
    'public',
    'accounts',
    'payments',
  ]),
}

const expectedOutcome = (
  mode: LaunchMode,
  route: ExpectedRoute,
  method: HttpMethod,
  path: string,
): Outcome => {
  if (mode === 'FULL') return { kind: 'pass' }

  if (!OPEN_AREAS[mode].has(route.area)) {
    if (mode === 'PRIVATE') {
      return path === '/robots.txt'
        ? { kind: 'status', status: 200, reason: 'private-robots' }
        : { kind: 'status', status: 503, reason: 'private' }
    }

    return method === 'GET' || method === 'HEAD'
      ? { kind: 'not-found-rewrite' }
      : { kind: 'status', status: 404, reason: 'not-found' }
  }

  if (route.methods !== 'ANY' && !route.methods.includes(method)) {
    return { kind: 'status', status: 405, reason: 'method' }
  }

  return { kind: 'pass' }
}

/* -------------------------------------------------------------------------- */
/* Observing the handler                                                      */
/* -------------------------------------------------------------------------- */

const request = (
  path: string,
  method: string,
  init: { headers?: Record<string, string> } = {},
): NextRequest =>
  // Concatenated, not `new URL(path, ORIGIN)`: that would read `//x` as a
  // protocol-relative URL with host `x`, which is not what a server receives.
  new NextRequest(`${ORIGIN}${path}`, {
    method,
    ...(init.headers ? { headers: init.headers } : {}),
  })

const observe = (response: Response): Outcome => {
  if (response.headers.get('x-middleware-next') === '1') {
    assert.equal(response.headers.get('x-launch-gate'), null)
    return { kind: 'pass' }
  }

  const rewrite = response.headers.get('x-middleware-rewrite')

  if (rewrite !== null) {
    assert.equal(rewrite, new URL(NOT_FOUND_PATH, ORIGIN).toString())
    assert.equal(response.headers.get('x-launch-gate'), 'not-found')
    assert.equal(response.headers.get('cache-control'), 'no-store')
    return { kind: 'not-found-rewrite' }
  }

  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow')

  return {
    kind: 'status',
    status: response.status,
    reason: response.headers.get('x-launch-gate') ?? '(none)',
  }
}

const gate = (
  path: string,
  method: string,
  mode: unknown,
  init: { headers?: Record<string, string>; development?: boolean } = {},
): Response =>
  runLaunchGate(request(path, method, init), mode, {
    development: init.development ?? false,
  })

/* -------------------------------------------------------------------------- */
/* Every route × every method × every mode                                     */
/* -------------------------------------------------------------------------- */

describe('every route, every method, every mode', () => {
  for (const mode of LAUNCH_MODES) {
    describe(mode, () => {
      for (const route of ROUTES) {
        const expected = EXPECTED_ROUTES[route.template]

        it(`${route.template} (${expected?.area ?? 'unclassified'})`, () => {
          assert.ok(expected, `${route.template} is not in EXPECTED_ROUTES`)

          for (const sample of route.samples) {
            for (const method of HTTP_METHODS) {
              assert.deepEqual(
                observe(gate(sample, method, mode)),
                expectedOutcome(mode, expected, method, sample),
                `${mode} ${method} ${sample}`,
              )
            }
          }
        })
      }
    })
  }
})

/* -------------------------------------------------------------------------- */
/* One test per disabled area, both states                                    */
/* -------------------------------------------------------------------------- */

describe('disabled areas, both flag states', () => {
  const areas: Record<string, readonly string[]> = {
    registration: ['/registrace'],
    'sign-in and second factor': ['/prihlaseni', '/prihlaseni/dvoufazove'],
    'password flows': ['/zapomenute-heslo', '/obnova-hesla'],
    'email verification': ['/overeni-emailu'],
    'account area': [
      '/ucet',
      '/ucet/doklady',
      '/ucet/doklady/123',
      '/ucet/zabezpeceni',
    ],
    'authentication library endpoints': [
      '/auth/sign-up/email',
      '/auth/sign-in/email',
      '/auth/get-session',
      '/auth/two-factor/verify-totp',
    ],
    checkout: ['/predplatne', '/predplatne?plan=PRO&obdobi=mesicne'],
    'payment webhooks': ['/webhooks/stripe'],
  }

  for (const [area, paths] of Object.entries(areas)) {
    it(`${area}: closed in INFORMATIONAL, served in FULL`, () => {
      for (const path of paths) {
        for (const method of HTTP_METHODS) {
          const closed = observe(gate(path, method, 'INFORMATIONAL'))
          assert.notEqual(
            closed.kind,
            'pass',
            `INFORMATIONAL ${method} ${path}`,
          )

          if (closed.kind === 'status') {
            assert.equal(closed.status, 404, `INFORMATIONAL ${method} ${path}`)
          }

          assert.deepEqual(
            observe(gate(path, method, 'FULL')),
            { kind: 'pass' },
            `FULL ${method} ${path}`,
          )
          assert.deepEqual(
            observe(gate(path, method, 'PRIVATE')),
            { kind: 'status', status: 503, reason: 'private' },
            `PRIVATE ${method} ${path}`,
          )
        }
      }
    })
  }

  it('closes a Server Function call aimed at a closed page', () => {
    // The action id is irrelevant: the gate refuses the page before Next
    // ever looks one up.
    const call = gate('/registrace', 'POST', 'INFORMATIONAL', {
      headers: {
        'next-action': '7f0000000000000000000000000000000000000000',
        'content-type': 'text/plain;charset=UTF-8',
      },
    })

    assert.equal(call.status, 404)
    assert.equal(call.headers.get('x-launch-gate'), 'not-found')
  })

  it('lets the public forms post to their own pages', () => {
    for (const path of ['/', '/kontakt']) {
      const call = gate(path, 'POST', 'INFORMATIONAL', {
        headers: { 'next-action': '7f00000000000000000000000000000000000000' },
      })
      assert.deepEqual(observe(call), { kind: 'pass' }, path)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* Private mode                                                               */
/* -------------------------------------------------------------------------- */

describe('PRIVATE mode', () => {
  it('refuses every public page with the same answer', async () => {
    const bodies = new Set<string>()

    for (const route of ROUTES) {
      if (EXPECTED_ROUTES[route.template]?.area !== 'public') continue
      if (route.template === '/robots.txt') continue

      for (const sample of route.samples) {
        const response = gate(sample, 'GET', 'PRIVATE')
        assert.equal(response.status, 503, sample)
        bodies.add(await response.text())
      }
    }

    assert.equal(bodies.size, 1, 'every refusal must look the same')
    assert.deepEqual([...bodies], [PRIVATE_MAINTENANCE_HTML])
  })

  it('answers with the Czech maintenance page, as HTML', () => {
    for (const path of ['/', '/cenik', '/registrace', '/does-not-exist']) {
      const response = gate(path, 'GET', 'PRIVATE')
      assert.equal(response.status, 503, path)
      assert.equal(
        response.headers.get('content-type'),
        'text/html; charset=utf-8',
        path,
      )
      assert.equal(response.headers.get('content-language'), 'cs', path)
    }
  })

  it('answers robots.txt with disallow-everything', async () => {
    const response = gate('/robots.txt', 'GET', 'PRIVATE')

    assert.equal(response.status, 200)
    assert.equal(await response.text(), PRIVATE_ROBOTS_TXT)
  })

  it('refuses an unknown path exactly like a known one', async () => {
    const known = gate('/historie', 'GET', 'PRIVATE')
    const unknown = gate('/does-not-exist', 'GET', 'PRIVATE')

    assert.equal(unknown.status, known.status)
    assert.equal(await unknown.text(), await known.text())
  })

  it('keeps the health check, cron and administration reachable', () => {
    for (const path of [
      '/healthz',
      '/api/cron/sweep-lockouts',
      '/api/cron/retry-document-delivery',
      '/admin',
      '/admin/login',
      '/api/users/login',
    ]) {
      const method = path === '/api/users/login' ? 'POST' : 'GET'
      assert.deepEqual(
        observe(gate(path, method, 'PRIVATE')),
        { kind: 'pass' },
        path,
      )
    }
  })

  it('omits the body of a HEAD refusal', async () => {
    const response = gate('/', 'HEAD', 'PRIVATE')

    assert.equal(response.status, 503)
    assert.equal(await response.text(), '')
  })
})

/* -------------------------------------------------------------------------- */
/* Fail closed                                                                */
/* -------------------------------------------------------------------------- */

describe('an invalid or missing mode', () => {
  const invalid: unknown[] = [undefined, null, '', 'full', 'FULL ', 'PUBLIC', 1]

  it('behaves exactly like PRIVATE on every route', () => {
    for (const mode of invalid) {
      for (const route of ROUTES) {
        for (const sample of route.samples) {
          for (const method of ['GET', 'POST'] as const) {
            assert.deepEqual(
              observe(gate(sample, method, mode)),
              observe(gate(sample, method, 'PRIVATE')),
              `${String(mode)} ${method} ${sample}`,
            )
          }
        }
      }
    }
  })
})

/* -------------------------------------------------------------------------- */
/* Nothing in the request can widen the gate                                  */
/* -------------------------------------------------------------------------- */

describe('no bypass', () => {
  const closed = '/prihlaseni'

  it('ignores headers that look like a mode, a session or an internal hop', () => {
    const headers: Record<string, string>[] = [
      { 'x-launch-mode': 'FULL' },
      { 'x-launch-gate': 'pass' },
      {
        cookie:
          'launch_mode=FULL; better-auth.session_token=abc; payload-token=abc',
      },
      { authorization: 'Bearer ci-build-only-value-not-a-real-secret-000000' },
      { 'x-middleware-subrequest': 'proxy:proxy:proxy:proxy:proxy' },
      { 'x-action-forwarded': '1' },
      { 'x-forwarded-host': 'localhost', 'x-forwarded-proto': 'http' },
      { 'x-real-ip': '127.0.0.1', 'x-forwarded-for': '127.0.0.1' },
      { 'next-router-prefetch': '1', rsc: '1' },
    ]

    for (const mode of ['PRIVATE', 'INFORMATIONAL'] as const) {
      const baseline = observe(gate(closed, 'GET', mode))

      for (const extra of headers) {
        assert.deepEqual(
          observe(gate(closed, 'GET', mode, { headers: extra })),
          baseline,
          `${mode} with ${JSON.stringify(extra)}`,
        )
      }
    }
  })

  it('ignores query parameters', () => {
    for (const query of [
      '?mode=FULL',
      '?launch=FULL',
      '?preview=1',
      '?_rsc=abc',
    ]) {
      assert.deepEqual(
        observe(gate(`${closed}${query}`, 'GET', 'INFORMATIONAL')),
        { kind: 'not-found-rewrite' },
        query,
      )
    }
  })

  it('refuses other spellings of a closed path', () => {
    const spellings = [
      '/prihl%61seni',
      '/%70rihlaseni',
      '/PRIHLASENI',
      '/Prihlaseni',
      '/prihlaseni/',
      '//prihlaseni',
      '/prihlaseni;jsessionid=1',
      '/prihlaseni%2F',
      '/historie/../prihlaseni',
      '/historie/%2e%2e/prihlaseni',
      '/tipy/..%2Fprihlaseni',
      '/tipy/a/b',
      '/tipy/a%2Fb',
      '/tipy/a%5Cb',
      '/ucet%2Fdoklady',
      '/registrace%00',
      '/predplatne.json',
      '/auth%2Fsign-up%2Femail',
    ]

    for (const spelling of spellings) {
      const outcome = observe(gate(spelling, 'GET', 'INFORMATIONAL'))
      assert.deepEqual(outcome, { kind: 'not-found-rewrite' }, spelling)

      const post = observe(gate(spelling, 'POST', 'INFORMATIONAL'))
      assert.deepEqual(
        post,
        { kind: 'status', status: 404, reason: 'not-found' },
        spelling,
      )
    }
  })

  it('classifies the path after dot segments are resolved, as the URL parser does', () => {
    // `..` and `%2e%2e` are resolved by the WHATWG URL parser before the
    // gate sees the path, so these ARE the home page and are classified as
    // such. The production build is probed with the raw forms as well; see
    // the verification notes in docs/DEPLOYMENT.md.
    for (const path of ['/tipy/..', '/tipy/%2e%2e', '/tipy/%2E%2E']) {
      assert.equal(request(path, 'GET').nextUrl.pathname, '/', path)
    }

    assert.equal(
      request('/historie/%2e%2e/prihlaseni', 'GET').nextUrl.pathname,
      '/prihlaseni',
    )
  })

  it('refuses the rewrite target itself when requested directly', () => {
    assert.deepEqual(observe(gate(NOT_FOUND_PATH, 'GET', 'INFORMATIONAL')), {
      kind: 'not-found-rewrite',
    })
    assert.deepEqual(observe(gate(NOT_FOUND_PATH, 'GET', 'PRIVATE')), {
      kind: 'status',
      status: 503,
      reason: 'private',
    })
  })
})

/* -------------------------------------------------------------------------- */
/* Framework paths                                                            */
/* -------------------------------------------------------------------------- */

describe('framework paths', () => {
  it('serves the image optimiser exactly when the public pages are served', () => {
    assert.equal(
      gate('/_next/image?url=%2Fx.png&w=64&q=75', 'GET', 'PRIVATE').status,
      503,
    )
    assert.deepEqual(
      observe(
        gate('/_next/image?url=%2Fx.png&w=64&q=75', 'GET', 'INFORMATIONAL'),
      ),
      { kind: 'pass' },
    )
  })

  it('opens the dev server endpoints under next dev only', () => {
    const path = '/__nextjs_original-stack-frames'

    assert.deepEqual(
      observe(gate(path, 'POST', 'INFORMATIONAL', { development: true })),
      { kind: 'pass' },
    )
    assert.deepEqual(observe(gate(path, 'POST', 'INFORMATIONAL')), {
      kind: 'status',
      status: 404,
      reason: 'not-found',
    })
  })

  it('passes the rest of /_next in every mode', () => {
    for (const mode of LAUNCH_MODES) {
      assert.deepEqual(observe(gate('/_next/webpack-hmr', 'GET', mode)), {
        kind: 'pass',
      })
    }
  })

  it('names the accepted methods on a 405', () => {
    const response = gate('/historie', 'DELETE', 'INFORMATIONAL')

    assert.equal(response.status, 405)
    assert.equal(response.headers.get('allow'), 'GET, HEAD, POST')
  })
})
