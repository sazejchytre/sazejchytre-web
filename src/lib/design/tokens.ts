/**
 * The palette, as data.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHERE THE VALUES COME FROM
 *
 * `docs/DESIGN.md` is the specification ("results desk": calm off-white page,
 * white panels for data, near-black ink, one restrained green). Its token
 * table names nine colours. This file carries those nine under the names the
 * codebase already uses, plus the handful a real interface needs that the
 * table does not list (a control border, filled-control foregrounds, a hover
 * shade, a void tone, a selection highlight).
 *
 * The names are NOT renamed to the DESIGN.md ones, deliberately: pages that
 * this branch does not own (`src/components/layout/*`, the history, the tip
 * detail) write `bg-surface-page`, `text-brand-text`, `border-border-subtle`
 * today. Renaming would leave every one of those classes generating nothing.
 * So the mapping is declared once, in `DESIGN_SPEC_TOKENS` below, and
 * `contrast.test.ts` reads the DESIGN.md table off disk and checks every
 * value against it. The spec, this file and `globals.css` cannot drift apart
 * without a failing test.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THE COLOURS EXIST TWICE
 *
 * The authority at runtime is `globals.css`: that is what the browser reads.
 * This file is the same values in a form a test can check, which buys the one
 * thing CSS cannot — a build failure when someone nudges a green and drops
 * text under 4.5:1. `contrast.test.ts` asserts that every value here is
 * declared, under its own name, in `globals.css`.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE RULES ARE A CROSS PRODUCT, NOT A LIST OF PAIRS
 *
 * Foregrounds declare WHICH SURFACES THEY MAY APPEAR ON, and the test
 * multiplies that out across both themes. That is what caught the old
 * `border-strong`, which had been checked against one background and was
 * wrong on the other two. Changing a shade is checked everywhere it can
 * land, not everywhere somebody remembered to write down.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT CHANGED IN THE SC-005 PALETTE, IN ONE PARAGRAPH
 *
 * The brand green is now a dark, ink-like #236344 instead of the light
 * #5bc894. That flips the old contrast rule: white on the brand fill is now
 * the CORRECT pair (7.14:1) and dark ink on it is the failing one (2.46:1).
 * `ink-on-brand` therefore turned white. The yellow `accent` surface is gone;
 * its one job, "attention", is carried by the `result-pending` ochre, which
 * reaches AA as text. And `surface-page` is now the off-white canvas with
 * `surface-raised` the white panel on top of it, rather than the other way
 * round.
 */

export type ThemeMode = 'light' | 'dark'

/** Every semantic colour token, by mode. */
export const PALETTE = {
  light: {
    /** DESIGN.md `bg`: the page canvas. */
    'surface-page': '#f8f9f6',
    /** DESIGN.md `surface`: tables, panels, inputs. */
    'surface-raised': '#ffffff',
    /**
     * A barely-green panel for callouts. Kept light enough that `ink-muted`
     * still reaches AA on it (4.60:1) — muted text sits inside callouts on
     * pages this branch does not own.
     */
    'surface-accent': '#f2f7f3',
    /** DESIGN.md `border`: hairlines only. 1.30:1 — never a control edge. */
    'border-subtle': '#dfe3df',
    /** Control borders: 4.26 / 4.04 / 3.93 on raised / page / accent. */
    'border-strong': '#767c78',
    /** DESIGN.md `ink`. */
    ink: '#171a18',
    /** DESIGN.md `ink-muted`. 4.99 / 4.72 / 4.60 — AA at every size. */
    'ink-muted': '#6b716e',
    /** White: the brand fill is dark now. See the header. */
    'ink-on-brand': '#ffffff',
    /**
     * Text on a FILLED result badge. White here, dark in dark mode.
     *
     * Not a literal `#ffffff` at the call site: white is correct on these
     * fills in light mode only, because the dark-theme result values are
     * light colours meant for a dark surface.
     */
    'ink-on-result': '#ffffff',
    /** DESIGN.md `accent`: primary actions. A FILL. */
    brand: '#236344',
    /** Hover and pressed state of the brand fill. */
    'brand-strong': '#1a4b33',
    /** DESIGN.md `accent` as TEXT: links and the focus ring. */
    'brand-text': '#236344',
    /** DESIGN.md `win`. */
    'result-win': '#18794e',
    /** DESIGN.md `loss`. */
    'result-loss': '#b42318',
    /**
     * Void: the stake came back, nothing happened. Neutral on purpose, and the
     * same grey as `ink-muted` in light mode.
     */
    'result-void': '#6b716e',
    /** DESIGN.md `pending`: unsettled. Also the "attention" tone. */
    'result-pending': '#8c6d28',
    /** `::selection`. Ink is the only foreground it carries. */
    highlight: '#d3e6da',
  },
  dark: {
    'surface-page': '#111412',
    'surface-raised': '#191d1a',
    'surface-accent': '#17261d',
    'border-subtle': '#2a302c',
    'border-strong': '#737b76',
    ink: '#eceeea',
    'ink-muted': '#a1a8a3',
    // The fill stays the same dark green, so white stays the right ink.
    'ink-on-brand': '#ffffff',
    // Dark, because the dark result values are light colours.
    'ink-on-result': '#111412',
    brand: '#236344',
    'brand-strong': '#2b7853',
    'brand-text': '#6cc597',
    'result-win': '#5cc591',
    'result-loss': '#ff8f80',
    'result-void': '#a1a8a3',
    'result-pending': '#d6b264',
    highlight: '#28473a',
  },
} as const satisfies Record<ThemeMode, Record<string, string>>

export type ColourToken = keyof (typeof PALETTE)['light']

/**
 * The DESIGN.md token table, mapped onto the code's names.
 *
 * `contrast.test.ts` parses the table in `docs/DESIGN.md` and asserts that
 * each listed value equals the light value of the token named here. If the
 * spec changes a colour, the build fails until this file follows.
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

/* -------------------------------------------------------------------------- */
/* Surfaces                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Every background a foreground can land on.
 *
 * `brand`, the result fills and `highlight` are surfaces too, but they are
 * FILLED controls with exactly one legal foreground each, so they are handled
 * by `FILLED_PAIRS` rather than by the cross product. `border-subtle` is never
 * a background.
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
 * Every text token is checked at the NORMAL threshold (4.5:1) even where it
 * is usually set large, because a token cannot know its size at the call
 * site.
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
     Not on surface-accent: see EXCLUDED_PLACEMENTS. ResultIndicator and the
     result badges carry their own background, so they never inherit one.
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
 * Filled controls: a foreground bound to one specific background.
 *
 * Not part of the cross product because the binding is the point: there is
 * exactly one legal foreground for each fill.
 */
export const FILLED_PAIRS: readonly {
  readonly fg: ColourToken
  readonly bg: ColourToken
  readonly note: string
}[] = [
  {
    fg: 'ink-on-brand',
    bg: 'brand',
    note: 'the primary button, the skip link, the brand badge',
  },
  {
    fg: 'ink-on-brand',
    bg: 'brand-strong',
    note: 'the primary button, hovered or pressed',
  },
  {
    fg: 'surface-raised',
    bg: 'ink',
    note: 'the inverted (`accent`) button',
  },
  {
    fg: 'ink',
    bg: 'highlight',
    note: 'selected text',
  },
  /* --- Filled result badges ---------------------------------------------
     White in light mode, dark in dark mode, via one token.
     --------------------------------------------------------------------- */
  { fg: 'ink-on-result', bg: 'result-win', note: 'a filled won badge' },
  { fg: 'ink-on-result', bg: 'result-loss', note: 'a filled lost badge' },
  { fg: 'ink-on-result', bg: 'result-void', note: 'a filled void badge' },
  {
    fg: 'ink-on-result',
    bg: 'result-pending',
    note: 'a filled pending badge',
  },
]

/**
 * Placements that are deliberately NOT allowed, with the measurement.
 *
 * Pinned rather than merely omitted, so a palette change that made one of
 * them pass shows up as a test asking for a deliberate decision.
 */
export const EXCLUDED_PLACEMENTS: readonly {
  readonly fg: ColourToken
  readonly bg: SurfaceToken
  readonly level: ContrastLevelName
  /**
   * `fails` — it measures under the threshold in at least one theme.
   * `policy` — it passes, by too little to rely on, and is refused anyway so
   * that "result tones never sit on the accent surface" stays one rule.
   */
  readonly basis: 'fails' | 'policy'
  readonly why: string
  readonly prevention: string
}[] = [
  {
    fg: 'result-pending',
    bg: 'surface-accent',
    level: 'normal',
    basis: 'fails',
    why: 'measures 4.47:1 in light mode, under the 4.5:1 floor for text',
    prevention:
      'ResultIndicator and Badge set bg-surface-raised on themselves, so a result tone never inherits an accent background',
  },
  {
    fg: 'result-void',
    bg: 'surface-accent',
    level: 'normal',
    basis: 'policy',
    why:
      'measures 4.60:1 in light mode. It passes — by a tenth, which is luck ' +
      'rather than margin. Excluded so the restriction stays one rule about ' +
      'where result tones go rather than a per-placement exception list',
    prevention: 'same — the result components carry their own background',
  },
]

/**
 * Pairs that must NOT be used, asserted to fail in light mode.
 *
 * The specific mistakes this palette invites, pinned so that nobody can
 * "simplify" one of them back in without the suite saying so.
 */
export const FORBIDDEN_PAIRS: readonly {
  readonly fg: string
  readonly bg: ColourToken
  readonly level: ContrastLevelName
  readonly why: string
}[] = [
  {
    fg: '#171a18',
    bg: 'brand',
    level: 'normal',
    why: 'ink on the brand green measures 2.46:1 — the fill is dark now, so its text is white',
  },
  {
    fg: '#dfe3df',
    bg: 'surface-raised',
    level: 'non-text',
    why: 'the hairline is 1.30:1 on white: decorative only, never a control border',
  },
  {
    fg: '#dfe3df',
    bg: 'surface-page',
    level: 'non-text',
    why: 'the hairline is 1.23:1 on the page: decorative only, never a control border',
  },
]

/* -------------------------------------------------------------------------- */
/* Type scale                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The type styles, DESIGN.md's scale.
 *
 * `size` / `lineHeight` are the MOBILE values, which is what applies below
 * 768px and is therefore what decides the WCAG large-text question: a style
 * is only "large" if it is large on the smallest screen too. Styles that step
 * up on wider screens carry `desktop`.
 *
 *   display-xl  H1        32/40 → 48/56
 *   display-lg  H2        24/32 → 32/40
 *   heading     H3        20/28
 *   body                  16/26
 *   body-sm     small     14/20
 *   label                 14/20, medium — form labels, column heads
 *   data-xl     figures   24/32 → 32/40, tabular
 *   data        numbers   16/24, mono
 *   data-sm     table     14/20, mono
 *
 * `tabular` is not cosmetic: odds, money and dates sit in columns, and
 * proportional digits make a column ragged enough that comparing two rows
 * means reading rather than glancing. `mono` marks the styles set in Geist
 * Mono (DESIGN.md: odds, units, money, dates in tables).
 */
export const TYPE_SCALE = {
  'display-xl': {
    size: 32,
    lineHeight: 40,
    desktop: { size: 48, lineHeight: 56 },
    weight: 600,
    tabular: false,
    mono: false,
  },
  'display-lg': {
    size: 24,
    lineHeight: 32,
    desktop: { size: 32, lineHeight: 40 },
    weight: 600,
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
    size: 24,
    lineHeight: 32,
    desktop: { size: 32, lineHeight: 40 },
    weight: 600,
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
 * Radii, named by what they are for. DESIGN.md rule 44: 6px everywhere it
 * applies, no pills, no 16px+ rounded containers. Table rows have none, which
 * needs no token.
 *
 * Every name the codebase already uses is kept so that callers on other
 * branches keep rendering, and every one of them is now 6px. `pill` is the
 * odd one out by name: it survives only because four files this branch does
 * not own write `rounded-pill` on the 18+ marker and a filter toggle. They
 * become 6px chips, which is what rule 44 asks for; the name can go when
 * SC-006/SC-007 touch those files.
 */
export const RADII = {
  input: 6,
  badge: 6,
  button: 6,
  card: 6,
  modal: 6,
  pill: 6,
} as const

export const LAYOUT = {
  /** Content width. DESIGN.md: 1200px content, 720px for long reading. */
  contentMax: 1200,
  readingMax: 720,
  /** 12 columns; gutter 24px from 768px, 16px below. */
  columns: 12,
  gutterDesktop: 24,
  gutterMobile: 16,
  /** Page margins, by breakpoint: <640, ≥640, ≥1024. */
  pageMarginMobile: 16,
  pageMarginTablet: 24,
  pageMarginDesktop: 32,
  /** The smallest a primary tappable thing may be, in px. */
  minTouchTarget: 44,
} as const
