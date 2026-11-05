import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  HONEYPOT_FIELD,
  TURNSTILE_FIELD,
  isHoneypotTripped,
  parseContactForm,
  parseNewsletterForm,
  turnstileToken,
} from './schema.ts'

const form = (entries: Record<string, string>): FormData => {
  const data = new FormData()

  for (const [key, value] of Object.entries(entries)) {
    data.set(key, value)
  }

  return data
}

const validContact = {
  name: 'Jan Novák',
  email: 'jan@example.cz',
  subject: 'Dotaz k předplatnému',
  message: 'Dobrý den, chtěl bych se zeptat na fakturaci.',
}

/* -------------------------------------------------------------------------- */

describe('parseContactForm', () => {
  it('accepts a filled-in form and trims it', () => {
    const result = parseContactForm(
      form({ ...validContact, name: '  Jan Novák  ' }),
    )

    assert.equal(result.ok, true)
    assert.equal(result.ok && result.value.name, 'Jan Novák')
  })

  it('reports one code per field, not a sentence', () => {
    // The copy lives in the catalogue, where the copy-rule test can see it.
    const result = parseContactForm(form({}))

    assert.equal(result.ok, false)
    assert.deepEqual(result.ok ? {} : result.errors, {
      name: 'required',
      email: 'required',
      subject: 'required',
      message: 'required',
    })
  })

  it('rejects a malformed address as invalidEmail, not as required', () => {
    const result = parseContactForm(
      form({ ...validContact, email: 'jan(at)example.cz' }),
    )

    assert.equal(result.ok ? '' : result.errors.email, 'invalidEmail')
  })

  it('rejects an over-long message', () => {
    const result = parseContactForm(
      form({ ...validContact, message: 'a'.repeat(5_001) }),
    )

    assert.equal(result.ok ? '' : result.errors.message, 'tooLong')
  })

  it('rejects a one-word message as tooShort rather than accepting it', () => {
    const result = parseContactForm(form({ ...validContact, message: 'ahoj' }))

    assert.equal(result.ok ? '' : result.errors.message, 'tooShort')
  })

  it('treats a whitespace-only field as missing', () => {
    const result = parseContactForm(form({ ...validContact, name: '    ' }))

    assert.equal(result.ok ? '' : result.errors.name, 'required')
  })

  it('does not accept a File where a string belongs', () => {
    // What a crafted multipart body can send. Without the guard this reads as
    // a non-empty string and passes `required`.
    const data = form(validContact)
    data.set('name', new File(['x'], 'name.txt'))

    const result = parseContactForm(data)

    assert.equal(result.ok ? '' : result.errors.name, 'required')
  })

  it('accepts Czech diacritics in every field', () => {
    const result = parseContactForm(
      form({
        name: 'Žofie Čápová',
        email: 'zofie@example.cz',
        subject: 'Zrušení předplatného — dotaz',
        message: 'Děkuji za odpověď, ještě bych potřebovala upřesnit účtování.',
      }),
    )

    assert.equal(result.ok, true)
  })
})

/* -------------------------------------------------------------------------- */

describe('parseNewsletterForm', () => {
  it('accepts an address with the consent box ticked', () => {
    const result = parseNewsletterForm(
      form({ email: 'jan@example.cz', consent: 'on' }),
    )

    assert.equal(result.ok, true)
  })

  it('refuses to subscribe without consent', () => {
    // An unticked checkbox sends nothing at all, which must be an error
    // rather than a silent `false`.
    const result = parseNewsletterForm(form({ email: 'jan@example.cz' }))

    assert.equal(result.ok, false)
    assert.equal(result.ok ? '' : result.errors.consent, 'consentRequired')
  })

  it('refuses a consent value the checkbox could not have sent', () => {
    const result = parseNewsletterForm(
      form({ email: 'jan@example.cz', consent: 'false' }),
    )

    assert.equal(result.ok, false)
  })
})

/* -------------------------------------------------------------------------- */

describe('isHoneypotTripped', () => {
  it('is not tripped by an empty hidden field', () => {
    assert.equal(isHoneypotTripped(form({ [HONEYPOT_FIELD]: '' })), false)
  })

  it('is not tripped when the field is absent entirely', () => {
    assert.equal(isHoneypotTripped(form({})), false)
  })

  it('is tripped by any value at all', () => {
    assert.equal(
      isHoneypotTripped(form({ [HONEYPOT_FIELD]: 'https://spam.example' })),
      true,
    )
  })

  it('is not called "honeypot" in the markup', () => {
    // A bot that reads the HTML would leave a field called `honeypot` alone.
    assert.notEqual(HONEYPOT_FIELD, 'honeypot')
  })
})

describe('turnstileToken', () => {
  it('returns null when the widget never ran', () => {
    assert.equal(turnstileToken(form({})), null)
  })

  it('returns null for a blank token rather than an empty string', () => {
    assert.equal(turnstileToken(form({ [TURNSTILE_FIELD]: '   ' })), null)
  })

  it('returns the token when present', () => {
    assert.equal(turnstileToken(form({ [TURNSTILE_FIELD]: 'abc' })), 'abc')
  })

  it('uses the field name the widget actually posts', () => {
    assert.equal(TURNSTILE_FIELD, 'cf-turnstile-response')
  })
})
