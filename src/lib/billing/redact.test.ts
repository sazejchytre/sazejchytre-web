import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  REDACTED,
  describeProviderError,
  looksLikeCardNumber,
  maskTail,
  redactForLog,
  redactString,
} from './redact.ts'

const serialise = (value: unknown): string =>
  JSON.stringify(redactForLog(value))

describe('redactString', () => {
  it('removes a Stripe secret key', () => {
    const out = redactString(
      'using sk_test_51Abc123Def456Ghi789Jkl for the call',
    )

    assert.equal(out.includes('sk_test_51Abc123Def456Ghi789Jkl'), false)
    assert.ok(out.includes(REDACTED))
  })

  it('removes a live secret key', () => {
    assert.equal(
      redactString('sk_live_51Abc123Def456Ghi789Jkl').includes('sk_live'),
      false,
    )
  })

  it('removes a restricted key', () => {
    assert.equal(
      redactString('rk_test_51Abc123Def456Ghi789').includes('rk_test'),
      false,
    )
  })

  it('removes a webhook signing secret', () => {
    const out = redactString('whsec_0123456789abcdef0123456789abcdef')

    assert.equal(out.includes('whsec_0'), false)
    assert.equal(out, REDACTED)
  })

  it('removes a client secret wherever it appears', () => {
    // Including inside a URL, which is how one usually escapes: somebody logs
    // the hosted payment page link and the secret is a path segment.
    const out = redactString(
      'open https://pay.example.test/pi_3Abc123_secret_xyz789abc to continue',
    )

    assert.equal(out.includes('_secret_'), false)
    assert.ok(out.includes(REDACTED))
  })

  it('removes a setup intent client secret', () => {
    assert.equal(
      redactString('seti_1Abc123_secret_Def456Ghi').includes('_secret_'),
      false,
    )
  })

  it('leaves ordinary text alone', () => {
    const text = 'Subscription sub_1Abc moved from ACTIVE to PAST_DUE'

    assert.equal(redactString(text), text)
  })
})

describe('card numbers', () => {
  it('removes a bare PAN', () => {
    assert.equal(redactString('4242424242424242'), REDACTED)
  })

  it('removes a PAN written in groups', () => {
    assert.equal(redactString('4242 4242 4242 4242'), REDACTED)
    assert.equal(redactString('4242-4242-4242-4242'), REDACTED)
  })

  it('removes a 15-digit Amex test number', () => {
    assert.equal(redactString('378282246310005'), REDACTED)
  })

  it('leaves an epoch-millisecond timestamp alone', () => {
    // The reason the Luhn check exists. A 13-digit epoch-ms value is exactly
    // as long as a Visa PAN, and redacting every one of them would destroy
    // the timestamps that make out-of-order event handling debuggable.
    const timestamp = '1773568800000'

    assert.equal(looksLikeCardNumber(timestamp), false)
    assert.equal(
      redactString(`event created at ${timestamp}`).includes(timestamp),
      true,
    )
  })

  it('leaves a large amount in minor units alone', () => {
    assert.equal(redactString('totalMinor 1234567'), 'totalMinor 1234567')
  })

  it('accepts only digit runs that pass Luhn', () => {
    assert.equal(looksLikeCardNumber('4242424242424242'), true)
    // One digit changed: no longer a valid card number.
    assert.equal(looksLikeCardNumber('4242424242424243'), false)
  })

  it('rejects runs outside the ISO 7812 length range', () => {
    assert.equal(looksLikeCardNumber('424242424242'), false)
    assert.equal(looksLikeCardNumber('42424242424242424242'), false)
  })
})

describe('maskTail', () => {
  it('keeps only the last four characters', () => {
    assert.equal(maskTail('sk_test_abcdefgh'), '************efgh')
  })

  it('masks a short value entirely', () => {
    assert.equal(maskTail('abc'), '***')
  })
})

describe('redactForLog', () => {
  it('replaces a sensitive key whatever its value looks like', () => {
    const out = redactForLog({ client_secret: 'anything at all' }) as Record<
      string,
      unknown
    >

    assert.equal(out.client_secret, REDACTED)
  })

  it('replaces every spelling of a secret key', () => {
    for (const key of [
      'clientSecret',
      'client_secret',
      'webhook_secret',
      'apiKey',
      'authorization',
      'cvc',
      'number',
    ]) {
      const out = redactForLog({ [key]: 'value' }) as Record<string, unknown>

      assert.equal(out[key], REDACTED, key)
    }
  })

  it('omits a whole provider payload rather than trying to clean it', () => {
    // A provider event is large, nested and full of fields nobody audited.
    // It belongs in the access-controlled WebhookEvents row, not in a log.
    const out = redactForLog({
      rawPayload: { deeply: { nested: 'everything' } },
    }) as Record<string, unknown>

    assert.equal(out.rawPayload, '[payload omitted]')
  })

  it('reaches secrets nested in objects and arrays', () => {
    const out = serialise({
      events: [
        { note: 'see sk_test_51Abc123Def456Ghi789' },
        { nested: { deeper: ['whsec_0123456789abcdef01'] } },
      ],
    })

    assert.equal(out.includes('sk_test'), false)
    assert.equal(out.includes('whsec_'), false)
  })

  it('does not mutate its input', () => {
    const input = { client_secret: 'pi_1_secret_abc' }
    redactForLog(input)

    assert.equal(input.client_secret, 'pi_1_secret_abc')
  })

  it('truncates rather than recursing without limit', () => {
    // Cheap protection against a cyclic or absurdly deep provider payload
    // turning a log call into a stack overflow.
    let deep: Record<string, unknown> = { value: 'sk_test_51Abc123Def456' }

    for (let index = 0; index < 20; index += 1) {
      deep = { nested: deep }
    }

    const out = serialise(deep)

    assert.ok(out.includes('[truncated]'))
    assert.equal(out.includes('sk_test'), false)
  })

  it('keeps an error readable without its stack', () => {
    const error = new Error('failed with key sk_test_51Abc123Def456Ghi')
    const out = redactForLog(error) as Record<string, unknown>

    assert.equal(out.name, 'Error')
    assert.equal(String(out.message).includes('sk_test'), false)
    // No stack: it can hold interpolated argument values.
    assert.equal('stack' in out, false)
  })

  it('renders a Date rather than emptying it', () => {
    const out = redactForLog({ at: new Date('2026-03-15T10:00:00.000Z') }) as {
      at: string
    }

    assert.equal(out.at, '2026-03-15T10:00:00.000Z')
  })

  it('keeps the numbers that make a log useful', () => {
    const out = redactForLog({
      amountMinor: 59_900,
      currency: 'CZK',
      applied: true,
    }) as Record<string, unknown>

    assert.equal(out.amountMinor, 59_900)
    assert.equal(out.currency, 'CZK')
    assert.equal(out.applied, true)
  })
})

describe('describeProviderError', () => {
  it('keeps the four fields support actually needs', () => {
    const described = describeProviderError({
      type: 'StripeCardError',
      code: 'card_declined',
      param: 'payment_method',
      requestId: 'req_abc123',
      statusCode: 402,
      message: 'Your card was declined.',
      // Everything below must not survive.
      headers: { authorization: 'Bearer sk_test_51Abc123Def456' },
      raw: { client_secret: 'pi_1_secret_abc' },
    })

    assert.deepEqual(described, {
      type: 'StripeCardError',
      code: 'card_declined',
      param: 'payment_method',
      requestId: 'req_abc123',
      statusCode: 402,
      message: 'Your card was declined.',
    })
  })

  it('redacts a secret that reached the message', () => {
    const described = describeProviderError({
      type: 'StripeAuthenticationError',
      message: 'Invalid API key provided: sk_test_51Abc123Def456Ghi789',
    })

    assert.equal(String(described.message).includes('sk_test'), false)
  })

  it('survives being handed something that is not an error', () => {
    assert.deepEqual(describeProviderError('just a string'), {
      message: 'just a string',
    })
    assert.deepEqual(describeProviderError(null), { message: 'null' })
  })
})
