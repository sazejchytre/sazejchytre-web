import type { MetadataRoute } from 'next'
import { getPayload } from 'payload'

import { absoluteUrl } from '@/lib/seo/base'
import { indexingAllowed } from '@/lib/seo/metadata'
import { indexableRoutes } from '@/lib/seo/routes'
import { loadPublicArchive } from '@/lib/tips/loader'
import config from '@/payload.config'

/**
 * `sitemap.xml`, generated.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * NOT A STATIC FILE
 *
 * Because the tip pages are rows in a table. A hand-written sitemap is out of
 * date the moment a tip is published, and the usual consequence is that the
 * one page type with genuinely new content is the one a crawler never hears
 * about.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * A PREVIEW DEPLOYMENT SERVES AN EMPTY SITEMAP
 *
 * `indexingAllowed()` compares the configured origin against the production
 * host. On a preview that is false, and an empty `<urlset>` is returned —
 * because a preview sitemap full of preview URLs is an invitation to index
 * the staging copy of the whole site, and `robots.txt` alone does not stop a
 * crawler that was handed a URL directly.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * `lastModified` IS THE REAL DATE
 *
 * For a tip, its settlement or publication time. Not `new Date()`, which is
 * what a sitemap generator does by default and which tells a crawler that
 * every page on the site changed this second — advice it learns to ignore.
 */
/**
 * Regenerated hourly.
 *
 * A sitemap is a Route Handler and is cached indefinitely by default, which
 * for this one would mean the tip URLs are whatever they were at build time —
 * so a tip published after a deploy would never appear in it, which is the
 * one job this file has. An hour is short enough that a new tip is announced
 * the same day and long enough that a crawler cannot turn the sitemap into a
 * query per fetch.
 */
export const revalidate = 3600

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!indexingAllowed()) {
    return []
  }

  const staticEntries: MetadataRoute.Sitemap = indexableRoutes().map(
    (route) => ({
      url: absoluteUrl(route.path),
      changeFrequency: route.changeFrequency,
      priority: route.priority,
    }),
  )

  let tipEntries: MetadataRoute.Sitemap = []

  try {
    const payload = await getPayload({ config })
    const tips = await loadPublicArchive({ payload })

    tipEntries = tips
      .filter((tip) => tip.slug !== '')
      .map((tip) => ({
        url: absoluteUrl(`/tipy/${tip.slug}`),
        lastModified: new Date(tip.settledAt ?? tip.publishedAt ?? Date.now()),
        changeFrequency: 'monthly' as const,
        // Lower than the archive page that lists them: an individual tip is
        // worth indexing, but the record as a whole is the thing.
        priority: 0.4,
      }))
  } catch {
    /**
     * A database failure must not produce a 500 on `sitemap.xml`.
     *
     * A crawler that gets a 500 here backs off; one that gets a valid sitemap
     * with the static pages in it indexes the static pages and comes back for
     * the rest. The degraded answer is strictly better than no answer, and
     * the failure is visible in the application logs either way.
     */
    tipEntries = []
  }

  return [...staticEntries, ...tipEntries]
}
