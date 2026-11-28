import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  SESSION_CACHE_CONTROL,
  mergeVary,
  withSessionCacheHeaders,
} from './session-headers.ts'

describe('mergeVary', () => {
  it('adds the session headers to an empty Vary', () => {
    assert.equal(
      mergeVary(null, ['Authorization', 'Cookie']),
      'Authorization, Cookie',
    )
    assert.equal(
      mergeVary('', ['Authorization', 'Cookie']),
      'Authorization, Cookie',
    )
  })

  it("keeps the framework's values, in order, and appends", () => {
    // What Next actually sends on a route handler response.
    const framework =
      'rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch'

    assert.equal(
      mergeVary(framework, ['Authorization', 'Cookie']),
      `${framework}, Authorization, Cookie`,
    )
  })

  it('adds nothing twice, whatever the case', () => {
    assert.equal(
      mergeVary('Origin, cookie', ['Authorization', 'Cookie']),
      'Origin, cookie, Authorization',
    )
    assert.equal(
      mergeVary('Authorization, Cookie', ['Authorization', 'Cookie']),
      'Authorization, Cookie',
    )
  })

  it('keeps a wildcard as it is', () => {
    assert.equal(mergeVary('Origin, *', ['Authorization', 'Cookie']), '*')
  })
})

describe('withSessionCacheHeaders', () => {
  it('marks a success response private and unstorable, body untouched', async () => {
    const response = withSessionCacheHeaders(
      Response.json({ user: { email: 'admin@example.invalid' } }),
    )

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), SESSION_CACHE_CONTROL)
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
    assert.equal(response.headers.get('vary'), 'Authorization, Cookie')
    assert.deepEqual(await response.json(), {
      user: { email: 'admin@example.invalid' },
    })
  })

  it('replaces a cacheable Cache-Control rather than adding to it', () => {
    const response = withSessionCacheHeaders(
      new Response('x', {
        headers: { 'cache-control': 'public, max-age=3600' },
      }),
    )

    assert.equal(response.headers.get('cache-control'), 'private, no-store')
  })

  it('keeps status, status text and the other headers of an error', () => {
    const response = withSessionCacheHeaders(
      new Response('{"errors":[]}', {
        status: 403,
        statusText: 'Forbidden',
        headers: {
          'content-type': 'application/json',
          vary: 'Origin',
          'access-control-allow-credentials': 'true',
        },
      }),
    )

    assert.equal(response.status, 403)
    assert.equal(response.statusText, 'Forbidden')
    assert.equal(response.headers.get('content-type'), 'application/json')
    assert.equal(
      response.headers.get('access-control-allow-credentials'),
      'true',
    )
    assert.equal(response.headers.get('vary'), 'Origin, Authorization, Cookie')
  })

  it('keeps every Set-Cookie header of a sign-in response', () => {
    const headers = new Headers()
    headers.append('set-cookie', 'payload-token=a; HttpOnly; Path=/')
    headers.append('set-cookie', 'other=b; Path=/')

    const response = withSessionCacheHeaders(
      new Response('{}', { status: 200, headers }),
    )

    assert.deepEqual(response.headers.getSetCookie(), [
      'payload-token=a; HttpOnly; Path=/',
      'other=b; Path=/',
    ])
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
  })

  it('works on a response whose headers are immutable', () => {
    // `Response.redirect` and fetched responses have read-only headers.
    const response = withSessionCacheHeaders(
      Response.redirect('https://sazejchytre.cz/admin', 302),
    )

    assert.equal(response.status, 302)
    assert.equal(
      response.headers.get('location'),
      'https://sazejchytre.cz/admin',
    )
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
  })

  it('works on a bodiless response', async () => {
    const response = withSessionCacheHeaders(
      new Response(null, { status: 204 }),
    )

    assert.equal(response.status, 204)
    assert.equal(await response.text(), '')
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
  })
})
