/**
 * WCAG contrast arithmetic, so colour decisions are checked rather than
 * asserted.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS IS IN THE REPOSITORY AND NOT A BROWSER EXTENSION
 *
 * Because the palette is in the repository, and a token can be changed by
 * someone who has no way to check what they have just broken. A one-line
 * nudge to a green — the kind that looks like a refinement — can drop body
 * text under 4.5:1, and nothing about the page will look wrong to the person
 * who made the change.
 *
 * `contrast.test.ts` runs every pair the design system actually uses through
 * this on every `pnpm test`. That turns accessibility from a review item into
 * a build failure, which is the only form of it that survives contact with a
 * deadline.
 *
 * The formulas are from WCAG 2.1 (relative luminance, §1.4.3). They are
 * simple enough to implement exactly, and a dependency for twelve lines of
 * arithmetic is a dependency to keep updated for no reason.
 */

/** A colour as 8-bit sRGB channels. */
export type Rgb = { r: number; g: number; b: number }

/**
 * Parse `#rgb` or `#rrggbb`.
 *
 * @throws {RangeError} for anything else. A silent fallback here would make a
 *   typo in a token read as pure black and pass most contrast checks, which
 *   is the worst possible way to fail.
 */
export const parseHex = (hex: string): Rgb => {
  const value = hex.trim().replace(/^#/, '')

  const expanded =
    value.length === 3
      ? value
          .split('')
          .map((char) => char + char)
          .join('')
      : value

  if (!/^[0-9a-f]{6}$/i.test(expanded)) {
    throw new RangeError(`Not a hex colour: ${JSON.stringify(hex)}`)
  }

  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  }
}

/**
 * One channel, linearised.
 *
 * sRGB is gamma-encoded, so the stored 0–255 value is not proportional to
 * emitted light. Averaging the encoded values — the obvious thing — gives
 * answers that are wrong by enough to pass a failing pair.
 */
const linearise = (channel: number): number => {
  const scaled = channel / 255

  return scaled <= 0.040_45
    ? scaled / 12.92
    : Math.pow((scaled + 0.055) / 1.055, 2.4)
}

/** Relative luminance, 0 (black) to 1 (white). WCAG 2.1 §1.4.3. */
export const relativeLuminance = ({ r, g, b }: Rgb): number =>
  0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b)

/**
 * Contrast ratio between two colours, 1 to 21.
 *
 * Order does not matter: the lighter colour always goes on top of the
 * fraction, which is what makes the result a property of the PAIR rather than
 * of which one you happened to call the foreground.
 */
export const contrastRatio = (
  foreground: string,
  background: string,
): number => {
  const a = relativeLuminance(parseHex(foreground))
  const b = relativeLuminance(parseHex(background))

  const lighter = Math.max(a, b)
  const darker = Math.min(a, b)

  return (lighter + 0.05) / (darker + 0.05)
}

/** Rounded to two decimals, for reporting. */
export const ratio = (foreground: string, background: string): number =>
  Math.round(contrastRatio(foreground, background) * 100) / 100

/**
 * The thresholds, named rather than inlined.
 *
 * `LARGE_TEXT` applies from 24px regular or 18.66px bold — the tokens that
 * qualify in this design system are display-xl, display-lg and data-xl. Every
 * other text token is normal text and needs the full 4.5:1.
 */
export const AA_NORMAL_TEXT = 4.5
export const AA_LARGE_TEXT = 3
/** Borders of controls, focus rings, and anything carrying meaning by shape. */
export const AA_NON_TEXT = 3

export type ContrastLevel = 'normal' | 'large' | 'non-text'

const THRESHOLDS: Readonly<Record<ContrastLevel, number>> = {
  normal: AA_NORMAL_TEXT,
  large: AA_LARGE_TEXT,
  'non-text': AA_NON_TEXT,
}

export const meetsAA = (
  foreground: string,
  background: string,
  level: ContrastLevel = 'normal',
): boolean => contrastRatio(foreground, background) >= THRESHOLDS[level]

/** The required ratio for a level, for assertion messages. */
export const thresholdFor = (level: ContrastLevel): number => THRESHOLDS[level]
