import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { before, describe, it } from 'node:test'

import { decide } from './decide.ts'
import { NOT_FOUND_PATH } from './proxy-handler.ts'
import { discoverAppRoutes, type AppRoute } from './route-inventory.ts'
import { ROUTE_RULES, classifyPath } from './routes.ts'
import { EXPECTED_ROUTES, PLACEHOLDER_ENV } from './test-fixtures.ts'
import type * as SeoRoutesModule from '../seo/routes.ts'

/**
 * Route coverage: the gate's table against the route tree that exists.
 *
 * Every route file under `src/app` must be listed in `EXPECTED_ROUTES`, and
 * every shape of URL it accepts must classify into the area listed there.
 * A new page, route handler or metadata file fails this suite until it is
 * classified in both places.
 */

const APP_DIR = fileURLToPath(new URL('../../app', import.meta.url))

let routes: AppRoute[]

before(() => {
  routes = discoverAppRoutes(APP_DIR)
})

describe('route inventory', () => {
  it('finds the route tree', () => {
    // A guard against the walk silently returning nothing.
    assert.ok(routes.length >= 25, `only ${routes.length} routes found`)
  })

  it('lists every route that exists, and nothing that does not', () => {
    const discovered = routes.map((route) => route.template).sort()
    const expected = Object.keys(EXPECTED_ROUTES).sort()

    assert.deepEqual(
      discovered,
      expected,
      'src/app and EXPECTED_ROUTES disagree. Classify the new route in ' +
        'src/lib/launch-gate/test-fixtures.ts AND src/lib/launch-gate/routes.ts.',
    )
  })

  it('classifies every sample path of every route into its expected area', () => {
    for (const route of routes) {
      const expected = EXPECTED_ROUTES[route.template]
      assert.ok(expected, route.template)

      for (const sample of route.samples) {
        const rule = classifyPath(sample)

        assert.ok(rule, `${sample} (${route.file}) is not in the gate's table`)
        assert.equal(rule.area, expected.area, `${sample} (${route.file})`)
        assert.deepEqual(rule.methods, expected.methods, `${sample} methods`)
      }
    }
  })

  it('has no rule that no route or framework path needs', () => {
    const samples = routes.flatMap((route) => route.samples)
    const frameworkPaths = [
      '/_next/image',
      '/_next/webpack-hmr',
      '/__nextjs_original-stack-frames',
    ]

    for (const rule of ROUTE_RULES) {
      const used = [...samples, ...frameworkPaths].some((path) =>
        rule.pattern.test(path),
      )
      assert.ok(used, `rule "${rule.name}" matches nothing that exists`)
    }
  })
})

describe('the not-found rewrite target', () => {
  it('can never be served by a route', () => {
    // An underscore folder is not routable, so the only way a route could
    // answer NOT_FOUND_PATH is a dynamic segment at the root.
    assert.ok(NOT_FOUND_PATH.startsWith('/_'))

    for (const route of routes) {
      const first = route.template.split('/')[1] ?? ''
      assert.equal(
        first.startsWith('['),
        false,
        `${route.file} is a root catch-all`,
      )
    }
  })

  it('is not in the gate table, so it is refused if requested directly', () => {
    assert.equal(classifyPath(NOT_FOUND_PATH), undefined)
  })
})

describe('consistency with the SEO route inventory', () => {
  let seo: typeof SeoRoutesModule

  before(async () => {
    for (const [key, value] of Object.entries(PLACEHOLDER_ENV)) {
      process.env[key] ??= value
    }
    seo = await import('../seo/routes.ts')
  })

  it('serves every indexable page in INFORMATIONAL mode', () => {
    for (const route of seo.indexableRoutes()) {
      const decision = decide({
        mode: 'INFORMATIONAL',
        method: 'GET',
        pathname: route.path,
        development: false,
      })
      assert.equal(decision.action, 'pass', route.path)
    }
  })

  it('closes every non-indexable page in INFORMATIONAL mode', () => {
    for (const route of seo.PUBLIC_ROUTES.filter((r) => !r.indexable)) {
      const decision = decide({
        mode: 'INFORMATIONAL',
        method: 'GET',
        pathname: route.path,
        development: false,
      })
      assert.equal(decision.action, 'refuse', route.path)
    }
  })

  it('closes every robots-disallowed customer prefix in INFORMATIONAL mode', () => {
    const administrative = new Set(['/admin', '/api/'])

    for (const prefix of seo.DISALLOWED_PREFIXES) {
      if (administrative.has(prefix)) continue

      const path = prefix.endsWith('/') ? `${prefix}sample` : prefix
      const decision = decide({
        mode: 'INFORMATIONAL',
        method: 'GET',
        pathname: path,
        development: false,
      })
      assert.equal(decision.action, 'refuse', path)
    }
  })
})
