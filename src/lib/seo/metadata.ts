/**
 * Per-page metadata, built from one resolver.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * EVERY PAGE GOES THROUGH HERE
 *
 * Not because a page could not write its own `export const metadata`, but
 * because four of the things on it are easy to get subtly wrong and
 * impossible to notice in a browser:
 *
 *   - the CANONICAL must be absolute and must point at the real origin, not
 *     at the preview deployment that rendered it;
 *   - the OPEN GRAPH url must agree with the canonical, or a share card
 *     advertises a different URL from the one the crawler indexes;
 *   - `noindex` must be on by default anywhere that is not the production
 *     host, or every preview deployment competes with the real site;
 *   - the locale tag has to match `<html lang>`, which is `cs-CZ` here and
 *     `cs_CZ` in Open Graph's own spelling. One underscore.
 *
 * So pages pass a path, a title and a description, and this returns the
 * Metadata object. `base.ts` owns the origin; nothing here hardcodes a host.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THERE IS NO OG IMAGE YET
 *
 * Because there is no artwork. A `openGraph.images` entry pointing at a file
 * that does not exist produces a share card with a broken image, which is
 * worse than a text card — so the card is declared `summary` rather than
 * `summary_large_image`, which is the correct type for a card with no image.
 * When the brand assets land, add the image here and flip the card type in
 * this one function.
 */
import type { Metadata } from 'next'

import { HTML_LANG, LOCALES } from '../../i18n/config.ts'
import { absoluteUrl, isCanonicalHost, siteOrigin } from './base.ts'

/** The Open Graph spelling of a locale: `cs-CZ` becomes `cs_CZ`. */
const openGraphLocale = (tag: string): string => tag.replace('-', '_')

export const SITE_NAME = 'Sázej chytře'

export type PageSeoArgs = {
  /** Site-relative path, e.g. `/historie`. Leading slash optional. */
  path: string
  title: string
  description: string
  /**
   * Keep this page out of the index.
   *
   * A SWITCH, not a policy: non-production hosts are excluded anyway (see
   * below). This is for pages that should stay out of the index even in
   * production — a thank-you page, a stub, a filtered view of a dataset.
   */
  noindex?: boolean
  /** `website` for the home page, `article` for a tip or a legal document. */
  ogType?: 'website' | 'article'
  /** ISO timestamp for an article-type page. */
  publishedTime?: string | null
}

/**
 * hreflang, deliberately absent — with the hook in place.
 *
 * `LOCALES` has one member, and emitting `hreflang` for locales that all
 * serve the same Czech text is the most reliable way to hand a search engine
 * a duplicate-content problem. It is not a saving to skip the plumbing,
 * though: the moment a second locale exists this function starts returning
 * entries and every page picks them up with no page-level change.
 *
 * Returns `undefined` rather than an empty object so the key can be spread
 * away entirely — an empty `languages: {}` still emits nothing useful but
 * does show up in a diff as though something changed.
 */
export const hreflangAlternates = (
  path: string,
): Record<string, string> | undefined => {
  if (LOCALES.length < 2) {
    return undefined
  }

  // Reached only once a second locale exists. The prefix scheme is the
  // decision that comes with it; Czech keeps the bare paths.
  return Object.fromEntries(
    LOCALES.map((locale) => [
      HTML_LANG[locale],
      locale === 'cs' ? absoluteUrl(path) : absoluteUrl(`/${locale}${path}`),
    ]),
  )
}

/**
 * Should anything on this host be indexable?
 *
 * A preview build is a production build, so `NODE_ENV` cannot answer this —
 * only the configured origin can. See `isCanonicalHost`.
 */
export const indexingAllowed = (): boolean => isCanonicalHost()

export const pageMetadata = ({
  path,
  title,
  description,
  noindex = false,
  ogType = 'website',
  publishedTime = null,
}: PageSeoArgs): Metadata => {
  const canonical = absoluteUrl(path)
  const languages = hreflangAlternates(path)
  const indexable = indexingAllowed() && !noindex

  return {
    title,
    description,
    alternates: {
      canonical,
      ...(languages ? { languages } : {}),
    },
    openGraph: {
      type: ogType,
      // Agrees with the canonical by construction, because it is the same
      // string. Two calls to `absoluteUrl` would be two chances to differ.
      url: canonical,
      siteName: SITE_NAME,
      title,
      description,
      locale: openGraphLocale(HTML_LANG.cs),
      ...(publishedTime ? { publishedTime } : {}),
    },
    twitter: {
      // `summary`, not `summary_large_image`: there is no image. See header.
      card: 'summary',
      title,
      description,
    },
    robots: indexable
      ? { index: true, follow: true }
      : {
          index: false,
          follow: false,
          // `noarchive` as well, so a page that briefly leaked into an index
          // does not survive there as a cached copy.
          noarchive: true,
        },
  }
}

/**
 * The origin, for the one place Next wants it as a `URL`.
 *
 * Re-exported from here so a layout imports metadata concerns from one
 * module rather than two.
 */
export const metadataBaseUrl = (): URL => new URL(siteOrigin())
