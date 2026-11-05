/**
 * Reading editable content out of Payload, with the cache in front of it.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY CACHED AT ALL, AND WHY ONLY THIS
 *
 * Site settings are read on EVERY page, because the footer needs the contact
 * address and the help-line number. Uncached, that is one database round trip
 * added to every request on the site, for three fields that change twice a
 * year. The FAQ and the legal documents are the same shape of data: edited
 * rarely, read constantly.
 *
 * The track record is NOT cached here and should not be. It is the product's
 * evidence, it changes when a tip settles, and a stale ROI is a wrong claim
 * about money — a category of staleness this project does not get to accept
 * to save a query.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE LOCALE IS THE FIRST ARGUMENT OF EVERY LOADER
 *
 * See `src/lib/cache/keys.ts` for why. Short version: a cache keyed without
 * the locale serves whichever language rendered first, and the day that
 * breaks is the day a second locale ships.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * EVERY READ USES `overrideAccess: false`
 *
 * Not `true`. These collections carry a public read predicate that is a QUERY
 * CONSTRAINT — `{ published: { equals: true } }` — and running the read with
 * access control ON is what applies it. Bypassing it here would mean an
 * unpublished draft privacy policy renders on the public page, and the
 * collection's careful access block would be protecting the REST API only.
 */
import { unstable_cache } from 'next/cache'
import { getPayload } from 'payload'

import type { FaqEntry, LegalPage, SiteSetting } from '@/payload-types'

import config from '../../payload.config.ts'
import type { Locale } from '../../i18n/config.ts'
import {
  CACHE_TAGS,
  CONTENT_REVALIDATE_SECONDS,
  cacheKey,
} from '../cache/keys.ts'
import type { LegalPageSlug } from '../../collections/content/LegalPages.ts'

/* -------------------------------------------------------------------------- */
/* Site settings                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The settings every page needs, with fallbacks.
 *
 * `helpline` has a fallback because rule 5 of the copy rules makes it
 * permanent furniture: a page that renders without a help-line number
 * because a global row has not been saved yet would be a page that breaks a
 * legal constraint over a missing database row. The fallback matches the
 * message catalogue, where the copy test pins it.
 */
export type SiteSettingsView = {
  contactEmail: string
  notificationEmail: string
  helpline: { name: string; phone: string; url: string | null }
  socialLinks: readonly string[]
}

const FALLBACK_SETTINGS: SiteSettingsView = {
  contactEmail: 'podpora@sazejchytre.cz',
  notificationEmail: 'podpora@sazejchytre.cz',
  helpline: {
    name: 'Národní linka pro odvykání',
    phone: '800 350 000',
    url: 'https://www.narodnilinka.cz/',
  },
  socialLinks: [],
}

const toSettingsView = (row: SiteSetting | null): SiteSettingsView => {
  if (!row) return FALLBACK_SETTINGS

  const contactEmail = row.contactEmail || FALLBACK_SETTINGS.contactEmail

  return {
    contactEmail,
    // An empty notification address means "the same one", rather than
    // meaning nobody is told a message arrived.
    notificationEmail: row.notificationEmail || contactEmail,
    helpline: {
      name: row.helpline?.name || FALLBACK_SETTINGS.helpline.name,
      phone: row.helpline?.phone || FALLBACK_SETTINGS.helpline.phone,
      url: row.helpline?.url || FALLBACK_SETTINGS.helpline.url,
    },
    socialLinks: (row.socialLinks ?? [])
      .map((link) => link.url)
      .filter((url): url is string => typeof url === 'string' && url !== ''),
  }
}

export const loadSiteSettings = async (
  locale: Locale,
): Promise<SiteSettingsView> => {
  const read = unstable_cache(
    async (): Promise<SiteSettingsView> => {
      try {
        // `getPayload` is INSIDE the try, deliberately. It was outside, which
        // meant the fallback below only covered "the global has never been
        // saved" and not "the database cannot be reached" — and the second
        // case is the one that matters more.
        //
        // Copy rule 5 requires the 18+ marker, the service statement and the
        // help-line number on every page. Those live in the footer, which
        // reads this. If an unreachable database took the footer down, a
        // database outage would mean every page on the site is a 500 with no
        // help-line number on it. The fallback values are the real ones —
        // they are the same strings the copy test pins in the catalogue — so
        // rendering them during an outage is correct rather than a guess.
        const payload = await getPayload({ config })

        const row = await payload.findGlobal({
          slug: 'site-settings',
          depth: 0,
          overrideAccess: false,
        })

        return toSettingsView(row as SiteSetting)
      } catch {
        return FALLBACK_SETTINGS
      }
    },
    cacheKey(locale, 'site-settings'),
    {
      revalidate: CONTENT_REVALIDATE_SECONDS,
      tags: [CACHE_TAGS.siteSettings],
    },
  )

  return read()
}

/* -------------------------------------------------------------------------- */
/* FAQ                                                                        */
/* -------------------------------------------------------------------------- */

export type FaqView = { id: number; question: string; answer: string }

export const loadFaqEntries = async (
  locale: Locale,
): Promise<readonly FaqView[]> => {
  const read = unstable_cache(
    async (): Promise<readonly FaqView[]> => {
      const payload = await getPayload({ config })

      const found = await payload.find({
        collection: 'faq-entries',
        depth: 0,
        limit: 50,
        pagination: false,
        overrideAccess: false,
        sort: 'sortOrder',
      })

      return (found.docs as FaqEntry[]).map((entry) => ({
        id: entry.id,
        question: entry.question,
        answer: entry.answer,
      }))
    },
    cacheKey(locale, 'faq-entries'),
    { revalidate: CONTENT_REVALIDATE_SECONDS, tags: [CACHE_TAGS.faqEntries] },
  )

  return read()
}

/* -------------------------------------------------------------------------- */
/* Legal documents                                                            */
/* -------------------------------------------------------------------------- */

export type LegalPageView = {
  title: string
  version: string
  effectiveFrom: string | null
  summary: string | null
  body: LegalPage['body']
  updatedAt: string
}

/**
 * The version of a legal document that is in force NOW.
 *
 * Two filters, both load-bearing:
 *
 *   - `published` comes from the collection's access predicate, applied
 *     because the read runs with access control on;
 *   - `effectiveFrom` must be absent or in the past. A terms change dated
 *     next month is legitimate to have in the database and must not be
 *     served as current — a customer consenting to it today would be
 *     consenting to a document that is not yet in force.
 *
 * `now` is computed inside the cached function rather than passed in. Passing
 * it would make every request a cache miss; computing it inside means a
 * document can be up to `CONTENT_REVALIDATE_SECONDS` late in becoming
 * current, which for a date-granular effective date is not a real difference.
 */
export const loadLegalPage = async (
  locale: Locale,
  pageSlug: LegalPageSlug,
): Promise<LegalPageView | null> => {
  const read = unstable_cache(
    async (): Promise<LegalPageView | null> => {
      const payload = await getPayload({ config })
      const now = new Date().toISOString()

      const found = await payload.find({
        collection: 'legal-pages',
        depth: 0,
        limit: 1,
        pagination: false,
        overrideAccess: false,
        // Newest effective date first, so a scheduled replacement takes over
        // by itself the moment it comes into force.
        sort: '-effectiveFrom',
        where: {
          pageSlug: { equals: pageSlug },
          or: [
            { effectiveFrom: { less_than_equal: now } },
            { effectiveFrom: { exists: false } },
          ],
        },
      })

      const row = (found.docs as LegalPage[])[0]

      if (!row) return null

      return {
        title: row.title,
        version: row.version,
        effectiveFrom: row.effectiveFrom ?? null,
        summary: row.summary ?? null,
        body: row.body,
        updatedAt: row.updatedAt,
      }
    },
    cacheKey(locale, 'legal-page', pageSlug),
    { revalidate: CONTENT_REVALIDATE_SECONDS, tags: [CACHE_TAGS.legalPages] },
  )

  return read()
}
