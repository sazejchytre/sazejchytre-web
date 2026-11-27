/**
 * The design-preview gate: development only, decided by NODE_ENV alone.
 *
 * The route wiring — that the layout and the page actually call this, first,
 * with no bypass beside it — is asserted in
 * `src/app/(preview)/preview-route.test.ts`. This file is the decision.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { DESIGN_PREVIEW_MODE, isDesignPreviewEnabled } from './preview-gate.ts'

const MODES = [
  'development',
  'test',
  'production',
  undefined,
  '',
  'Development',
  'dev',
] as const

describe('isDesignPreviewEnabled', () => {
  it('is open only when the build AND the runtime are development', () => {
    assert.equal(
      isDesignPreviewEnabled({ build: 'development', runtime: 'development' }),
      true,
    )
  })

  it('is closed in a production build, whatever the runtime says', () => {
    // `next build` inlines process.env.NODE_ENV as "production"; a runtime
    // environment claiming development must not reopen it.
    for (const runtime of MODES) {
      assert.equal(
        isDesignPreviewEnabled({ build: 'production', runtime }),
        false,
        `opened for build=production, runtime=${String(runtime)}`,
      )
    }
  })

  it('is closed at runtime in production, whatever the build says', () => {
    for (const build of MODES) {
      assert.equal(
        isDesignPreviewEnabled({ build, runtime: 'production' }),
        false,
        `opened for build=${String(build)}, runtime=production`,
      )
    }
  })

  it('fails closed on every combination except development/development', () => {
    for (const build of MODES) {
      for (const runtime of MODES) {
        const expected = build === 'development' && runtime === 'development'

        assert.equal(
          isDesignPreviewEnabled({ build, runtime }),
          expected,
          `build=${String(build)}, runtime=${String(runtime)}`,
        )
      }
    }
  })

  it('names development as the only mode', () => {
    assert.equal(DESIGN_PREVIEW_MODE, 'development')
  })
})

/** The code without its comments, which discuss `process.env` at length. */
const code = (relative: string): string =>
  readFileSync(path.join(process.cwd(), relative), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"])\/\/.*$/gm, '$1')

describe('the gate has nothing a request could switch on', () => {
  const gate = code('src/lib/design/preview-gate.ts')
  const wiring = code('src/lib/design/preview.ts')

  it('keeps the decision pure: no imports, no environment reads', () => {
    assert.equal(/^import /m.test(gate), false)
    assert.equal(/process\.env/.test(gate), false)
  })

  it('wires exactly two readings of NODE_ENV and no other setting', () => {
    const envReads = [...wiring.matchAll(/process\.env\.([A-Z_]+)/g)].map(
      (match) => match[1],
    )
    const validatedReads = [
      ...wiring.matchAll(/(?<!process\.)\benv\.([A-Z_]+)/g),
    ].map((match) => match[1])

    assert.deepEqual(envReads, ['NODE_ENV'])
    assert.deepEqual(validatedReads, ['NODE_ENV'])
  })

  it('reads process.env.NODE_ENV as a whole expression, so Next inlines it', () => {
    // `process.env[key]` or a destructured `NODE_ENV` would survive the build
    // as a runtime read, and the production-build half of the gate would be
    // gone.
    assert.match(wiring, /build: process\.env\.NODE_ENV,/)
    assert.equal(/process\.env\[/.test(wiring), false)
    assert.equal(/\{\s*NODE_ENV\s*\}\s*=\s*process\.env/.test(wiring), false)
  })

  it('consults no cookie, header, query parameter or draft mode', () => {
    for (const source of [gate, wiring]) {
      for (const bypass of [
        /\bcookies\s*\(/,
        /\bheaders\s*\(/,
        /searchParams/,
        /draftMode/,
        /x-preview|preview_token|previewSecret/i,
      ]) {
        assert.equal(bypass.test(source), false, `found ${String(bypass)}`)
      }
    }
  })
})
