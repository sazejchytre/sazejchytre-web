/**
 * The palette, as data. SC-005, second proposal for D-005.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE DIRECTION
 *
 * The first proposal (an editorial "results desk": off-white canvas, white
 * data sheets, hairlines everywhere, a monospace-heavy dashboard beside the
 * hero) was rejected by the owner. This one is a classic, conventional sports
 * analysis website with a distinct brand:
 *
 *   - a deep "pitch at night" green (`surface-brand`) for the hero and the
 *     closing band, with white type on it;
 *   - one fresh mint (`signal`) for the main action on that green;
 *   - a plain white (light) / near-black green (dark) page, sections
 *     separated by a soft band (`surface-accent`) and space, not by borders;
 *   - a confident type scale (H1 56px) and slightly softer corners.
 *
 * Both themes are first-class and follow the system setting.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHERE THIS DEPARTS FROM docs/DESIGN.md
 *
 * `docs/DESIGN.md` still describes the first proposal, and only Cowork edits
 * it. Every value that now differs from it is listed in `DESIGN_MD_DEPARTURES`
 * with the reason, and `contrast.test.ts` reads DESIGN.md and fails on any
 * difference that is NOT listed — and on any listed departure that no longer
 * departs, so the list empties itself once the document is updated.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THE NAMES ARE THE CODEBASE'S
 *
 * Pages outside this branch write `bg-surface-page`, `text-brand-text`,
 * `border-border-subtle` today. The names stay; the values move.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE RULES ARE A CROSS PRODUCT, NOT A LIST OF PAIRS
 *
 * Foregrounds declare which surfaces they may appear on and the test
 * multiplies that out across both themes, so a shade change is checked
 * everywhere it can land. Filled controls (a button, a band) bind one
 * foreground to one fill.
 */

export type ThemeMode = 'light' | 'dark'

/** Every semantic colour token, by mode. */
export const PALETTE = {
  light: {
    /** The page. Plain white: the simplest possible canvas. */
    'surface-page': '#ffffff',
    /** Panels, inputs, tables. Same white; separated by a hairline. */
    'surface-raised': '#ffffff',
    /** The soft band that separates sections without a border. */
    'surface-accent': '#f1f5f2',
    /** The deep brand green of the hero and closing bands. */
    'surface-brand': '#0c3a29',
    /** Hairlines. Decorative only — 1.27:1 on white, never a control edge. */
    'border-subtle': '#e1e7e3',
    /** Control borders: 3.93 / 3.93 / 3.57 on page / raised / accent. */
    'border-strong': '#78837d',
    ink: '#13201a',
    /** 6.39 on white, 5.81 on the band: AA at every size. */
    'ink-muted': '#55625b',
    /** Text on `brand` (the primary button). White on the light-mode green. */
    'ink-on-brand': '#ffffff',
    /** Text on the brand band. */
    'ink-on-surface-brand': '#ffffff',
    /** Secondary text on the brand band: 7.94:1. */
    'ink-muted-on-surface-brand': '#b7d3c4',
    /** Text on a FILLED result badge; flips with the theme. */
    'ink-on-result': '#ffffff',
    /** The primary action on a light surface: a confident green fill. */
    brand: '#14683f',
    'brand-strong': '#0e5232',
    /** Links and the focus ring on light surfaces. */
    'brand-text': '#14683f',
    /** The main action ON the brand band, and its focus ring there. */
    signal: '#74e4a8',
    'ink-on-signal': '#072419',
    'result-win': '#14794a',
    'result-loss': '#b42318',
    /** Void: nothing happened. Neutral, the muted ink. */
    'result-void': '#55625b',
    /** Unsettled, and the "attention" badge. */
    'result-pending': '#87681d',
    /** `::selection`. Ink only. */
    highlight: '#cfeadb',
  },
  dark: {
    'surface-page': '#0b110e',
    'surface-raised': '#121a16',
    'surface-accent': '#0f1813',
    /** Lighter than the page on purpose (1.62:1), so the band still reads. */
    'surface-brand': '#143f2f',
    'border-subtle': '#25312b',
    'border-strong': '#6e7b74',
    ink: '#e7eee9',
    'ink-muted': '#a0aea6',
    /** Dark: in dark mode the primary fill is the light mint-green. */
    'ink-on-brand': '#062014',
    'ink-on-surface-brand': '#ffffff',
    'ink-muted-on-surface-brand': '#a8c9b7',
    'ink-on-result': '#0b110e',
    brand: '#5fd99a',
    'brand-strong': '#80e4b1',
    'brand-text': '#6ee0a4',
    signal: '#74e4a8',
    'ink-on-signal': '#072419',
    'result-win': '#5cca8d',
    'result-loss': '#ff8f80',
    'result-void': '#a0aea6',
    'result-pending': '#d8b45d',
    highlight: '#23493a',
  },
} as const satisfies Record<ThemeMode, Record<string, string>>

export type ColourToken = keyof (typeof PALETTE)['light']

/**
 * The DESIGN.md token table, mapped onto the code's names.
 *
 * `contrast.test.ts` parses the table and compares each value with the light
 * value of the token named here; a difference must be a listed departure.
 */
export const DESIGN_SPEC_TOKENS = {
  bg: 'surface-page',
  surface: 'surface-raised',
  ink: 'ink',
  'ink-muted': 'ink-muted',
  border: 'border-subtle',
  accent: 'brand',
  win: 'result-win',
  loss: 'result-loss',
  pending: 'result-pending',
} as const satisfies Record<string, ColourToken>

/**
 * Every value that departs from `docs/DESIGN.md` (the rejected first
 * proposal), with its reason. Proposed for D-005; Cowork updates the document
 * once the owner approves, and the test then requires each entry's removal.
 *
 * `spec` is the DESIGN.md name (a token from its table, a type role from its
 * "sizes" row, or `radius`).
 */
export const DESIGN_MD_DEPARTURES: readonly {
  readonly spec: string
  readonly previous: string
  readonly proposed: string
  readonly why: string
}[] = [
  {
    spec: 'bg',
    previous: '#f8f9f6',
    proposed: '#ffffff',
    why: 'a plain white page is the simplest, most conventional canvas; sections are separated by the soft band instead',
  },
  {
    spec: 'ink',
    previous: '#171a18',
    proposed: '#13201a',
    why: 'ink tinted towards the brand green so type and brand read as one family',
  },
  {
    spec: 'ink-muted',
    previous: '#6b716e',
    proposed: '#55625b',
    why: 'darker secondary text: 6.39:1 instead of 4.72:1, comfortable rather than borderline',
  },
  {
    spec: 'border',
    previous: '#dfe3df',
    proposed: '#e1e7e3',
    why: 'hairline tinted to the new ink; still decorative only',
  },
  {
    spec: 'accent',
    previous: '#236344',
    proposed: '#14683f',
    why: 'a clearer, more saturated brand green for the primary action (6.81:1 with white)',
  },
  {
    spec: 'win',
    previous: '#18794e',
    proposed: '#14794a',
    why: 'aligned to the brand green hue; 5.44:1 on white',
  },
  {
    spec: 'pending',
    previous: '#8c6d28',
    proposed: '#87681d',
    why: 'slightly darker so it also passes on the soft band (4.74:1)',
  },
  {
    spec: 'H1',
    previous: '48/56',
    proposed: '56/64',
    why: 'a strong, simple hero needs a larger headline',
  },
  {
    spec: 'mobile H1',
    previous: '32/40',
    proposed: '36/44',
    why: 'the same hero weight on a phone, still two lines for the tagline at 390px',
  },
  {
    spec: 'H2',
    previous: '32/40',
    proposed: '36/44',
    why: 'section headings that announce one idea per section',
  },
  {
    spec: 'radius',
    previous: '6px',
    proposed: '8px controls, 12px panels',
    why: 'slightly softer, friendlier corners for a conventional consumer site; still no pills, no 16px+ containers',
  },
]

/* -------------------------------------------------------------------------- */
/* Surfaces                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Every ordinary background a foreground can land on.
 *
 * `surface-brand` is not here: it is a FILLED band with its own foregrounds
 * (`ink-on-surface-brand`, `ink-muted-on-surface-brand`, `signal`), bound in
 * `FILLED_PAIRS`. Ordinary ink and the light-mode `brand-text` do not reach
 * AA on it, and the pairs that must never meet are pinned in FORBIDDEN_PAIRS.
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

/** Which surfaces each foreground may be used on, and at what threshold. */
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
    note: 'control borders — inputs, selects, checkboxes, outlined buttons',
  },
  {
    fg: 'brand-text',
    on: SURFACE_TOKENS,
    level: 'non-text',
    note: 'the focus ring, which can appear over any ordinary surface',
  },

  /* --- Result tones ------------------------------------------------------
     Not on surface-accent, by policy: see EXCLUDED_PLACEMENTS. The result
     components carry their own background.
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
  {
    fg: 'result-pending',
    on: ['surface-page', 'surface-raised'],
    level: 'normal',
    note: 'an unsettled result, and the attention badge',
  },
]

/**
 * Filled controls and bands: a foreground bound to one specific fill.
 *
 * `level` is `normal` for text and `non-text` for the focus ring.
 */
export const FILLED_PAIRS: readonly {
  readonly fg: ColourToken
  readonly bg: ColourToken
  readonly level: ContrastLevelName
  readonly note: string
}[] = [
  {
    fg: 'ink-on-brand',
    bg: 'brand',
    level: 'normal',
    note: 'the primary button, the skip link, the brand badge',
  },
  {
    fg: 'ink-on-brand',
    bg: 'brand-strong',
    level: 'normal',
    note: 'the primary button, hovered or pressed',
  },
  {
    fg: 'ink-on-signal',
    bg: 'signal',
    level: 'normal',
    note: 'the main action on the brand band (the `accent` button)',
  },
  /* --- The brand band ---------------------------------------------------- */
  {
    fg: 'ink-on-surface-brand',
    bg: 'surface-brand',
    level: 'normal',
    note: 'headlines and text on the hero and closing bands',
  },
  {
    fg: 'ink-muted-on-surface-brand',
    bg: 'surface-brand',
    level: 'normal',
    note: 'secondary text on the bands',
  },
  {
    fg: 'signal',
    bg: 'surface-brand',
    level: 'non-text',
    note: 'the focus ring and the outline of a secondary action on the bands',
  },
  { fg: 'ink', bg: 'highlight', level: 'normal', note: 'selected text' },
  /* --- Filled result badges --------------------------------------------- */
  {
    fg: 'ink-on-result',
    bg: 'result-win',
    level: 'normal',
    note: 'a filled won badge',
  },
  {
    fg: 'ink-on-result',
    bg: 'result-loss',
    level: 'normal',
    note: 'a filled lost badge',
  },
  {
    fg: 'ink-on-result',
    bg: 'result-void',
    level: 'normal',
    note: 'a filled void badge',
  },
  {
    fg: 'ink-on-result',
    bg: 'result-pending',
    level: 'normal',
    note: 'a filled pending badge',
  },
]

/**
 * Placements that are deliberately NOT allowed, with the measurement.
 *
 * Both pass today, by a margin under 0.5 — luck rather than margin — so the
 * rule stays "result tones never sit on the accent band".
 */
export const EXCLUDED_PLACEMENTS: readonly {
  readonly fg: ColourToken
  readonly bg: SurfaceToken
  readonly level: ContrastLevelName
  readonly basis: 'fails' | 'policy'
  readonly why: string
  readonly prevention: string
}[] = [
  {
    fg: 'result-pending',
    bg: 'surface-accent',
    level: 'normal',
    basis: 'policy',
    why: 'measures 4.74:1 in light mode: a pass by 0.24',
    prevention:
      'ResultIndicator and Badge set bg-surface-raised on themselves, so a result tone never inherits the band',
  },
  {
    fg: 'result-win',
    bg: 'surface-accent',
    level: 'normal',
    basis: 'policy',
    why: 'measures 4.94:1 in light mode: a pass by 0.44',
    prevention: 'same — the result components carry their own background',
  },
]

/**
 * Pairs that must NOT be used, asserted to fail in light mode.
 */
export const FORBIDDEN_PAIRS: readonly {
  readonly fg: string
  readonly bg: ColourToken
  readonly level: ContrastLevelName
  readonly why: string
}[] = [
  {
    fg: '#13201a',
    bg: 'brand',
    level: 'normal',
    why: 'ink on the light-mode brand green is 2.47:1 — its text is white',
  },
  {
    fg: '#14683f',
    bg: 'surface-brand',
    level: 'non-text',
    why: 'the ordinary focus ring disappears on the brand band (1.86:1) — use signal there',
  },
  {
    fg: '#13201a',
    bg: 'surface-brand',
    level: 'normal',
    why: 'ordinary ink on the brand band is unreadable — use ink-on-surface-brand',
  },
  {
    fg: '#e1e7e3',
    bg: 'surface-raised',
    level: 'non-text',
    why: 'the hairline is 1.27:1 on white: decorative only, never a control border',
  },
  {
    fg: '#e1e7e3',
    bg: 'surface-accent',
    level: 'non-text',
    why: 'the hairline is 1.16:1 on the band: decorative only',
  },
]

/* -------------------------------------------------------------------------- */
/* Type scale                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The sizes the scale may use, in px. One list, so a stray 17px is a failure.
 */
export const TYPE_SIZES = [14, 16, 18, 20, 28, 32, 36, 40, 56] as const

/**
 * The type styles. `size` / `lineHeight` are the MOBILE values (below 768px)
 * and decide the WCAG large-text question; stepped styles carry `desktop`.
 *
 *   display-xl  H1        36/44 → 56/64   700
 *   display-lg  H2        28/36 → 36/44   700
 *   heading     H3        20/28           600
 *   lead        intro     18/28 → 20/30   400
 *   body                  16/26           400
 *   body-sm     small     14/20           400
 *   label                 14/20           500
 *   data-xl     figures   32/40 → 40/48   700, tabular
 *   data        numbers   16/24           500, mono
 *   data-sm     table     14/20           500, mono
 */
export const TYPE_SCALE = {
  'display-xl': {
    size: 36,
    lineHeight: 44,
    desktop: { size: 56, lineHeight: 64 },
    weight: 700,
    tabular: false,
    mono: false,
  },
  'display-lg': {
    size: 28,
    lineHeight: 36,
    desktop: { size: 36, lineHeight: 44 },
    weight: 700,
    tabular: false,
    mono: false,
  },
  heading: {
    size: 20,
    lineHeight: 28,
    desktop: null,
    weight: 600,
    tabular: false,
    mono: false,
  },
  lead: {
    size: 18,
    lineHeight: 28,
    desktop: { size: 20, lineHeight: 30 },
    weight: 400,
    tabular: false,
    mono: false,
  },
  body: {
    size: 16,
    lineHeight: 26,
    desktop: null,
    weight: 400,
    tabular: false,
    mono: false,
  },
  'body-sm': {
    size: 14,
    lineHeight: 20,
    desktop: null,
    weight: 400,
    tabular: false,
    mono: false,
  },
  label: {
    size: 14,
    lineHeight: 20,
    desktop: null,
    weight: 500,
    tabular: false,
    mono: false,
  },
  'data-xl': {
    size: 32,
    lineHeight: 40,
    desktop: { size: 40, lineHeight: 48 },
    weight: 700,
    tabular: true,
    mono: false,
  },
  data: {
    size: 16,
    lineHeight: 24,
    desktop: null,
    weight: 500,
    tabular: true,
    mono: true,
  },
  'data-sm': {
    size: 14,
    lineHeight: 20,
    desktop: null,
    weight: 500,
    tabular: true,
    mono: true,
  },
} as const satisfies Record<
  string,
  {
    size: number
    lineHeight: number
    desktop: { size: number; lineHeight: number } | null
    weight: number
    tabular: boolean
    mono: boolean
  }
>

export type TypeToken = keyof typeof TYPE_SCALE

/** Styles at or above 24px on every screen, which WCAG lets reach 3:1. */
export const LARGE_TEXT_TOKENS: readonly TypeToken[] = [
  'display-xl',
  'display-lg',
  'data-xl',
]

/** The breakpoint at which the stepped styles switch to `desktop`. */
export const TYPE_STEP_MIN_WIDTH_REM = 48

/* -------------------------------------------------------------------------- */
/* Geometry                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Radii, named by purpose. Controls 8px, panels 12px, small chips 6px.
 * Nothing below 6px exists as a token, and nothing reaches pill or 16px+.
 * `pill` survives as a NAME only (callers outside this branch use it on the
 * 18+ marker and a filter toggle); it is a 6px chip.
 */
export const RADII = {
  input: 8,
  badge: 6,
  button: 8,
  card: 12,
  modal: 12,
  pill: 6,
} as const

export const LAYOUT = {
  /** Content width, and the measure for long reading. */
  contentMax: 1200,
  readingMax: 720,
  columns: 12,
  gutterDesktop: 24,
  gutterMobile: 16,
  /** Page margins: <640, ≥640, ≥1024. */
  pageMarginMobile: 20,
  pageMarginTablet: 32,
  pageMarginDesktop: 40,
  /** Sticky header height: 64px desktop, 56px mobile (rule 95). */
  headerDesktop: 64,
  headerMobile: 56,
  minTouchTarget: 44,
} as const
