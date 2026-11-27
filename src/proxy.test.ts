import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { before, describe, it } from 'node:test'

import { NextRequest } from 'next/server.js'
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server.js'

import { discoverAppRoutes } from './lib/launch-gate/route-inventory.ts'
import { PLACEHOLDER_ENV } from './lib/launch-gate/test-fixtures.ts'
import type * as ProxyModule from './proxy.ts'

/**
 * `src/proxy.ts` itself: that its matcher reaches every route, and that it
 * hands the configured mode to the gate.
 *
 * The behaviour of every route in every mode is covered in
 * `lib/launch-gate/proxy-handler.test.ts`; this file only has to prove the
 * wiring, so it loads the real module once, with INFORMATIONAL configured.
 */

const ORIGIN = 'https://sazejchytre.cz'
const ROUTES = discoverAppRoutes(
  fileURLToPath(new URL('./app', import.meta.url)),
)

let proxyModule: typeof ProxyModule

before(async () => {
  Object.assign(process.env, PLACEHOLDER_ENV, { LAUNCH_MODE: 'INFORMATIONAL' })
  proxyModule = await import('./proxy.ts')
})

describe('proxy matcher', () => {
  it('runs the gate for every sample path of every route', () => {
    for (const route of ROUTES) {
      for (const sample of route.samples) {
        assert.equal(
          unstable_doesMiddlewareMatch({
            config: proxyModule.config,
            url: sample,
          }),
          true,
          `${sample} (${route.file}) would skip the gate`,
        )
      }
    }
  })

  it('runs the gate for paths with an extension and for framework endpoints', () => {
    for (const path of [
      '/llms.txt',
      '/robots.txt',
      '/sitemap.xml',
      '/predplatne.json',
      '/favicon.ico',
      '/_next/image',
      '/_next/data/build/prihlaseni.json',
      '/_next/webpack-hmr',
      '/__nextjs_original-stack-frames',
    ]) {
      assert.equal(
        unstable_doesMiddlewareMatch({ config: proxyModule.config, url: path }),
        true,
        path,
      )
    }
  })

  it('skips only the hashed build assets', () => {
    assert.equal(
      unstable_doesMiddlewareMatch({
        config: proxyModule.config,
        url: '/_next/static/chunks/main.js',
      }),
      false,
    )
  })
})

describe('proxy wiring', () => {
  const call = (path: string, method = 'GET') =>
    proxyModule.proxy(new NextRequest(`${ORIGIN}${path}`, { method }))

  it('enforces the configured mode (INFORMATIONAL here)', () => {
    assert.equal(call('/historie').headers.get('x-middleware-next'), '1')
    assert.equal(call('/prihlaseni').headers.get('x-launch-gate'), 'not-found')
    assert.equal(call('/auth/sign-in/email', 'POST').status, 404)
    assert.equal(call('/webhooks/stripe', 'POST').status, 404)
  })

  it('keeps operations open', () => {
    assert.equal(call('/healthz').headers.get('x-middleware-next'), '1')
  })
})
