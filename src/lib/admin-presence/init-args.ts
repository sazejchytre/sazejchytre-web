/**
 * Argument and password rules for the initialization command
 * (`src/scripts/admin-init.ts`).
 *
 * The password is never accepted as an argument or an environment variable:
 * both end up in shell history, process listings and container metadata. It
 * comes from a hidden prompt on a terminal, or from standard input with
 * `--password-stdin` (for piping from a password manager).
 *
 * Dependency-free apart from the shared password policy, so it is unit-tested
 * under Node's type stripping.
 */
import { checkPassword } from '../auth/password-policy.ts'

import { ADMINISTRATOR_MIN_PASSWORD_LENGTH } from './policy.ts'

export type InitArguments = {
  email: string
  name: string
  passwordFromStdin: boolean
}

export type ParseResult =
  { ok: true; value: InitArguments } | { ok: false; error: string }

export const USAGE =
  'Usage: admin-init --email <address> --name <display name> [--password-stdin]\n' +
  '  The password is read from a hidden prompt, or from standard input with\n' +
  '  --password-stdin. It is never accepted as an argument.'

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export const parseInitArguments = (argv: readonly string[]): ParseResult => {
  let email: string | undefined
  let name: string | undefined
  let passwordFromStdin = false

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? ''
    const [flag, inline] = argument.startsWith('--')
      ? (argument.split(/=(.*)/s, 2) as [string, string | undefined])
      : [argument, undefined]

    const takeValue = (): string | undefined => {
      if (inline !== undefined) return inline
      const next = argv[index + 1]
      if (next === undefined || next.startsWith('--')) return undefined
      index += 1

      return next
    }

    switch (flag) {
      case '--email':
        email = takeValue()
        if (email === undefined)
          return { ok: false, error: '--email needs a value.' }
        break
      case '--name':
        name = takeValue()
        if (name === undefined)
          return { ok: false, error: '--name needs a value.' }
        break
      case '--password-stdin':
        passwordFromStdin = true
        break
      case '--password':
        return {
          ok: false,
          error:
            'The password is not accepted as an argument. Use the prompt or --password-stdin.',
        }
      default:
        return { ok: false, error: `Unknown argument: ${flag}` }
    }
  }

  const trimmedEmail = email?.trim().toLowerCase() ?? ''
  const trimmedName = name?.trim() ?? ''

  if (!EMAIL.test(trimmedEmail)) {
    return { ok: false, error: 'A valid --email is required.' }
  }

  if (trimmedName.length === 0) {
    return { ok: false, error: 'A non-empty --name is required.' }
  }

  return {
    ok: true,
    value: { email: trimmedEmail, name: trimmedName, passwordFromStdin },
  }
}

export type PasswordVerdict = { ok: true } | { ok: false; error: string }

/**
 * The customer password policy (length, common-password list), with a
 * longer minimum: this account can read every customer and accounting
 * record.
 */
export const checkAdministratorPassword = (
  password: string,
): PasswordVerdict => {
  if ([...password].length < ADMINISTRATOR_MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `The password must have at least ${ADMINISTRATOR_MIN_PASSWORD_LENGTH} characters.`,
    }
  }

  const check = checkPassword(password)

  if (!check.ok) {
    return {
      ok: false,
      error:
        check.reason === 'TOO_COMMON'
          ? 'The password is on the list of common passwords.'
          : check.reason === 'TOO_LONG'
            ? 'The password is too long.'
            : 'The password is not acceptable.',
    }
  }

  return { ok: true }
}

/** Standard input as a password: one trailing newline removed, no more. */
export const passwordFromStdinText = (text: string): string =>
  text.replace(/\r?\n$/, '')
