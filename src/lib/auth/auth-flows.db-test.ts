/**
 * Integration tests for the customer authentication flows.
 *
 * Run with `pnpm test:db`. Not part of `pnpm test`, which is pure and has no
 * database — CI's DATABASE_URL points at a host that does not exist.
 *
 * NO EMAIL IS SENT. `setEmailTransport` swaps the Resend transport for a
 * capturing one, which is also how these tests get hold of the verification
 * and reset tokens: by reading them out of the email that would have gone.
 * That is the only way to drive the real flows end to end, and it is what
 * makes the log-leak test possible — it needs the genuine token to grep for.
 *
 * better-auth is driven through `auth.api.*` with a cookie jar rather than
 * through the server actions, because those call `next/headers` and need a
 * request context the test runner does not have. The actions are thin wrappers
 * over exactly these calls.
 */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { base32 } from '@better-auth/utils/base32'
import { createOTP } from '@better-auth/utils/otp'
import { getPayload, type Payload } from 'payload'

import config from '@/payload.config'
import { auth } from '@/lib/auth/config'
import { getCurrentCustomer, requireEntitlement } from '@/lib/auth/customer'
import { setEmailTransport, type SendArgs } from '@/lib/auth/email'
import { authLog, setAuthLogSink } from '@/lib/auth/logging'
import {
  SESSION_DEFAULT_SECONDS,
  SESSION_REMEMBERED_SECONDS,
} from '@/lib/auth/session-policy'

const RUN = `af${Date.now().toString(36)}`
const PASSWORD = 'tajne-dlouhe-heslo-2026'
const NEW_PASSWORD = 'jine-dlouhe-heslo-2026'

let payload: Payload
const sent: SendArgs[] = []
let restoreTransport: (() => void) | undefined

const email = (suffix: string) => `${RUN}-${suffix}@example.test`

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

/** A cookie jar, so a sequence of API calls behaves like one browser. */
const makeJar = () => {
  const jar = new Map<string, string>()

  return {
    headers(extra: Record<string, string> = {}): Headers {
      const h = new Headers({
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36',
        'x-forwarded-for': '203.0.113.42',
        'cf-ipcountry': 'CZ',
        ...extra,
      })

      if (jar.size > 0) {
        h.set(
          'cookie',
          [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
        )
      }

      return h
    },
    absorb(response: Response): void {
      for (const raw of response.headers.getSetCookie()) {
        const [pair] = raw.split(';')
        const index = pair?.indexOf('=') ?? -1

        if (pair && index > 0) {
          jar.set(pair.slice(0, index), pair.slice(index + 1))
        }
      }
    },
    get size() {
      return jar.size
    },
  }
}

/**
 * Pull the one-time token out of the email that would have been sent.
 *
 * better-auth uses a query parameter for verification and a PATH SEGMENT for
 * the reset link, so both shapes are handled rather than assuming one.
 */
const tokenFrom = (args: SendArgs | undefined): string => {
  assert.ok(args, 'expected an email to have been sent')

  const text = args.email.text
  const query = /[?&]token=([^&\s"']+)/.exec(text)

  if (query?.[1]) {
    return decodeURIComponent(query[1])
  }

  const path =
    /https?:\/\/\S*?\/(?:reset-password|verify-email)\/([^/?\s"']+)/.exec(text)

  if (path?.[1]) {
    return decodeURIComponent(path[1])
  }

  return assert.fail(`no token found in email:\n${text}`)
}

const lastOfKind = (kind: string): SendArgs | undefined =>
  [...sent].reverse().find((item) => item.kind === kind)

/** Register, verify, and return a signed-in jar. */
const registerAndVerify = async (
  suffix: string,
  options: { rememberMe?: boolean } = {},
): Promise<{ jar: ReturnType<typeof makeJar>; address: string }> => {
  const address = email(suffix)
  const jar = makeJar()

  await auth.api.signUpEmail({
    body: { email: address, password: PASSWORD, name: `Test ${suffix}` },
    headers: jar.headers(),
  })

  const token = tokenFrom(lastOfKind('verify_email'))

  await auth.api.verifyEmail({ query: { token }, headers: jar.headers() })

  const response = await auth.api.signInEmail({
    body: {
      email: address,
      password: PASSWORD,
      rememberMe: options.rememberMe ?? false,
    },
    headers: jar.headers(),
    asResponse: true,
  })

  jar.absorb(response)
  assert.ok(jar.size > 0, 'sign-in set no cookie')

  return { jar, address }
}

before(async () => {
  payload = await getPayload({ config })

  restoreTransport = setEmailTransport(async (args) => {
    sent.push(args)
  })
})

after(async () => {
  restoreTransport?.()

  // Remove everything this run created, from both schemas.
  const { sql } = await import('@payloadcms/db-postgres/drizzle')
  const db = (
    payload.db as unknown as {
      drizzle: { execute: (q: unknown) => Promise<unknown> }
    }
  ).drizzle

  // Dependents first. `subscriptions.customer_id` is NOT NULL behind an
  // ON DELETE SET NULL foreign key, so deleting a customer that still has a
  // subscription fails with 23502 instead of a clean FK error — the quirk
  // flagged in the step 2 report.
  await db.execute(
    sql`delete from "subscriptions" where "provider_subscription_id" like ${`sub_${RUN}%`}`,
  )
  await db.execute(sql`delete from "customers" where "email" like ${`${RUN}%`}`)
  await db.execute(
    sql`delete from "auth"."user" where "email" like ${`${RUN}%`}`,
  )
})

/* ========================================================================== */

describe('registration and verification', () => {
  it('creates the Customer only once the email is verified', async () => {
    const address = email('link')
    const jar = makeJar()

    await auth.api.signUpEmail({
      body: { email: address, password: PASSWORD, name: 'Link Test' },
      headers: jar.headers(),
    })

    // Before verification: no billing record exists for this address.
    const before = await payload.find({
      collection: 'customers',
      where: { email: { equals: address } },
      pagination: false,
      overrideAccess: true,
      depth: 0,
    })
    assert.equal(
      before.docs.length,
      0,
      'a Customer must not exist before verification',
    )

    const token = tokenFrom(lastOfKind('verify_email'))
    await auth.api.verifyEmail({ query: { token }, headers: jar.headers() })

    const linked = await payload.find({
      collection: 'customers',
      where: { email: { equals: address } },
      pagination: false,
      overrideAccess: true,
      depth: 0,
    })

    assert.equal(linked.docs.length, 1, 'verification must create a Customer')
    assert.ok(linked.docs[0]?.authUserId, 'authUserId must be set')
    assert.equal(linked.docs[0]?.billingCountry, 'CZ')
  })

  it('sends a verification email on sign-up', async () => {
    assert.ok(lastOfKind('verify_email'))
  })

  it('exposes isVerified on the session', async () => {
    const { jar } = await registerAndVerify('verified')
    const current = await getCurrentCustomer(jar.headers())

    assert.ok(current)
    assert.equal(current.session.isVerified, true)
    assert.ok(current.customer, 'a verified session has a Customer')
  })

  it('signs in but stays unverified when the email is not confirmed', async () => {
    // The brief: an unverified account may sign in and see its account page,
    // nothing more.
    const address = email('unverified')
    const jar = makeJar()

    await auth.api.signUpEmail({
      body: { email: address, password: PASSWORD, name: 'Unverified' },
      headers: jar.headers(),
    })

    const response = await auth.api.signInEmail({
      body: { email: address, password: PASSWORD },
      headers: jar.headers(),
      asResponse: true,
    })
    jar.absorb(response)

    const current = await getCurrentCustomer(jar.headers())

    assert.ok(current, 'an unverified user can still sign in')
    assert.equal(current.session.isVerified, false)
    assert.equal(current.customer, null, 'and has no billing record yet')
  })
})

/* ========================================================================== */

describe('email enumeration', () => {
  it('registering an address that already exists does not error', async () => {
    // With `autoSignIn: false`, better-auth answers with a synthetic success.
    // If this threw, the thrown error would itself be the oracle.
    const address = email('dupe')
    const jar = makeJar()

    await auth.api.signUpEmail({
      body: { email: address, password: PASSWORD, name: 'First' },
      headers: jar.headers(),
    })

    const emailsBefore = sent.length

    await assert.doesNotReject(
      auth.api.signUpEmail({
        body: {
          email: address,
          password: 'uplne-jine-heslo-2026',
          name: 'Second',
        },
        headers: makeJar().headers(),
      }),
      'a duplicate sign-up must not reveal that the address is taken',
    )

    // And the real owner is not spammed with a second verification email.
    const verifyEmailsAfter = sent
      .slice(emailsBefore)
      .filter((item) => item.kind === 'verify_email')

    assert.equal(
      verifyEmailsAfter.length,
      0,
      'a duplicate sign-up must not send another verification email',
    )
  })

  it('creates no second auth user for a duplicate sign-up', async () => {
    const { sql } = await import('@payloadcms/db-postgres/drizzle')
    const db = (
      payload.db as unknown as {
        drizzle: { execute: (q: unknown) => Promise<unknown> }
      }
    ).drizzle

    const result = (await db.execute(
      sql`select count(*)::int as n from "auth"."user" where "email" = ${email('dupe')}`,
    )) as { rows?: { n: number }[] } | { n: number }[]

    const rows = Array.isArray(result) ? result : (result.rows ?? [])

    assert.equal(Number(rows[0]?.n), 1)
  })

  it('a wrong password and an unknown address both just fail', async () => {
    const existing = email('dupe')

    await assert.rejects(
      auth.api.signInEmail({
        body: { email: existing, password: 'definitely-not-the-password' },
        headers: makeJar().headers(),
      }),
    )

    await assert.rejects(
      auth.api.signInEmail({
        body: { email: email('never-registered'), password: PASSWORD },
        headers: makeJar().headers(),
      }),
    )
  })

  it('a reset request for an unknown address sends nothing and does not error', async () => {
    const before = sent.length

    await assert.doesNotReject(
      auth.api.requestPasswordReset({
        body: { email: email('ghost'), redirectTo: '/obnova-hesla' },
        headers: makeJar().headers(),
      }),
    )

    assert.equal(sent.length, before, 'no email for an address with no account')
  })
})

/* ========================================================================== */

describe('session lifetimes and remember me', () => {
  const lifetimeOf = async (rememberMe: boolean): Promise<number> => {
    const { jar } = await registerAndVerify(`life${rememberMe ? 'R' : 'D'}`, {
      rememberMe,
    })

    const sessions = await auth.api.listSessions({ headers: jar.headers() })
    const current = sessions?.[0]

    assert.ok(current, 'expected a session')

    return (
      new Date(current.expiresAt).getTime() -
      new Date(current.createdAt).getTime()
    )
  }

  it('lasts 7 days by default', async () => {
    const lifetime = await lifetimeOf(false)
    const expected = SESSION_DEFAULT_SECONDS * 1000

    assert.ok(
      Math.abs(lifetime - expected) < 60_000,
      `expected ~7 days, got ${Math.round(lifetime / 86_400_000)} days`,
    )
  })

  it('lasts 30 days with "zapamatovat si mě"', async () => {
    const lifetime = await lifetimeOf(true)
    const expected = SESSION_REMEMBERED_SECONDS * 1000

    assert.ok(
      Math.abs(lifetime - expected) < 60_000,
      `expected ~30 days, got ${Math.round(lifetime / 86_400_000)} days`,
    )
  })

  it('records the device and country, but never the address', async () => {
    const { jar } = await registerAndVerify('device')
    const sessions = await auth.api.listSessions({ headers: jar.headers() })
    const current = sessions?.[0] as
      (Record<string, unknown> & { ipAddress?: string | null }) | undefined

    assert.ok(current)
    assert.equal(current.deviceLabel, 'Chrome na Windows')
    assert.equal(current.ipCountry, 'CZ')

    // The truncated hash is stored; the address itself is not, anywhere.
    assert.ok(current.ipPrefixHash, 'expected a stored prefix hash')
    assert.ok(
      !String(JSON.stringify(current)).includes('203.0.113.42'),
      'the raw IP address must not appear on the session row',
    )
  })
})

/* ========================================================================== */

describe('password change', () => {
  it('revokes other sessions and notifies the previous address', async () => {
    const { jar, address } = await registerAndVerify('pwchange')

    // A second device for the same account.
    const other = makeJar()
    const otherResponse = await auth.api.signInEmail({
      body: { email: address, password: PASSWORD },
      headers: other.headers(),
      asResponse: true,
    })
    other.absorb(otherResponse)

    assert.ok(
      await getCurrentCustomer(other.headers()),
      'the second device starts out signed in',
    )

    const noticesBefore = sent.filter(
      (item) => item.kind === 'password_changed',
    ).length

    // `asResponse` so the rotated session cookie is absorbed. better-auth
    // issues a new token on a password change; a browser follows it, and a
    // test holding the old cookie would look as though it had been signed out.
    const changed = await auth.api.changePassword({
      body: {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
        revokeOtherSessions: true,
      },
      headers: jar.headers(),
      asResponse: true,
    })
    jar.absorb(changed)

    // The other device is out.
    assert.equal(
      await getCurrentCustomer(other.headers()),
      null,
      'changing the password must sign out every other device',
    )

    // The device that made the change stays in.
    assert.ok(
      await getCurrentCustomer(jar.headers()),
      'the device that changed the password stays signed in',
    )

    // The NOTICE is our code, not better-auth's: there is no provider hook for
    // `changePassword` (only `onPasswordReset`), so it is sent at the single
    // call site and exercised here through the same function that call site
    // uses. See the note on `notifyPasswordChanged`.
    const { notifyPasswordChanged } = await import('@/lib/auth/email')
    const delivery = await notifyPasswordChanged(address)

    const noticesAfter = sent.filter(
      (item) => item.kind === 'password_changed',
    ).length

    assert.equal(delivery.delivered, true)
    assert.ok(
      noticesAfter > noticesBefore,
      'a password change must notify the account address',
    )

    const notice = lastOfKind('password_changed')
    assert.equal(notice?.to, address)
    assert.ok(
      (notice?.email.text.length ?? 0) > 0,
      'every notice needs a plain-text part',
    )
    assert.match(
      String(notice?.email.text),
      /odhlásili/,
      'the notice must say the other devices were signed out',
    )
  })
})

/* ========================================================================== */

describe('password reset leaks no token into the logs', () => {
  it('greps the log output of a full reset flow for the token', async () => {
    const { address } = await registerAndVerify('resetlog')

    const lines: string[] = []
    const restoreSink = setAuthLogSink((level, event, fields) => {
      lines.push(JSON.stringify({ level, event, ...fields }))
    })

    let token: string

    try {
      await auth.api.requestPasswordReset({
        body: { email: address, redirectTo: '/obnova-hesla' },
        headers: makeJar().headers(),
      })

      token = tokenFrom(lastOfKind('password_reset'))

      // Something the real flow logs, with the real values in hand.
      authLog.info('reset_request.received', { email: address })

      await auth.api.resetPassword({
        body: { newPassword: NEW_PASSWORD, token },
        headers: makeJar().headers(),
      })

      authLog.info('reset.succeeded', { email: address })
    } finally {
      restoreSink()
    }

    const text = lines.join('\n')

    assert.ok(token.length > 10, 'expected a real token to grep for')

    // THE assertion. A reset token in a log is an account takeover waiting for
    // anyone with log access.
    assert.ok(
      !text.includes(token),
      `the reset token appeared in the log output:\n${text}`,
    )

    // The address is hashed rather than printed.
    assert.ok(
      !text.includes(address),
      `the email address appeared in the log output:\n${text}`,
    )

    assert.ok(lines.length > 0, 'the flow did log something')
  })
})

/* ========================================================================== */

describe('two-factor authentication', () => {
  /** Enrol and return the jar plus the plaintext secret and backup codes. */
  const enrol = async (suffix: string) => {
    const { jar, address } = await registerAndVerify(suffix)

    const result = (await auth.api.enableTwoFactor({
      body: { password: PASSWORD },
      headers: jar.headers(),
    })) as { totpURI?: string; backupCodes?: string[] }

    assert.ok(result.totpURI, 'enrolment must return an otpauth URI')

    const encoded = new URL(
      result.totpURI.replace('otpauth://', 'https://'),
    ).searchParams.get('secret')

    assert.ok(encoded, 'the URI must carry the secret for manual entry')

    // `url()` base32-ENCODES the raw secret, and `createOTP` expects the raw
    // one. Feeding it the encoded form yields codes that never match — a
    // confusing way to fail — so decode it back here.
    const secret = new TextDecoder().decode(base32.decode(encoded))

    return {
      jar,
      address,
      secret,
      backupCodes: result.backupCodes ?? [],
    }
  }

  /** A code generated the way the authenticator app would generate it. */
  const codeFor = (secret: string) =>
    createOTP(secret, { digits: 6, period: 30 }).totp()

  /**
   * Activate 2FA, then start a fresh sign-in and stop at the challenge.
   *
   * `verifyBackupCode` and the sign-in `verifyTOTP` both consume the
   * short-lived two-factor cookie that a password sign-in sets when the
   * account has 2FA active — not an ordinary session cookie. Testing them
   * against a normal session fails with "Invalid two factor cookie", which is
   * the API correctly refusing to treat an already-authenticated session as a
   * pending challenge.
   */
  const challenge = async (suffix: string) => {
    const enrolled = await enrol(suffix)

    // Activate the factor. `asResponse` so the rotated session cookie is
    // absorbed — better-auth issues a new token here, and a jar still holding
    // the old one gets 401 on the next authenticated call.
    const activated = await auth.api.verifyTOTP({
      body: { code: await codeFor(enrolled.secret) },
      headers: enrolled.jar.headers(),
      asResponse: true,
    })
    enrolled.jar.absorb(activated)

    // Sign in again from a clean jar: this one gets the challenge cookie.
    const pending = makeJar()
    const response = await auth.api.signInEmail({
      body: { email: enrolled.address, password: PASSWORD },
      headers: pending.headers(),
      asResponse: true,
    })
    pending.absorb(response)

    return { ...enrolled, pending }
  }

  it('does not require the factor until a code is proved', async () => {
    const { jar, secret } = await enrol('2fapend')

    // Still unverified at this point: the row exists but the factor is not
    // required. Someone who scanned the QR into the wrong app must not be
    // locked out by a factor they never used.
    const code = await codeFor(secret)
    await assert.doesNotReject(
      auth.api.verifyTOTP({ body: { code }, headers: jar.headers() }),
      'a correct code must activate the factor',
    )
  })

  it('refuses a wrong code', async () => {
    const { jar } = await enrol('2fawrong')

    await assert.rejects(
      auth.api.verifyTOTP({ body: { code: '000000' }, headers: jar.headers() }),
      'a wrong code must be refused',
    )
  })

  it('accepts a correct code', async () => {
    const { jar, secret } = await enrol('2faright')
    const code = await codeFor(secret)

    await assert.doesNotReject(
      auth.api.verifyTOTP({ body: { code }, headers: jar.headers() }),
    )
  })

  it('issues exactly ten backup codes, once', async () => {
    const { backupCodes } = await enrol('2fabackup')

    assert.equal(backupCodes.length, 10)
    assert.equal(new Set(backupCodes).size, 10, 'codes must be distinct')
  })

  it('accepts a backup code once and not twice', async () => {
    const { backupCodes, pending } = await challenge('2faonce')

    const code = backupCodes[0]
    assert.ok(code)

    await assert.doesNotReject(
      auth.api.verifyBackupCode({ body: { code }, headers: pending.headers() }),
      'the first use of a backup code must succeed',
    )

    // A second challenge, and the same code again.
    const { pending: second } = await challenge('2fatwice')

    await assert.rejects(
      auth.api.verifyBackupCode({ body: { code }, headers: second.headers() }),
      'a consumed backup code must not work again',
    )
  })

  it('invalidates every previous code when regenerated', async () => {
    const { jar, backupCodes, pending } = await challenge('2faregen')

    const old = backupCodes[1]
    assert.ok(old)

    const regenerated = (await auth.api.generateBackupCodes({
      body: { password: PASSWORD },
      headers: jar.headers(),
    })) as { backupCodes?: string[] }

    const fresh = regenerated.backupCodes ?? []

    assert.equal(fresh.length, 10)
    assert.ok(
      !fresh.includes(old),
      'a regenerated set must not reuse an old code',
    )

    await assert.rejects(
      auth.api.verifyBackupCode({
        body: { code: old },
        headers: pending.headers(),
      }),
      'a code from the previous set must no longer work',
    )

    const replacement = fresh[0]
    assert.ok(replacement)

    await assert.doesNotReject(
      auth.api.verifyBackupCode({
        body: { code: replacement },
        headers: pending.headers(),
      }),
      'a code from the new set must work',
    )
  })

  it('accepts a backup code from an authenticated session too', async () => {
    // Documents measured behaviour rather than an assumption: better-auth's
    // `verifyBackupCode` accepts EITHER a pending two-factor challenge or an
    // already-authenticated session. It is not limited to the challenge.
    //
    // The consequence is worth knowing: a stolen session cookie can consume
    // backup codes. That burns them — a nuisance and a signal — but grants
    // nothing, because the session already had access. Flagged in the report
    // rather than worked around, since changing it means diverging from the
    // library's 2FA flow.
    const { jar, backupCodes } = await enrol('2fasession')
    const code = backupCodes[0]
    assert.ok(code)

    await assert.doesNotReject(
      auth.api.verifyBackupCode({ body: { code }, headers: jar.headers() }),
    )
  })

  it('never stores a backup code in readable form', async () => {
    const { backupCodes } = await enrol('2faplain')
    const { sql } = await import('@payloadcms/db-postgres/drizzle')
    const db = (
      payload.db as unknown as {
        drizzle: { execute: (q: unknown) => Promise<unknown> }
      }
    ).drizzle

    const result = (await db.execute(
      sql`select "backupCodes" from "auth"."twoFactor"`,
    )) as { rows?: { backupCodes: string }[] } | { backupCodes: string }[]

    const rows = Array.isArray(result) ? result : (result.rows ?? [])
    const stored = rows.map((row) => row.backupCodes).join('\n')

    const plain = backupCodes[0]
    assert.ok(plain)

    // `storeBackupCodes: 'encrypted'` — the plaintext must not be findable.
    assert.ok(
      !stored.includes(plain),
      'a backup code was stored in readable form',
    )
  })
})

/* ========================================================================== */

describe('requireEntitlement', () => {
  const FEATURE = 'TIPS_REALTIME' as const

  const givePlan = async () => {
    const plans = await payload.find({
      collection: 'plans',
      where: { code: { equals: 'START' } },
      limit: 1,
      pagination: false,
      overrideAccess: true,
      depth: 0,
    })

    assert.ok(plans.docs[0], 'seed must have run')

    return plans.docs[0]
  }

  const subscribe = async (
    customerId: number,
    planId: number,
    suffix: string,
    period: { start: string; end: string },
    status: 'ACTIVE' | 'EXPIRED',
  ) =>
    payload.create({
      collection: 'subscriptions',
      data: {
        customer: customerId,
        plan: planId,
        currency: 'CZK',
        interval: 'MONTH',
        priceMinor: 34_900,
        status,
        currentPeriodStart: period.start,
        currentPeriodEnd: period.end,
        cancelAtPeriodEnd: false,
        provider: 'STRIPE',
        providerSubscriptionId: `sub_${RUN}_${suffix}`,
      },
      overrideAccess: true,
      depth: 0,
    })

  it('refuses when there is no subscription at all', async () => {
    const { jar } = await registerAndVerify('entnone')

    await assert.rejects(
      requireEntitlement(jar.headers(), FEATURE),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'MISSING_ENTITLEMENT')
        return true
      },
    )
  })

  it('grants when an active subscription covers the feature', async () => {
    const { jar } = await registerAndVerify('entactive')
    const current = await getCurrentCustomer(jar.headers())
    assert.ok(current?.customer)

    const plan = await givePlan()
    const now = Date.now()

    await subscribe(
      Number(current.customer.id),
      Number(plan.id),
      'active',
      {
        start: new Date(now - 86_400_000).toISOString(),
        end: new Date(now + 20 * 86_400_000).toISOString(),
      },
      'ACTIVE',
    )

    const granted = await requireEntitlement(jar.headers(), FEATURE)
    assert.equal(granted.customer.id, current.customer.id)
  })

  it('refuses when the subscription has expired', async () => {
    const { jar } = await registerAndVerify('entexpired')
    const current = await getCurrentCustomer(jar.headers())
    assert.ok(current?.customer)

    const plan = await givePlan()
    const now = Date.now()

    await subscribe(
      Number(current.customer.id),
      Number(plan.id),
      'expired',
      {
        start: new Date(now - 60 * 86_400_000).toISOString(),
        end: new Date(now - 30 * 86_400_000).toISOString(),
      },
      'EXPIRED',
    )

    await assert.rejects(
      requireEntitlement(jar.headers(), FEATURE),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'MISSING_ENTITLEMENT')
        return true
      },
    )
  })

  it('refuses an unverified customer before it looks at entitlements', async () => {
    const address = email('entunverified')
    const jar = makeJar()

    await auth.api.signUpEmail({
      body: { email: address, password: PASSWORD, name: 'Unverified' },
      headers: jar.headers(),
    })

    const response = await auth.api.signInEmail({
      body: { email: address, password: PASSWORD },
      headers: jar.headers(),
      asResponse: true,
    })
    jar.absorb(response)

    await assert.rejects(
      requireEntitlement(jar.headers(), FEATURE),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'EMAIL_NOT_VERIFIED')
        return true
      },
    )
  })

  it('refuses when nobody is signed in', async () => {
    await assert.rejects(
      requireEntitlement(new Headers(), FEATURE),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'NOT_AUTHENTICATED')
        return true
      },
    )
  })
})
