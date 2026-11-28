import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  expectationFor,
  isRestPath,
  judge,
  normalisedPath,
  probeCategory,
  type Observation,
  type ProxyPolicy,
  type VerificationTarget,
} from './verification.ts'

/**
 * The deployment check's rules, without a network: given what a probe
 * should get and what a server answered, is that a pass?
 *
 * Observations are written as a real server would send them. `seen` is the
 * application's marker; a reverse proxy's own refusal has no marker.
 */

const app = (
  status: number,
  gate: string | null = null,
  cacheControl: string | null = null,
): Observation => ({
  status,
  gate,
  seen: true,
  cacheControl,
})

const proxy = (status: number): Observation => ({
  status,
  gate: null,
  seen: false,
  cacheControl: null,
})

const REST_OK = 'private, no-store'

const verdict = (
  observed: Observation,
  {
    mode,
    method = 'GET',
    path,
    target = 'proxy',
    policy = 'admin',
  }: {
    mode: string
    method?: string
    path: string
    target?: VerificationTarget
    policy?: ProxyPolicy
  },
) =>
  judge(
    expectationFor({ mode, method, rawPath: path, target, policy }),
    observed,
    {
      restResponse: isRestPath(normalisedPath(path)),
    },
  )

const ADMIN_PATHS = [
  '/admin',
  '/admin/login',
  '/admin/collections/users',
  '/api/users/init',
  '/api/users/me',
  '/api/access',
  '/api/legal-pages',
  '/api/globals/site-settings',
  '/api/users/login',
]

describe('categories', () => {
  it('puts each path where the policy expects it', () => {
    assert.equal(probeCategory('/healthz'), 'health')
    assert.equal(probeCategory('/api/cron/sweep-lockouts'), 'cron')
    assert.equal(probeCategory('/api/users/me'), 'payload-api')
    assert.equal(probeCategory('/admin/login'), 'administration')
    assert.equal(probeCategory('/cenik'), 'public')
    assert.equal(probeCategory('/prihlaseni'), 'accounts')
    assert.equal(probeCategory('/webhooks/stripe'), 'payments')
    assert.equal(probeCategory('/_next/static/x.js'), 'framework')
    assert.equal(probeCategory('/does-not-exist'), 'unknown')
    // `/api/cron` itself is not a cron route; it is the REST API.
    assert.equal(probeCategory('/api/cron'), 'payload-api')
  })
})

describe('proxy policy "admin": a correctly restricted proxy passes', () => {
  it('accepts a proxy 401, 403 or 404 for every administrative path, in every mode', () => {
    for (const mode of ['PRIVATE', 'INFORMATIONAL', 'FULL']) {
      for (const path of ADMIN_PATHS) {
        for (const status of [401, 403, 404]) {
          const result = verdict(proxy(status), { mode, path })
          assert.equal(
            result.ok,
            true,
            `${mode} ${path} ${status}: ${result.note}`,
          )
        }
      }
    }
  })

  it('also accepts the raw spellings that normalise to an administrative path', () => {
    for (const path of [
      '/historie/../admin',
      '/historie/%2e%2e/api/users/me',
    ]) {
      assert.equal(
        verdict(proxy(403), { mode: 'PRIVATE', path }).ok,
        true,
        path,
      )
    }
  })

  it('still requires the application to answer the public site as the gate decides', () => {
    assert.equal(
      verdict(app(200), { mode: 'INFORMATIONAL', path: '/cenik' }).ok,
      true,
    )
    assert.equal(
      verdict(app(404, 'not-found'), {
        mode: 'INFORMATIONAL',
        path: '/prihlaseni',
      }).ok,
      true,
    )
    assert.equal(
      verdict(app(503, 'private'), { mode: 'PRIVATE', path: '/cenik' }).ok,
      true,
    )
  })

  it('accepts cron either refused by the proxy or answered by the application', () => {
    const path = '/api/cron/sweep-lockouts'
    assert.equal(verdict(proxy(403), { mode: 'PRIVATE', path }).ok, true)
    assert.equal(verdict(app(401), { mode: 'PRIVATE', path }).ok, true)
  })

  it('requires the health check to reach the application', () => {
    assert.equal(
      verdict(app(200), { mode: 'PRIVATE', path: '/healthz' }).ok,
      true,
    )
    assert.equal(
      verdict(proxy(403), { mode: 'PRIVATE', path: '/healthz' }).ok,
      false,
    )
  })
})

describe('proxy policy "admin": an exposed administrative endpoint fails', () => {
  it('fails when the application answered, whatever the status', () => {
    for (const mode of ['PRIVATE', 'INFORMATIONAL', 'FULL']) {
      for (const path of ADMIN_PATHS) {
        // 200 (reachable), 503 (the REST guard's refusal), and 401/403
        // produced by the application itself all mean the client reached it.
        for (const observed of [
          app(200, null, REST_OK),
          app(503, 'private', REST_OK),
          app(403, null, REST_OK),
          app(401, null, REST_OK),
          app(307),
        ]) {
          const result = verdict(observed, { mode, path })
          assert.equal(result.ok, false, `${mode} ${path} ${observed.status}`)
          assert.match(result.note, /REACHABLE/)
        }
      }
    }
  })

  it('fails when the proxy answers something that is not a refusal', () => {
    for (const status of [200, 302, 500, 502]) {
      const result = verdict(proxy(status), { mode: 'PRIVATE', path: '/admin' })
      assert.equal(result.ok, false, String(status))
    }
  })

  it('fails when the proxy also refuses the public site', () => {
    assert.equal(
      verdict(proxy(403), { mode: 'INFORMATIONAL', path: '/cenik' }).ok,
      false,
    )
    assert.equal(
      verdict(proxy(403), { mode: 'INFORMATIONAL', path: '/prihlaseni' }).ok,
      false,
    )
  })
})

describe('target "app": talking to the application directly', () => {
  it('requires the application to answer everything, administration included', () => {
    for (const path of ['/admin', '/api/users/me', '/cenik', '/healthz']) {
      const result = verdict(proxy(403), {
        mode: 'PRIVATE',
        path,
        target: 'app',
      })
      assert.equal(result.ok, false, path)
      assert.match(result.note, /not answered by the application/)
    }
  })

  it('expects the REST guard in PRIVATE, and an open REST API otherwise', () => {
    const path = '/api/legal-pages'
    assert.equal(
      verdict(app(503, 'private', REST_OK), {
        mode: 'PRIVATE',
        path,
        target: 'app',
      }).ok,
      true,
    )
    assert.equal(
      verdict(app(200, null, REST_OK), { mode: 'PRIVATE', path, target: 'app' })
        .ok,
      false,
    )
    assert.equal(
      verdict(app(200, null, REST_OK), {
        mode: 'INFORMATIONAL',
        path,
        target: 'app',
      }).ok,
      true,
    )
  })

  it('behaves the same with proxy policy "none"', () => {
    for (const [observed, path] of [
      [app(200), '/admin'],
      [proxy(403), '/admin'],
    ] as const) {
      assert.equal(
        verdict(observed, { mode: 'PRIVATE', path, policy: 'none' }).ok,
        verdict(observed, { mode: 'PRIVATE', path, target: 'app' }).ok,
      )
    }
  })
})

describe('proxy policy "site": a non-public host', () => {
  it('requires a proxy refusal everywhere but the health check', () => {
    for (const path of [
      '/',
      '/cenik',
      '/prihlaseni',
      '/admin',
      '/api/users/me',
      '/does-not-exist',
    ]) {
      assert.equal(
        verdict(proxy(401), { mode: 'INFORMATIONAL', path, policy: 'site' }).ok,
        true,
        path,
      )
      assert.equal(
        verdict(app(200, null, REST_OK), {
          mode: 'INFORMATIONAL',
          path,
          policy: 'site',
        }).ok,
        false,
        path,
      )
    }

    assert.equal(
      verdict(app(200), {
        mode: 'INFORMATIONAL',
        path: '/healthz',
        policy: 'site',
      }).ok,
      true,
    )
    assert.equal(
      verdict(proxy(401), {
        mode: 'INFORMATIONAL',
        path: '/healthz',
        policy: 'site',
      }).ok,
      false,
    )
  })
})

describe('server errors are not evidence', () => {
  it('flags a 5xx on a passed route instead of counting it as expected', () => {
    const result = verdict(app(500), {
      mode: 'INFORMATIONAL',
      path: '/cenik',
      target: 'app',
    })
    assert.equal(result.ok, true)
    assert.equal(result.ok && result.serverError, true)
  })

  it('fails a route the gate must refuse that answered 500', () => {
    for (const [mode, path] of [
      ['INFORMATIONAL', '/prihlaseni'],
      ['INFORMATIONAL', '/ucet'],
      ['PRIVATE', '/'],
    ] as const) {
      assert.equal(
        verdict(app(500), { mode, path, target: 'app' }).ok,
        false,
        path,
      )
    }
  })

  it('fails a route the gate must refuse that the application passed', () => {
    assert.equal(
      verdict(app(200), {
        mode: 'INFORMATIONAL',
        path: '/registrace',
        target: 'app',
      }).ok,
      false,
    )
  })
})

describe('the REST cache rule', () => {
  it('fails an application REST response without private, no-store', () => {
    for (const cacheControl of [
      null,
      'no-store',
      'private',
      'public, max-age=60',
    ]) {
      const result = verdict(app(200, null, cacheControl), {
        mode: 'INFORMATIONAL',
        path: '/api/globals/site-settings',
        target: 'app',
      })
      assert.equal(result.ok, false, String(cacheControl))
    }
  })

  it("does not apply to the framework's own 405 for a method the REST mount does not export", () => {
    assert.equal(
      verdict(app(405), {
        mode: 'INFORMATIONAL',
        method: 'PUT',
        path: '/api/users/me',
        target: 'app',
      }).ok,
      true,
    )
    // But the 405 must still be the framework's, not a pass.
    assert.equal(
      verdict(app(200, null, REST_OK), {
        mode: 'INFORMATIONAL',
        method: 'PUT',
        path: '/api/users/me',
        target: 'app',
      }).ok,
      false,
    )
  })

  it('applies to REST refusals too, and not to pages', () => {
    assert.equal(
      verdict(app(503, 'private', 'no-store'), {
        mode: 'PRIVATE',
        path: '/api/users/me/x',
        target: 'app',
      }).ok,
      false,
    )
    assert.equal(
      verdict(app(200), {
        mode: 'INFORMATIONAL',
        path: '/cenik',
        target: 'app',
      }).ok,
      true,
    )
  })
})
