import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  GATE_HEADER,
  PRIVATE_MAINTENANCE_HTML,
  PRIVATE_ROBOTS_TXT,
  refusalResponse,
} from './responses.ts'

/**
 * The refusals themselves, and the Czech page PRIVATE mode answers with.
 *
 * That page is customer-facing copy that lives outside the message
 * catalogue (see the comment in `responses.ts`), so the catalogue's copy
 * test cannot see it. The rules that apply to it are restated here.
 */

describe('the PRIVATE-mode response', () => {
  it('is a 503 Czech HTML page that nothing may cache or index', async () => {
    const response = refusalResponse('private', { method: 'GET' })

    assert.equal(response.status, 503)
    assert.equal(
      response.headers.get('content-type'),
      'text/html; charset=utf-8',
    )
    assert.equal(response.headers.get('content-language'), 'cs')
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow')
    assert.equal(response.headers.get(GATE_HEADER), 'private')
    assert.equal(await response.text(), PRIVATE_MAINTENANCE_HTML)
  })

  it('declares its language and encoding, and asks not to be indexed', () => {
    assert.match(PRIVATE_MAINTENANCE_HTML, /^<!doctype html>/)
    assert.match(PRIVATE_MAINTENANCE_HTML, /<html lang="cs">/)
    assert.match(PRIVATE_MAINTENANCE_HTML, /<meta charset="utf-8">/)
    assert.match(
      PRIVATE_MAINTENANCE_HTML,
      /<meta name="robots" content="noindex, nofollow">/,
    )
    assert.match(PRIVATE_MAINTENANCE_HTML, /<title>[^<]+<\/title>/)
    assert.match(PRIVATE_MAINTENANCE_HTML, /<h1>[^<]+<\/h1>/)
  })

  it('loads nothing: no script, style, image, frame, form or link', () => {
    // Every other path is refused in this mode, so anything the page tried
    // to fetch would fail; and a refusal should not run code at all.
    for (const tag of [
      '<script',
      '<style',
      '<link',
      '<img',
      '<iframe',
      '<form',
      '<a ',
      'style=',
      'src=',
      'href=',
    ]) {
      assert.ok(
        !PRIVATE_MAINTENANCE_HTML.toLowerCase().includes(tag),
        `the maintenance page contains ${tag}`,
      )
    }
  })

  it('is Czech, with its diacritics intact', () => {
    assert.match(PRIVATE_MAINTENANCE_HTML, /dočasně nedostupný/)
    assert.match(PRIVATE_MAINTENANCE_HTML, /Sázej chytře/)
    // Rule 4 of the copy rules: no stripped spellings.
    for (const stripped of ['docasne', 'nedostupny', 'Sazej chytre']) {
      assert.ok(!PRIVATE_MAINTENANCE_HTML.includes(stripped), stripped)
    }
  })

  it('follows the copy rules: no betting imperative, no promise, no urgency', () => {
    // The words a reader sees, title included; markup removed.
    const visible = PRIVATE_MAINTENANCE_HTML.replace(/<[^>]*>/g, ' ')
    const text = visible.toLowerCase()

    assert.match(visible, /Zkuste to prosím později/)

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
      !/\d/.test(visible),
      'the visible text must not state a date, time or number',
    )
  })

  it('names no person, company or identifier', () => {
    // Operator identity comes from `src/lib/legal/operator.ts` only
    // (AGENTS.md rule 12); a refusal has no reason to carry it.
    assert.ok(!/IČO|IČ:|s\.r\.o\.|@/.test(PRIVATE_MAINTENANCE_HTML))
  })

  it('has no body for HEAD', async () => {
    const response = refusalResponse('private', { method: 'HEAD' })

    assert.equal(response.status, 503)
    assert.equal(await response.text(), '')
  })
})

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

  it('keeps 404 and 405 plain text, with Allow on the 405', async () => {
    const notFound = refusalResponse('not-found', { method: 'POST' })
    assert.equal(notFound.status, 404)
    assert.equal(
      notFound.headers.get('content-type'),
      'text/plain; charset=utf-8',
    )
    assert.equal(notFound.headers.get('content-language'), null)

    const method = refusalResponse('method', {
      method: 'DELETE',
      allow: ['GET', 'HEAD'],
    })
    assert.equal(method.status, 405)
    assert.equal(method.headers.get('allow'), 'GET, HEAD')
    assert.equal(await method.text(), 'Method Not Allowed\n')
  })

  it('marks every refusal no-store and noindex', () => {
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
    }
  })
})
