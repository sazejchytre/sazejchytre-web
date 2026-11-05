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
export const inter = Inter({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-inter',
  // The weights the type scale actually uses: 400 body, 500 data, 600
  // heading/label, 700 display. Asking for the variable font would ship
  // every weight in between for no use.
  weight: ['400', '500', '600', '700'],
})

/**
 * Display headings and the wordmark.
 *
 * Only 600 and 700 — Barlow never sets body text here, so the body weights
 * would be bytes nobody renders.
 */
export const barlow = Barlow({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-barlow',
  weight: ['600', '700'],
})

/**
 * Both font variables, for the `<html>` element.
 *
 * Applied once in the layout so a page cannot forget one and silently fall
 * back to a system face for its headings.
 */
export const fontVariables = `${inter.variable} ${barlow.variable}`
