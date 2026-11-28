import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { LAUNCH_MODES } from './modes.ts'
import { guardRestHandler } from './rest-guard.ts'

/**
 * The guard around the Payload REST mount, with Payload replaced by stubs:
 * an "administrator" is whoever the stub says, and the handler records that
 * it ran. What is under test is the guard's own behaviour — who reaches the
 * handler, and the cache headers on every possible outcome.
 */

const ORIGIN = 'https://sazejchytre.cz'

const ADMIN_TOKEN = 'JWT administrator'

const isAdministrator = (request: Request): Promise<boolean> =>
  Promise.resolve(request.headers.get('authorization') === ADMIN_TOKEN)

type Call = { ran: boolean }

const handlerReturning = (make: () => Response, call: Call) => () => {
  call.ran = true
  return Promise.resolve(make())
}

const request = (
  path: string,
  { method = 'GET', admin = false }: { method?: string; admin?: boolean } = {},
): Request =>
  new Request(`${ORIGIN}${path}`, {
    method,
    headers: admin ? { authorization: ADMIN_TOKEN } : {},
  })

const assertSessionHeaders = (response: Response, label: string): void => {
  assert.equal(
    response.headers.get('cache-control'),
    'private, no-store',
    label,
  )

  const vary = (response.headers.get('vary') ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())

  assert.ok(
    vary.includes('authorization'),
    `${label}: Vary lacks Authorization`,
  )
  assert.ok(vary.includes('cookie'), `${label}: Vary lacks Cookie`)
}

const silent = () => undefined

describe('PRIVATE mode', () => {
  it('runs the handler for an administrator, and marks the answer session-dependent', async () => {
    const call: Call = { ran: false }
    const guarded = guardRestHandler(
      handlerReturning(
        () => Response.json({ user: { email: 'admin@example.invalid' } }),
        call,
      ),
      { mode: 'PRIVATE', isAdministrator, log: silent },
    )

    const response = await guarded(
      request('/api/users/me', { admin: true }),
      {},
    )

    assert.equal(call.ran, true)
    assert.equal(response.status, 200)
    assertSessionHeaders(response, 'administrator /api/users/me')
  })

  it('refuses an anonymous content read without running the handler', async () => {
    const call: Call = { ran: false }
    const guarded = guardRestHandler(
      handlerReturning(() => Response.json({ docs: [] }), call),
      { mode: 'PRIVATE', isAdministrator, log: silent },
    )

    for (const path of ['/api/legal-pages', '/api/globals/site-settings']) {
      const response = await guarded(request(path), {})

      assert.equal(call.ran, false, path)
      assert.equal(response.status, 503, path)
      assert.equal(response.headers.get('x-launch-gate'), 'private', path)
      assertSessionHeaders(response, `anonymous ${path}`)
    }
  })

  it('lets an anonymous sign-in operation through, with the same headers', async () => {
    const call: Call = { ran: false }
    const guarded = guardRestHandler(
      handlerReturning(() => Response.json({ user: null }), call),
      { mode: 'PRIVATE', isAdministrator, log: silent },
    )

    const response = await guarded(request('/api/users/me'), {})

    assert.equal(call.ran, true)
    assertSessionHeaders(response, 'anonymous /api/users/me')
  })
})

describe('every mode', () => {
  it('marks success, Payload errors and refusals alike', async () => {
    const outcomes: Array<[string, () => Response]> = [
      ['200', () => Response.json({ docs: [] })],
      ['401', () => Response.json({ errors: [] }, { status: 401 })],
      ['403', () => Response.json({ errors: [] }, { status: 403 })],
      ['404', () => Response.json({ errors: [] }, { status: 404 })],
      ['500', () => Response.json({ errors: [] }, { status: 500 })],
      [
        'framework Vary',
        () =>
          new Response('{}', {
            headers: { vary: 'rsc, next-router-state-tree, Origin' },
          }),
      ],
    ]

    for (const mode of LAUNCH_MODES) {
      for (const [label, make] of outcomes) {
        for (const admin of [false, true]) {
          const guarded = guardRestHandler(
            handlerReturning(make, { ran: false }),
            { mode, isAdministrator, log: silent },
          )
          const response = await guarded(
            request('/api/users/me', { admin }),
            {},
          )
          assertSessionHeaders(
            response,
            `${mode} ${label} ${admin ? 'administrator' : 'anonymous'}`,
          )
        }
      }
    }
  })

  it("keeps the framework's Vary values", async () => {
    const guarded = guardRestHandler(
      () =>
        Promise.resolve(
          new Response('{}', { headers: { vary: 'rsc, Origin' } }),
        ),
      { mode: 'FULL', isAdministrator, log: silent },
    )

    const response = await guarded(request('/api/legal-pages'), {})

    assert.equal(
      response.headers.get('vary'),
      'rsc, Origin, Authorization, Cookie',
    )
  })

  it('answers a thrown handler with a generic, unstorable 500', async () => {
    const logged: unknown[] = []

    for (const mode of LAUNCH_MODES) {
      const guarded = guardRestHandler(
        () => Promise.reject(new Error('detail that must not reach a client')),
        {
          mode,
          isAdministrator: () => Promise.resolve(true),
          log: (_message, error) => logged.push(error),
        },
      )

      const response = await guarded(request('/api/users/me'), {})
      const body = await response.text()

      assert.equal(response.status, 500, mode)
      assert.ok(!body.includes('detail that must not reach a client'), mode)
      assertSessionHeaders(response, `${mode} thrown`)
    }

    assert.equal(logged.length, LAUNCH_MODES.length)
  })

  it('treats a failing administrator check as a refusal in PRIVATE', async () => {
    const call: Call = { ran: false }
    const guarded = guardRestHandler(
      handlerReturning(() => Response.json({ docs: [] }), call),
      {
        mode: 'PRIVATE',
        isAdministrator: () => Promise.reject(new Error('database down')),
        log: silent,
      },
    )

    const response = await guarded(
      request('/api/legal-pages', { admin: true }),
      {},
    )

    assert.equal(call.ran, false)
    assert.equal(response.status, 500)
    assertSessionHeaders(response, 'failing administrator check')
  })

  it('treats an invalid mode as PRIVATE', async () => {
    const call: Call = { ran: false }
    const guarded = guardRestHandler(
      handlerReturning(() => Response.json({ docs: [] }), call),
      { mode: 'full', isAdministrator, log: silent },
    )

    const response = await guarded(request('/api/legal-pages'), {})

    assert.equal(call.ran, false)
    assert.equal(response.status, 503)
  })
})
