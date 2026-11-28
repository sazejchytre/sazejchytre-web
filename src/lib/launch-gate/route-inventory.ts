/**
 * Every route the App Router can serve, read from `src/app` itself.
 *
 * The launch gate's tests and the deployment check do not trust a
 * hand-maintained list of URLs: a list is exactly the thing that falls behind
 * when somebody adds a page. They walk the route tree instead, so "every
 * route" means every `page`, `route` and metadata file that exists, and a new
 * one shows up in the next test run whether or not anybody remembered it.
 *
 * Follows the App Router's conventions: `(group)` segments add nothing to
 * the URL, `@slot` segments are parallel routes and add nothing either, and
 * `_private` folders are not routable at all.
 *
 * Uses only `node:fs` and `node:path`, so it runs under Node's native type
 * stripping without the bundler.
 */
import { readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

export type AppRouteKind = 'page' | 'route' | 'metadata'

export type AppRoute = {
  /** Path of the defining file relative to the app directory, `/`-separated. */
  file: string
  kind: AppRouteKind
  /** The URL in App Router notation, e.g. `/tipy/[slug]`. */
  template: string
  /** Concrete paths that reach this route, one per shape it accepts. */
  samples: readonly string[]
}

const PAGE_FILE = /^page\.(?:tsx|ts|jsx|js|mdx)$/
const ROUTE_FILE = /^route\.(?:ts|js)$/

/** Metadata file conventions and the URL each one is served at. */
const METADATA_FILES: ReadonlyArray<{ pattern: RegExp; url: string }> = [
  { pattern: /^robots\.(?:ts|js|txt)$/, url: 'robots.txt' },
  { pattern: /^sitemap\.(?:ts|js|xml)$/, url: 'sitemap.xml' },
  {
    pattern: /^manifest\.(?:ts|js|json|webmanifest)$/,
    url: 'manifest.webmanifest',
  },
  { pattern: /^favicon\.ico$/, url: 'favicon.ico' },
  { pattern: /^icon\.(?:ts|tsx|js|jsx|ico|png|jpg|jpeg|svg)$/, url: 'icon' },
  {
    pattern: /^apple-icon\.(?:ts|tsx|js|jsx|png|jpg|jpeg)$/,
    url: 'apple-icon',
  },
  {
    pattern: /^opengraph-image\.(?:ts|tsx|js|jsx|png|jpg|jpeg|gif)$/,
    url: 'opengraph-image',
  },
  {
    pattern: /^twitter-image\.(?:ts|tsx|js|jsx|png|jpg|jpeg|gif)$/,
    url: 'twitter-image',
  },
]

const isUrlless = (segment: string): boolean =>
  (segment.startsWith('(') && segment.endsWith(')')) || segment.startsWith('@')

/** Concrete values a segment can take, in App Router notation. */
const segmentSamples = (segment: string): readonly string[] => {
  if (segment.startsWith('[[...') && segment.endsWith(']]')) {
    return ['', 'sample', 'sample/nested']
  }

  if (segment.startsWith('[...') && segment.endsWith(']')) {
    return ['sample', 'sample/nested']
  }

  if (segment.startsWith('[') && segment.endsWith(']')) {
    return [`sample-${segment.slice(1, -1)}`]
  }

  return [segment]
}

const expandSamples = (segments: readonly string[]): string[] => {
  let paths = ['']

  for (const segment of segments) {
    const values = segmentSamples(segment)
    paths = paths.flatMap((prefix) =>
      values.map((value) => (value === '' ? prefix : `${prefix}/${value}`)),
    )
  }

  return paths.map((path) => (path === '' ? '/' : path))
}

const toTemplate = (segments: readonly string[]): string =>
  segments.length === 0 ? '/' : `/${segments.join('/')}`

export const discoverAppRoutes = (appDir: string): AppRoute[] => {
  const routes: AppRoute[] = []

  const walk = (dir: string, urlSegments: readonly string[]): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        // `_folder` opts the whole subtree out of routing.
        if (entry.name.startsWith('_')) continue

        walk(
          join(dir, entry.name),
          isUrlless(entry.name) ? urlSegments : [...urlSegments, entry.name],
        )
        continue
      }

      const file = relative(appDir, join(dir, entry.name)).split(sep).join('/')

      if (PAGE_FILE.test(entry.name) || ROUTE_FILE.test(entry.name)) {
        routes.push({
          file,
          kind: PAGE_FILE.test(entry.name) ? 'page' : 'route',
          template: toTemplate(urlSegments),
          samples: expandSamples(urlSegments),
        })
        continue
      }

      const metadata = METADATA_FILES.find(({ pattern }) =>
        pattern.test(entry.name),
      )

      if (metadata) {
        const segments = [...urlSegments, metadata.url]
        routes.push({
          file,
          kind: 'metadata',
          template: toTemplate(segments),
          samples: expandSamples(segments),
        })
      }
    }
  }

  walk(appDir, [])

  return routes.sort((a, b) => a.template.localeCompare(b.template))
}
