import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  TURNSTILE_VERIFY_ENDPOINT,
  turnstileAllows,
  verifyTurnstileToken,
} from './turnstile.ts'

/**
 * The distinction these tests exist to protect: "Cloudflare said no" and
 * "Cloudflare said nothing" must not collapse into one outcome. One is a bot;
 * the other is an outage, and treating an outage as a bot takes the contact
 * form down for everyone while Cloudflare is having a bad minute.
 */

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

describe('verifyTurnstileToken', () => {
  it('accepts a token Cloudflare approves', async () => {
    const verdict = await verifyTurnstileToken({
      token: 'token',
      secret: 'secret',
      fetchImpl: async () => jsonResponse({ success: true }),
    })

    assert.deepEqual(verdict, { outcome: 'ok' })
  })

  it('posts the secret and the token to the siteverify endpoint', async () => {
    let seenUrl = ''
    let seenBody = ''

    await verifyTurnstileToken({
      token: 'the-token',
      secret: 'the-secret',
      remoteIp: '198.51.100.7',
      fetchImpl: async (url, init) => {
        seenUrl = String(url)
        seenBody = String(init?.body ?? '')

        return jsonResponse({ success: true })
      },
    })

    assert.equal(seenUrl, TURNSTILE_VERIFY_ENDPOINT)

    const sent = new URLSearchParams(seenBody)
    assert.equal(sent.get('secret'), 'the-secret')
    assert.equal(sent.get('response'), 'the-token')
    assert.equal(sent.get('remoteip'), '198.51.100.7')
  })

  it('leaves remoteip out when the address is unknown', async () => {
    let seenBody = ''

    await verifyTurnstileToken({
      token: 'token',
      secret: 'secret',
      fetchImpl: async (_url, init) => {
        seenBody = String(init?.body ?? '')

        return jsonResponse({ success: true })
      },
    })

    assert.equal(new URLSearchParams(seenBody).has('remoteip'), false)
  })

  it('reports a missing token without calling Cloudflare', async () => {
    let called = false

    const verdict = await verifyTurnstileToken({
      token: '',
      secret: 'secret',
      fetchImpl: async () => {
        called = true

        return jsonResponse({ success: true })
      },
    })

    assert.deepEqual(verdict, { outcome: 'missing-token' })
    assert.equal(called, false)
  })

  it('rejects a token Cloudflare refuses, keeping the codes', async () => {
    const verdict = await verifyTurnstileToken({
      token: 'token',
      secret: 'secret',
      fetchImpl: async () =>
        jsonResponse({
          success: false,
          'error-codes': ['invalid-input-response'],
        }),
    })

    assert.equal(verdict.outcome, 'rejected')
    assert.deepEqual(verdict.outcome === 'rejected' ? verdict.codes : [], [
      'invalid-input-response',
    ])
  })

  it('reports a reused token as a rejection, with its code', async () => {
    // A Turnstile token is single use. The code is what tells a developer to
    // reset the widget rather than hunt for a phantom bug.
    const verdict = await verifyTurnstileToken({
      token: 'token',
      secret: 'secret',
      fetchImpl: async () =>
        jsonResponse({
          success: false,
          'error-codes': ['timeout-or-duplicate'],
        }),
    })

    assert.equal(verdict.outcome, 'rejected')
  })

  it('treats a network failure as unavailable, not as a rejection', async () => {
    const verdict = await verifyTurnstileToken({
      token: 'token',
      secret: 'secret',
      fetchImpl: async () => {
        throw new TypeError('fetch failed')
      },
    })

    assert.equal(verdict.outcome, 'unavailable')
  })

  it('treats a 5xx as unavailable', async () => {
    const verdict = await verifyTurnstileToken({
      token: 'token',
      secret: 'secret',
      fetchImpl: async () => jsonResponse({}, 503),
    })

    assert.equal(verdict.outcome, 'unavailable')
  })

  it('treats a malformed body as unavailable', async () => {
    const verdict = await verifyTurnstileToken({
      token: 'token',
      secret: 'secret',
      fetchImpl: async () =>
        new Response('not json', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
    })

    assert.equal(verdict.outcome, 'unavailable')
  })

  it('treats a bad secret as OUR fault rather than as a bot', async () => {
    // The dangerous version of this bug: a missing secret makes every
    // submission look like a bot, so the form appears protected while in
    // fact nothing is being checked.
    const verdict = await verifyTurnstileToken({
      token: 'token',
      secret: '',
      fetchImpl: async () =>
        jsonResponse({
          success: false,
          'error-codes': ['missing-input-secret'],
        }),
    })

    assert.equal(verdict.outcome, 'unavailable')
  })

  it('treats Cloudflare internal errors as unavailable', async () => {
    const verdict = await verifyTurnstileToken({
      token: 'token',
      secret: 'secret',
      fetchImpl: async () =>
        jsonResponse({ success: false, 'error-codes': ['internal-error'] }),
    })

    assert.equal(verdict.outcome, 'unavailable')
  })
})

describe('turnstileAllows', () => {
  it('lets an approved submission through, undegraded', () => {
    assert.deepEqual(turnstileAllows({ outcome: 'ok' }), {
      allowed: true,
      degraded: false,
    })
  })

  it('lets a submission through when the check is DOWN, flagged', () => {
    // The fail-open decision, asserted. See the module header for why.
    assert.deepEqual(
      turnstileAllows({ outcome: 'unavailable', reason: 'HTTP 503' }),
      { allowed: true, degraded: true },
    )
  })

  it('refuses a rejected token', () => {
    assert.deepEqual(turnstileAllows({ outcome: 'rejected', codes: [] }), {
      allowed: false,
      degraded: false,
    })
  })

  it('refuses a submission with no token at all', () => {
    assert.deepEqual(turnstileAllows({ outcome: 'missing-token' }), {
      allowed: false,
      degraded: false,
    })
  })
})
