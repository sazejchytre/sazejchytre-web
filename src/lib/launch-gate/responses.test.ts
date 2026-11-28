import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { isLinkServedInMode } from './links.ts'
import {
  GATE_HEADER,
  GATE_SEEN_HEADER,
  NOT_FOUND_HTML,
  PRIVATE_MAINTENANCE_HTML,
  PRIVATE_ROBOTS_TXT,
  refusalResponse,
} from './responses.ts'

/**
 * The refusals themselves, and the two Czech pages the gate answers with:
 * the PRIVATE maintenance page and the INFORMATIONAL not-found page.
 *
 * Both are customer-facing copy that lives outside the message catalogue
 * (see the comment in `responses.ts`), so the catalogue's copy test cannot
 * see them. The rules that apply to them are restated here.
 */

const PAGES = [
  {
    name: 'the PRIVATE maintenance page',
    html: PRIVATE_MAINTENANCE_HTML,
    reason: 'private',
    status: 503,
    phrases: [/dočasně nedostupný/, /Zkuste to prosím později/],
    stripped: ['docasne', 'nedostupny'],
    links: [] as string[],
  },
  {
    name: 'the INFORMATIONAL not-found page',
    html: NOT_FOUND_HTML,
    reason: 'not-found',
    status: 404,
    phrases: [/Stránka nenalezena/, /Přejít na úvodní stránku/],
    stripped: ['Stranka', 'Prejit', 'uvodni'],
    links: ['/'],
  },
] as const

const visibleText = (html: string): string => html.replace(/<[^>]*>/g, ' ')

for (const page of PAGES) {
  describe(page.name, () => {
    it('is answered as Czech HTML that nothing may cache or index', async () => {
      const response = refusalResponse(page.reason, { method: 'GET' })

      assert.equal(response.status, page.status)
      assert.equal(
        response.headers.get('content-type'),
        'text/html; charset=utf-8',
      )
      assert.equal(response.headers.get('content-language'), 'cs')
      assert.equal(response.headers.get('cache-control'), 'no-store')
      assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow')
      assert.equal(response.headers.get(GATE_HEADER), page.reason)
      assert.equal(response.headers.get(GATE_SEEN_HEADER), '1')
      assert.equal(await response.text(), page.html)
    })

    it('is the same answer for every method that carries a body', async () => {
      for (const method of [
        'GET',
        'POST',
        'PUT',
        'PATCH',
        'DELETE',
        'OPTIONS',
      ]) {
        const response = refusalResponse(page.reason, { method })
        assert.equal(response.status, page.status, method)
        assert.equal(await response.text(), page.html, method)
      }
    })

    it('has no body for HEAD', async () => {
      const response = refusalResponse(page.reason, { method: 'HEAD' })

      assert.equal(response.status, page.status)
      assert.equal(await response.text(), '')
    })

    it('declares its language and encoding, and asks not to be indexed', () => {
      assert.match(page.html, /^<!doctype html>/)
      assert.match(page.html, /<html lang="cs">/)
      assert.match(page.html, /<meta charset="utf-8">/)
      assert.match(
        page.html,
        /<meta name="robots" content="noindex, nofollow">/,
      )
      assert.match(page.html, /<title>[^<]+<\/title>/)
      assert.match(page.html, /<h1>[^<]+<\/h1>/)
    })

    it('loads nothing: no script, style, image, frame or form', () => {
      // A refusal must not depend on any other path, and must not run code.
      for (const tag of [
        '<script',
        '<style',
        '<link',
        '<img',
        '<iframe',
        '<form',
        'style=',
        'src=',
      ]) {
        assert.ok(
          !page.html.toLowerCase().includes(tag),
          `${page.name} contains ${tag}`,
        )
      }
    })

    it('links only where it is meant to, and only to served paths', () => {
      const hrefs = [...page.html.matchAll(/href="([^"]*)"/g)].map((m) => m[1])

      assert.deepEqual(hrefs, page.links)

      // The not-found page is only ever answered in INFORMATIONAL; its link
      // must be one that mode serves, or it would be a dead end of its own.
      for (const href of hrefs) {
        assert.ok(isLinkServedInMode('INFORMATIONAL', href ?? ''), href)
      }
    })

    it('is Czech, with its diacritics intact', () => {
      assert.match(page.html, /Sázej chytře/)
      for (const phrase of page.phrases) assert.match(page.html, phrase)

      // Rule 4 of the copy rules: no stripped spellings.
      for (const stripped of [...page.stripped, 'Sazej chytre']) {
        assert.ok(!page.html.includes(stripped), stripped)
      }
    })

    it('follows the copy rules: no betting imperative, no promise, no urgency', () => {
      const text = visibleText(page.html).toLowerCase()

      for (const forbidden of [
        // rule 1
        'vsaď',
        'vsadit',
        'hraj',
        'tipni',
        'tipněte',
        // rule 2
        'vyděl',
        'zaručen',
        'garant',
        'zisk',
        // no false urgency, no invented launch date (AGENTS.md rule 11)
        'brzy',
        'již za',
        'už za',
        'spouštíme',
        'poslední',
        'nenechte',
        'neváhejte',
        '!',
      ]) {
        assert.ok(!text.includes(forbidden), `contains "${forbidden}"`)
      }

      assert.ok(
        !/\d/.test(visibleText(page.html)),
        'the visible text must not state a date, time or number',
      )
    })

    it('names no person, company or identifier', () => {
      // Operator identity comes from `src/lib/legal/operator.ts` only
      // (AGENTS.md rule 12); a refusal has no reason to carry it.
      assert.ok(!/IČO|IČ:|s\.r\.o\.|@/.test(page.html))
    })
  })
}

describe('the other refusals', () => {
  it('answers robots.txt in PRIVATE mode with disallow-everything', async () => {
    const response = refusalResponse('private-robots', { method: 'GET' })

    assert.equal(response.status, 200)
    assert.equal(
      response.headers.get('content-type'),
      'text/plain; charset=utf-8',
    )
    assert.equal(await response.text(), PRIVATE_ROBOTS_TXT)
  })

  it('keeps 405 plain text, with Allow', async () => {
    const method = refusalResponse('method', {
      method: 'DELETE',
      allow: ['GET', 'HEAD'],
    })
    assert.equal(method.status, 405)
    assert.equal(method.headers.get('allow'), 'GET, HEAD')
    assert.equal(
      method.headers.get('content-type'),
      'text/plain; charset=utf-8',
    )
    assert.equal(await method.text(), 'Method Not Allowed\n')
  })

  it('marks every refusal no-store, noindex and as seen by the gate', () => {
    for (const reason of [
      'private',
      'private-robots',
      'not-found',
      'method',
    ] as const) {
      const response = refusalResponse(reason)
      assert.equal(response.headers.get('cache-control'), 'no-store', reason)
      assert.equal(
        response.headers.get('x-robots-tag'),
        'noindex, nofollow',
        reason,
      )
      assert.equal(response.headers.get(GATE_HEADER), reason, reason)
      assert.equal(response.headers.get(GATE_SEEN_HEADER), '1', reason)
    }
  })
})
