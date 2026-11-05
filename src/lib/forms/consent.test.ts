import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  MARKETING_CONSENT_FINGERPRINT,
  MARKETING_CONSENT_VERSION,
  fingerprintConsentText,
  marketingConsentText,
} from './consent.ts'

describe('the marketing consent wording', () => {
  it('still matches the fingerprint recorded for this version', () => {
    const actual = fingerprintConsentText(marketingConsentText())

    assert.equal(
      actual,
      MARKETING_CONSENT_FINGERPRINT,
      'The marketing consent wording in src/i18n/messages/cs.ts has changed.\n' +
        'That is allowed — but the consent VERSION has to change with it, or ' +
        'two different texts end up recorded under one version string and the ' +
        'grouping stops meaning anything.\n\n' +
        `  1. bump MARKETING_CONSENT_VERSION (currently "${MARKETING_CONSENT_VERSION}")\n` +
        `  2. set MARKETING_CONSENT_FINGERPRINT to ${actual}\n\n` +
        'Records already written keep their own snapshot and version, which is ' +
        'the point: nothing already consented to is rewritten.',
    )
  })

  it('is a sentence a person can act on, not a reference to one', () => {
    const text = marketingConsentText()

    // Two things make a marketing consent defensible: it says what will be
    // sent, and it says how to stop it. Both have to be in the text itself,
    // because the text is what gets snapshotted into the record.
    assert.match(text, /novinek|novinky/i)
    assert.match(text, /odvolat/i)
  })

  it('carries a version that says what it is a version of', () => {
    assert.match(MARKETING_CONSENT_VERSION, /^newsletter-cs-\d{4}-\d{2}$/)
  })
})
