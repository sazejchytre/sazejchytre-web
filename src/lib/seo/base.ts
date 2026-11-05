/**
 * THE one place a URL becomes absolute.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY EVERY ABSOLUTE URL COMES FROM HERE
 *
 * Canonical tags, Open Graph images, JSON-LD `@id`s, the sitemap and
 * `robots.txt` all need absolute URLs, and every one of them is wrong in a
 * different way if the origin is hardcoded:
 *
 *   - a hardcoded production domain makes every preview deployment advertise
 *     the production URL as its canonical, so a staging page can out-rank or
 *     replace the real one in an index;
 *   - a relative canonical is ignored by some crawlers and resolved against
 *     the wrong host by others;
 *   - a per-file `process.env.NEXT_PUBLIC_SERVER_URL ?? 'https://…'` means a
 *     missing variable silently produces the fallback, which is the failure
 *     that is impossible to notice.
 *
 * So there is one resolver, it reads the validated public env, and it has no
 * fallback origin. If the variable is missing the app does not boot, which is
 * the correct and loud failure.
 */
import { publicEnv } from '../env.public.ts'

/**
 * The canonical origin, with no trailing slash.
 *
 * `publicEnv` has already refused a trailing slash and a non-URL, so this is
 * a plain read rather than a parse.
 */
export const siteOrigin = (): string => publicEnv.NEXT_PUBLIC_SERVER_URL

/**
 * An absolute URL for a site-relative path.
 *
 * Takes `/historie` and returns `https://sazejchytre.cz/historie`. Accepts a
 * path with or without the leading slash, because half the call sites will
 * have one and half will not, and a double slash in a canonical is a
 * different URL as far as a crawler is concerned.
 *
 * Query strings are allowed through; a canonical that needs one is rare but
 * `/historie?sport=FOOTBALL` is a legitimate page.
 */
export const absoluteUrl = (path = '/'): string => {
  const origin = siteOrigin()

  if (path === '' || path === '/') {
    return `${origin}/`
  }

  const normalised = path.startsWith('/') ? path : `/${path}`

  return `${origin}${normalised}`
}

/**
 * The `URL` object Next wants for `metadataBase`.
 *
 * Set once in the root layout. With it in place Next resolves relative
 * `openGraph.images` and `alternates.canonical` against the right origin, so
 * individual pages can stay relative and still emit absolute tags.
 */
export const metadataBase = (): URL => new URL(siteOrigin())

/**
 * Is this the real production site?
 *
 * Used to decide whether a page may be indexed at all. A preview deployment
 * serves the same code against the same database and must never be indexed —
 * `robots.txt` alone is not enough, because a linked preview URL gets
 * crawled anyway.
 *
 * Deliberately a comparison of the configured origin against the known
 * production host rather than a `NODE_ENV` check: a preview build is a
 * production build, so `NODE_ENV` says `production` there too and would let
 * every preview advertise itself as indexable.
 */
export const PRODUCTION_HOST = 'sazejchytre.cz'

export const isCanonicalHost = (origin: string = siteOrigin()): boolean => {
  try {
    const { hostname } = new URL(origin)

    return hostname === PRODUCTION_HOST || hostname === `www.${PRODUCTION_HOST}`
  } catch {
    return false
  }
}
