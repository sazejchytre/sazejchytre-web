import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { isLinkServedInMode } from './links.ts'
import { LAUNCH_MODES, type LaunchMode } from './modes.ts'

/**
 * `isLinkServedInMode` is what navigation and calls to action ask before
 * rendering a link. The expectations are written out per mode rather than
 * derived from the gate, so the suite checks the helper against intent.
 */

const servedIn = (href: string): LaunchMode[] =>
  LAUNCH_MODES.filter((mode) => isLinkServedInMode(mode, href))

describe('links the site renders', () => {
  it('serves the checkout links only in FULL', () => {
    // Exactly the shapes `TierCards` builds.
    for (const href of [
      '/predplatne',
      '/predplatne?plan=BASIC&obdobi=mesicne',
      '/predplatne?plan=PRO&obdobi=rocne',
    ]) {
      assert.deepEqual(servedIn(href), ['FULL'], href)
    }
  })

  it('serves the account links only in FULL', () => {
    for (const href of [
      '/prihlaseni',
      '/prihlaseni/dvoufazove',
      '/registrace',
      '/zapomenute-heslo',
      '/ucet',
      '/ucet/doklady',
    ]) {
      assert.deepEqual(servedIn(href), ['FULL'], href)
    }
  })

  it('serves the informational pages in INFORMATIONAL and FULL, not PRIVATE', () => {
    for (const href of [
      '/',
      '/#novinky',
      '/historie',
      '/metodika',
      '/cenik',
      '/cenik?obdobi=rocne',
      '/kontakt',
      '/obchodni-podminky',
      '/ochrana-osobnich-udaju',
      '/cookies',
      '/tipy/some-analysis',
    ]) {
      assert.deepEqual(servedIn(href), ['INFORMATIONAL', 'FULL'], href)
    }
  })

  it('does not claim an unknown path is served outside FULL', () => {
    assert.deepEqual(servedIn('/does-not-exist'), ['FULL'])
  })
})

describe('anything that is not a root-relative link', () => {
  it('is never judged served, in any mode', () => {
    for (const href of [
      '',
      'cenik',
      'https://sazejchytre.cz/cenik',
      'mailto:someone@example.invalid',
      'tel:800350000',
      // Root-relative only in appearance: a browser reads both as another host.
      '//example.invalid/cenik',
      '/\\example.invalid/cenik',
    ]) {
      assert.deepEqual(servedIn(href), [], JSON.stringify(href))
    }
  })
})

describe('an invalid mode', () => {
  it('serves what PRIVATE serves, which is no public page', () => {
    for (const mode of [undefined, '', 'full', 'FULL ', 'PUBLIC']) {
      assert.equal(isLinkServedInMode(mode, '/cenik'), false, String(mode))
      assert.equal(isLinkServedInMode(mode, '/predplatne'), false, String(mode))
    }
  })
})
