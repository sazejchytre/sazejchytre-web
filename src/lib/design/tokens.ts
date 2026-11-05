/**
 * The palette, as data.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THE COLOURS EXIST TWICE
 *
 * The authority is `globals.css`: that is what the browser reads, and a page
 * cannot get its colours from here. This file is the same values in a form a
 * test can check, which buys the one thing CSS cannot — a build failure when
 * someone nudges a green and drops body text under 4.5:1.
 *
 * Two copies can drift, and that would be worse than one unchecked copy. So
 * `contrast.test.ts` reads `globals.css` off disk and asserts that every
 * value here appears in it. Drift is therefore a failing test, not a
 * discovery made months later by a user who cannot read the page.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE RULES ARE A CROSS PRODUCT, NOT A LIST OF PAIRS
 *
 * This started as an explicit list of the pairs the design puts on screen,
 * and that list had a hole in it: `border-strong` was checked against white,
 * passed at 3.06:1, and was wrong on the other two surfaces — 2.94:1 on
 * `surface-raised` and 2.45:1 on `surface-accent`. The list was the bug. A
 * colour had been verified against one background and declared fine.
 *
 * So foregrounds now declare WHICH SURFACES THEY MAY APPEAR ON, and the test
 * multiplies that out. Adding a surface, or changing a shade, is then checked
 * everywhere it can possibly land rather than everywhere somebody remembered
 * to write down.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE RULE THAT IS EASIEST TO BREAK
 *
 * `brand` (#5bc894) and `accent` (#ffd93d) are SURFACE colours. White text on
 * them measures 2.07:1 and 1.38:1 — both far below AA, and both the first
 * thing a designer reaches for. Text on those surfaces is always
 * `ink-on-brand` / `ink-on-accent`, which are dark.
 *
 * `brand` is also never text on a page background: #5bc894 on white is
 * 2.07:1. The green you may WRITE with is `brand-text`. The test enforces
 * both halves of this.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THAT RULE IS SCOPED TO `brand` AND `accent`, AND NOWHERE ELSE
 *
 * White on a solid RESULT fill is fine and is used: in light mode it measures
 * 5.33:1 on win, 7.30:1 on loss, 5.63:1 on void. A blanket "never white on a
 * fill" would ban a badge that is perfectly legible.
 *
 * But it cannot be written as literal white either, because the dark-theme
 * result values are LIGHT colours — they are foregrounds meant for a dark
 * surface. Fill a badge with them and write white on it and you get 1.77:1 on
 * win, 2.58:1 on loss, 2.32:1 on void. Dark ink on those same fills measures
 * 8.17 / 5.59 / 6.22.
 *
 * So a filled result badge uses `ink-on-result`, which is white in light mode
 * and dark in dark mode — exactly the same arrangement as `ink-on-brand`. The
 * component names the token and the theme decides the colour, which is the
 * only version of this that is correct in both.
 */

export type ThemeMode = 'light' | 'dark'

/** Every semantic colour token, by mode. */
export const PALETTE = {
  light: {
    'surface-page': '#ffffff',
    'surface-raised': '#f8fbf7',
    'surface-accent': '#c5f0d8',
    'border-subtle': '#dde8e0',
    /**
     * Control borders. Reaches 3:1 on ALL THREE surfaces — see the note about
     * the cross product above, and the value this replaced.
     */
    'border-strong': '#6d8775',
    ink: '#1a2e1f',
    'ink-muted': '#4a5f50',
    'ink-on-brand': '#1a2e1f',
    'ink-on-accent': '#1a2e1f',
    /**
     * Text on a FILLED result badge. White here, dark in dark mode.
     *
     * Not a literal `#ffffff` at the call site: white is correct on these
     * fills in light mode only. See the note above.
     */
    'ink-on-result': '#ffffff',
    brand: '#5bc894',
    'brand-text': '#27714e',
    accent: '#ffd93d',
    'result-win': '#1e7a4c',
    'result-loss': '#9e2f1c',
    'result-void': '#5c6b60',
  },
  dark: {
    'surface-page': '#0f1711',
    'surface-raised': '#1a2e1f',
    'surface-accent': '#22402c',
    'border-subtle': '#2c4634',
    'border-strong': '#71927b',
    ink: '#f2f8f3',
    'ink-muted': '#a8bfaf',
    'ink-on-brand': '#1a2e1f',
    'ink-on-accent': '#1a2e1f',
    // Dark, because the dark-theme result values are light colours.
    'ink-on-result': '#1a2e1f',
    brand: '#5bc894',
    'brand-text': '#7fd9ac',
    accent: '#ffd93d',
    'result-win': '#6ed79f',
    'result-loss': '#ee8468',
    'result-void': '#9bafa1',
  },
} as const satisfies Record<ThemeMode, Record<string, string>>

export type ColourToken = keyof (typeof PALETTE)['light']

/* -------------------------------------------------------------------------- */
/* Surfaces                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Every background a foreground can land on.
 *
 * `brand` and `accent` are surfaces too, but they are FILLED controls with
 * exactly one legal foreground each, so they are handled by `FILLED_PAIRS`
 * rather than by the cross product. `border-subtle` is never a background.
 */
export const SURFACE_TOKENS = [
  'surface-page',
  'surface-raised',
  'surface-accent',
] as const

export type SurfaceToken = (typeof SURFACE_TOKENS)[number]

export type ContrastLevelName = 'normal' | 'large' | 'non-text'

/* -------------------------------------------------------------------------- */
/* Foreground rules                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Which surfaces each foreground may be used on, and at what threshold.
 *
 * The test multiplies these out across both themes. A foreground listed
 * against `SURFACE_TOKENS` must work on every one of them — that is the
 * generalisation that would have caught the old `border-strong`.
 */
export const FOREGROUND_RULES: readonly {
  readonly fg: ColourToken
  readonly on: readonly SurfaceToken[]
  readonly level: ContrastLevelName
  readonly note: string
}[] = [
  /* --- Text, on every surface ------------------------------------------- */
  { fg: 'ink', on: SURFACE_TOKENS, level: 'normal', note: 'body text' },
  {
    fg: 'ink-muted',
    on: SURFACE_TOKENS,
    level: 'normal',
    note: 'secondary text',
  },
  {
    fg: 'brand-text',
    on: SURFACE_TOKENS,
    level: 'normal',
    note: 'links and emphasis',
  },

  /* --- Non-text, on every surface --------------------------------------- */
  {
    fg: 'border-strong',
    on: SURFACE_TOKENS,
    level: 'non-text',
    note: 'control borders — inputs, selects, checkboxes',
  },
  {
    fg: 'brand-text',
    on: SURFACE_TOKENS,
    level: 'non-text',
    note: 'the focus ring, which can appear over any surface',
  },

  /* --- Result tones ------------------------------------------------------
     NOT on surface-accent. See EXCLUDED_PLACEMENTS for the measurements and
     for why the component cannot produce that combination.
     ---------------------------------------------------------------------- */
  {
    fg: 'result-win',
    on: ['surface-page', 'surface-raised'],
    level: 'normal',
    note: 'a won result',
  },
  {
    fg: 'result-loss',
    on: ['surface-page', 'surface-raised'],
    level: 'normal',
    note: 'a lost result',
  },
  {
    fg: 'result-void',
    on: ['surface-page', 'surface-raised'],
    level: 'normal',
    note: 'a void result',
  },
]

/**
 * Filled controls: a foreground bound to one specific background.
 *
 * Not part of the cross product because the binding is the point. There is
 * exactly one legal foreground for each of these fills, and the whole reason
 * they are separate tokens is so that a component cannot reach for white.
 */
export const FILLED_PAIRS: readonly {
  readonly fg: ColourToken
  readonly bg: ColourToken
  readonly note: string
}[] = [
  {
    fg: 'ink-on-brand',
    bg: 'brand',
    note: 'the primary button and the brand badge',
  },
  {
    fg: 'ink-on-accent',
    bg: 'accent',
    note: 'the accent button and the recommended badge',
  },
  /* --- Filled result badges ---------------------------------------------
     White in light mode, dark in dark mode, via one token. The outlined
     result treatment in `FOREGROUND_RULES` is the other option; both are
     legal and the badge chooses.
     --------------------------------------------------------------------- */
  {
    fg: 'ink-on-result',
    bg: 'result-win',
    note: 'a filled won badge',
  },
  {
    fg: 'ink-on-result',
    bg: 'result-loss',
    note: 'a filled lost badge',
  },
  {
    fg: 'ink-on-result',
    bg: 'result-void',
    note: 'a filled void badge',
  },
]

/**
 * Placements that are deliberately NOT allowed, with the measurement.
 *
 * Pinned rather than merely omitted. An absence from `FOREGROUND_RULES` says
 * nothing about whether the combination was considered; this says it was,
 * gives the number, and names the thing that stops it happening. If a palette
 * change ever made one of these pass, the test fails and somebody has to come
 * here and allow it on purpose.
 */
export const EXCLUDED_PLACEMENTS: readonly {
  readonly fg: ColourToken
  readonly bg: SurfaceToken
  readonly level: ContrastLevelName
  /**
   * Why it is excluded, and the two are not the same thing.
   *
   * `fails` — it measures under the threshold. The test asserts that, so a
   * palette change that fixed it would show up as a failing test rather than
   * as a restriction nobody could justify any more.
   *
   * `policy` — it PASSES, and is still not allowed. `result-void` on
   * `surface-accent` is 4.52:1 in light, which clears 4.5 by two hundredths:
   * that is luck, not margin. One rule about where result tones may go is
   * worth more than a per-placement list that happens to have a gap in it,
   * so the near-miss is excluded with the two real failures.
   */
  readonly basis: 'fails' | 'policy'
  readonly why: string
  readonly prevention: string
}[] = [
  {
    fg: 'result-win',
    bg: 'surface-accent',
    level: 'normal',
    basis: 'fails',
    why: 'measures 4.27:1 in light mode, under the 4.5:1 floor for body text',
    prevention:
      'ResultIndicator sets bg-surface-page on itself, so it never inherits an accent background',
  },
  {
    fg: 'result-loss',
    bg: 'surface-accent',
    level: 'normal',
    basis: 'fails',
    why: 'measures 4.43:1 in dark mode, under the 4.5:1 floor',
    prevention: 'same — ResultIndicator carries its own background',
  },
  {
    fg: 'result-void',
    bg: 'surface-accent',
    level: 'normal',
    basis: 'policy',
    why:
      'measures 4.52:1 light and 4.92:1 dark. It PASSES — by two hundredths ' +
      'in light, which is luck rather than margin. Excluded with the other ' +
      'two so that the restriction is one rule about where result tones go, ' +
      'not a per-placement exception list that happens to have a gap',
    prevention:
      'ResultIndicator carries its own background, so no result tone ever ' +
      'inherits an accent surface',
  },
]

/**
 * Pairs that must NOT be used, asserted to fail.
 *
 * A test that only checks the good pairs cannot stop anyone adding a bad one.
 * These are the specific mistakes the palette invites, pinned so that if a
 * future change ever made white-on-brand legal, somebody would have to come
 * here and say so deliberately.
 */
export const FORBIDDEN_PAIRS: readonly {
  readonly fg: string
  readonly bg: ColourToken
  readonly why: string
}[] = [
  {
    fg: '#ffffff',
    bg: 'brand',
    why: 'white on the brand green measures about 2.07:1',
  },
  {
    fg: '#ffffff',
    bg: 'accent',
    why: 'white on the accent yellow measures about 1.38:1',
  },
  {
    fg: '#5bc894',
    bg: 'surface-page',
    why: 'brand is a surface colour; write with brand-text instead',
  },
]

/* -------------------------------------------------------------------------- */
/* Type scale                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The type styles, with the numeric ones marked.
 *
 * `tabular` is not cosmetic. Odds, money, dates and percentages sit in
 * columns, and proportional digits make a column of numbers ragged enough
 * that comparing two rows means reading rather than glancing — which is the
 * entire job of the track record page.
 */
export const TYPE_SCALE = {
  'display-xl': { size: 56, lineHeight: 60, weight: 700, tabular: false },
  'display-lg': { size: 36, lineHeight: 40, weight: 700, tabular: false },
  heading: { size: 22, lineHeight: 28, weight: 600, tabular: false },
  body: { size: 16, lineHeight: 24, weight: 400, tabular: false },
  'body-sm': { size: 14, lineHeight: 20, weight: 400, tabular: false },
  label: { size: 12, lineHeight: 16, weight: 600, tabular: false },
  'data-xl': { size: 32, lineHeight: 36, weight: 600, tabular: true },
  data: { size: 16, lineHeight: 20, weight: 500, tabular: true },
  'data-sm': { size: 13, lineHeight: 18, weight: 500, tabular: true },
} as const satisfies Record<
  string,
  { size: number; lineHeight: number; weight: number; tabular: boolean }
>

export type TypeToken = keyof typeof TYPE_SCALE

/** Styles at or above 24px, which WCAG lets reach 3:1 instead of 4.5:1. */
export const LARGE_TEXT_TOKENS: readonly TypeToken[] = [
  'display-xl',
  'display-lg',
  'data-xl',
]

/* -------------------------------------------------------------------------- */
/* Geometry                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Radii, named by what they are for.
 *
 * Named rather than t-shirt-sized so that "nothing below 6px" is enforceable
 * by the absence of a token rather than by a rule in a document. There is no
 * `radius-sm`, so nobody can reach for 2px.
 */
export const RADII = {
  input: 6,
  badge: 6,
  button: 8,
  card: 16,
  modal: 24,
  pill: 999,
} as const

export const LAYOUT = {
  /** Container max width. */
  containerMax: 1280,
  columns: 12,
  gutter: 24,
  /** Page margins, by breakpoint. */
  pageMarginDesktop: 64,
  pageMarginTablet: 48,
  pageMarginMobile: 24,
  /** The smallest a tappable thing may be, in px. */
  minTouchTarget: 44,
} as const
