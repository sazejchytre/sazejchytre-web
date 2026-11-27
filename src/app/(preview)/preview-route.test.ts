/**
 * Regression test: the design preview cannot be served in production.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT IS PROVEN WHERE
 *
 *   - The DECISION (development only, NODE_ENV only, fail closed) is tested
 *     as a pure function in `src/lib/design/preview-gate.test.ts`.
 *   - THIS FILE proves the route is wired to that decision so that it cannot
 *     leak: every page and layout under `(preview)` calls the gate and
 *     `notFound()` before doing anything else; the group is its own root
 *     layout with no loading boundary, so the 404 is decided before a byte is
 *     streamed; nothing in the group reads a cookie, header or query string;
 *     and the pages are `noindex`.
 *   - The END-TO-END proof — `next build`, `next start`, request the URL, get
 *     a 404 — needs a built server and is not part of `pnpm test`. It was run
 *     for SC-005 and its output is in the PR description.
 *
 * Source-level assertions are deliberate: they fail at the exact line that
 * breaks the rule, which a black-box HTTP test can only report as "200".
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const GROUP = path.join(process.cwd(), 'src/app/(preview)')

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)

    return entry.isDirectory() ? walk(full) : [full]
  })

const sourceFiles = walk(GROUP).filter(
  (file) => /\.(tsx?|jsx?)$/.test(file) && !file.endsWith('.test.ts'),
)

const relative = (file: string): string =>
  path.relative(process.cwd(), file).split(path.sep).join('/')

/** Files Next treats as a route entry point for rendering. */
const ENTRY_NAMES = /[\\/](page|layout|template|default)\.(tsx?|jsx?)$/

const entries = sourceFiles.filter((file) => ENTRY_NAMES.test(file))

/**
 * The statements of the default export's body, up to the first `await` or
 * `return` — i.e. everything that runs before the component can render or
 * load anything.
 */
const bodyBeforeFirstWork = (source: string): string => {
  const start = source.search(
    /export default (async )?function \w+\([^)]*\)[^{]*\{/,
  )

  assert.ok(start >= 0, 'no `export default function` found')

  const body = source.slice(source.indexOf('{', source.indexOf(')', start)) + 1)
  const firstWork = body.search(/\bawait\b|\breturn\b/)

  return firstWork === -1 ? body : body.slice(0, firstWork)
}

describe('the (preview) route group', () => {
  it('exists and contains the homepage prototype', () => {
    assert.ok(existsSync(path.join(GROUP, 'layout.tsx')))
    assert.ok(existsSync(path.join(GROUP, 'nahled/homepage/page.tsx')))
  })

  it('is its OWN root layout, not nested under (frontend)', () => {
    // Under (frontend), its loading boundary would stream a 200 before the
    // page's notFound() ran, and its footer refuses to render in production
    // while the operator data is a placeholder.
    const layout = readFileSync(path.join(GROUP, 'layout.tsx'), 'utf8')

    assert.match(layout, /<html\b/)
    assert.match(layout, /<body\b/)
    assert.equal(
      existsSync(path.join(process.cwd(), 'src/app/(frontend)/nahled')),
      false,
      'a nahled folder under (frontend) would bypass this group',
    )
  })

  it('has no loading or not-found boundary that could stream before the gate', () => {
    const boundaries = walk(GROUP).filter((file) =>
      /[\\/](loading|not-found|error|template)\.(tsx?|jsx?)$/.test(file),
    )

    assert.deepEqual(boundaries.map(relative), [])
  })

  it('finds the entry points, or the checks below are vacuous', () => {
    assert.ok(entries.length >= 2, `found ${String(entries.length)} entries`)
  })

  for (const file of entries) {
    describe(relative(file), () => {
      const source = readFileSync(file, 'utf8')

      it('imports the gate and notFound', () => {
        assert.match(
          source,
          /import \{ designPreviewEnabled \} from '@\/lib\/design\/preview'/,
        )
        assert.match(source, /import \{ notFound \} from 'next\/navigation'/)
      })

      it('refuses with notFound() before it awaits or returns anything', () => {
        const before = bodyBeforeFirstWork(source)

        assert.match(
          before,
          /if \(!designPreviewEnabled\(\)\) notFound\(\)/,
          'the gate is not the first thing the component does',
        )
      })
    })
  }

  it('reads no cookie, header, query parameter or draft mode anywhere', () => {
    // "No production bypass using a cookie, request header or query
    // parameter" — so none of the request APIs appear in the group at all.
    const BYPASSES = [
      /\bcookies\s*\(/,
      /\bheaders\s*\(/,
      /\bsearchParams\b/,
      /\bdraftMode\s*\(/,
      /from 'next\/headers'/,
      /\bprocess\.env\b/,
    ]

    for (const file of sourceFiles) {
      const source = readFileSync(file, 'utf8')

      for (const bypass of BYPASSES) {
        assert.equal(
          bypass.test(source),
          false,
          `${relative(file)} matches ${String(bypass)}`,
        )
      }
    }
  })

  it('is noindex on the layout and on every page', () => {
    for (const file of entries) {
      const source = readFileSync(file, 'utf8')

      assert.match(
        source,
        /robots: \{ index: false, follow: false, nocache: true \}/,
        `${relative(file)} is indexable`,
      )
    }
  })

  it('is rendered per request, so a build never prerenders it', () => {
    const layout = readFileSync(path.join(GROUP, 'layout.tsx'), 'utf8')

    assert.match(layout, /export const dynamic = 'force-dynamic'/)
  })
})
