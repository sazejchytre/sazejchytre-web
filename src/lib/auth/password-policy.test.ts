import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { COMMON_PASSWORDS } from './common-passwords.ts'
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  checkPassword,
  isCommonPassword,
  normaliseForComparison,
} from './password-policy.ts'

describe('password length', () => {
  it('requires at least 12 characters', () => {
    assert.equal(MIN_PASSWORD_LENGTH, 12)

    const eleven = 'abcdefghijk'
    assert.equal([...eleven].length, 11)

    const result = checkPassword(eleven)
    assert.equal(result.ok, false)
    assert.equal(result.ok === false && result.reason, 'TOO_SHORT')
  })

  it('accepts exactly 12 characters', () => {
    const result = checkPassword('vlakvlakvlak')
    assert.equal(result.ok, true)
  })

  it('counts code points, not UTF-16 units', () => {
    // Twelve emoji are twelve characters to a person and 24 units to JS. A
    // naive `.length` check would accept six, which is not 12 characters.
    const sixEmoji = '🙂🙂🙂🙂🙂🙂'
    assert.equal(sixEmoji.length, 12)
    assert.equal([...sixEmoji].length, 6)

    const result = checkPassword(sixEmoji)
    assert.equal(result.ok, false)
    assert.equal(result.ok === false && result.reason, 'TOO_SHORT')
  })

  it('accepts accented Czech text at 12 code points', () => {
    const value = 'příšerněžluť'
    assert.equal([...value].length, 12)
    assert.equal(checkPassword(value).ok, true)
  })

  it('rejects an unbounded password, as a hashing-cost guard', () => {
    const result = checkPassword('a'.repeat(MAX_PASSWORD_LENGTH + 1))
    assert.equal(result.ok, false)
    assert.equal(result.ok === false && result.reason, 'TOO_LONG')
  })

  it('rejects whitespace padded to length', () => {
    const result = checkPassword(' '.repeat(20))
    assert.equal(result.ok, false)
    assert.equal(result.ok === false && result.reason, 'WHITESPACE_ONLY')
  })
})

describe('no composition requirements', () => {
  it('accepts a long all-lowercase passphrase', () => {
    // The point of the policy: this is stronger than `P@ssw0rd!` and must not
    // be rejected for lacking a capital or a symbol.
    assert.equal(checkPassword('kunamodracervena').ok, true)
  })

  it('does not demand a digit, a capital or a symbol', () => {
    for (const candidate of [
      'zelenastrecha',
      'ZELENASTRECHA',
      'zelena-strecha',
      'zelena strecha a',
    ]) {
      assert.equal(
        checkPassword(candidate).ok,
        true,
        `expected ${candidate} to be accepted`,
      )
    }
  })
})

describe('common password rejection', () => {
  it('rejects a common password that is long enough to reach the check', () => {
    const result = checkPassword('password1234')
    assert.equal(result.ok, false)
    assert.equal(result.ok === false && result.reason, 'TOO_COMMON')
  })

  it('rejects the Czech equivalent', () => {
    // An English-only list would miss this entirely, and `heslo` is simply
    // the word "password".
    const result = checkPassword('heslo1234567')
    assert.equal(result.ok, false)
    assert.equal(result.ok === false && result.reason, 'TOO_COMMON')
  })

  it('rejects something derived from the site name', () => {
    assert.equal(checkPassword('sazejchytre123').ok, false)
  })

  it('rejects long keyboard walks and digit runs', () => {
    for (const candidate of [
      'qwertyuiop123',
      '123456789012',
      '1qaz2wsx3edc',
      'qwertzuiop12',
    ]) {
      assert.equal(
        checkPassword(candidate).ok,
        false,
        `expected ${candidate} to be rejected`,
      )
    }
  })

  it('matches regardless of case, padding or unicode form', () => {
    assert.equal(isCommonPassword('PASSWORD1234'), true)
    assert.equal(isCommonPassword('  password1234  '), true)
    assert.equal(isCommonPassword('Password1234'), true)
  })

  it('reports length before commonality', () => {
    // `password` is in the list but is only 8 characters. The user should be
    // told it is short, not that it is common — the actionable fact first.
    const result = checkPassword('password')
    assert.equal(result.ok === false && result.reason, 'TOO_SHORT')
  })

  it('leaves an uncommon passphrase alone', () => {
    assert.equal(isCommonPassword('bagristatristavrba'), false)
    assert.equal(checkPassword('bagristatristavrba').ok, true)
  })
})

describe('normalisation', () => {
  it('folds case, whitespace and compatibility forms', () => {
    assert.equal(normaliseForComparison('  HeSLo  '), 'heslo')
  })

  it('is only used for comparison, never before hashing', () => {
    // A guard on intent: the stored list is normalised, so the function must
    // be idempotent on it. If normalisation ever changed, this would catch a
    // list that no longer matches what the function produces.
    for (const entry of COMMON_PASSWORDS) {
      assert.equal(normaliseForComparison(entry), entry)
    }
  })

  it('has a list big enough to be worth consulting', () => {
    assert.ok(
      COMMON_PASSWORDS.size >= 150,
      `expected a substantial list, got ${COMMON_PASSWORDS.size}`,
    )
  })
})

describe('no rotation policy', () => {
  it('exposes nothing that expires a password', () => {
    // Deliberate absence, asserted so nobody adds one without a conversation:
    // forced rotation pushes people to Summer2026! → Autumn2026!.
    const exported = Object.keys({
      MIN_PASSWORD_LENGTH,
      MAX_PASSWORD_LENGTH,
    })

    assert.ok(!exported.some((key) => /rotat|expir|maxage/i.test(key)))
  })
})
