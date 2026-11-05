import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ECOMAIL_BASE_URL, subscribeToEcomail } from './ecomail.ts'

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

type Captured = { url: string; headers: Headers; body: unknown }

const capture = (
  response: Response,
): { calls: Captured[]; fetchImpl: typeof fetch } => {
  const calls: Captured[] = []

  const fetchImpl = (async (url, init) => {
    calls.push({
      url: String(url),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body ?? '{}')),
    })

    return response
  }) as typeof fetch

  return { calls, fetchImpl }
}

describe('subscribeToEcomail', () => {
  it('posts to the documented subscribe path on api2', async () => {
    const { calls, fetchImpl } = capture(jsonResponse({ id: 1 }))

    await subscribeToEcomail({
      email: 'jan@example.cz',
      listId: '7',
      apiKey: 'key-123',
      fetchImpl,
    })

    assert.equal(calls[0]?.url, `${ECOMAIL_BASE_URL}/lists/7/subscribe`)
    assert.match(calls[0]?.url ?? '', /^https:\/\/api2\.ecomailapp\.cz\//)
  })

  it('authenticates with the `key` header, not Authorization', async () => {
    const { calls, fetchImpl } = capture(jsonResponse({ id: 1 }))

    await subscribeToEcomail({
      email: 'jan@example.cz',
      listId: '7',
      apiKey: 'key-123',
      fetchImpl,
    })

    assert.equal(calls[0]?.headers.get('key'), 'key-123')
    assert.equal(calls[0]?.headers.get('authorization'), null)
  })

  it('keeps double opt-in on', async () => {
    // Flipping `skip_confirmation` to true would add addresses whose owners
    // never asked for anything. The flag is asserted, not assumed.
    const { calls, fetchImpl } = capture(jsonResponse({ id: 1 }))

    await subscribeToEcomail({
      email: 'jan@example.cz',
      listId: '7',
      apiKey: 'key-123',
      fetchImpl,
    })

    const body = calls[0]?.body as Record<string, unknown>
    assert.equal(body.skip_confirmation, false)
  })

  it('sends the address and a source, and nothing else about the person', async () => {
    const { calls, fetchImpl } = capture(jsonResponse({ id: 1 }))

    await subscribeToEcomail({
      email: 'jan@example.cz',
      listId: '7',
      apiKey: 'key-123',
      fetchImpl,
    })

    const body = calls[0]?.body as { subscriber_data: Record<string, unknown> }

    assert.deepEqual(Object.keys(body.subscriber_data).sort(), [
      'email',
      'source',
    ])
    assert.equal(body.subscriber_data.email, 'jan@example.cz')
  })

  it('reports an address that was already on the list', async () => {
    const { fetchImpl } = capture(
      jsonResponse({ id: 1, already_subscribed: true }),
    )

    const outcome = await subscribeToEcomail({
      email: 'jan@example.cz',
      listId: '7',
      apiKey: 'key',
      fetchImpl,
    })

    assert.deepEqual(outcome, { ok: true, alreadySubscribed: true })
  })

  it('still counts a 2xx it could not parse as accepted', async () => {
    const fetchImpl = (async () =>
      new Response('ok', { status: 200 })) as typeof fetch

    const outcome = await subscribeToEcomail({
      email: 'jan@example.cz',
      listId: '7',
      apiKey: 'key',
      fetchImpl,
    })

    assert.deepEqual(outcome, { ok: true, alreadySubscribed: false })
  })

  it('treats a 422 as a rejection and keeps the reason for the log', async () => {
    const { fetchImpl } = capture(
      jsonResponse({ success: false, message: 'Validation errors' }, 422),
    )

    const outcome = await subscribeToEcomail({
      email: 'jan@example.cz',
      listId: '7',
      apiKey: 'key',
      fetchImpl,
    })

    assert.equal(outcome.ok, false)
    assert.equal(outcome.ok ? '' : outcome.reason, 'rejected')
    assert.match(outcome.ok ? '' : outcome.detail, /Validation errors/)
  })

  it('treats a 5xx as unavailable rather than as a rejection', async () => {
    const { fetchImpl } = capture(jsonResponse({}, 503))

    const outcome = await subscribeToEcomail({
      email: 'jan@example.cz',
      listId: '7',
      apiKey: 'key',
      fetchImpl,
    })

    assert.equal(outcome.ok ? '' : outcome.reason, 'unavailable')
  })

  it('treats a network failure as unavailable and never throws', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed')
    }) as typeof fetch

    const outcome = await subscribeToEcomail({
      email: 'jan@example.cz',
      listId: '7',
      apiKey: 'key',
      fetchImpl,
    })

    assert.equal(outcome.ok ? '' : outcome.reason, 'unavailable')
  })

  it('encodes the list id rather than interpolating it raw', async () => {
    const { calls, fetchImpl } = capture(jsonResponse({ id: 1 }))

    await subscribeToEcomail({
      email: 'jan@example.cz',
      listId: 'a/b',
      apiKey: 'key',
      fetchImpl,
    })

    assert.equal(calls[0]?.url, `${ECOMAIL_BASE_URL}/lists/a%2Fb/subscribe`)
  })
})
