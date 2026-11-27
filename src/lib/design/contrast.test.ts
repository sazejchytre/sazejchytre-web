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
  TYPE_STEP_MIN_WIDTH_REM,
  type ColourToken,
  type ThemeMode,
} from './tokens.ts'

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
          meetsAA(fg, bg, 'normal'),
          `${pair.fg} on ${pair.bg} is ${String(ratio(fg, bg))}:1`,
        )
      })
    }
  }

  it('binds each fill to exactly one foreground', () => {
    const fills = FILLED_PAIRS.map((pair) => pair.bg)

    assert.equal(
      new Set(fills).size,
      fills.length,
      'a fill has two foregrounds',
    )
  })

  it('puts WHITE on the brand fill, because the fill is dark now', () => {
    // The old palette's rule was the opposite ("never white on brand"). The
    // SC-005 green is #236344, where white is 7.14:1 and ink is 2.46:1. The
    // token, not the call site, carries that, so it is pinned here.
    assert.equal(PALETTE.light['ink-on-brand'], '#ffffff')
    assert.equal(PALETTE.dark['ink-on-brand'], '#ffffff')
    assert.ok(!meetsAA(PALETTE.light.ink, PALETTE.light.brand, 'normal'))
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

describe('tokens.ts implements the DESIGN.md specification', () => {
  const spec = read('docs/DESIGN.md')

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
    it(`DESIGN.md \`${name}\` is the light \`${token}\``, () => {
      assert.equal(PALETTE.light[token], specColours.get(name))
    })
  }

  it('uses the specified sizes', () => {
    // "H1 48/56, H2 32/40, H3 20/28, body 16/26, small 14/20, table 14/20",
    // and "mobile H1 32/40".
    const pair = (pattern: RegExp): [number, number] => {
      const match = pattern.exec(spec)

      assert.ok(match, `DESIGN.md no longer matches ${String(pattern)}`)

      return [Number(match[1]), Number(match[2])]
    }

    const expected: readonly [string, [number, number], [number, number]][] = [
      [
        'H1',
        pair(/\bH1 (\d+)\/(\d+)/),
        [
          TYPE_SCALE['display-xl'].desktop.size,
          TYPE_SCALE['display-xl'].desktop.lineHeight,
        ],
      ],
      [
        'mobile H1',
        pair(/mobile H1 (\d+)\/(\d+)/),
        [TYPE_SCALE['display-xl'].size, TYPE_SCALE['display-xl'].lineHeight],
      ],
      [
        'H2',
        pair(/\bH2 (\d+)\/(\d+)/),
        [
          TYPE_SCALE['display-lg'].desktop.size,
          TYPE_SCALE['display-lg'].desktop.lineHeight,
        ],
      ],
      [
        'H3',
        pair(/\bH3 (\d+)\/(\d+)/),
        [TYPE_SCALE.heading.size, TYPE_SCALE.heading.lineHeight],
      ],
      [
        'body',
        pair(/\bbody (\d+)\/(\d+)/),
        [TYPE_SCALE.body.size, TYPE_SCALE.body.lineHeight],
      ],
      [
        'small',
        pair(/\bsmall (\d+)\/(\d+)/),
        [TYPE_SCALE['body-sm'].size, TYPE_SCALE['body-sm'].lineHeight],
      ],
      [
        'table',
        pair(/\btable (\d+)\/(\d+)/),
        [TYPE_SCALE['data-sm'].size, TYPE_SCALE['data-sm'].lineHeight],
      ],
    ]

    for (const [name, specified, implemented] of expected) {
      assert.deepEqual(implemented, specified, `${name} drifted from DESIGN.md`)
    }
  })

  it('uses the specified radius and content widths', () => {
    assert.match(spec, /\|\s*radius\s*\|\s*`6px`/)
    assert.deepEqual(new Set(Object.values(RADII)), new Set([6]))

    const widths = /(\d+) px content, (\d+) px for long reading/.exec(spec)

    assert.ok(widths, 'DESIGN.md no longer states the content widths')
    assert.equal(LAYOUT.contentMax, Number(widths[1]))
    assert.equal(LAYOUT.readingMax, Number(widths[2]))
  })

  it('names Geist Sans and Geist Mono, which is what fonts.ts loads', () => {
    assert.match(spec, /Geist Sans/)
    assert.match(spec, /Geist Mono/)
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

  it('has every radius at 6px and none below it', () => {
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
  })

  it('has one shadow level, tinted with the ink (rule 43)', () => {
    const shadows = [...css.matchAll(/^\s*--shadow-[a-z-]+:/gm)]

    assert.equal(shadows.length, 1, 'more than one shadow level is declared')
    assert.ok(css.includes('--sc-shadow-overlay: rgba(23, 26, 24, 0.12);'))
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

  it('uses only sizes on the DESIGN.md scale', () => {
    const allowed = new Set([14, 16, 20, 24, 32, 48])

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
   * fails, so the stylesheet may not be linked and the page styles itself
   * inline with literal hex values. That is the only correct way to write
   * it, and the one place a colour can drift from the palette unnoticed —
   * hence this check.
   *
   * ────────────────────────────────────────────────────────────────────────
   * THE PENDING MIGRATION, PINNED
   *
   * The file sits outside the SC-005 branch's ownership, so it still carries
   * the PREVIOUS palette's values. Rather than either editing a file this
   * branch may not touch or dropping the check, each old value is listed
   * here with the token that replaces it, and the test holds three lines:
   *
   *   1. every hex in the file is a current palette value OR a listed legacy
   *      value — an invented colour still fails;
   *   2. every listed legacy value is still in the file — the moment the
   *      file is migrated, a stale entry fails and must be deleted, so this
   *      list can only shrink;
   *   3. the text pairs the file actually draws still reach AA.
   *
   * The exact replacement is in the SC-005 PR description.
   */
  const LEGACY_GLOBAL_ERROR_VALUES: Readonly<Record<string, ColourToken>> = {
    '#1a2e1f': 'ink',
    '#5bc894': 'brand',
    '#6d8775': 'border-strong',
    '#dde8e0': 'border-subtle',
    '#4a5f50': 'ink-muted',
    '#27714e': 'brand-text',
  }

  const hexes = [...globalError.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) =>
    match[0].toLowerCase(),
  )

  it('contains some hex literals, or this test is vacuous', () => {
    assert.ok(
      hexes.length >= 4,
      `found only ${String(hexes.length)} hex literals`,
    )
  })

  it('uses only light-palette values or a pinned legacy value', () => {
    const allowed = new Set([
      ...Object.values(PALETTE.light).map((value) => value.toLowerCase()),
      ...Object.keys(LEGACY_GLOBAL_ERROR_VALUES),
    ])

    for (const hex of hexes) {
      assert.ok(
        allowed.has(hex),
        `${hex} in global-error.tsx is neither a light-theme palette value nor a pinned legacy value`,
      )
    }
  })

  it('still contains every pinned legacy value, so the list only shrinks', () => {
    for (const [legacy, token] of Object.entries(LEGACY_GLOBAL_ERROR_VALUES)) {
      assert.ok(
        hexes.includes(legacy),
        `${legacy} is no longer in global-error.tsx (migrated to ${token}?) — ` +
          'remove it from LEGACY_GLOBAL_ERROR_VALUES',
      )
    }
  })

  it('draws only text pairs that reach AA', () => {
    // The pairs the file renders: body text, the retry button, the muted
    // furniture line and the help-line link, each on its background.
    const pairs: readonly [string, string][] = [
      ['#1a2e1f', '#ffffff'],
      ['#1a2e1f', '#5bc894'],
      ['#4a5f50', '#ffffff'],
      ['#27714e', '#ffffff'],
    ]

    for (const [fg, bg] of pairs) {
      if (!hexes.includes(fg) || !hexes.includes(bg)) continue

      assert.ok(meetsAA(fg, bg), `${fg} on ${bg} is ${String(ratio(fg, bg))}:1`)
    }
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
