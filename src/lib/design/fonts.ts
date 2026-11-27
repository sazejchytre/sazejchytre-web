/**
 * The two typefaces: Geist Sans and Geist Mono, self-hosted.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHERE THE FILES COME FROM
 *
 * The `geist` npm package (SIL Open Font License, no dependencies), pinned in
 * `package.json`. `next/font/local` reads the woff2 files out of
 * `node_modules` at BUILD time and serves them from our own origin with
 * hashed names. Nothing is fetched from any third party, at build time or at
 * runtime:
 *
 *   - the previous setup (`next/font/google`, Inter + Barlow) downloaded the
 *     files from Google during `next build`, which is a build-time network
 *     dependency — the sandboxed CI-equivalent build needed a stub for it;
 *   - visitors' IPs never reach a font CDN, which a Czech site under GDPR
 *     should not need to explain;
 *   - one connection fewer on the critical path.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY `localFont` HERE AND NOT THE PACKAGE'S `GeistSans` / `GeistMono`
 *
 * The package exports are `localFont` calls too, with options this site
 * wants to set differently:
 *
 *   - `GeistMono` is PRELOADED by default. Mono only appears in table cells
 *     and meta lines, never in the LCP element, so preloading it would put a
 *     second 71 kB file on the critical path to compete with the sans face
 *     the first paint actually needs.
 *   - next/font requires the options as literals at the call site, so they
 *     cannot be overridden on an imported instance.
 *
 * The paths point into the installed package rather than at copied files, so
 * there is one source for the fonts and upgrading is a version bump.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * CZECH COVERAGE, VERIFIED RATHER THAN ASSUMED
 *
 * Both variable files map every Czech letter in both cases (á č ď é ě í ň ó
 * ř š ť ú ů ý ž), plus „ “ – — … × −, checked against their `cmap` tables.
 * They do NOT contain ✓ or ✕, which is why `ResultIndicator` draws its marks
 * as SVG instead of borrowing them from a fallback face.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * NO LAYOUT SHIFT ON SWAP
 *
 * `display: 'swap'` so text paints immediately in a fallback.
 *
 *   - Sans: `adjustFontFallback: 'Arial'` makes next/font emit a fallback
 *     face with `size-adjust` and ascent/descent overrides matched to Geist,
 *     so the swap does not re-wrap a heading.
 *   - Mono: Geist Mono's advance is exactly 0.600 em; Courier New's is
 *     0.6001 em (measured from `hmtx`), and Menlo and SF Mono are 0.6 em
 *     faces as well. A monospace fallback from that list therefore
 *     already has the right width per character, and an Arial-based metric
 *     override would make it WORSE (a proportional face stretched to an
 *     average). So the fallback is a mono stack with the adjustment off.
 *     Line height is fixed by the type tokens, so the vertical metrics of
 *     the fallback cannot move anything either.
 *
 * The variables are consumed by `globals.css` (`--font-sans`, `--font-mono`),
 * so no component imports a font.
 */
import localFont from 'next/font/local'

/** Body, headings, UI and headline figures. Preloaded: it is the LCP text. */
export const geistSans = localFont({
  src: '../../../node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  variable: '--font-geist-sans',
  preload: true,
  adjustFontFallback: 'Arial',
  fallback: ['ui-sans-serif', 'system-ui', 'Segoe UI', 'Arial', 'sans-serif'],
})

/** Odds, units, dates in tables. Not preloaded — see the header. */
export const geistMono = localFont({
  src: '../../../node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  variable: '--font-geist-mono',
  preload: false,
  adjustFontFallback: false,
  // Every entry is a 0.60 em face. Consolas (0.55 em) is left out on
  // purpose: on Windows it would be picked before Courier New and make the
  // swap change the width of every mono cell.
  fallback: [
    'ui-monospace',
    'SFMono-Regular',
    'Menlo',
    'Courier New',
    'monospace',
  ],
})

/**
 * Both font variables, for the `<html>` element.
 *
 * Applied once in each root layout so a page cannot forget one and silently
 * fall back to a system face.
 */
export const fontVariables = `${geistSans.variable} ${geistMono.variable}`
