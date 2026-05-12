import type { MetadataRoute } from 'next'

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://sazejchytre.cz'

export default function sitemap(): MetadataRoute.Sitemap {
  const locales = ['cs', 'en', 'sk']

  const publicRoutes = [
    '',
    '/pricing',
    '/how-it-works',
    '/about',
    '/contact',
    '/terms',
    '/privacy',
    '/cookies',
    '/responsible-gambling',
    '/risk-warning',
  ]

  const entries: MetadataRoute.Sitemap = []

  for (const locale of locales) {
    for (const route of publicRoutes) {
      entries.push({
        url: `${appUrl}/${locale}${route}`,
        lastModified: new Date(),
        changeFrequency: route === '' ? 'daily' : 'weekly',
        priority: route === '' ? 1 : route === '/pricing' ? 0.9 : 0.7,
      })
    }
  }

  return entries
}
