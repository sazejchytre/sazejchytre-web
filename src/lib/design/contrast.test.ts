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
 * list had a hole exactly where you would expect: a control border verified
 * against white and declared fine, while failing on two of the three
 * surfaces it could actually land on. So foregrounds declare which surfaces
 * they may appear on, and this multiplies that out across both themes.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THREE SOURCES THAT MUST AGREE
 *
 *   docs/DESIGN.md   the specification (token table, sizes, radius, widths)
 *   tokens.ts        the same values as data, which this file can measure
 *   globals.css      what the browser actually reads
 *
 * Each pair is checked below. A value changed in one place and not the
 * others is a failing test, not a discovery made by a reader who cannot see
 * the page.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
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
  DESIGN_MD_DEPARTURES,
  DESIGN_SPEC_TOKENS,
  EXCLUDED_PLACEMENTS,
  FILLED_PAIRS,
  FOREGROUND_RULES,
  FORBIDDEN_PAIRS,
  LARGE_TEXT_TOKENS,
  LAYOUT,
  PALETTE,
  RADII,
  SURFACE_TOKENS,
  TYPE_SCALE,
  TYPE_SIZES,
  TYPE_STEP_MIN_WIDTH_REM,
  type ColourToken,
  type ThemeMode,
} from './tokens.ts'
import { cs } from '../../i18n/messages/cs.ts'

const MODES: readonly ThemeMode[] = ['light', 'dark']

const read = (relative: string): string =>
  readFileSync(path.join(process.cwd(), relative), 'utf8')

const rem = (px: number): string => `${String(px / 16)}rem`

/** Block, JSX and line comments removed, so a rule is checked against code. */
const stripComments = (source: string): string =>
  source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"])\/\/.*$/gm, '$1')

/* -------------------------------------------------------------------------- */
/* The arithmetic itself                                                      */
/* -------------------------------------------------------------------------- */

describe('contrast arithmetic', () => {
  it('anchors on the two values everyone can check', () => {
    // Black on white is 21:1 and a colour against itself is 1:1. If either of
    // these is wrong, nothing else in this file means anything.
    assert.equal(ratio('#000000', '#ffffff'), 21)
    assert.equal(ratio('#236344', '#236344'), 1)
  })

  it('is symmetric in its arguments', () => {
    assert.equal(
      contrastRatio('#171a18', '#ffffff'),
      contrastRatio('#ffffff', '#171a18'),
    )
  })

  it('linearises the channels rather than averaging the encoded values', () => {
    // sRGB is gamma-encoded, so mid-grey has a relative luminance near 0.216,
    // not 0.5 — and a checker built on the wrong one passes pairs that fail.
    const midGrey = relativeLuminance(parseHex('#808080'))

    assert.ok(
      midGrey > 0.21 && midGrey < 0.22,
      `#808080 should linearise to ~0.216, got ${String(midGrey)}`,
    )
  })

  it('accepts shorthand hex and refuses anything else', () => {
    assert.deepEqual(parseHex('#fff'), { r: 255, g: 255, b: 255 })

    for (const bad of ['', '#gg0000', '#12345', 'rgb(0,0,0)', '#1234567']) {
      // A silent fallback would read a typo as black and pass most checks.
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

  it('checks every TEXT token at the normal-text threshold', () => {
    // A token cannot know its size at the call site, so none of the text
    // rules may lean on the 3:1 large-text allowance.
    const textTokens: readonly ColourToken[] = [
      'ink',
      'ink-muted',
      'brand-text',
      'result-win',
      'result-loss',
      'result-void',
      'result-pending',
    ]

    for (const token of textTokens) {
      const rule = FOREGROUND_RULES.find(
        (candidate) => candidate.fg === token && candidate.level === 'normal',
      )

      assert.ok(rule, `${token} has no normal-text rule`)
    }
  })

  it('checks control borders against ALL surfaces, not just the page', () => {
    // The assertion that would have caught the shade an earlier palette had.
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
    const rule = FOREGROUND_RULES.find(
      (candidate) =>
        candidate.fg === 'brand-text' && candidate.level === 'non-text',
    )

    assert.ok(rule)
    assert.deepEqual([...rule.on].sort(), [...SURFACE_TOKENS].sort())
  })

  it('lets ink-muted sit on every surface, because callouts use it', () => {
    // Pages outside the design system put muted text inside accent callouts
    // (the methodology box on /historie, the locked-tip panel). The accent
    // tint was chosen light enough for that; this keeps it so.
    const rule = FOREGROUND_RULES.find(
      (candidate) =>
        candidate.fg === 'ink-muted' && candidate.level === 'normal',
    )

    assert.ok(rule)
    assert.deepEqual([...rule.on].sort(), [...SURFACE_TOKENS].sort())
  })

  it('covers every surface token in the palette', () => {
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

  it('declares the same tokens in both themes', () => {
    assert.deepEqual(
      Object.keys(PALETTE.light).sort(),
      Object.keys(PALETTE.dark).sort(),
    )
  })
})

describe('filled controls', () => {
  for (const mode of MODES) {
    for (const pair of FILLED_PAIRS) {
      it(`${mode}: ${pair.fg} on ${pair.bg} (${pair.note})`, () => {
        const fg = PALETTE[mode][pair.fg]
        const bg = PALETTE[mode][pair.bg]

        assert.ok(
          meetsAA(fg, bg, pair.level),
          `${pair.fg} on ${pair.bg} is ${String(ratio(fg, bg))}:1, needs ${String(thresholdFor(pair.level))}:1`,
        )
      })
    }
  }

  it('lists no pair twice, and binds each control fill to exactly one ink', () => {
    const keys = FILLED_PAIRS.map((pair) => `${pair.fg}|${pair.bg}`)

    assert.equal(new Set(keys).size, keys.length, 'a pair is listed twice')

    // A BUTTON fill has one legal text colour, so a component cannot reach
    // for the wrong one. The brand BAND is a surface and legitimately carries
    // a headline ink, a secondary ink and the signal ring.
    for (const fill of ['brand', 'brand-strong', 'signal'] as const) {
      const text = FILLED_PAIRS.filter(
        (pair) => pair.bg === fill && pair.level === 'normal',
      )

      assert.equal(text.length, 1, `${fill} has ${String(text.length)} inks`)
    }
  })

  it('gives the brand band a text ink, a secondary ink and a focus ring', () => {
    const onBand = FILLED_PAIRS.filter((pair) => pair.bg === 'surface-brand')

    assert.deepEqual(onBand.map((pair) => `${pair.fg}:${pair.level}`).sort(), [
      'ink-muted-on-surface-brand:normal',
      'ink-on-surface-brand:normal',
      'signal:non-text',
    ])
  })

  it('flips the ink on the brand fill with the theme', () => {
    // Light: the brand green is dark and takes white (6.81:1); ink on it is
    // 2.47:1. Dark: the brand green is a light mint and takes dark ink;
    // white on it would fail. The token, not the call site, carries this.
    assert.equal(PALETTE.light['ink-on-brand'], '#ffffff')
    assert.ok(!meetsAA(PALETTE.light.ink, PALETTE.light.brand, 'normal'))
    assert.notEqual(PALETTE.dark['ink-on-brand'], '#ffffff')
    assert.ok(!meetsAA('#ffffff', PALETTE.dark.brand, 'normal'))
  })

  it('moves the focus ring to signal on the brand band', () => {
    // The ordinary ring is brand-text, which vanishes on the band in light
    // mode. globals.css must override it inside `.band-brand`.
    assert.ok(
      !meetsAA(
        PALETTE.light['brand-text'],
        PALETTE.light['surface-brand'],
        'non-text',
      ),
    )

    const css = read('src/app/(frontend)/globals.css')

    assert.match(
      css,
      /\.band-brand :focus-visible,\s*\.band-brand input:focus-within\s*\{\s*outline-color: var\(--color-signal\);/,
    )
  })
})

describe('white on a filled result', () => {
  const RESULT_FILLS = [
    'result-win',
    'result-loss',
    'result-void',
    'result-pending',
  ] as const

  it('is legal in light mode', () => {
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
    // surface. This is what stops ink-on-result being "simplified" to white.
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
    assert.equal(PALETTE.light['ink-on-result'], '#ffffff')
    assert.equal(PALETTE.dark['ink-on-result'], PALETTE.dark['surface-page'])

    for (const mode of MODES) {
      for (const fill of RESULT_FILLS) {
        assert.ok(
          meetsAA(PALETTE[mode]['ink-on-result'], PALETTE[mode][fill]),
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

      // A POLICY exclusion passes and is still refused. The assertion is that
      // the margin is thin enough to justify the refusal.
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
          'real margin, so the policy exclusion deserves re-deciding.',
      )
    })
  }

  it('is not allowed by any rule at the same time', () => {
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
      const measured = ratio(pair.fg, background)

      // Asserted to FAIL. A suite that only checks the good pairs cannot stop
      // anyone adding a bad one.
      assert.ok(
        !meetsAA(pair.fg, background, pair.level),
        `${pair.fg} on ${pair.bg} now measures ${String(measured)}:1 — ` +
          'if that is intended, remove it from FORBIDDEN_PAIRS deliberately',
      )
    })
  }

  it('pins the hairline as decorative only', () => {
    assert.equal(
      FORBIDDEN_PAIRS.filter(
        (pair) => pair.fg === PALETTE.light['border-subtle'],
      ).length,
      2,
    )
  })
})

/* -------------------------------------------------------------------------- */
/* docs/DESIGN.md and tokens.ts must agree                                    */
/* -------------------------------------------------------------------------- */

describe('tokens.ts implements DESIGN.md, or declares each departure', () => {
  /**
   * DESIGN.md still describes the first, rejected proposal. The second
   * proposal departs from it on purpose, and every departure must be
   * DECLARED in `DESIGN_MD_DEPARTURES` with the exact previous and proposed
   * value. So:
   *
   *   - a value that differs from DESIGN.md and is not declared fails;
   *   - a declared departure whose "previous" no longer matches DESIGN.md, or
   *     whose "proposed" no longer matches the code, fails;
   *   - a declared departure that no longer departs (because Cowork updated
   *     DESIGN.md) fails, so the list empties itself.
   */
  const spec = read('docs/DESIGN.md')
  const checked = new Set<string>()

  const agreeOrDepart = (
    name: string,
    specified: string,
    implemented: string,
  ): void => {
    checked.add(name)
    const departure = DESIGN_MD_DEPARTURES.find((entry) => entry.spec === name)

    if (specified === implemented) {
      assert.equal(
        departure,
        undefined,
        `${name} matches DESIGN.md (${specified}) again — remove its entry from DESIGN_MD_DEPARTURES`,
      )
      return
    }

    assert.ok(
      departure,
      `${name} is ${implemented} in code but ${specified} in DESIGN.md, and is not a declared departure`,
    )
    assert.equal(departure.previous, specified, `${name}: "previous" is stale`)
    assert.equal(
      departure.proposed,
      implemented,
      `${name}: "proposed" is stale`,
    )
    assert.ok(departure.why.length > 20, `${name}: say why`)
  }

  /** `| \`bg\` | \`#F8F9F6\` | …` rows of the token table. */
  const specColours = new Map(
    [
      ...spec.matchAll(/^\|\s*`([a-z-]+)`\s*\|\s*`(#[0-9a-fA-F]{6})`\s*\|/gm),
    ].map((match) => [match[1] as string, (match[2] as string).toLowerCase()]),
  )

  it('finds the token table, or this block is vacuous', () => {
    assert.ok(specColours.size >= 9, `found ${String(specColours.size)} tokens`)
  })

  it('maps exactly the tokens the specification lists', () => {
    assert.deepEqual(
      [...specColours.keys()].sort(),
      Object.keys(DESIGN_SPEC_TOKENS).sort(),
    )
  })

  for (const [name, token] of Object.entries(DESIGN_SPEC_TOKENS)) {
    it(`DESIGN.md \`${name}\` is the light \`${token}\`, or a declared departure`, () => {
      agreeOrDepart(
        name,
        specColours.get(name) ?? '(missing)',
        PALETTE.light[token],
      )
    })
  }

  const size = (pattern: RegExp): string => {
    const match = pattern.exec(spec)

    assert.ok(match, `DESIGN.md no longer matches ${String(pattern)}`)

    return `${match[1] as string}/${match[2] as string}`
  }

  const step = (s: { size: number; lineHeight: number }): string =>
    `${String(s.size)}/${String(s.lineHeight)}`

  const SIZES: readonly [string, RegExp, string][] = [
    ['H1', /\bH1 (\d+)\/(\d+)/, step(TYPE_SCALE['display-xl'].desktop)],
    ['mobile H1', /mobile H1 (\d+)\/(\d+)/, step(TYPE_SCALE['display-xl'])],
    ['H2', /\bH2 (\d+)\/(\d+)/, step(TYPE_SCALE['display-lg'].desktop)],
    ['H3', /\bH3 (\d+)\/(\d+)/, step(TYPE_SCALE.heading)],
    ['body', /\bbody (\d+)\/(\d+)/, step(TYPE_SCALE.body)],
    ['small', /\bsmall (\d+)\/(\d+)/, step(TYPE_SCALE['body-sm'])],
    ['table', /\btable (\d+)\/(\d+)/, step(TYPE_SCALE['data-sm'])],
  ]

  for (const [name, pattern, implemented] of SIZES) {
    it(`DESIGN.md ${name} size is implemented, or a declared departure`, () => {
      agreeOrDepart(name, size(pattern), implemented)
    })
  }

  it('implements the radius, or declares the departure', () => {
    const specified = /\|\s*radius\s*\|\s*`(\d+px)`/.exec(spec)?.[1]

    assert.ok(specified, 'DESIGN.md no longer states a radius')

    // Widened from the literal types, so the comparison stays meaningful
    // whatever the current values are.
    const radii: Readonly<Record<keyof typeof RADII, number>> = RADII
    const uniform = radii.button === radii.card && radii.button === radii.input
    const implemented = uniform
      ? `${String(radii.button)}px`
      : `${String(radii.button)}px controls, ${String(radii.card)}px panels`

    agreeOrDepart('radius', specified, implemented)
  })

  it('uses the specified content widths', () => {
    const widths = /(\d+) px content, (\d+) px for long reading/.exec(spec)

    assert.ok(widths, 'DESIGN.md no longer states the content widths')
    assert.equal(LAYOUT.contentMax, Number(widths[1]))
    assert.equal(LAYOUT.readingMax, Number(widths[2]))
  })

  it('names Geist Sans and Geist Mono, which is what fonts.ts loads', () => {
    assert.match(spec, /Geist Sans/)
    assert.match(spec, /Geist Mono/)
  })

  it('declares no departure for something that is not checked', () => {
    // Runs last in this block: by now every check above has registered its
    // name. An entry for an unchecked name would be documentation nothing
    // holds to account.
    for (const entry of DESIGN_MD_DEPARTURES) {
      assert.ok(
        checked.has(entry.spec),
        `${entry.spec} is not a checked spec value`,
      )
    }

    assert.equal(
      new Set(DESIGN_MD_DEPARTURES.map((entry) => entry.spec)).size,
      DESIGN_MD_DEPARTURES.length,
      'a departure is declared twice',
    )
  })
})

/* -------------------------------------------------------------------------- */
/* globals.css and tokens.ts must agree                                       */
/* -------------------------------------------------------------------------- */

describe('globals.css and tokens.ts have not drifted', () => {
  const css = read('src/app/(frontend)/globals.css')
  const desktopBlock = css.slice(
    css.indexOf(
      `@media (min-width: ${String(TYPE_STEP_MIN_WIDTH_REM)}rem) {\n  :root {\n    --text-`,
    ),
  )

  for (const mode of MODES) {
    for (const [token, value] of Object.entries(PALETTE[mode])) {
      it(`${mode} ${token} = ${value} appears in globals.css`, () => {
        // The declaration, not merely the value: finding the hex anywhere
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

  it('wires no colour utility that the palette does not define', () => {
    // A `--color-*` with no tokens.ts entry would be a colour nothing
    // measures. The yellow `accent` of the old palette is the obvious one.
    const wired = [...css.matchAll(/--color-([a-z-]+): var\(--sc-/g)].map(
      (match) => match[1],
    )

    assert.deepEqual(wired.sort(), Object.keys(PALETTE.light).sort())
  })

  it('declares every radius from RADII, and none below 6px', () => {
    for (const forbidden of [
      '--radius-sm:',
      '--radius-xs:',
      '--radius-none:',
    ]) {
      assert.ok(!css.includes(forbidden), `${forbidden} is in globals.css`)
    }

    const radii = new Map(
      [...css.matchAll(/--radius-([a-z]+): ([\d.]+)rem;/g)].map((match) => [
        match[1],
        Number(match[2]) * 16,
      ]),
    )

    assert.deepEqual([...radii.keys()].sort(), Object.keys(RADII).sort())

    for (const [name, px] of radii) {
      assert.equal(
        px,
        RADII[name as keyof typeof RADII],
        `--radius-${String(name)}`,
      )
    }

    // Softer than the first proposal, still no pills and no 16px+ rounded
    // containers.
    assert.ok(Math.min(...Object.values(RADII)) >= 6, 'a radius below 6px')
    assert.ok(Math.max(...Object.values(RADII)) <= 12, 'a radius above 12px')
  })

  it('has one shadow level, tinted with the ink (rule 43)', () => {
    const shadows = [...css.matchAll(/^\s*--shadow-[a-z-]+:/gm)]

    assert.equal(shadows.length, 1, 'more than one shadow level is declared')
    assert.ok(css.includes('--sc-shadow-overlay: rgba(19, 32, 26, 0.14);'))
  })

  it('has no gradient, glow or glass anywhere (rule 45)', () => {
    for (const tell of [
      'gradient(',
      'backdrop-filter',
      'text-shadow',
      'blur(',
    ]) {
      assert.ok(!css.includes(tell), `globals.css contains ${tell}`)
    }
  })

  it('sets tabular figures on every numeric style, mono on the table ones', () => {
    const tabular = Object.entries(TYPE_SCALE)
      .filter(([, style]) => style.tabular)
      .map(([name]) => name)
    const mono = Object.entries(TYPE_SCALE)
      .filter(([, style]) => style.mono)
      .map(([name]) => name)

    assert.deepEqual(tabular, ['data-xl', 'data', 'data-sm'])
    assert.deepEqual(mono, ['data', 'data-sm'])

    assert.match(
      css,
      /\.text-data-xl,\s*\.text-data,\s*\.text-data-sm\s*\{\s*font-variant-numeric: tabular-nums;/,
      'the tabular-nums selector is not the three data styles',
    )
    assert.match(
      css,
      /\.text-data,\s*\.text-data-sm\s*\{\s*font-family: var\(--font-mono\);/,
      'the mono selector is not the two table data styles',
    )
  })

  it('declares every type token with its mobile size, line height and weight', () => {
    for (const [name, style] of Object.entries(TYPE_SCALE)) {
      assert.ok(
        css.includes(`--text-${name}: ${rem(style.size)};`),
        `--text-${name} should be ${rem(style.size)}`,
      )
      assert.ok(
        css.includes(`--text-${name}--line-height: ${rem(style.lineHeight)};`),
        `--text-${name}--line-height should be ${rem(style.lineHeight)}`,
      )
      assert.ok(
        css.includes(`--text-${name}--font-weight: ${String(style.weight)};`),
        `--text-${name}--font-weight should be ${String(style.weight)}`,
      )
    }
  })

  it('steps the large styles up at the breakpoint, and only those', () => {
    assert.ok(desktopBlock.length > 0, 'the stepped type block is missing')

    const block = desktopBlock.slice(0, desktopBlock.indexOf('}\n}') + 3)

    for (const [name, style] of Object.entries(TYPE_SCALE)) {
      if (style.desktop === null) {
        assert.ok(!block.includes(`--text-${name}:`), `${name} should not step`)
        continue
      }

      assert.ok(
        block.includes(`--text-${name}: ${rem(style.desktop.size)};`),
        `${name} should step to ${rem(style.desktop.size)}`,
      )
      assert.ok(
        block.includes(
          `--text-${name}--line-height: ${rem(style.desktop.lineHeight)};`,
        ),
        `${name} should step to ${rem(style.desktop.lineHeight)} leading`,
      )
    }
  })

  it('keeps the focus ring in brand-text, which reaches 3:1 everywhere', () => {
    assert.ok(css.includes('outline: 2px solid var(--color-brand-text)'))
    assert.ok(css.includes('outline-offset: 2px'))
  })

  it('points the font utilities at the Geist variables', () => {
    assert.ok(css.includes('--font-sans: var(--font-geist-sans)'))
    assert.match(css, /--font-mono:\s*var\(--font-geist-mono\)/)
  })

  it('sets the content and reading widths from LAYOUT', () => {
    assert.ok(css.includes(`--container-page: ${rem(LAYOUT.contentMax)};`))
    assert.ok(css.includes(`--container-reading: ${rem(LAYOUT.readingMax)};`))
  })
})

/* -------------------------------------------------------------------------- */
/* The fonts                                                                  */
/* -------------------------------------------------------------------------- */

describe('the typefaces are self-hosted Geist, from the geist package', () => {
  const fonts = read('src/lib/design/fonts.ts')
  const pkg = JSON.parse(read('package.json')) as {
    dependencies: Record<string, string>
  }

  it('loads through next/font/local, never next/font/google', () => {
    assert.match(fonts, /from 'next\/font\/local'/)

    // Nowhere in the source tree, not just here: a Google font anywhere is a
    // build-time network fetch and a second family. The needle is assembled
    // so this file does not match itself.
    const needle = ['from ', "'next/font/", "google'"].join('')
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)

        if (entry.isDirectory()) walk(full)
        else if (/\.(tsx?|css)$/.test(entry.name)) {
          if (readFileSync(full, 'utf8').includes(needle)) offenders.push(full)
        }
      }
    }

    walk(path.join(process.cwd(), 'src'))
    assert.deepEqual(offenders, [])
  })

  it('reads the woff2 files out of the installed geist package', () => {
    assert.ok(
      fonts.includes(
        "'../../../node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2'",
      ),
    )
    assert.ok(
      fonts.includes(
        "'../../../node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2'",
      ),
    )
  })

  it('pins the package to an exact version', () => {
    assert.match(pkg.dependencies.geist ?? '', /^\d+\.\d+\.\d+$/)
  })

  it('preloads the sans face only, and swaps both', () => {
    const sans = fonts.slice(fonts.indexOf('export const geistSans'))
    const mono = fonts.slice(fonts.indexOf('export const geistMono'))

    assert.match(sans.slice(0, 600), /preload: true/)
    assert.match(sans.slice(0, 600), /adjustFontFallback: 'Arial'/)
    assert.match(mono.slice(0, 900), /preload: false/)
    assert.match(sans.slice(0, 600), /display: 'swap'/)
    assert.match(mono.slice(0, 900), /display: 'swap'/)
  })

  it('keeps every mono fallback at the 0.6em advance Geist Mono has', () => {
    // Consolas is 0.55em; on Windows it would be chosen before Courier New and
    // make the swap re-measure every mono cell.
    assert.ok(!/['"]Consolas['"]/.test(fonts))
    assert.ok(!/Consolas/.test(read('src/app/(frontend)/globals.css')))
  })
})

/* -------------------------------------------------------------------------- */
/* The primitives                                                             */
/* -------------------------------------------------------------------------- */

describe('the primitives carry none of the generic tells (rules 43–45, 70)', () => {
  const dir = path.join(process.cwd(), 'src/components/ui')
  // CODE only: the comments in these files name the tells in order to forbid
  // them ("no gradients", "one `rounded-xl` at a time").
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.tsx'))
    .map((name) => ({
      name,
      source: stripComments(readFileSync(path.join(dir, name), 'utf8')),
    }))

  it('finds the primitives, or this block is vacuous', () => {
    assert.ok(files.length >= 5)
  })

  const TELLS: readonly [string, RegExp][] = [
    ['a gradient', /\bbg-(linear|radial|conic)-|gradient/],
    ['a shadow', /\bshadow-(sm|md|lg|xl|2xl|card|raised)\b/],
    ['a pill', /\brounded-(full|pill|3xl|2xl|xl)\b/],
    ['glass', /\bbackdrop-blur/],
    ['ALL CAPS', /\buppercase\b/],
    ['a literal white', /\btext-white\b|#fff(fff)?\b/i],
  ]

  for (const { name, source } of files) {
    for (const [tell, pattern] of TELLS) {
      it(`${name} has no ${tell}`, () => {
        assert.ok(!pattern.test(source), `${name} matches ${String(pattern)}`)
      })
    }
  }
})

describe('the result indicator carries its own background', () => {
  const indicator = read('src/components/ui/ResultIndicator.tsx')

  it('sets a background on every variant', () => {
    // THE MECHANISM behind excluding result tones from `surface-accent`: the
    // component never inherits a surface.
    assert.equal(
      (indicator.match(/outlined: '[^']*bg-surface-raised'/g) ?? []).length,
      4,
    )

    for (const fill of ['win', 'loss', 'void', 'pending']) {
      assert.ok(indicator.includes(`bg-result-${fill}`), `no filled ${fill}`)
    }
  })

  it('writes on a filled result with the token, not a literal white', () => {
    assert.ok(indicator.includes('text-ink-on-result'))
  })

  it('draws its marks as SVG, because Geist has no ✓ or ✕', () => {
    assert.ok(!/[✓✕]/.test(stripComments(indicator)))
    assert.match(indicator, /<svg/)
    assert.match(indicator, /aria-hidden="true"/)
  })

  it('still says the word for every outcome', () => {
    for (const label of [
      'Vyhráno',
      'Prohráno',
      'Zrušeno',
      'Čeká na výsledek',
    ]) {
      assert.ok(indicator.includes(`label: '${label}'`), `lost ${label}`)
    }
  })
})

describe('the input primitive uses one border colour', () => {
  const input = read('src/components/ui/Input.tsx')

  it('has no per-surface conditional', () => {
    // A border that is right only when a caller remembers an argument is
    // worse than one that is simply right.
    assert.ok(!input.includes('ControlSurface'))
    assert.ok(!input.includes('border-ink-muted'))
    assert.ok(input.includes('border-border-strong'))
  })
})

describe('the button primitive', () => {
  const button = read('src/components/ui/Button.tsx')

  it('fills the primary with brand and writes on it with its token', () => {
    assert.match(
      button,
      /primary: cn\(\s*'border-transparent bg-brand text-ink-on-brand'/,
    )
  })

  it('keeps all four variants and both sizes, so no caller breaks', () => {
    assert.match(
      button,
      /export type ButtonVariant = 'primary' \| 'secondary' \| 'ghost' \| 'accent'/,
    )
    assert.match(button, /export type ButtonSize = 'md' \| 'lg'/)
  })
})

/* -------------------------------------------------------------------------- */
/* The type scale                                                             */
/* -------------------------------------------------------------------------- */

describe('type scale', () => {
  it('marks exactly the styles at 24px and above ON MOBILE as large text', () => {
    // The smallest screen decides: a style that is 32px on a desktop and
    // 20px on a phone is not large text.
    const atLeast24 = Object.entries(TYPE_SCALE)
      .filter(([, style]) => style.size >= 24)
      .map(([name]) => name)
      .sort()

    assert.deepEqual([...LARGE_TEXT_TOKENS].sort(), atLeast24)
  })

  it('has line heights that are never tighter than the size', () => {
    for (const [name, style] of Object.entries(TYPE_SCALE)) {
      for (const step of [style, style.desktop]) {
        if (step === null) continue

        assert.ok(
          step.lineHeight >= step.size,
          `${name} has ${String(step.lineHeight)}px leading on ${String(step.size)}px text`,
        )
      }
    }
  })

  it('keeps body text at 16px (rule 31)', () => {
    assert.equal(TYPE_SCALE.body.size, 16)
  })

  it('uses only sizes on the declared scale (TYPE_SIZES)', () => {
    const allowed = new Set<number>(TYPE_SIZES)

    for (const [name, style] of Object.entries(TYPE_SCALE)) {
      for (const step of [style, style.desktop]) {
        if (step === null) continue

        assert.ok(allowed.has(step.size), `${name} uses ${String(step.size)}px`)
      }
    }
  })
})

/* -------------------------------------------------------------------------- */
/* The one file that cannot import the stylesheet                             */
/* -------------------------------------------------------------------------- */

describe('global-error.tsx uses palette values, not invented ones', () => {
  const globalError = read('src/app/global-error.tsx')

  /**
   * WHY THIS FILE IS A SPECIAL CASE
   *
   * `global-error.tsx` replaces the whole document when the ROOT LAYOUT
   * fails — a real scenario here, because the footer refuses to render in
   * production while the operator's register data is a placeholder. The
   * stylesheet may not have been linked, so the page styles itself inline
   * with literal hex values. That is the only correct way to write it, and
   * the one place a colour can drift from the palette without the CSS drift
   * tests noticing — hence this block.
   *
   * Every hex must be a LIGHT palette value (the page cannot take part in
   * the theme swap), every text pair it draws must reach AA, and each pair is
   * pinned to the token it stands for, so a future palette change fails here
   * until this file follows.
   */
  const hexes = [...globalError.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) =>
    match[0].toLowerCase(),
  )

  /** `{ … backgroundColor: 'x', color: 'y' … }` style objects, as written. */
  const styleValue = (key: string): readonly string[] =>
    [
      ...globalError.matchAll(
        new RegExp(`\\b${key}: '(#[0-9a-fA-F]{3,6})'`, 'g'),
      ),
    ].map((match) => (match[1] as string).toLowerCase())

  it('contains some hex literals, or this test is vacuous', () => {
    assert.ok(
      hexes.length >= 6,
      `found only ${String(hexes.length)} hex literals`,
    )
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

  it('carries none of the pre-SC-005 palette', () => {
    // The six values the file held before it was migrated. Pinned so a
    // revert of this file fails loudly rather than passing as "palette".
    for (const old of [
      '#1a2e1f',
      '#5bc894',
      '#6d8775',
      '#dde8e0',
      '#4a5f50',
      '#27714e',
    ]) {
      assert.equal(hexes.includes(old), false, `${old} is back`)
    }
  })

  it('draws the page in the page tokens', () => {
    assert.ok(
      styleValue('backgroundColor').includes(PALETTE.light['surface-page']),
      'the page background is not surface-page',
    )
    assert.ok(
      styleValue('color').includes(PALETTE.light.ink),
      'the body text is not ink',
    )
  })

  it('puts ink-on-brand (white) on the brand fill, never the page ink', () => {
    // The SC-005 fill is dark, so the rule is the reverse of the old one:
    // white on #236344 is 7.14:1, the page ink on it 2.46:1.
    const fill = PALETTE.light.brand
    const button = new RegExp(
      `backgroundColor: '${fill}',\\s*color: '(#[0-9a-fA-F]{3,6})'`,
      'i',
    ).exec(globalError)

    assert.ok(button, 'the retry button is not filled with the brand green')
    assert.equal(
      (button[1] as string).toLowerCase(),
      PALETTE.light['ink-on-brand'],
    )
    assert.ok(meetsAA(button[1] as string, fill))
  })

  it('draws only text pairs that reach AA on the page', () => {
    // Every text colour in the file is drawn on the page background, except
    // the button's, checked above.
    const page = PALETTE.light['surface-page']
    const buttonInk = PALETTE.light['ink-on-brand']

    for (const fg of styleValue('color')) {
      if (fg === buttonInk) continue

      assert.ok(
        meetsAA(fg, page),
        `${fg} on ${page} is ${String(ratio(fg, page))}:1`,
      )
    }
  })

  it('gives the outlined link a control border that reaches 3:1', () => {
    const border = /border: '1px solid (#[0-9a-fA-F]{3,6})'/.exec(globalError)

    assert.ok(border, 'the home link has no border')
    assert.equal(
      (border[1] as string).toLowerCase(),
      PALETTE.light['border-strong'],
    )
    assert.ok(
      meetsAA(border[1] as string, PALETTE.light['surface-page'], 'non-text'),
    )
  })

  it('uses the button radius and sentence-case labels', () => {
    const radius = `${String(RADII.button)}px`
    const radii = [...globalError.matchAll(/borderRadius: '([^']+)'/g)].map(
      (m) => m[1],
    )

    assert.ok(radii.length > 0)
    assert.deepEqual([...new Set(radii)], [radius])
    assert.match(globalError, />\s*Zkusit znovu\s*</)
    assert.match(globalError, />\s*Na úvod\s*</)
    assert.equal(/ZKUSIT ZNOVU|NA ÚVOD/.test(globalError), false)
  })

  it('has a document title and a language (WCAG 2.4.2, 3.1.1)', () => {
    // It replaces the whole document, so nothing else supplies either. The
    // title follows the site's "%s · Sázej chytře" template, with the text of
    // `errors.serverError.metaTitle`.
    const expected = `${cs.errors.serverError.metaTitle} · ${cs.common.brand}`

    assert.equal(expected, 'Chyba serveru · Sázej chytře')
    assert.ok(
      globalError.includes(`<title>${expected}</title>`),
      `global-error.tsx has no <title>${expected}</title>`,
    )
    assert.match(globalError, /<html lang="cs-CZ">/)
  })

  it('still carries the help line, because every page must', () => {
    // Rule 5 does not exempt an outage page.
    assert.match(globalError, /800\s?350\s?000/)
    assert.match(globalError, /18\+/)
    assert.match(globalError, /Nepřijímáme sázky/)
  })
})

/* -------------------------------------------------------------------------- */
/* The brand marks must not depend on a font                                  */
/* -------------------------------------------------------------------------- */

describe('the brand marks are outlines, not text', () => {
  const marks = read('src/components/brand/Marks.tsx')

  /**
   * The logo must not wait for, or change shape with, a webfont — Geist
   * included. These assertions stop someone "simplifying" the paths back
   * into a styled `<span>`.
   */
  it('contains no text element and no font-family', () => {
    assert.equal(/<text[\s>]/.test(marks), false)
    assert.equal(/font-family/i.test(marks), false)
    assert.equal(/font-display|font-barlow|font-geist/.test(marks), false)
  })

  it('draws both marks as path data', () => {
    const paths = marks.match(/<path d="/g) ?? []

    assert.equal(paths.length, 2, 'expected a wordmark and a monogram')
  })

  it('inherits colour instead of hard-coding one', () => {
    assert.match(marks, /fill="currentColor"/)
    assert.equal(/fill="#/.test(marks), false)
  })

  it('carries an accessible name from the caller, not a hard-coded string', () => {
    assert.match(marks, /aria-label=\{label\}/)
    assert.match(marks, /role="img"/)
    assert.equal(marks.includes('aria-label="Sázej'), false)
  })
})
