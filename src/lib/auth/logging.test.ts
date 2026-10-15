import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  type AuthLogLevel,
  authLog,
  hashIdentifier,
  redactFields,
  redactValue,
  setAuthLogSink,
} from './logging.ts'

/** Capture everything the logger emits, as the text a log file would hold. */
const capture = (work: () => void): { lines: string[]; text: string } => {
  const lines: string[] = []

  const restore = setAuthLogSink(
    (level: AuthLogLevel, event: string, fields: Record<string, unknown>) => {
      lines.push(JSON.stringify({ level, event, ...fields }))
    },
  )

  try {
    work()
  } finally {
    restore()
  }

  return { lines, text: lines.join('\n') }
}

describe('redaction by field name', () => {
  it('drops anything whose name looks like a secret', () => {
    const out = redactFields({
      token: 'abc123',
      resetToken: 'xyz',
      password: 'hunter2hunter2',
      totpSecret: 'JBSWY3DPEHPK3PXP',
      backupCodes: ['a', 'b'],
      sessionId: 'sess_123',
      authorization: 'Bearer abc',
      apiKey: 'k',
    })

    for (const [key, value] of Object.entries(out)) {
      assert.equal(value, '[redacted]', `${key} should be redacted`)
    }
  })

  it('keeps harmless fields readable', () => {
    const out = redactFields({ kind: 'password_reset', status: 429, ok: false })

    assert.equal(out.kind, 'password_reset')
    assert.equal(out.status, 429)
    assert.equal(out.ok, false)
  })

  it('hashes email addresses instead of dropping them', () => {
    // Correlating events for one account must stay possible without the log
    // holding the address.
    const out = redactFields({ email: 'Zakaznik@Example.com' })

    assert.notEqual(out.email, 'Zakaznik@Example.com')
    assert.match(String(out.email), /^acct_[0-9a-f]{12}$/)
    // Stable and case-insensitive, so two events for one person correlate.
    assert.equal(out.email, hashIdentifier('zakaznik@example.com'))
  })

  it('recurses into nested objects', () => {
    const out = redactFields({ meta: { token: 'abc', kind: 'verify' } })
    const meta = out.meta as Record<string, unknown>

    assert.equal(meta.token, '[redacted]')
    assert.equal(meta.kind, 'verify')
  })
})

describe('redaction by value shape', () => {
  it('scrubs a token carried inside a URL under an innocent field name', () => {
    // Name-based filtering alone would miss this: `url` is not a secret name.
    const out = redactFields({
      url: 'https://sazejchytre.cz/obnova-hesla?token=S3cr3tR3s3tT0k3nV4lu3',
    })

    const value = String(out.url)
    assert.ok(!value.includes('S3cr3tR3s3tT0k3nV4lu3'))
    assert.match(value, /token=\[redacted\]/)
  })

  it('scrubs long opaque strings anywhere', () => {
    const value = String(redactValue('session abcdefghijklmnopqrstuvwxyz0123'))

    assert.ok(!value.includes('abcdefghijklmnopqrstuvwxyz0123'))
  })

  it('scrubs a numeric code that could be a TOTP', () => {
    assert.ok(!String(redactValue('code 492013')).includes('492013'))
  })
})

describe('full password-reset flow leaves no token in the logs', () => {
  it('greps the captured log output for the token and finds nothing', () => {
    // The token a real reset link carries.
    const token = 'rst_9HJk2LmNpQrStUvWxYz0AbCdEfGh'
    const resetUrl = `https://sazejchytre.cz/obnova-hesla?token=${token}`
    const email = 'zakaznik@example.com'

    // Every log call the reset flow makes, in order, with the real values.
    const { text, lines } = capture(() => {
      authLog.info('reset_request.received', { email })
      authLog.info('email.sent', { kind: 'password_reset', email })
      // The pessimistic cases: a careless caller passing the link or token
      // through anyway. The logger has to survive those too.
      authLog.info('reset_request.link_built', { email, url: resetUrl })
      authLog.warn('reset.failed', { email, token })
      authLog.info('reset.succeeded', { email, sessionId: 'sess_abc123xyz' })
      authLog.info('email.sent', { kind: 'password_changed', email })
    })

    assert.ok(lines.length === 6, 'all six events were captured')

    // THE assertion. If this fails, a reset token is reaching the logs, and
    // anyone with log access can take over the account it belongs to.
    assert.ok(
      !text.includes(token),
      `the reset token appeared in the log output:\n${text}`,
    )

    // And neither does the raw address or the session id.
    assert.ok(!text.includes(email), 'the email address appeared in the logs')
    assert.ok(!text.includes('sess_abc123xyz'), 'the session id appeared')

    // The events themselves are still there — redaction must not silence the
    // log, only the secrets in it.
    assert.ok(text.includes('reset.succeeded'))
    assert.ok(text.includes('password_changed'))
  })

  it('also finds nothing for a verification token', () => {
    const token = 'vrf_ZxYwVuTsRqPoNmLkJiHgFeDcBa98'

    const { text } = capture(() => {
      authLog.info('email.sent', {
        kind: 'verify_email',
        email: 'novy@example.com',
        url: `https://sazejchytre.cz/auth/verify-email?token=${token}&callbackURL=%2Fucet`,
      })
    })

    assert.ok(!text.includes(token), `verification token leaked:\n${text}`)
  })

  it('also finds nothing for a backup code or TOTP secret', () => {
    const { text } = capture(() => {
      authLog.info('two_factor.enabled', {
        email: 'a@example.com',
        totpSecret: 'JBSWY3DPEHPK3PXP',
        backupCodes: ['A1B2C3D4E5', 'F6G7H8I9J0'],
      })
    })

    assert.ok(!text.includes('JBSWY3DPEHPK3PXP'))
    assert.ok(!text.includes('A1B2C3D4E5'))
  })
})
