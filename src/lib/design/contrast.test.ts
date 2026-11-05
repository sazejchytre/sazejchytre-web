/**
 * The palette, checked rather than asserted.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT THIS BUYS
 *
 * Accessibility review happens once; token edits happen whenever someone
 * thinks a green looks slightly off. This suite makes the second one fail the
 * build, which is the only form of the first that survives a deadline.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY IT IS A CROSS PRODUCT AND NOT A LIST
 *
 * The first version of this file checked an explicit list of pairs, and the
 * list had a hole exactly where you would expect: `border-strong` was
 * verified against white, measured 3.06:1, and was declared fine. It was
 * 2.94:1 on `surface-raised` and 2.45:1 on `surface-accent` — wrong on two of
 * the three surfaces a control border can actually land on.
 *
 * The list was the bug. So foregrounds now declare which surfaces they may
 * appear on, and this multiplies that out across both themes. A shade change
 * is checked everywhere it can land rather than everywhere somebody
 * remembered to write down.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  AA_NORMAL_TEXT,
  contrastRatio,
  meetsAA,
  parseHex,
  ratio,
  relativeLuminance,
  thresholdFor,
} from './contrast.ts'
import {
  EXCLUDED_PLACEMENTS,
  FILLED_PAIRS,
  FOREGROUND_RULES,
  FORBIDDEN_PAIRS,
  LARGE_TEXT_TOKENS,
  PALETTE,
  RADII,
  SURFACE_TOKENS,
  TYPE_SCALE,
  type ThemeMode,
} from './tokens.ts'

const MODES: readonly ThemeMode[] = ['light', 'dark']

/* -------------------------------------------------------------------------- */
/* The arithmetic itself                                                      */
/* -------------------------------------------------------------------------- */

describe('contrast arithmetic', () => {
  it('anchors on the two values everyone can check', () => {
    // Black on white is 21:1 and a colour against itself is 1:1. If either of
    // these is wrong, nothing else in this file means anything.
    assert.equal(ratio('#000000', '#ffffff'), 21)
    assert.equal(ratio('#5bc894', '#5bc894'), 1)
  })

  it('is symmetric in its arguments', () => {
    assert.equal(
      contrastRatio('#1a2e1f', '#ffffff'),
      contrastRatio('#ffffff', '#1a2e1f'),
    )
  })

  it('linearises the channels rather than averaging the encoded values', () => {
    // The shortcut everyone takes. sRGB is gamma-encoded, so mid-grey has a
    // relative luminance near 0.216, not 0.5 — and a checker built on the
    // wrong one passes pairs that fail.
    const midGrey = relativeLuminance(parseHex('#808080'))

    assert.ok(
      midGrey > 0.21 && midGrey < 0.22,
      `#808080 should linearise to ~0.216, got ${String(midGrey)}`,
    )
  })

  it('accepts shorthand hex and refuses anything else', () => {
    assert.deepEqual(parseHex('#fff'), { r: 255, g: 255, b: 255 })

    for (const bad of ['', '#gg0000', '#12345', 'rgb(0,0,0)', '#1234567']) {
      // A silent fallback would read a typo as black and pass most checks,
      // which is the worst available failure mode.
      assert.throws(() => parseHex(bad), RangeError, `accepted ${bad}`)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* THE CROSS PRODUCT                                                          */
/* -------------------------------------------------------------------------- */

describe('every foreground reaches AA on every surface it may appear on', () => {
  for (const mode of MODES) {
    for (const rule of FOREGROUND_RULES) {
      for (const surface of rule.on) {
        const label = `${mode}: ${rule.fg} on ${surface} (${rule.note})`

        it(label, () => {
          const fg = PALETTE[mode][rule.fg]
          const bg = PALETTE[mode][surface]
          const measured = ratio(fg, bg)

          assert.ok(
            meetsAA(fg, bg, rule.level),
            `${label} is ${String(measured)}:1, needs ${String(thresholdFor(rule.level))}:1`,
          )
        })
      }
    }
  }

  it('checks control borders against ALL surfaces, not just the page', () => {
    // The assertion that would have caught the shade this palette replaced.
    // Stated separately from the loop above so the intent survives even if
    // somebody narrows `FOREGROUND_RULES`.
    const rule = FOREGROUND_RULES.find(
      (candidate) =>
        candidate.fg === 'border-strong' && candidate.level === 'non-text',
    )

    assert.ok(rule, 'border-strong has no rule at all')
    assert.deepEqual(
      [...rule.on].sort(),
      [...SURFACE_TOKENS].sort(),
      'border-strong must be checked against every surface',
    )
  })

  it('checks the focus ring against ALL surfaces', () => {
    // The ring can appear over anything, including an accent callout.
    const rule = FOREGROUND_RULES.find(
      (candidate) =>
        candidate.fg === 'brand-text' && candidate.level === 'non-text',
    )

    assert.ok(rule)
    assert.deepEqual([...rule.on].sort(), [...SURFACE_TOKENS].sort())
  })

  it('covers every surface token in the palette', () => {
    // So that adding a fourth surface is a failing test rather than a surface
    // nothing was ever measured against.
    for (const surface of SURFACE_TOKENS) {
      assert.ok(
        PALETTE.light[surface] && PALETTE.dark[surface],
        `${surface} is missing from one of the themes`,
      )
    }

    const covered = new Set(FOREGROUND_RULES.flatMap((rule) => [...rule.on]))

    for (const surface of SURFACE_TOKENS) {
      assert.ok(covered.has(surface), `nothing is checked against ${surface}`)
    }
  })
})

describe('filled controls', () => {
  for (const mode of MODES) {
    for (const pair of FILLED_PAIRS) {
      it(`${mode}: ${pair.fg} on ${pair.bg} (${pair.note})`, () => {
        const fg = PALETTE[mode][pair.fg]
        const bg = PALETTE[mode][pair.bg]

        assert.ok(
          meetsAA(fg, bg, 'normal'),
          `${pair.fg} on ${pair.bg} is ${String(ratio(fg, bg))}:1`,
        )
      })
    }
  }

  it('binds each fill to exactly one foreground', () => {
    // The binding is the point: there is one legal foreground per fill.
    const fills = FILLED_PAIRS.map((pair) => pair.bg)

    assert.deepEqual(fills, [
      'brand',
      'accent',
      'result-win',
      'result-loss',
      'result-void',
    ])
    assert.equal(
      new Set(fills).size,
      fills.length,
      'a fill has two foregrounds',
    )
  })
})

describe('white on a filled result', () => {
  const RESULT_FILLS = ['result-win', 'result-loss', 'result-void'] as const

  it('is legal in light mode — the "never white" rule is not global', () => {
    // Scoped to `brand` and `accent`. A blanket ban would have outlawed a
    // badge that is perfectly legible: 5.33 / 7.30 / 5.63.
    for (const fill of RESULT_FILLS) {
      const measured = ratio('#ffffff', PALETTE.light[fill])

      assert.ok(
        measured >= AA_NORMAL_TEXT,
        `white on ${fill} is ${String(measured)}:1 in light mode`,
      )
    }
  })

  it('is NOT legal in dark mode, which is why it is a token', () => {
    // The dark result values are LIGHT colours — foregrounds meant for a dark
    // surface. Filling a chip with one and writing white on it inverts the
    // intent: 1.77 / 2.58 / 2.32.
    //
    // This is the assertion that stops someone "simplifying" ink-on-result
    // down to a literal #ffffff.
    for (const fill of RESULT_FILLS) {
      const measured = ratio('#ffffff', PALETTE.dark[fill])

      assert.ok(
        measured < AA_NORMAL_TEXT,
        `white on ${fill} measures ${String(measured)}:1 in dark mode — if a ` +
          'palette change made this legal, ink-on-result could be simplified',
      )
    }
  })

  it('is covered by ink-on-result in both themes', () => {
    // Which is what the cross product above already asserts; this names the
    // reason so the two cannot be separated by a later edit.
    assert.equal(PALETTE.light['ink-on-result'], '#ffffff')
    assert.equal(PALETTE.dark['ink-on-result'], '#1a2e1f')

    for (const mode of MODES) {
      for (const fill of RESULT_FILLS) {
        assert.ok(
          meetsAA(
            PALETTE[mode]['ink-on-result'],
            PALETTE[mode][fill],
            'normal',
          ),
          `${mode}: ink-on-result on ${fill} fails`,
        )
      }
    }
  })
})

/* -------------------------------------------------------------------------- */
/* The placements that are deliberately refused                               */
/* -------------------------------------------------------------------------- */

describe('placements that are excluded on purpose', () => {
  for (const excluded of EXCLUDED_PLACEMENTS) {
    it(`${excluded.fg} is not allowed on ${excluded.bg} (${excluded.basis})`, () => {
      // Pinned rather than merely omitted. An absence from the rules says
      // nothing about whether a combination was considered; this says it was,
      // gives the number, and names what prevents it.
      const measured = MODES.map((mode) => ({
        mode,
        value: ratio(PALETTE[mode][excluded.fg], PALETTE[mode][excluded.bg]),
        passes: meetsAA(
          PALETTE[mode][excluded.fg],
          PALETTE[mode][excluded.bg],
          excluded.level,
        ),
      }))

      if (excluded.basis === 'fails') {
        assert.ok(
          measured.some((entry) => !entry.passes),
          `${excluded.fg} on ${excluded.bg} now passes in both themes ` +
            `(${measured.map((e) => `${e.mode} ${String(e.value)}:1`).join(', ')}). ` +
            'If that is intended, move it into FOREGROUND_RULES deliberately. ' +
            `Prevention was: ${excluded.prevention}`,
        )

        return
      }

      // A POLICY exclusion passes the threshold and is still refused. There
      // is nothing to assert about the ratio failing — the assertion is that
      // the margin is thin enough to justify the refusal. If a palette change
      // ever gave it real headroom, this says so rather than leaving a
      // restriction with no remaining reason.
      const floor = thresholdFor(excluded.level)
      const thinnest = Math.min(...measured.map((entry) => entry.value))

      assert.ok(
        thinnest >= floor,
        `${excluded.fg} on ${excluded.bg} is recorded as a policy exclusion ` +
          `but measures ${String(thinnest)}:1 — change its basis to 'fails'`,
      )
      assert.ok(
        thinnest < floor + 0.5,
        `${excluded.fg} on ${excluded.bg} now clears ${String(floor)}:1 by ` +
          `${(thinnest - floor).toFixed(2)} (${String(thinnest)}:1). That is ` +
          'real margin rather than luck, so the policy exclusion deserves ' +
          're-deciding rather than inheriting.',
      )
    })
  }

  it('is not allowed by any rule at the same time', () => {
    // A combination cannot be both excluded and permitted. Without this, a
    // later edit could add the rule and leave the exclusion in place, and the
    // suite would assert both and pass neither honestly.
    for (const excluded of EXCLUDED_PLACEMENTS) {
      const permitted = FOREGROUND_RULES.some(
        (rule) =>
          rule.fg === excluded.fg &&
          rule.level === excluded.level &&
          rule.on.includes(excluded.bg),
      )

      assert.ok(
        !permitted,
        `${excluded.fg} on ${excluded.bg} is both excluded and permitted`,
      )
    }
  })
})

describe('the pairs that must never be used', () => {
  for (const pair of FORBIDDEN_PAIRS) {
    it(`refuses ${pair.fg} on ${pair.bg} — ${pair.why}`, () => {
      const background = PALETTE.light[pair.bg]
      const measured = contrastRatio(pair.fg, background)

      // Asserted to FAIL. A suite that only checks the good pairs cannot stop
      // anyone adding a bad one, and these are the specific mistakes the
      // palette invites.
      assert.ok(
        measured < AA_NORMAL_TEXT,
        `${pair.fg} on ${pair.bg} now measures ${String(ratio(pair.fg, background))}:1 — ` +
          'if that is intended, remove it from FORBIDDEN_PAIRS deliberately',
      )
    })
  }

  it('keeps the brand green off light backgrounds as text', () => {
    // The one mistake that looks right in a design tool and is unreadable on
    // a phone in daylight.
    assert.ok(contrastRatio('#5bc894', '#ffffff') < 3)
  })
})

/* -------------------------------------------------------------------------- */
/* The CSS and the data must agree                                            */
/* -------------------------------------------------------------------------- */

describe('globals.css and tokens.ts have not drifted', () => {
  const css = readFileSync(
    path.join(process.cwd(), 'src/app/(frontend)/globals.css'),
    'utf8',
  )

  for (const mode of MODES) {
    for (const [token, value] of Object.entries(PALETTE[mode])) {
      it(`${mode} ${token} = ${value} appears in globals.css`, () => {
        // The declaration, not merely the value: finding `#5bc894` anywhere
        // would pass even if it had been assigned to the wrong token.
        const declaration = `--sc-${token}: ${value};`

        assert.ok(
          css.includes(declaration),
          `globals.css is missing \`${declaration}\``,
        )
      })
    }
  }

  it('declares a custom property for every colour token', () => {
    for (const token of Object.keys(PALETTE.light)) {
      assert.ok(
        css.includes(`--color-${token}: var(--sc-${token})`),
        `--color-${token} is not wired to --sc-${token} in @theme`,
      )
    }
  })

  it('no longer carries the border shade that failed on two surfaces', () => {
    // #7e9a87 reached 3.06:1 on white and failed on both of the others. If it
    // ever comes back, it comes back with this test failing.
    //
    // The DECLARATION, not the mention: globals.css names the old value in a
    // comment explaining why it was replaced, and that explanation is the
    // most useful thing in the file for whoever next considers nudging this
    // shade. A substring check would have forced it out.
    assert.ok(
      !css.includes('--sc-border-strong: #7e9a87;'),
      'the old light border-strong is assigned again in globals.css',
    )
    assert.ok(
      !css.includes('--sc-border-strong: #6b8b75;'),
      'the old dark border-strong is assigned again in globals.css',
    )
  })

  it('has no radius below 6px', () => {
    for (const forbidden of [
      '--radius-sm:',
      '--radius-xs:',
      '--radius-none:',
    ]) {
      assert.ok(!css.includes(forbidden), `${forbidden} is back in globals.css`)
    }

    assert.equal(Math.min(...Object.values(RADII)), 6)
  })

  it('sets tabular figures on every numeric style', () => {
    const tabular = Object.entries(TYPE_SCALE)
      .filter(([, style]) => style.tabular)
      .map(([name]) => name)

    assert.deepEqual(tabular, ['data-xl', 'data', 'data-sm'])

    const rule = css.slice(css.indexOf('.text-data-xl,'))

    for (const name of tabular) {
      assert.ok(
        rule.slice(0, 200).includes(`.text-${name}`),
        `.text-${name} is not in the tabular-nums selector`,
      )
    }

    assert.ok(rule.includes('font-variant-numeric: tabular-nums'))
  })

  it('declares every type token with size, line height and weight', () => {
    for (const [name, style] of Object.entries(TYPE_SCALE)) {
      assert.ok(css.includes(`--text-${name}:`), `--text-${name} is missing`)
      assert.ok(
        css.includes(`--text-${name}--line-height:`),
        `--text-${name}--line-height is missing`,
      )
      assert.ok(
        css.includes(`--text-${name}--font-weight: ${String(style.weight)}`),
        `--text-${name}--font-weight should be ${String(style.weight)}`,
      )
    }
  })

  it('keeps the focus ring in brand-text, which reaches 3:1', () => {
    assert.ok(css.includes('outline: 2px solid var(--color-brand-text)'))
    assert.ok(css.includes('outline-offset: 2px'))
  })

  it('tints the shadows rather than using black in light mode', () => {
    // A neutral black shadow over a green page reads as grey dirt.
    assert.ok(css.includes('rgba(26, 46, 31, 0.06)'))
    assert.ok(css.includes('rgba(26, 46, 31, 0.1)'))
  })
})

describe('the result indicator carries its own background', () => {
  const indicator = readFileSync(
    path.join(process.cwd(), 'src/components/ui/ResultIndicator.tsx'),
    'utf8',
  )

  it('sets a background on every variant', () => {
    // THE MECHANISM behind excluding result tones from `surface-accent`: the
    // component never inherits a surface, so it cannot land on one where it
    // measures 4.27 / 4.43 / 4.52. A per-placement exception list would have
    // to be complete; this cannot be incomplete.
    assert.ok(indicator.includes('bg-surface-page'))
    assert.ok(indicator.includes('bg-result-win'))
    assert.ok(indicator.includes('bg-result-loss'))
    assert.ok(indicator.includes('bg-result-void'))
  })

  it('writes on a filled result with the token, not a literal white', () => {
    assert.ok(indicator.includes('text-ink-on-result'))
    assert.ok(
      !/text-white|#ffffff/i.test(indicator),
      'a literal white here would be unreadable in dark mode',
    )
  })
})

describe('the input primitive uses one border colour', () => {
  const input = readFileSync(
    path.join(process.cwd(), 'src/components/ui/Input.tsx'),
    'utf8',
  )

  it('has no per-surface conditional left', () => {
    // The step-up to ink-muted existed only because the old border-strong
    // failed on raised surfaces. The token was fixed; the conditional went
    // with it, because a border that is right only when a caller remembers an
    // argument is worse than one that is simply right.
    assert.ok(!input.includes('ControlSurface'))
    assert.ok(!input.includes('border-ink-muted'))
    assert.ok(input.includes('border-border-strong'))
  })
})

/* -------------------------------------------------------------------------- */
/* The type scale                                                             */
/* -------------------------------------------------------------------------- */

describe('type scale', () => {
  it('marks exactly the styles at 24px and above as large text', () => {
    const atLeast24 = Object.entries(TYPE_SCALE)
      .filter(([, style]) => style.size >= 24)
      .map(([name]) => name)
      .sort()

    assert.deepEqual([...LARGE_TEXT_TOKENS].sort(), atLeast24)
  })

  it('has line heights that are never tighter than the size', () => {
    for (const [name, style] of Object.entries(TYPE_SCALE)) {
      assert.ok(
        style.lineHeight >= style.size,
        `${name} has ${String(style.lineHeight)}px leading on ${String(style.size)}px text`,
      )
    }
  })
})

/* -------------------------------------------------------------------------- */
/* The one file that cannot import the stylesheet                             */
/* -------------------------------------------------------------------------- */

describe('global-error.tsx uses palette values, not invented ones', () => {
  const globalError = readFileSync(
    path.join(process.cwd(), 'src/app/global-error.tsx'),
    'utf8',
  )

  /**
   * WHY THIS FILE IS A SPECIAL CASE
   *
   * `global-error.tsx` replaces the whole document when the ROOT LAYOUT
   * fails — which is a real scenario here, because the footer calls
   * `assertOperatorConfigured()` and that throws in production while the
   * register data is a placeholder. Since the layout did not render, the
   * stylesheet may not have been linked, so this page styles itself inline
   * with literal hex values.
   *
   * That is the only correct way to write it, and it is also the one place in
   * the codebase where a colour can drift away from the palette without the
   * CSS drift tests above noticing. So every hex literal in it is checked
   * against the LIGHT palette — the one the page uses, since it cannot
   * participate in the theme swap either.
   */
  const hexes = [...globalError.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) =>
    match[0].toLowerCase(),
  )

  it('contains some hex literals, or this test is vacuous', () => {
    assert.ok(hexes.length >= 4, `found only ${hexes.length} hex literals`)
  })

  it('uses only light-palette values', () => {
    const allowed = new Set(
      Object.values(PALETTE.light).map((value) => value.toLowerCase()),
    )

    for (const hex of hexes) {
      assert.ok(
        allowed.has(hex),
        `${hex} in global-error.tsx is not a light-theme palette value. ` +
          `Allowed: ${[...allowed].sort().join(', ')}`,
      )
    }
  })

  it('puts ink-on-brand on the brand fill, never white', () => {
    // The contrast rule survives even here: white on #5bc894 is 2.07:1.
    assert.match(
      globalError,
      new RegExp(`backgroundColor: '${PALETTE.light.brand}'`, 'i'),
    )
    assert.match(
      globalError,
      new RegExp(`color: '${PALETTE.light['ink-on-brand']}'`, 'i'),
    )
    // Case-SENSITIVE and anchored on a lowercase `color:`, so it tests the
    // text colour and not `backgroundColor` — the page's own background
    // legitimately is #ffffff, which is `surface-page`.
    assert.equal(/[^a-zA-Z]color:\s*'#(fff|ffffff)'/.test(globalError), false)
  })

  it('still carries the help line, because every page must', () => {
    // Rule 5 does not exempt an outage page. This may be the only page a
    // visitor sees.
    assert.match(globalError, /800\s?350\s?000/)
    assert.match(globalError, /18\+/)
    assert.match(globalError, /Nepřijímáme sázky/)
  })
})
