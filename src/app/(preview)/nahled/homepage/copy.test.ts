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
import { readFileSync } from 'node:fs'
import path from 'node:path'

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
    assert.ok(STRINGS.length >= 8)
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

  it('keeps no button labels of its own: they come from the catalogue', () => {
    // Since SC-005 the catalogue's action labels are sentence case and held
    // to that by cs.test.ts, so a second copy here could only drift.
    assert.equal('cta' in previewCopy, false)

    const page = readFileSync(
      path.join(process.cwd(), 'src/app/(preview)/nahled/homepage/page.tsx'),
      'utf8',
    )

    for (const label of [
      'Zobrazit historii',
      'Celá historie',
      'Celá analýza',
      'Celá metodika',
      'Získat přístup',
    ]) {
      assert.equal(
        page.includes(label),
        false,
        `page.tsx hard-codes "${label}"`,
      )
    }
  })

  it('has no ALL CAPS phrase (DESIGN.md rule 70)', () => {
    const shouting = /(?:^|[^\p{L}])\p{Lu}{2,}(?:\s+\p{Lu}{2,})+(?=$|[^\p{L}])/u

    for (const { path: key, value } of STRINGS) {
      assert.ok(!shouting.test(value), `${key} is ALL CAPS`)
    }
  })

  it('keeps Czech diacritics (catalogue rule 4)', () => {
    for (const [stripped, correct] of [
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
