import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { decimalStringToMinor, minorToDecimalString } from './decimal.ts'

describe('minorToDecimalString', () => {
  it('converts ordinary amounts', () => {
    assert.equal(minorToDecimalString(79_900, 'CZK'), '799.00')
    assert.equal(minorToDecimalString(34_900, 'CZK'), '349.00')
    assert.equal(minorToDecimalString(1, 'CZK'), '0.01')
    assert.equal(minorToDecimalString(0, 'CZK'), '0.00')
  })

  it('keeps the sign in front, for correction documents', () => {
    assert.equal(minorToDecimalString(-79_900, 'CZK'), '-799.00')
    assert.equal(minorToDecimalString(-1, 'CZK'), '-0.01')
  })

  it('pads the fraction so the provider never sees a short decimal', () => {
    assert.equal(minorToDecimalString(79_905, 'CZK'), '799.05')
    assert.equal(minorToDecimalString(100, 'CZK'), '1.00')
  })

  it('refuses a non-integer rather than rounding it', () => {
    // A fractional minor unit is a bug upstream. Rounding here would hide it
    // and put a wrong amount on a statutory document.
    assert.throws(() => minorToDecimalString(799.5, 'CZK'), RangeError)
    assert.throws(() => minorToDecimalString(Number.NaN, 'CZK'), RangeError)
  })

  it('never produces a floating-point artefact', () => {
    // The whole reason this function exists rather than `(m / 100).toFixed(2)`.
    for (let minor = 0; minor < 5_000; minor += 1) {
      const text = minorToDecimalString(minor, 'CZK')

      assert.match(text, /^\d+\.\d{2}$/, `${String(minor)} -> ${text}`)
      assert.equal(
        decimalStringToMinor(text, 'CZK'),
        minor,
        `${String(minor)} did not round-trip`,
      )
    }
  })

  it('round-trips large amounts exactly', () => {
    for (const minor of [
      99_999_999, 123_456_789, 1_000_000_000, 2_147_483_647,
    ]) {
      assert.equal(
        decimalStringToMinor(minorToDecimalString(minor, 'CZK'), 'CZK'),
        minor,
      )
    }
  })
})

describe('decimalStringToMinor', () => {
  it('parses what a provider sends back', () => {
    assert.equal(decimalStringToMinor('799.00', 'CZK'), 79_900)
    assert.equal(decimalStringToMinor('799', 'CZK'), 79_900)
    assert.equal(decimalStringToMinor('0.05', 'CZK'), 5)
    assert.equal(decimalStringToMinor('-799.00', 'CZK'), -79_900)
  })

  it('tolerates surrounding whitespace and a short fraction', () => {
    assert.equal(decimalStringToMinor(' 799.5 ', 'CZK'), 79_950)
  })

  it('accepts trailing zeros beyond the currency precision', () => {
    // `799.000` is exactly representable; refusing it would be pedantry.
    assert.equal(decimalStringToMinor('799.000', 'CZK'), 79_900)
  })

  it('refuses more precision than the currency can hold', () => {
    // Rounding would invent a number nobody agreed to. Refusing surfaces a
    // real disagreement between us and the provider.
    assert.throws(() => decimalStringToMinor('799.005', 'CZK'), RangeError)
  })

  it('refuses anything that is not a plain decimal', () => {
    for (const bad of ['', 'abc', '1 234.00', '1,234.00', '7.99e2', '799.']) {
      assert.throws(
        () => decimalStringToMinor(bad, 'CZK'),
        RangeError,
        `accepted ${JSON.stringify(bad)}`,
      )
    }
  })
})
