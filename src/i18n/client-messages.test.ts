import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'

import { CLIENT_NAMESPACES, pickClientMessages } from './client-messages.ts'
import { cs } from './messages/cs.ts'

/**
 * The guard behind `CLIENT_NAMESPACES`.
 *
 * A client component asking for a namespace the provider was not given finds
 * nothing. In development that throws; in production `onError` swallows it
 * and the KEY is rendered instead of the text — a silent, production-only
 * defect. So the list is checked against the code rather than trusted.
 */

const SOURCE_ROOT = path.join(process.cwd(), 'src')

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)

    if (entry.isDirectory()) return walk(full)

    return entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')
      ? [full]
      : []
  })

/** Files carrying the `'use client'` directive. */
const clientFiles = walk(SOURCE_ROOT).filter((file) => {
  const source = readFileSync(file, 'utf8')

  return /^\s*['"]use client['"]/m.test(source)
})

/** `useTranslations('contact.form')` -> `contact` */
const namespacesUsedIn = (source: string): string[] =>
  [...source.matchAll(/useTranslations\(\s*['"]([^'"]+)['"]\s*\)/g)].map(
    (match) => (match[1] ?? '').split('.')[0] ?? '',
  )

describe('client message namespaces', () => {
  it('finds the client components, or this test is vacuous', () => {
    assert.ok(
      clientFiles.length >= 4,
      `only found ${clientFiles.length} 'use client' files`,
    )
  })

  it('every namespace a client component asks for is sent to the browser', () => {
    const allowed = new Set<string>(CLIENT_NAMESPACES)

    for (const file of clientFiles) {
      const source = readFileSync(file, 'utf8')

      for (const namespace of namespacesUsedIn(source)) {
        assert.ok(
          allowed.has(namespace),
          `${path.relative(process.cwd(), file)} calls useTranslations('${namespace}') ` +
            `but '${namespace}' is not in CLIENT_NAMESPACES, so the provider never ` +
            `receives it.\n` +
            `In production that renders the KEY instead of the text, silently.\n` +
            `Add '${namespace}' to CLIENT_NAMESPACES and to pickClientMessages ` +
            `in src/i18n/client-messages.ts.`,
        )
      }
    }
  })

  it('does not send a namespace no client component uses', () => {
    // The other direction. A namespace left in the list after its last
    // consumer went away is payload on every page for nobody.
    const used = new Set<string>()

    for (const file of clientFiles) {
      for (const namespace of namespacesUsedIn(readFileSync(file, 'utf8'))) {
        used.add(namespace)
      }
    }

    for (const namespace of CLIENT_NAMESPACES) {
      assert.ok(
        used.has(namespace),
        `CLIENT_NAMESPACES includes '${namespace}' but no 'use client' file ` +
          `calls useTranslations('${namespace}'). Remove it, or the whole ` +
          `namespace ships in the HTML of every page for nothing.`,
      )
    }
  })

  it('picks exactly those namespaces and nothing else', () => {
    const picked = pickClientMessages(cs)

    assert.deepEqual(Object.keys(picked).sort(), [...CLIENT_NAMESPACES].sort())
  })

  it('leaves the server-only namespaces out', () => {
    const picked = pickClientMessages(cs) as Record<string, unknown>

    for (const serverOnly of [
      'common',
      'home',
      'history',
      'tip',
      'pricing',
      'legal',
    ]) {
      assert.equal(
        picked[serverOnly],
        undefined,
        `${serverOnly} is resolved on the server and must not be serialised ` +
          'into the page',
      )
    }
  })

  it('ships a fraction of the catalogue', () => {
    const whole = JSON.stringify(cs).length
    const sent = JSON.stringify(pickClientMessages(cs)).length

    // Not a performance assertion so much as a check that the narrowing is
    // actually doing something. If this ever approaches 1, the split has
    // stopped being worth its complexity and should be removed.
    assert.ok(
      sent < whole * 0.4,
      `client messages are ${sent} of ${whole} bytes — the split is not earning its keep`,
    )
  })
})
