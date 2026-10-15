import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  DEFAULT_SUPPORTED_BILLING_COUNTRIES,
  assertSupportedBillingCountry,
  isSupportedBillingCountry,
  normaliseCountryCode,
} from './countries.ts'
import {
  BillingDomainError,
  InvalidCountryCodeError,
  UnsupportedBillingCountryError,
} from './errors.ts'

describe('assertSupportedBillingCountry', () => {
  it('accepts CZ, the launch market', () => {
    assert.equal(assertSupportedBillingCountry('CZ'), 'CZ')
  })

  it('rejects SK with a typed error carrying the reason', () => {
    assert.throws(
      () => assertSupportedBillingCountry('SK'),
      (error: unknown) => {
        assert.ok(error instanceof UnsupportedBillingCountryError)
        assert.ok(error instanceof BillingDomainError)
        assert.equal(error.code, 'UNSUPPORTED_BILLING_COUNTRY')
        assert.equal(error.country, 'SK')
        assert.deepEqual(error.supported, ['CZ'])
        return true
      },
    )
  })

  it('returns the canonical upper-case form, whatever the input casing', () => {
    assert.equal(assertSupportedBillingCountry('cz'), 'CZ')
    assert.equal(assertSupportedBillingCountry(' Cz '), 'CZ')
  })

  it('honours an injected supported set', () => {
    assert.equal(assertSupportedBillingCountry('SK', ['CZ', 'SK']), 'SK')
    assert.throws(
      () => assertSupportedBillingCountry('CZ', ['SK']),
      UnsupportedBillingCountryError,
    )
  })

  it('rejects a malformed code before asking whether it is supported', () => {
    for (const bad of ['CZE', 'C', '', '12', 'c z']) {
      assert.throws(
        () => assertSupportedBillingCountry(bad, ['CZ']),
        InvalidCountryCodeError,
        `expected ${JSON.stringify(bad)} to be rejected as malformed`,
      )
    }
  })

  it('rejects everything when the supported set is empty', () => {
    assert.throws(
      () => assertSupportedBillingCountry('CZ', []),
      UnsupportedBillingCountryError,
    )
  })

  it('fails closed on the launch market by default', () => {
    // The one-argument form must not admit the world. If this ever widens,
    // it should be a deliberate edit to the constant, caught here.
    assert.deepEqual(DEFAULT_SUPPORTED_BILLING_COUNTRIES, ['CZ'])
  })
})

describe('isSupportedBillingCountry', () => {
  it('answers without throwing, including for malformed input', () => {
    assert.equal(isSupportedBillingCountry('CZ'), true)
    assert.equal(isSupportedBillingCountry('SK'), false)
    assert.equal(isSupportedBillingCountry('nonsense'), false)
  })
})

describe('normaliseCountryCode', () => {
  it('upper-cases and trims', () => {
    assert.equal(normaliseCountryCode(' de '), 'DE')
  })

  it('throws on anything that is not two letters', () => {
    assert.throws(() => normaliseCountryCode('DEU'), InvalidCountryCodeError)
  })
})
