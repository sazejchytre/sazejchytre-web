/**
 * Private initialization: creates the first administrator account.
 *
 * Run it on the server, against the production database, BEFORE the site is
 * reachable — the exact procedure is in `docs/DEPLOYMENT.md` ("First
 * administrator"). A production server does not start until a verified
 * administrator exists, so this command is how a fresh install, or a restore
 * that has none, is brought up.
 *
 *   node --env-file-if-exists=.env --import tsx src/scripts/admin-init.ts \
 *     --email <address> --name "<display name>"
 *
 * The password comes from a hidden prompt (asked twice), or from standard
 * input with `--password-stdin`. Never from an argument or a variable.
 *
 * It refuses if a verified administrator already exists: additional
 * administrators are created by a signed-in administrator in the panel, and
 * this command is not a way around that. The refusal is enforced by the
 * `users` hooks under a database lock, not only by the check below, so two
 * concurrent runs cannot both succeed.
 *
 * After creating the account it signs in with the same credentials, through
 * Payload's normal login, and reports the result. It prints no token, no
 * password and no connection string.
 *
 * Exit codes: 0 created and verified · 2 refused (administrator exists, bad
 * arguments or password) · 1 anything else.
 */
/* eslint-disable no-console -- this is a CLI; stdout is its interface. */
import { stdin, stdout } from 'node:process'

import type { Payload } from 'payload'

import { bootstrapContext } from '../lib/admin-presence/bootstrap.ts'
import {
  USAGE,
  checkAdministratorPassword,
  parseInitArguments,
  passwordFromStdinText,
} from '../lib/admin-presence/init-args.ts'
import { COUNT_VERIFIED_ADMINISTRATORS_SQL } from '../lib/admin-presence/policy.ts'

// Payload and its configuration are imported only once the arguments and the
// password have been checked (below): loading them takes a while, and a
// refusal should not.

const REFUSED = 2

const fail = (message: string, code = REFUSED): never => {
  console.error(`admin-init: ${message}`)
  process.exit(code)
}

const readAllStdin = async (): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const chunk of stdin) chunks.push(Buffer.from(chunk))

  return Buffer.concat(chunks).toString('utf8')
}

/** One line from the terminal without echoing it. */
const promptHidden = (question: string): Promise<string> =>
  new Promise((resolve, reject) => {
    if (!stdin.isTTY) {
      reject(
        new Error(
          'No terminal for the password prompt. Run with a TTY (docker -it) or pass --password-stdin.',
        ),
      )
      return
    }

    stdout.write(question)
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')

    let value = ''

    const done = (error?: Error) => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.removeListener('data', onData)
      stdout.write('\n')
      if (error) reject(error)
      else resolve(value)
    }

    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') return done()
        if (char === '\u0003') return done(new Error('Cancelled.'))
        if (char === '\u007f' || char === '\b') {
          value = [...value].slice(0, -1).join('')
          continue
        }
        value += char
      }
    }

    stdin.on('data', onData)
  })

const countVerifiedAdministrators = async (
  payload: Payload,
): Promise<number> => {
  const db = (
    payload.db as unknown as {
      pool: { query: (text: string) => Promise<{ rows: { count: unknown }[] }> }
    }
  ).pool
  const result = await db.query(COUNT_VERIFIED_ADMINISTRATORS_SQL)

  return Number(result.rows[0]?.count ?? 0)
}

const databaseName = async (payload: Payload): Promise<string> => {
  const db = (
    payload.db as unknown as {
      pool: { query: (text: string) => Promise<{ rows: { name: string }[] }> }
    }
  ).pool
  const result = await db.query('SELECT current_database() AS "name"')

  return result.rows[0]?.name ?? 'unknown'
}

const parsed = parseInitArguments(process.argv.slice(2))
if (!parsed.ok) fail(`${parsed.error}\n${USAGE}`)
const { email, name, passwordFromStdin } = parsed.ok
  ? parsed.value
  : (undefined as never)

let password: string
try {
  if (passwordFromStdin) {
    password = passwordFromStdinText(await readAllStdin())
  } else {
    password = await promptHidden('Password: ')
    const repeated = await promptHidden('Repeat password: ')
    if (repeated !== password) fail('The two passwords do not match.')
  }
} catch (error) {
  password = fail(error instanceof Error ? error.message : 'No password read.')
}

const passwordVerdict = checkAdministratorPassword(password)
if (!passwordVerdict.ok) fail(passwordVerdict.error)

const { getPayload } = await import('payload')
const { default: config } = await import('../payload.config.ts')
const payload = await getPayload({ config })

console.log(`admin-init: database "${await databaseName(payload)}"`)

const before = await countVerifiedAdministrators(payload)
if (before > 0) {
  fail(
    `refused: ${before} verified administrator(s) already exist. ` +
      'Create further administrators from the admin panel while signed in.',
  )
}

let createdId: number | string
try {
  const created = await payload.create({
    collection: 'users',
    data: { email, name, password },
    overrideAccess: true,
    context: bootstrapContext(),
    depth: 0,
  })
  createdId = created.id
} catch (error) {
  const status = (error as { status?: unknown }).status
  const message = error instanceof Error ? error.message : 'unknown error'
  createdId = fail(
    `refused: ${message}`,
    status === 409 || status === 403 || status === 400 ? REFUSED : 1,
  )
}

console.log(`admin-init: administrator created (id ${String(createdId)})`)

// Prove the account authenticates through the normal sign-in path.
try {
  const login = await payload.login({
    collection: 'users',
    data: { email, password },
  })
  if (String(login.user?.id) !== String(createdId)) {
    fail('sign-in returned a different account.', 1)
  }
} catch (error) {
  fail(
    `the account was created but sign-in failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    1,
  )
}

console.log('admin-init: sign-in with the new credentials verified')
console.log(
  `admin-init: verified administrators: ${await countVerifiedAdministrators(payload)}`,
)

process.exit(0)
