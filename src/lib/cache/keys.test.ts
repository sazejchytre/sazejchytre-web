import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CACHE_NAMESPACE, CACHE_TAGS, cacheKey } from './keys.ts'

describe('cacheKey', () => {
  it('puts the namespace first and the locale second, always', () => {
    assert.deepEqual(cacheKey('cs', 'legal', 'obchodni-podminky'), [
      CACHE_NAMESPACE,
      'cs',
      'legal',
      'obchodni-podminky',
    ])
  })

  it('cannot be called without a locale', () => {
    // A COMPILE-TIME assertion, not a runtime one. The call below omits the
    // locale, so TypeScript must reject it. If the parameter ever becomes
    // optional the directive goes unused and `tsc --noEmit` fails on the
    // directive itself — which is exactly the failure we want.
    const withoutLocale = () =>
      // @ts-expect-error locale is required and positional
      cacheKey()

    assert.equal(typeof withoutLocale, 'function')
  })

  it('stringifies numeric parts so a key is always comparable', () => {
    assert.deepEqual(cacheKey('cs', 'tip', 42), [
      CACHE_NAMESPACE,
      'cs',
      'tip',
      '42',
    ])
  })

  it('keeps two locales apart for the same content', () => {
    const czech = cacheKey('cs', 'legal', 'cookies').join('/')
    // Cast because `sk` is not a locale today. The test exists for the day it
    // is: the keys must differ, or a Slovak reader gets Czech terms.
    const slovak = cacheKey('sk' as 'cs', 'legal', 'cookies').join('/')

    assert.notEqual(czech, slovak)
  })
})

describe('CACHE_TAGS', () => {
  it('names a collection rather than a document', () => {
    // Coarse tags on purpose: the admin panel must not have to know which
    // document-level tag to invalidate.
    for (const tag of Object.values(CACHE_TAGS)) {
      assert.match(tag, /^content:[a-z-]+$/)
    }
  })
})
