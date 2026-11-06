/**
 * The two typefaces, self-hosted.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY next/font AND NOT A <link> TO GOOGLE
 *
 * `next/font/google` downloads the files at BUILD time and serves them from
 * our own origin. Nothing about it is a runtime request to Google. That
 * matters for three separate reasons:
 *
 *   - every visitor's IP would otherwise be sent to a third party on every
 *     page load, which is a GDPR problem a Czech site does not need and
 *     which German courts have already ruled on;
 *   - a third-party font request is a third-party dependency on the critical
 *     render path — their outage becomes our outage;
 *   - a same-origin font is one connection fewer and no cross-origin
 *     preconnect, which is the cheapest Core Web Vitals win available.
 *
 * `display: 'swap'` so text paints in the fallback immediately rather than
 * holding a blank page while the file arrives. The fallback stacks below are
 * chosen to be metrically close, which is what keeps the swap from shifting
 * layout — Next also generates an adjusted fallback automatically.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY TWO, AND WHERE THE SECOND ONE IS ALLOWED
 *
 * Inter for everything. Barlow for display headings and the wordmark only.
 * Two families is already a budget; a third would be a decision nobody could
 * defend and another file on the critical path.
 *
 * The variables are consumed by `globals.css` (`--font-sans`,
 * `--font-display`), so no component imports a font.
 */
import { Barlow, Inter } from 'next/font/google'

/**
 * Body, UI and all data.
 *
 * `latin-ext` is not optional: Czech needs ě š č ř ž ý á í é ú ů ť ň ď, and
 * the plain `latin` subset does not contain them. Shipping `latin` only is
 * how a Czech site ends up rendering half its diacritics from a fallback
 * face, at a different weight, which looks like a broken font rather than a
 * missing subset.
 */
/**
 * NO `weight`, so this is the VARIABLE file.
 *
 * The old comment here said asking for the variable font "would ship every
 * weight in between for no use". That was wrong, and measurably so: with
 * four static weights requested, next/font emitted 28 `@font-face` blocks
 * pointing at only SEVEN files — the same seven, once per weight. Google
 * Fonts was already serving the variable file and the declarations were
 * merely pinning weights against it.
 *
 * So this change removes 21 redundant `@font-face` blocks from the CSS and
 * leaves the downloaded bytes alone. A variable font does not ship a copy
 * per weight; it ships one interpolable outline set, which is why the files
 * were shared in the first place.
 *
 * `latin-ext` is not optional: ř, ě, ů and ť live there, while á, í and é
 * are in `latin`. Czech needs both ranges, and dropping either is how a
 * Czech site ends up rendering half its diacritics from a fallback face.
 */
export const inter = Inter({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-inter',
  // Above the fold on every page: body copy, the nav, the figures. This is
  // the one family worth a preload.
  preload: true,
})

/**
 * Display headings. STATIC, because Barlow has no variable file.
 *
 * Verified rather than assumed: dropping `weight` fails the build with
 * "Missing weight for Barlow. Available weights: 100, 200, …, 900" — Google
 * Fonts publishes Barlow as named instances only. So 600 and 700 are two
 * separate files per subset and there is no interpolable single file to
 * collapse them into.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY IT IS NOT PRELOADED AT ALL, RATHER THAN "700 ONLY"
 *
 * `preload` is per next/font INSTANCE, not per weight, and the two weights
 * cannot be split into two instances without breaking weight selection:
 * each instance gets its own internal family name, and CSS font matching
 * picks a FAMILY first and only then the nearest weight inside it. Listing
 * both families in `--font-display` would render 600 text from whichever
 * came first — synthesised, not real.
 *
 * So the choice was both weights preloaded (50.3 kB) or neither. Neither is
 * the better trade, and not only on byte count: with `display: swap` the
 * heading paints immediately in the metric-adjusted fallback either way, so
 * preloading buys no earlier text — it only avoids a swap, while competing
 * for bandwidth with the render-critical Inter and script. The swap is
 * layout-stable, because next/font emits a `size-adjust` fallback (96.68%
 * for Barlow) and the CLS work already established that font swap is not a
 * shift source here.
 */
export const barlow = Barlow({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-barlow',
  weight: ['600', '700'],
  // See above. Headings swap in; they do not hold up first paint.
  preload: false,
})

/**
 * Both font variables, for the `<html>` element.
 *
 * Applied once in the layout so a page cannot forget one and silently fall
 * back to a system face for its headings.
 */
export const fontVariables = `${inter.variable} ${barlow.variable}`
