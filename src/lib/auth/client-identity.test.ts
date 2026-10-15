import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  describeDevice,
  fingerprintIpAddress,
  hashIpPrefix,
  normaliseIpCountry,
  truncateIpAddress,
} from './client-identity.ts'

const SECRET = 'test-secret-at-least-32-characters-long'

describe('truncateIpAddress', () => {
  it('drops the last octet of IPv4', () => {
    assert.equal(truncateIpAddress('203.0.113.42'), '203.0.113.0/24')
  })

  it('collapses every host in a /24 to one value', () => {
    // This is what makes the stored value non-identifying: 256 machines share
    // it, so even with the key you cannot get back to one person.
    assert.equal(
      truncateIpAddress('203.0.113.1'),
      truncateIpAddress('203.0.113.254'),
    )
  })

  it('keeps only the network half of IPv6', () => {
    assert.equal(
      truncateIpAddress('2001:db8:85a3:8d3:1319:8a2e:370:7348'),
      '2001:db8:85a3:8d3::/64',
    )
  })

  it('treats an IPv4-mapped IPv6 address as IPv4', () => {
    assert.equal(truncateIpAddress('::ffff:203.0.113.42'), '203.0.113.0/24')
  })

  it('returns null for anything that is not an address', () => {
    for (const value of [
      '',
      '   ',
      'not-an-ip',
      '999.1.1.1',
      null,
      undefined,
    ]) {
      assert.equal(truncateIpAddress(value), null, String(value))
    }
  })
})

describe('fingerprintIpAddress', () => {
  it('never contains the original address', () => {
    const value = fingerprintIpAddress('203.0.113.42', SECRET)

    assert.ok(value)
    assert.ok(!String(value).includes('203'))
    assert.ok(!String(value).includes('203.0.113.42'))
  })

  it('is stable across hosts in the same prefix', () => {
    assert.equal(
      fingerprintIpAddress('203.0.113.1', SECRET),
      fingerprintIpAddress('203.0.113.99', SECRET),
    )
  })

  it('differs across prefixes', () => {
    assert.notEqual(
      fingerprintIpAddress('203.0.113.1', SECRET),
      fingerprintIpAddress('203.0.114.1', SECRET),
    )
  })

  it('is keyed, so another secret yields another value', () => {
    // Unkeyed, an attacker could enumerate all 2^24 /24 prefixes and match the
    // stored hash. The key is what prevents that.
    assert.notEqual(
      fingerprintIpAddress('203.0.113.1', SECRET),
      fingerprintIpAddress('203.0.113.1', 'a-completely-different-secret-xx'),
    )
  })

  it('truncates BEFORE hashing, not after', () => {
    // Hashing the full address first would leave two hosts in one /24 with
    // different values — and that difference is exactly the identifying
    // information truncation exists to destroy.
    const fullAddressHash = hashIpPrefix('203.0.113.42', SECRET)
    const actual = fingerprintIpAddress('203.0.113.42', SECRET)

    assert.notEqual(actual, fullAddressHash)
    assert.equal(actual, hashIpPrefix('203.0.113.0/24', SECRET))
  })

  it('is null when there is no address', () => {
    assert.equal(fingerprintIpAddress(null, SECRET), null)
  })
})

describe('normaliseIpCountry', () => {
  it('accepts a two-letter code, upper-cased', () => {
    assert.equal(normaliseIpCountry('cz'), 'CZ')
    assert.equal(normaliseIpCountry(' SK '), 'SK')
  })

  it('treats Cloudflare placeholders as absent rather than as a place', () => {
    assert.equal(normaliseIpCountry('XX'), null)
    assert.equal(normaliseIpCountry('T1'), null)
  })

  it('rejects anything else', () => {
    for (const value of ['CZE', '', 'Czechia', null, undefined]) {
      assert.equal(normaliseIpCountry(value), null, String(value))
    }
  })
})

describe('describeDevice', () => {
  it('produces a coarse Czech label', () => {
    assert.equal(
      describeDevice(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      ),
      'Chrome na Windows',
    )
  })

  it('does not mistake Edge for Chrome', () => {
    assert.equal(
      describeDevice(
        'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0',
      ),
      'Edge na Windows',
    )
  })

  it('recognises mobile Safari on iOS', () => {
    assert.equal(
      describeDevice(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
      ),
      'Safari na iOS',
    )
  })

  it('never returns the raw user agent', () => {
    const label = describeDevice(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.6099.129 Safari/537.36',
    )

    assert.ok(!label.includes('120.0.6099.129'))
    assert.ok(label.length < 40)
  })

  it('falls back when the header is missing or unrecognisable', () => {
    assert.equal(describeDevice(null), 'Neznámé zařízení')
    assert.equal(describeDevice(''), 'Neznámé zařízení')
    assert.equal(describeDevice('curl/8.0'), 'Neznámé zařízení')
  })
})
