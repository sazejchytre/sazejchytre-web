import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  checkAdministratorPassword,
  parseInitArguments,
  passwordFromStdinText,
} from './init-args.ts'

describe('parseInitArguments', () => {
  it('reads email and name, normalising the email', () => {
    assert.deepEqual(
      parseInitArguments([
        '--email',
        ' Owner@Example.TEST ',
        '--name',
        'Owner',
      ]),
      {
        ok: true,
        value: {
          email: 'owner@example.test',
          name: 'Owner',
          passwordFromStdin: false,
        },
      },
    )
  })

  it('accepts --flag=value and --password-stdin', () => {
    const parsed = parseInitArguments([
      '--email=owner@example.test',
      '--name=The Owner',
      '--password-stdin',
    ])
    assert.equal(parsed.ok, true)
    assert.ok(parsed.ok && parsed.value.passwordFromStdin)
    assert.ok(parsed.ok && parsed.value.name === 'The Owner')
  })

  it('never accepts the password as an argument', () => {
    for (const argv of [
      ['--email', 'a@b.cz', '--name', 'x', '--password', 'secret'],
      ['--email', 'a@b.cz', '--name', 'x', '--password=secret'],
    ]) {
      const parsed = parseInitArguments(argv)
      assert.equal(parsed.ok, false)
      assert.ok(!parsed.ok && /not accepted as an argument/.test(parsed.error))
    }
  })

  it('requires a valid email and a name', () => {
    assert.equal(parseInitArguments(['--name', 'x']).ok, false)
    assert.equal(
      parseInitArguments(['--email', 'nope', '--name', 'x']).ok,
      false,
    )
    assert.equal(parseInitArguments(['--email', 'a@b.cz']).ok, false)
    assert.equal(
      parseInitArguments(['--email', 'a@b.cz', '--name', ' ']).ok,
      false,
    )
    assert.equal(parseInitArguments(['--email', '--name', 'x']).ok, false)
  })

  it('rejects unknown arguments', () => {
    const parsed = parseInitArguments([
      '--email',
      'a@b.cz',
      '--name',
      'x',
      '--force',
    ])
    assert.equal(parsed.ok, false)
  })
})

describe('checkAdministratorPassword', () => {
  it('requires at least 16 characters', () => {
    assert.equal(checkAdministratorPassword('fifteen-chars-x').ok, false)
    assert.equal(checkAdministratorPassword('sixteen-chars-xy').ok, true)
  })

  it('applies the common-password list', () => {
    // 16+ characters, and on the bundled list after normalisation.
    const verdict = checkAdministratorPassword('ASDFGHJKLZXCVBNM')
    assert.deepEqual(verdict, {
      ok: false,
      error: 'The password is on the list of common passwords.',
    })
  })

  it('refuses a password made only of spaces', () => {
    assert.equal(checkAdministratorPassword(' '.repeat(16)).ok, false)
  })

  it('refuses absurdly long input', () => {
    assert.equal(checkAdministratorPassword('x'.repeat(500)).ok, false)
  })
})

describe('passwordFromStdinText', () => {
  it('removes exactly one trailing newline', () => {
    assert.equal(passwordFromStdinText('secret\n'), 'secret')
    assert.equal(passwordFromStdinText('secret\r\n'), 'secret')
    assert.equal(passwordFromStdinText('secret\n\n'), 'secret\n')
    assert.equal(passwordFromStdinText(' secret '), ' secret ')
  })
})
