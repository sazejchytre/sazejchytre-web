/**
 * Locale configuration. CZECH ONLY, and unprefixed.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY WIRE i18n UP AT ALL WHEN THERE IS ONE LOCALE
 *
 * Because the alternative is a refactor later, and the refactor is the
 * expensive part. Hard-coded Czech strings spread into every component, and
 * adding Slovak then means finding all of them — which is the job nobody
 * finishes, so the second locale either never ships or ships half-translated.
 *
 * With the plumbing in place, adding a locale is: add the code to `LOCALES`,
 * add a catalogue, done. No component changes.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * AND WHY NOT ADD SLOVAK NOW
 *
 * Because there is no Slovak text. A locale that serves Czech content under
 * `/sk` is duplicate content with a language tag that lies about it, and the
 * search engine is right to treat it as such. The groundwork is free; the
 * empty locale is not.
 *
 * This is also why `hreflang` stays out of the metadata layer (see
 * `src/lib/seo/`): emitting it for locales that serve identical text is the
 * most reliable way to hand Google a duplicate-content problem.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * UNPREFIXED
 *
 * Czech lives at `/`, not `/cs`. A single-locale site with a locale prefix
 * has two URLs for every page — `/` and `/cs` — and has to redirect one to
 * the other for ever. When a second locale arrives it gets a prefix and Czech
 * keeps the bare paths, which is both what the operator wants and what keeps
 * every link ever shared working.
 */

export const LOCALES = ['cs'] as const

export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'cs'

/**
 * The BCP 47 tag for `<html lang>`, per locale.
 *
 * Separate from the locale code because they are not always the same thing —
 * a future `sk` is `sk-SK`, and a future English would be `en-GB` rather than
 * the `en` that a browser would guess as American.
 */
export const HTML_LANG: Readonly<Record<Locale, string>> = {
  cs: 'cs-CZ',
}

/** Czech formatting, so `Intl` output matches the rest of the page. */
export const INTL_LOCALE: Readonly<Record<Locale, string>> = {
  cs: 'cs-CZ',
}

export const isLocale = (value: string): value is Locale =>
  (LOCALES as readonly string[]).includes(value)

/**
 * Resolve a locale from an untrusted string, falling back to the default.
 *
 * Never throws. A bad locale in a URL or a cookie is a 404-worthy mistake at
 * most, and crashing a page render over it would turn a typo into an outage.
 */
export const resolveLocale = (value: string | null | undefined): Locale =>
  value && isLocale(value) ? value : DEFAULT_LOCALE
