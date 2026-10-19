/**
 * The HTTP layer: the four failures that look alike, kept apart.
 *
 * These are the assertions the contract suite cannot make. Provoking a 429 or
 * a maintenance window on purpose against the operator's real accounting
 * account is both antisocial and unreliable, so the mapping is proven here
 * against a stubbed transport instead.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  AccountingProviderUnreachableError,
  RETRYABLE_ACCOUNTING_CODES,
} from '../port.ts'
import { FAKTUROID_BASE_URL, type FakturoidConfig } from './config.ts'
import {
  createFakturoidHttp,
  describeValidationErrors,
  parseRateLimit,
  retryAfterSecondsOf,
} from './http.ts'

const config: FakturoidConfig = {
  clientId: 'id',
  clientSecret: 'secret',
  slug: 'stub-account',
  userAgent: 'sazejchytre.cz-test (test@example.com)',
  baseUrl: FAKTUROID_BASE_URL,
}

const tokens = {
  accessToken: async () => 'stub-token',
  invalidate: () => {
    /* nothing to forget */
  },
}

type Answer = {
  status: number
  body?: unknown
  headers?: Record<string, string>
}

/** An http client that answers with the given sequence, then repeats the last. */
const httpAnswering = (...answers: Answer[]) => {
  const seen: { url: string; headers: Headers }[] = []
  const slept: number[] = []
  let index = 0

  const fetchImpl: typeof fetch = async (input, init) => {
    seen.push({
      url: typeof input === 'string' ? input : String(input),
      headers: new Headers(init?.headers),
    })

    const answer = answers[Math.min(index, answers.length - 1)]

    index += 1

    if (!answer) throw new Error('no answer configured')

    // 204 must carry a null body, or the Response constructor refuses it.
    const hasBody = answer.body !== undefined && answer.status !== 204

    return new Response(hasBody ? JSON.stringify(answer.body) : null, {
      status: answer.status,
      ...(answer.headers ? { headers: answer.headers } : {}),
    })
  }

  return {
    seen,
    slept,
    http: createFakturoidHttp({
      config,
      tokens,
      fetchImpl,
      sleep: async (ms) => {
        slept.push(ms)
      },
    }),
  }
}

describe('status mapping', () => {
  it('tells throttling, maintenance, blocking and bad data apart', async () => {
    const cases = [
      { status: 429, code: 'RATE_LIMITED', retryable: true },
      { status: 503, code: 'PROVIDER_MAINTENANCE', retryable: true },
      { status: 500, code: 'PROVIDER_ERROR', retryable: true },
      { status: 402, code: 'ACCOUNT_BLOCKED', retryable: false },
      { status: 422, code: 'REJECTED_DATA', retryable: false },
      { status: 400, code: 'REJECTED_DATA', retryable: false },
    ] as const

    const codes = new Set<string>()

    for (const expected of cases) {
      // 429 is retried inline, so give it a terminal answer too.
      const { http } = httpAnswering({
        status: expected.status,
        body: { errors: { base: ['no'] } },
      })

      const outcome = await http.request({
        method: 'GET',
        path: '/invoices.json',
      })

      assert.equal(outcome.kind, 'failure', `${String(expected.status)}`)
      assert.equal(
        outcome.failure.code,
        expected.code,
        `${String(expected.status)} should map to ${expected.code}`,
      )
      assert.equal(
        outcome.failure.retryable,
        expected.retryable,
        `${expected.code} retryability`,
      )

      codes.add(outcome.failure.code)
    }

    // The point of the whole exercise: these must never share a reason
    // string. 402 and 422 look identical in a log that only records "failed",
    // and one of them means "pay a bill" while the other means "fix a bug".
    assert.equal(codes.size, 5, 'the distinct causes must stay distinct')
  })

  it('declares exactly the transient failures retryable', () => {
    // A permanent failure marked retryable turns the retry cron into an
    // infinite loop against a request that will be refused every time.
    assert.deepEqual([...RETRYABLE_ACCOUNTING_CODES].sort(), [
      'PROVIDER_ERROR',
      'PROVIDER_MAINTENANCE',
      'RATE_LIMITED',
    ])
  })

  it('explains a 400 by pointing at the User-Agent', async () => {
    const { http } = httpAnswering({ status: 400, body: {} })

    const outcome = await http.request({ method: 'GET', path: '/account.json' })

    assert.equal(outcome.kind, 'failure')
    // Because that is the actual cause, and the 400 body never says so.
    assert.match(outcome.failure.message, /User-Agent/)
  })

  it('names the rejected field on a 422', async () => {
    const { http } = httpAnswering({
      status: 422,
      body: { errors: { subject_id: ['is invalid'], number: ['is taken'] } },
    })

    const outcome = await http.request({
      method: 'POST',
      path: '/invoices.json',
      body: {},
    })

    assert.equal(outcome.kind, 'failure')
    // The field name is the whole diagnosis. A log line saying only "422"
    // sends somebody to read the request payload by hand.
    assert.match(outcome.failure.message, /subject_id: is invalid/)
    assert.match(outcome.failure.message, /number: is taken/)
  })

  it('reports 404 as absence rather than as a failure', async () => {
    const { http } = httpAnswering({ status: 404, body: {} })

    const outcome = await http.request({
      method: 'GET',
      path: '/invoices/1.json',
    })

    assert.equal(outcome.kind, 'missing')
  })

  it('reports 204 as empty, which is how a PDF says "not yet"', async () => {
    const { http } = httpAnswering({ status: 204 })

    const outcome = await http.request({
      method: 'GET',
      path: '/invoices/1/download.pdf',
      accept: 'pdf',
    })

    assert.equal(outcome.kind, 'empty')
  })

  it('throws unreachable when the network fails', async () => {
    const http = createFakturoidHttp({
      config,
      tokens,
      fetchImpl: async () => {
        throw new TypeError('fetch failed')
      },
    })

    // Not a Result. A caller must not be able to ignore it by forgetting to
    // check a field, because the correct response is to keep the payment and
    // retry later rather than to fail the sale.
    await assert.rejects(
      () => http.request({ method: 'GET', path: '/account.json' }),
      AccountingProviderUnreachableError,
    )
  })
})

describe('rate limiting', () => {
  it('waits out a 429 and then succeeds', async () => {
    const { http, slept } = httpAnswering(
      {
        status: 429,
        body: {},
        headers: { 'Retry-After': '2', 'X-RateLimit': 'default;r=0;t=2' },
      },
      { status: 200, body: { ok: true } },
    )

    const outcome = await http.request({ method: 'GET', path: '/account.json' })

    assert.equal(outcome.kind, 'json')
    assert.deepEqual(slept, [2_000], 'it must honour what they told us')
  })

  it('gives up rather than waiting out a long window inline', async () => {
    const { http, slept } = httpAnswering({
      status: 429,
      body: {},
      headers: { 'Retry-After': '600' },
    })

    const outcome = await http.request({ method: 'GET', path: '/account.json' })

    // Holding a webhook open for ten minutes would make the caller time out
    // and retry, which is more load rather than less. And retrying early —
    // clamping the wait — just gets us throttled again, harder.
    assert.equal(outcome.kind, 'failure')
    assert.equal(outcome.failure.code, 'RATE_LIMITED')
    assert.equal(outcome.failure.retryAfterSeconds, 600)
    assert.deepEqual(slept, [], 'it must not have waited')
  })

  it('stops retrying a persistent 429', async () => {
    const { http, slept } = httpAnswering({
      status: 429,
      body: {},
      headers: { 'Retry-After': '1' },
    })

    const outcome = await http.request({ method: 'GET', path: '/account.json' })

    assert.equal(outcome.kind, 'failure')
    assert.equal(slept.length, 2, 'bounded, not unbounded')
  })

  it('reads the remaining budget so a run near the limit is visible', async () => {
    const { http } = httpAnswering({
      status: 200,
      body: {},
      headers: { 'X-RateLimit': 'default;r=12;t=37' },
    })

    await http.request({ method: 'GET', path: '/account.json' })

    assert.deepEqual(http.rateLimit(), { remaining: 12, resetsInSeconds: 37 })
  })
})

describe('header parsing', () => {
  it('reads the documented X-RateLimit shape', () => {
    assert.deepEqual(parseRateLimit('default;r=149;t=60'), {
      remaining: 149,
      resetsInSeconds: 60,
    })
  })

  it('yields nulls rather than throwing on an unreadable header', () => {
    // Failing a real request over an unreadable diagnostic header would be
    // absurd.
    assert.deepEqual(parseRateLimit('nonsense'), {
      remaining: null,
      resetsInSeconds: null,
    })
    assert.deepEqual(parseRateLimit(null), {
      remaining: null,
      resetsInSeconds: null,
    })
  })

  it('prefers Retry-After, then the window, then a default', () => {
    assert.equal(
      retryAfterSecondsOf(new Headers({ 'Retry-After': '9' })),
      9,
      'what they told us beats what we would guess',
    )
    assert.equal(
      retryAfterSecondsOf(new Headers({ 'X-RateLimit': 'default;r=0;t=42' })),
      42,
    )
    assert.equal(retryAfterSecondsOf(new Headers()), 5)
  })

  it('ignores a Retry-After it cannot read', () => {
    assert.equal(
      retryAfterSecondsOf(new Headers({ 'Retry-After': 'Wed, 21 Oct 2026' })),
      5,
    )
  })
})

describe('validation error formatting', () => {
  it('flattens the errors object to one line', () => {
    assert.equal(
      describeValidationErrors({
        errors: { subject_id: ['is invalid'], lines: ['are required'] },
      }),
      'subject_id: is invalid; lines: are required',
    )
  })

  it('survives a body that is not the documented shape', () => {
    assert.equal(describeValidationErrors(null), 'no detail')
    assert.equal(describeValidationErrors({ errors: 'broken' }), 'broken')
    assert.match(describeValidationErrors({ other: 1 }), /other/)
  })
})

describe('the request itself', () => {
  it('always sends the mandatory User-Agent and a bearer token', async () => {
    const { http, seen } = httpAnswering({ status: 200, body: {} })

    await http.request({ method: 'GET', path: '/account.json' })

    const [request] = seen

    assert.ok(request)
    assert.equal(request.headers.get('user-agent'), config.userAgent)
    assert.equal(request.headers.get('authorization'), 'Bearer stub-token')
  })

  it('puts the account slug in the path and the query on the URL', async () => {
    const { http, seen } = httpAnswering({ status: 200, body: [] })

    await http.request({
      method: 'GET',
      path: '/invoices.json',
      query: { custom_id: 'inv 1', skip: undefined },
    })

    const [request] = seen

    assert.ok(request)
    assert.equal(
      request.url,
      'https://app.fakturoid.cz/api/v3/accounts/stub-account/invoices.json?custom_id=inv+1',
    )
    // An explicit `undefined` must not become `skip=undefined`, which the
    // server would read as the literal string.
    assert.ok(!request.url.includes('skip'))
  })

  it('asks for a PDF when it wants a PDF', async () => {
    const { http, seen } = httpAnswering({ status: 204 })

    await http.request({
      method: 'GET',
      path: '/invoices/1/download.pdf',
      accept: 'pdf',
    })

    assert.equal(seen[0]?.headers.get('accept'), 'application/pdf')
  })
})
