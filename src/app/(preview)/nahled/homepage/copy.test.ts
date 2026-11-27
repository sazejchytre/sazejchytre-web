/**
 * The catalogue's copy rules, applied to the prototype's own strings.
 *
 * `src/i18n/messages/cs.test.ts` enforces these on `cs.ts`. The prototype
 * keeps a handful of strings outside the catalogue (see `copy.ts`), and a
 * string that escapes the rules by living in a different file is exactly
 * how a rule erodes — so the same checks run here, plus DESIGN.md's.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { previewCopy } from './copy.ts'

const walk = (
  node: unknown,
  trail: string[] = [],
): readonly { path: string; value: string }[] => {
  if (typeof node === 'string') return [{ path: trail.join('.'), value: node }]

  if (typeof node === 'object' && node !== null) {
    return Object.entries(node).flatMap(([key, value]) =>
      walk(value, [...trail, key]),
    )
  }

  return []
}

const STRINGS = walk(previewCopy)

const contains = (needle: string) =>
  STRINGS.filter(({ value }) => value.toLowerCase().includes(needle))

describe('the prototype copy', () => {
  it('has strings, or every rule below passes trivially', () => {
    assert.ok(STRINGS.length >= 10)
  })

  it('never tells anyone to place a bet (catalogue rule 1)', () => {
    for (const imperative of [
      'vsaď',
      'vsadit',
      'vsaďte',
      'hraj',
      'hrajte',
      'tipni',
      'tipněte',
      'podejte sázku',
    ]) {
      assert.deepEqual(contains(imperative), [], `contains "${imperative}"`)
    }
  })

  it('promises nothing (catalogue rule 2, DESIGN.md rules 67 and 68)', () => {
    for (const promise of [
      'vyděláte',
      'vydělat',
      'zisk zaručen',
      'ziskové tipy',
      'zaručen',
      'jistý',
      'jistá výhra',
      'garantovan',
      'bezrizikov',
      'zbohatn',
      'exkluzivní tip',
    ]) {
      assert.deepEqual(contains(promise), [], `contains "${promise}"`)
    }
  })

  it('names no bookmaker (catalogue rule 3)', () => {
    for (const bookmaker of [
      'tipsport',
      'fortuna',
      'chance',
      'betano',
      'synot',
      'sazka',
      'kingsbet',
      'bet365',
    ]) {
      assert.deepEqual(contains(bookmaker), [], `names "${bookmaker}"`)
    }
  })

  it('uses no urgency device (DESIGN.md rule 74)', () => {
    for (const urgency of ['jen dnes', 'zbývá', 'poslední šance', 'ihned']) {
      assert.deepEqual(contains(urgency), [], `contains "${urgency}"`)
    }
  })

  it('writes buttons in sentence case, not ALL CAPS (DESIGN.md rule 70)', () => {
    for (const [key, label] of Object.entries(previewCopy.cta)) {
      assert.notEqual(label, label.toUpperCase(), `${key} is ALL CAPS`)
      assert.equal(
        label.charAt(0),
        label.charAt(0).toUpperCase(),
        `${key} does not start with a capital`,
      )
      assert.equal(
        label.slice(1),
        label.slice(1).toLowerCase(),
        `${key} is not sentence case`,
      )
    }
  })

  it('keeps Czech diacritics (catalogue rule 4)', () => {
    for (const [stripped, correct] of [
      ['Zobrazit historii', null],
      ['Ziskat', 'Získat'],
      ['pristup', 'přístup'],
      ['Cela ', 'Celá '],
      ['analyza', 'analýza'],
      ['vysledky', 'výsledky'],
    ] as const) {
      if (correct === null) continue

      assert.deepEqual(
        STRINGS.filter(({ value }) => value.includes(stripped)),
        [],
        `uses "${stripped}" where Czech needs "${correct}"`,
      )
    }

    for (const { path, value } of STRINGS) {
      assert.ok(
        !value.includes('Ã') && !value.includes('�'),
        `${path} mis-encoded`,
      )
    }
  })

  it('uses no emoji (DESIGN.md rule 78)', () => {
    for (const { path, value } of STRINGS) {
      assert.equal(/\p{Extended_Pictographic}/u.test(value), false, path)
    }
  })

  it('carries the sentence the design has to prove, exactly', () => {
    assert.equal(
      previewCopy.record.heading,
      'Výsledky neschováváme. Ani ty špatné.',
    )
  })
})
