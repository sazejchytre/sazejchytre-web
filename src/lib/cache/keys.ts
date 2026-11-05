/**
 * Cache keys and tags. THE LOCALE IS ALWAYS PART OF THE KEY.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THAT MATTERS BEFORE A SECOND LOCALE EXISTS
 *
 * Because the day it exists is the day the bug ships. A cache keyed only on
 * `legal:obchodni-podminky` holds whichever language rendered first and
 * serves it to everyone, and the symptom is a Slovak visitor reading Czech
 * terms — intermittently, depending on who warmed the cache. That is a
 * cache-poisoning class of bug: it does not reproduce locally, it does not
 * appear in a diff, and it is invisible until a customer complains about the
 * wrong language on a legal document.
 *
 * Retrofitting it later means auditing every cached call site. Taking the
 * locale as the FIRST POSITIONAL PARAMETER — not an option, not a field on a
 * context object — means a call site cannot compile without one.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * TAGS ARE FOR INVALIDATION, KEYS ARE FOR IDENTITY
 *
 * Next deliberately does not include tags in the cache key. A tag says
 * "throw this away when the operator edits a legal page"; the key says
 * "which page, in which language". Confusing the two gives you either a
 * cache that never invalidates or one that never hits.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ON `unstable_cache`
 *
 * Next 16 marks `unstable_cache` as superseded by the `use cache` directive
 * under Cache Components, which this project has not enabled — turning it on
 * changes the rendering contract for every existing page and is its own
 * piece of work. The migration is already accounted for: `use cache` derives
 * its key from the function's ARGUMENTS, so a loader whose first argument is
 * the locale keeps the locale in its key for free. That is the second reason
 * the locale is a parameter rather than part of a key array.
 */
import type { Locale } from '../../i18n/config.ts'

/** Prefixes every key, so one glance at a key says which app wrote it. */
export const CACHE_NAMESPACE = 'sc'

/**
 * Tags, for `revalidateTag`.
 *
 * Coarse on purpose. A tag per document would mean the admin panel has to
 * know which tag to invalidate; a tag per collection means "the operator
 * edited some legal text" throws away four pages' worth of cache, which
 * costs one query each and is never wrong.
 */
export const CACHE_TAGS = {
  legalPages: 'content:legal-pages',
  faqEntries: 'content:faq-entries',
  siteSettings: 'content:site-settings',
} as const

export type CacheTag = (typeof CACHE_TAGS)[keyof typeof CACHE_TAGS]

/**
 * How long cached content lives.
 *
 * Five minutes, not an hour: the operator edits a legal page and then checks
 * the page. Waiting an hour to see their own change is how an operator
 * concludes the admin panel is broken. Short enough to be forgiving, long
 * enough that a crawl or a traffic spike does not become a query per request.
 */
export const CONTENT_REVALIDATE_SECONDS = 300

/**
 * A cache key. Locale first, always.
 *
 * @param locale the content language. Required, positional, first.
 * @param parts what is being cached, most general first.
 */
export const cacheKey = (
  locale: Locale,
  ...parts: readonly (string | number)[]
): string[] => [CACHE_NAMESPACE, locale, ...parts.map(String)]
