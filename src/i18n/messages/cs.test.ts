/**
 * The copy rules, enforced.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY A TEST AND NOT A COMMENT
 *
 * The comment at the top of `cs.ts` is there to explain the rules. This is
 * what stops them being broken by someone who has not read it — and the
 * person most likely to break them is a copywriter improving a call to
 * action, for whom "Vsadit" is obviously stronger than "Zobrazit tip".
 *
 * These are legal constraints on the payment account the business runs on.
 * A failing test is a cheaper way to find out than a Stripe email.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { cs } from './cs.ts'

/** Every string in the catalogue, with its dotted path. */
const walk = (
  node: unknown,
  path: string[] = [],
): readonly { path: string; value: string }[] => {
  if (typeof node === 'string') {
    return [{ path: path.join('.'), value: node }]
  }

  if (Array.isArray(node)) {
    return node.flatMap((item, index) => walk(item, [...path, String(index)]))
  }

  if (typeof node === 'object' && node !== null) {
    return Object.entries(node).flatMap(([key, value]) =>
      walk(value, [...path, key]),
    )
  }

  return []
}

const STRINGS = walk(cs)

/**
 * Every label on a control: keys named `cta`, `…Cta`, `submit`, `apply`,
 * `reset` or `backToHistory`. Derived from the catalogue rather than listed,
 * so a label added later is held to the same rules automatically.
 */
const ACTION_LABELS = STRINGS.filter(({ path: key }) =>
  /(^|\.)(cta|[a-z]+Cta|submit|apply|reset|backToHistory)$/.test(key),
)

describe('the catalogue is not empty and is all strings', () => {
  it('has a substantial number of entries', () => {
    // A guard against a refactor that accidentally empties the catalogue and
    // makes every rule below pass trivially.
    assert.ok(
      STRINGS.length > 100,
      `expected a full catalogue, found ${String(STRINGS.length)} strings`,
    )
  })

  it('has no empty strings', () => {
    for (const { path, value } of STRINGS) {
      assert.ok(value.trim().length > 0, `${path} is empty`)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* RULE 1 — no imperative to place a bet                                      */
/* -------------------------------------------------------------------------- */

describe('rule 1: never an imperative to place a bet', () => {
  /**
   * Imperative verb forms only.
   *
   * `sázk-` and `sázej` are NOT here: "sázka" is the noun we legitimately use
   * for a stake, and "Sázej chytře" is the brand name. A rule that banned the
   * stem would ban the product's own name, so the forbidden list is the
   * commands.
   */
  const IMPERATIVES = [
    'vsaď',
    'vsadit',
    'vsaďte',
    'vsadte',
    'hraj',
    'hrajte',
    'zahraj',
    'zahrajte',
    'tipni',
    'tipněte',
    'tipnete',
    'podej sázku',
    'podejte sázku',
  ]

  it('appears in no string anywhere in the catalogue', () => {
    for (const { path, value } of STRINGS) {
      const haystack = value.toLowerCase()

      for (const forbidden of IMPERATIVES) {
        assert.ok(
          !haystack.includes(forbidden),
          `${path} contains "${forbidden}": ${JSON.stringify(value)}`,
        )
      }
    }
  })

  it('leaves the brand name and the word for a stake alone', () => {
    // Proof the rule above is not over-broad: these must still be legal, or
    // the product cannot say its own name.
    assert.equal(cs.common.brand, 'Sázej chytře')
    assert.ok(cs.tip.stake.toLowerCase().includes('sázka'))
  })

  it('uses action labels that describe the control', () => {
    // Every button and link label in the catalogue, not a hand-picked five:
    // a new `cta` key is covered the day it is added. The verbs are matched
    // in their sentence-case form, so this also refuses an ALL CAPS label.
    for (const { path, value } of ACTION_LABELS) {
      assert.match(
        value,
        /^(Zobrazit|Celá|Odemknout|Získat|Použít|Zrušit|Odeslat|Přihlásit|Na |Zkusit|Zpět)/,
        `${path} (${JSON.stringify(value)}) does not describe what the control does`,
      )
    }
  })
})

/* -------------------------------------------------------------------------- */
/* DESIGN.md rule 70 — sentence case, no ALL CAPS                             */
/* -------------------------------------------------------------------------- */

describe('rule 70: action labels and headings are in sentence case', () => {
  it('finds every action label, or the checks below are vacuous', () => {
    // 19 at the time of SC-005. Fewer means the key pattern stopped matching.
    assert.ok(
      ACTION_LABELS.length >= 19,
      `found only ${String(ACTION_LABELS.length)} action labels`,
    )
  })

  for (const { path, value } of ACTION_LABELS) {
    it(`${path} is sentence case: ${JSON.stringify(value)}`, () => {
      const first = value.charAt(0)
      const rest = value.slice(1)

      assert.equal(
        first,
        first.toLocaleUpperCase('cs-CZ'),
        'must start with a capital',
      )
      assert.equal(
        rest,
        rest.toLocaleLowerCase('cs-CZ'),
        'only the first letter may be a capital',
      )
    })
  }

  it('has no ALL CAPS phrase anywhere in the catalogue', () => {
    // Two or more consecutive upper-case words. A single upper-case word is
    // how an abbreviation looks (ROI, IČO, DPH, CSV, API) and how one
    // developer-facing warning starts ("POZOR:"), so one is allowed; a run
    // of two is shouting, and is what the old button labels were.
    const shouting = /(?:^|[^\p{L}])\p{Lu}{2,}(?:\s+\p{Lu}{2,})+(?=$|[^\p{L}])/u

    for (const { path, value } of STRINGS) {
      assert.ok(
        !shouting.test(value),
        `${path} is ALL CAPS: ${JSON.stringify(value)}`,
      )
    }
  })

  it('never relies on CSS to change case', () => {
    // The catalogue's own rule 4: what is on screen is what is in the file.
    // Checked against the stylesheet rather than trusted.
    const css = readFileSync(
      path.join(process.cwd(), 'src/app/(frontend)/globals.css'),
      'utf8',
    )

    assert.equal(/text-transform\s*:\s*uppercase/i.test(css), false)
  })
})

/* -------------------------------------------------------------------------- */
/* RULE 2 — never promise winnings, profit or a result                        */
/* -------------------------------------------------------------------------- */

describe('rule 2: never promise winnings, profit or a result', () => {
  /**
   * Promissory phrasing.
   *
   * Phrases, not stems. "zisk" on its own is a legitimate column heading on
   * the history page — the figure we actually achieved — so the rule bans the
   * forms that promise one rather than the word for one.
   */
  const PROMISES = [
    'vydělá',
    'vyděláte',
    'vyděláš',
    'zaručen', // zaručený / zaručeně
    'garantuj',
    'garantovan',
    'jistý zisk',
    'jistý výdělek',
    'ziskové tipy',
    'vždy vyhra',
    'neprohraj',
    'bez rizika',
    'rychlé peníze',
    'snadný výdělek',
    'zbohatn',
  ]

  it('appears in no string anywhere in the catalogue', () => {
    for (const { path, value } of STRINGS) {
      const haystack = value.toLowerCase()

      for (const forbidden of PROMISES) {
        assert.ok(
          !haystack.includes(forbidden),
          `${path} promises an outcome via "${forbidden}": ${JSON.stringify(value)}`,
        )
      }
    }
  })

  it('keeps the tagline exactly as agreed', () => {
    // Not "Méně tipů, víc zisku". The difference is the whole rule.
    assert.equal(cs.common.tagline, 'Méně tipů, víc analýzy')
    assert.equal(cs.home.hero.heading, 'Méně tipů, víc analýzy')
  })

  it('still uses "zisk" where it means a historical figure', () => {
    // Proof the rule is not over-broad: the history page has to be able to
    // label its own profit column.
    assert.equal(cs.common.metrics.profit, 'Zisk')
    assert.ok(cs.history.chart.heading.includes('zisk'))
  })
})

/* -------------------------------------------------------------------------- */
/* RULE 3 — no bookmaker comparison                                           */
/* -------------------------------------------------------------------------- */

describe('rule 3: never name or compare bookmakers', () => {
  const BOOKMAKERS = [
    'tipsport',
    'fortuna',
    'sazka',
    'betano',
    'chance',
    'synottip',
    'betway',
    'bet365',
    'merkur',
    'kajot',
  ]

  it('names no bookmaker anywhere', () => {
    for (const { path, value } of STRINGS) {
      const haystack = value.toLowerCase()

      for (const name of BOOKMAKERS) {
        assert.ok(
          !haystack.includes(name),
          `${path} names a bookmaker ("${name}"): ${JSON.stringify(value)}`,
        )
      }
    }
  })

  it('says explicitly that odds are not compared', () => {
    assert.match(cs.tip.minimumOddsNote, /nesrovnáváme kurzy/)
    assert.match(cs.tip.minimumOddsNote, /nedoporučujeme konkrétní/i)
  })
})

/* -------------------------------------------------------------------------- */
/* RULE 4 — Czech diacritics, including in uppercase                          */
/* -------------------------------------------------------------------------- */

describe('rule 4: correct diacritics, in every case', () => {
  /**
   * Words whose correct Czech form carries a diacritic, paired with the
   * stripped spelling that must never appear.
   *
   * Both the sentence-case forms the labels use now and the uppercase forms
   * they used before SC-005 are listed: a label pasted back in from an old
   * screenshot is the likeliest way a stripped spelling returns.
   */
  const STRIPPED = [
    ['Ziskat', 'Získat'],
    ['ZISKAT', 'ZÍSKAT'],
    ['pristup', 'přístup'],
    ['PRISTUP', 'PŘÍSTUP'],
    ['Zobrazit tip', null], // no diacritic to lose; here as a sanity anchor
    ['historie tipu', 'historie tipů'],
    ['HISTORIE TIPU', 'HISTORIE TIPŮ'],
    ['Cela analyza', 'Celá analýza'],
    ['CELA ANALYZA', 'CELÁ ANALÝZA'],
    ['Odeslat zpravu', 'Odeslat zprávu'],
    ['ODESLAT ZPRAVU', 'ODESLAT ZPRÁVU'],
    ['Zpet ', 'Zpět '],
    ['Pouzit', 'Použít'],
    ['Zrusit', 'Zrušit'],
    ['Na uvod', 'Na úvod'],
    ['prihlasit', 'přihlásit'],
    ['ucet', 'účet'],
    ['zapas', 'zápas'],
    ['vysledek', 'výsledek'],
  ] as const

  it('uses no diacritic-stripped spelling', () => {
    for (const { path, value } of STRINGS) {
      for (const [stripped, correct] of STRIPPED) {
        if (correct === null) continue

        assert.ok(
          !value.includes(stripped),
          `${path} uses "${stripped}" where Czech needs "${correct}": ${JSON.stringify(value)}`,
        )
      }
    }
  })

  it('keeps diacritics in the sentence-case action labels', () => {
    // Pinned exactly, diacritics and case together. Case is never changed by
    // CSS here, so these strings are what a visitor reads.
    assert.equal(cs.pricing.cta, 'Získat přístup')
    assert.equal(cs.tip.locked.cta, 'Odemknout tipy')
    assert.equal(cs.home.freeTip.cta, 'Celá analýza')
    assert.equal(cs.contact.form.submit, 'Odeslat zprávu')
    assert.equal(cs.newsletter.submit, 'Přihlásit k novinkám')
    assert.equal(cs.tip.backToHistory, 'Zpět do historie')
    assert.equal(cs.errors.notFound.homeCta, 'Na úvod')
  })

  it('has no Latin-1 mangling anywhere', () => {
    // The signature of a file that has been through the wrong encoding once.
    for (const { path, value } of STRINGS) {
      assert.ok(!value.includes('Ã'), `${path} looks mis-encoded: ${value}`)
      assert.ok(!value.includes('�'), `${path} has a replacement char`)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* RULE 5 — the permanent furniture                                           */
/* -------------------------------------------------------------------------- */

describe('rule 5: the 18+ marker, the service statement and the help line', () => {
  it('has all three, as strings every page can render', () => {
    assert.equal(cs.common.ageMarker, '18+')
    assert.ok(cs.common.ageMarkerLong.includes('18'))

    // The statement has to say both halves: informational, and no betting.
    assert.match(cs.common.serviceStatement, /informační/i)
    assert.match(cs.common.serviceStatement, /analytick/i)
    assert.match(cs.common.serviceStatement, /nepřijímáme sázky/i)
  })

  it('carries the national help line number exactly', () => {
    // Národní linka pro odvykání. A wrong digit here is worse than no number.
    assert.equal(cs.common.helpline.phone, '800 350 000')
    assert.equal(cs.common.helpline.href, 'tel:800350000')
    assert.match(cs.common.helpline.name, /Národní linka/)
  })

  it('words the help line calmly rather than as a warning', () => {
    // Permanent furniture, not a banner. A warning the reader can close is a
    // warning the reader closes.
    assert.ok(!cs.common.helpline.lead.includes('!'))
    assert.ok(!/POZOR|VAROVÁNÍ/i.test(cs.common.helpline.lead))
  })
})

/* -------------------------------------------------------------------------- */
/* Task 0's methodology, in words the reader gets                              */
/* -------------------------------------------------------------------------- */

describe('the void rule is stated on the page, not only in code', () => {
  it('says voids leave the ROI entirely', () => {
    const text = cs.history.methodology.voidRule

    assert.match(text, /void|zrušen/i)
    assert.match(text, /ROI/)
    // Both sides of the fraction, which is the part a reader would otherwise
    // have to guess at.
    assert.match(text, /ani do zisku/i)
    assert.match(text, /vsazen/i)
  })

  it('distinguishes a void LEG from a void TIP', () => {
    // The distinction that does the real work, and the one a reader of the
    // table will otherwise ask about.
    assert.match(cs.history.methodology.voidLegNote, /složen/i)
    assert.match(cs.history.methodology.voidLegNote, /celý/i)
  })

  it('promises that losses cannot be filtered out', () => {
    assert.match(cs.history.filters.noResultFilterNote, /prohry/i)
    assert.match(cs.history.lead, /prohry|prohran/i)
  })
})
