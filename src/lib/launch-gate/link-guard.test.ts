import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

import { decide } from './decide.ts'
import { classifyPath } from './routes.ts'

/**
 * No unguarded link from the public site into a closed area.
 *
 * The informational site must not offer a control that leads to a route the
 * gate refuses there: a sign-in button or a "get access" button that opens a
 * 404. Components cannot be rendered under Node's type stripping, so this is
 * a source-level check:
 *
 *   every `.tsx` file that can render on a page the informational site
 *   serves, and that contains a root-relative link into an area that site
 *   closes, must decide whether to render it with `isLinkServed` from
 *   `src/lib/launch-gate/server.ts`.
 *
 * It is deliberately coarse — it checks that the file asks, not that every
 * branch does — and the real rendered pages are checked link by link by
 * `src/scripts/verify-launch-gate.ts --check-links`. What it catches is the
 * common regression: a new call to action pasted in with a hard-coded
 * `/predplatne` or `/prihlaseni`.
 *
 * Files under `src/app` whose own route is closed in INFORMATIONAL (the
 * sign-in page linking to registration, say) are exempt: they are never
 * rendered while their links are closed.
 */

const SRC_DIR = fileURLToPath(new URL('../../', import.meta.url))
const APP_DIR = join(SRC_DIR, 'app')
const COMPONENTS_DIR = join(SRC_DIR, 'components')

/**
 * Components that render only inside a closed area and may therefore link
 * within it unguarded. Empty today; add a file here only with a comment
 * saying which closed page renders it.
 */
const CLOSED_AREA_COMPONENTS: ReadonlySet<string> = new Set<string>([])

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return walk(path)
    return entry.isFile() && entry.name.endsWith('.tsx') ? [path] : []
  })

const posix = (path: string): string => path.split(sep).join('/')

/** The URL an `src/app` file renders at, with dynamic segments filled in. */
const appFileRoute = (file: string): string => {
  const segments = posix(relative(APP_DIR, file)).split('/').slice(0, -1)
  const url = segments
    .filter(
      (segment) =>
        !(segment.startsWith('(') && segment.endsWith(')')) &&
        !segment.startsWith('@'),
    )
    .map((segment) => (segment.startsWith('[') ? 'sample' : segment))

  return `/${url.join('/')}`
}

/** Remove comments, so prose that mentions a route is not read as a link. */
const stripComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\/\/.*$/, ''))
    .join('\n')

/** Every string literal that starts with a single `/`, up to `?`, `#` or `${`. */
const rootRelativeLiterals = (source: string): string[] => {
  const found: string[] = []
  const literal = /(["'`])(\/(?![/\\])[^"'`?#$\s]*)/g

  for (const match of stripComments(source).matchAll(literal)) {
    found.push(match[2] ?? '')
  }

  return found
}

const closedInInformational = (path: string): boolean =>
  decide({
    mode: 'INFORMATIONAL',
    method: 'GET',
    pathname: path,
    development: false,
  }).action === 'refuse'

/**
 * A link into a known route that the informational site closes. Unknown
 * paths are left to the rendered-page check: here they would only be noise
 * (`"/>` at the end of a JSX attribute, for one).
 */
const linksIntoClosedArea = (path: string): boolean =>
  classifyPath(path) !== undefined && closedInInformational(path)

const candidates = (): string[] => [
  ...walk(COMPONENTS_DIR).filter(
    (file) => !CLOSED_AREA_COMPONENTS.has(posix(relative(SRC_DIR, file))),
  ),
  ...walk(APP_DIR).filter((file) => !closedInInformational(appFileRoute(file))),
]

describe('links from the public site into closed areas', () => {
  it('finds the files it is meant to check', () => {
    const files = candidates().map((file) => posix(relative(SRC_DIR, file)))

    // Guards against the walk silently checking nothing.
    for (const expected of [
      'components/layout/Header.tsx',
      'components/layout/Footer.tsx',
      'components/pricing/TierCards.tsx',
      'app/(frontend)/page.tsx',
      'app/(frontend)/cenik/page.tsx',
    ]) {
      assert.ok(files.includes(expected), `${expected} is not checked`)
    }

    // And the exemption works: the sign-in page is not a public page.
    assert.ok(!files.includes('app/(frontend)/prihlaseni/page.tsx'))
  })

  it('recognises the links it is looking for', () => {
    // The check is only as good as the extraction; pin it to known shapes.
    assert.deepEqual(
      rootRelativeLiterals(
        [
          '<Button href="/prihlaseni">',
          "const a = '/registrace'",
          'href={`/predplatne?plan=${code}`}',
          "{ href: '/cenik', key: 'x' }",
          '// see /ucet in a comment',
          '/* and `/predplatne/...` in prose */',
          "fetch('//cdn.example.invalid/x')",
          "import x from '@/lib/x'",
        ].join('\n'),
      ),
      ['/prihlaseni', '/registrace', '/predplatne', '/cenik'],
    )
  })

  it('guards every such link with isLinkServed', () => {
    const offenders: string[] = []

    for (const file of candidates()) {
      const source = readFileSync(file, 'utf8')
      const closed = [
        ...new Set(rootRelativeLiterals(source).filter(linksIntoClosedArea)),
      ]

      if (closed.length > 0 && !/\bisLinkServed\(/.test(source)) {
        offenders.push(
          `${posix(relative(SRC_DIR, file))}: ${closed.join(', ')}`,
        )
      }
    }

    assert.deepEqual(
      offenders,
      [],
      'These files link to an area the informational site closes without ' +
        'asking the gate. Render the link only when isLinkServed(href) ' +
        '(src/lib/launch-gate/server.ts) is true.',
    )
  })

  it('still sees the guarded links in the two files that have them', () => {
    // Proof the check above is not passing because it found nothing.
    for (const [file, link] of [
      ['components/layout/Header.tsx', '/prihlaseni'],
      ['components/pricing/TierCards.tsx', '/predplatne'],
    ] as const) {
      const source = readFileSync(join(SRC_DIR, file), 'utf8')
      assert.ok(rootRelativeLiterals(source).includes(link), file)
      assert.match(source, /\bisLinkServed\(/, file)
    }
  })
})
