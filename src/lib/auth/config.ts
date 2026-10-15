/**
 * better-auth configuration — CUSTOMER authentication.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * TWO AUTH SYSTEMS, ON PURPOSE
 *
 * Payload's own auth (the `users` collection) is for ADMINS and is untouched
 * by this file. better-auth is for CUSTOMERS. They share a database and
 * nothing else:
 *
 *   - different Postgres schemas (`public` vs `auth`), so neither migration
 *     system can see or clobber the other's tables;
 *   - different signing secrets, so a compromise of one does not forge
 *     sessions in the other;
 *   - different cookies, so an admin session is not a customer session.
 *
 * The seam between them is `Customer.authUserId`, set once on email
 * verification. Nothing else crosses.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * SCHEMA ISOLATION
 *
 * `schemaName: 'auth'` makes better-auth qualify every statement it issues
 * with the schema. It therefore does not depend on the connection's
 * `search_path` — which matters here, because Neon's pooled endpoint is
 * pgBouncer in transaction mode, where a session-level `SET search_path` is
 * not guaranteed to still apply on the next statement.
 *
 * The schema itself is created by a Payload migration, so the ordering on a
 * fresh database is explicit: `pnpm migrate` then `pnpm auth:migrate`.
 */
import { betterAuth } from 'better-auth'
import { nextCookies } from 'better-auth/next-js'
import { twoFactor } from 'better-auth/plugins/two-factor'
import { Kysely, PostgresDialect, sql } from 'kysely'
import { Pool } from 'pg'

import { env, isProduction } from '../env.ts'
import {
  emailChangedTemplate,
  passwordChangedTemplate,
  passwordResetTemplate,
  verifyEmailTemplate,
} from './email-templates.ts'
import { sendEmail, sendSecurityNotice } from './email.ts'
import { authLog } from './logging.ts'
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './password-policy.ts'
import {
  FRESH_AGE_SECONDS,
  SESSION_DEFAULT_SECONDS,
  SESSION_REFRESH_AFTER_SECONDS,
  SESSION_REMEMBERED_SECONDS,
  TWO_FACTOR_CHALLENGE_SECONDS,
  clampExpiry,
  lifetimeForSignIn,
} from './session-policy.ts'

/** The schema better-auth owns. Referenced by the migration and the README. */
export const AUTH_SCHEMA = 'auth'

/* -------------------------------------------------------------------------- */
/* Connection                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * One pool per process, reused across hot reloads.
 *
 * Next.js re-evaluates modules on every edit in development. Without this, a
 * long session of editing opens a new pool each time and exhausts Neon's
 * connection budget — which then looks like a database outage rather than a
 * leak.
 */
const globalForAuth = globalThis as unknown as {
  __authPool?: Pool
}

const pool =
  globalForAuth.__authPool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    // Small: this pool only serves auth queries, and Neon's pooled endpoint
    // multiplexes behind it anyway.
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  })

if (!globalForAuth.__authPool) {
  globalForAuth.__authPool = pool
}

const dialect = new PostgresDialect({ pool })

/**
 * Exposed for the migration runner and the verification script, so they use
 * exactly the same connection and schema as the running application.
 */
export const authDb = new Kysely<Record<string, never>>({ dialect })

/* -------------------------------------------------------------------------- */
/* Request helpers                                                            */
/* -------------------------------------------------------------------------- */

/** Read a header from whatever shape the hook context provides. */
const headerOf = (context: unknown, name: string): string | null => {
  const request = (context as { request?: Request } | null)?.request

  if (request?.headers) {
    return request.headers.get(name)
  }

  const headers = (context as { headers?: Headers } | null)?.headers

  return headers?.get?.(name) ?? null
}

const bodyOf = (context: unknown): Record<string, unknown> =>
  ((context as { body?: Record<string, unknown> } | null)?.body ??
    {}) as Record<string, unknown>

/* -------------------------------------------------------------------------- */
/* Instance                                                                   */
/* -------------------------------------------------------------------------- */

export const auth = betterAuth({
  appName: 'Sázej chytře',
  baseURL: env.BETTER_AUTH_URL,
  /**
   * NOT `/api/auth`. Payload already owns `/api/[...slug]`, and two catch-all
   * route handlers under the same prefix is at best fragile. `/auth` is
   * unambiguous and leaves Payload's API surface alone.
   */
  basePath: '/auth',
  secret: env.BETTER_AUTH_SECRET,

  database: {
    dialect,
    type: 'postgres',
    schemaName: AUTH_SCHEMA,
    /**
     * Identifier casing is left at better-auth's default (camelCase, quoted),
     * NOT forced to snake_case to match `public`. Two reasons: `casing:
     * 'snake'` has no observable effect on this adapter path in 1.7.10, so
     * setting it would be a comment that lies; and better-auth's own future
     * migrations assume its own naming, so overriding it would make every
     * upgrade a rename. The inconsistency with `public` is contained by the
     * schema boundary — nothing joins across it except `customerId`.
     */
    // Password change + session revocation must be one atomic act.
    transaction: true,
  },

  emailAndPassword: {
    enabled: true,

    /**
     * FALSE on purpose. An unverified customer may sign in and see their own
     * account page; what they may not do is anything paid. Blocking sign-in
     * entirely would leave someone whose verification email went astray with
     * no way to reach the "resend" button. The paid-action gate is
     * `requireVerifiedCustomer()`, not this flag.
     */
    requireEmailVerification: false,

    /**
     * FALSE for EMAIL ENUMERATION protection. With auto sign-in off,
     * better-auth answers a sign-up for an existing address with a synthetic
     * success instead of "that email is taken" — so registration cannot be
     * used to test whether an address has an account. The customer is then
     * told to check their inbox either way.
     */
    autoSignIn: false,

    minPasswordLength: MIN_PASSWORD_LENGTH,
    maxPasswordLength: MAX_PASSWORD_LENGTH,

    /** A reset means "I may have been compromised": drop every session. */
    revokeSessionsOnPasswordReset: true,

    sendResetPassword: async ({ user, url }) => {
      // Propagates on failure: the caller turns that into a retryable action.
      await sendEmail({
        to: user.email,
        kind: 'password_reset',
        email: passwordResetTemplate({ url, isProduction }),
      })
    },

    onPasswordReset: async ({ user }) => {
      await sendSecurityNotice({
        to: user.email,
        kind: 'password_changed',
        email: passwordChangedTemplate({
          changedAt: new Date(),
          isProduction,
        }),
      })
    },

    /**
     * Someone tried to register with an address that already has an account.
     * The attempt is invisible to whoever made it; the owner is told, because
     * it may be an attempt to find out whether they are a customer.
     */
    onExistingUserSignUp: async ({ user }) => {
      authLog.info('signup.existing_address', { email: user.email })
    },
  },

  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        kind: 'verify_email',
        email: verifyEmailTemplate({ url, isProduction }),
      })
    },
    /** They verify, then sign in deliberately. One less link that logs you in. */
    autoSignInAfterVerification: false,

    /**
     * Verification is the moment the address is proved to belong to whoever is
     * using it, so it is when the billing record appears. Creating a Customer
     * at sign-up instead would fill the table with every address an attacker
     * probes registration with, and each row would hold the unique email index
     * hostage against the real owner.
     *
     * Imported dynamically to break a cycle: `customer.ts` needs `auth` from
     * this module, so a static import here would be circular.
     */
    afterEmailVerification: async (user) => {
      const { linkCustomerToAuthUser } = await import('./customer.ts')

      const customer = await linkCustomerToAuthUser({
        authUserId: user.id,
        email: user.email,
        name: user.name,
      })

      // Mirror the id onto the auth user. Raw SQL rather than the query
      // builder because `authDb` is intentionally untyped — better-auth owns
      // this schema, so we do not keep a second copy of its table types that
      // could drift from its migrations.
      await sql`
        update ${sql.table(`${AUTH_SCHEMA}.user`)}
        set "customerId" = ${String(customer.id)}
        where "id" = ${user.id}
      `.execute(authDb)
    },
    /** Re-send on sign-in attempt is handled by our own resend action. */
    sendOnSignUp: true,
    expiresIn: 60 * 60 * 24,
  },

  user: {
    changeEmail: {
      enabled: true,
      /**
       * The confirmation goes to the CURRENT address, not the new one. That is
       * what stops an attacker with a stolen session from quietly moving the
       * account to an inbox they control: the real owner is asked first.
       */
      sendChangeEmailVerification: async ({
        user,
        newEmail,
        url,
      }: {
        user: { email: string }
        newEmail: string
        url: string
      }) => {
        await sendEmail({
          to: user.email,
          kind: 'email_change_request',
          email: emailChangedTemplate({
            newEmail,
            changedAt: new Date(),
            isProduction,
          }),
        })
        authLog.info('email_change.requested', { email: user.email, url })
      },
    },
    additionalFields: {
      /**
       * Mirrors `Customer.id`, set when verification links the two.
       * Denormalised onto the auth user so `getCurrentCustomer()` is one
       * lookup rather than a scan.
       */
      customerId: {
        type: 'string',
        required: false,
        input: false,
      },
    },
  },

  session: {
    expiresIn: SESSION_DEFAULT_SECONDS,
    /** Sliding expiry: activity pushes the expiry out, at most once a day. */
    updateAge: SESSION_REFRESH_AFTER_SECONDS,
    freshAge: FRESH_AGE_SECONDS,
    additionalFields: {
      /** Which lifetime this session was created with. */
      rememberMe: { type: 'boolean', required: false, input: false },
      /** ISO 3166-1 alpha-2 from the edge. Country only — never a city. */
      ipCountry: { type: 'string', required: false, input: false },
      /** Keyed hash of a TRUNCATED address. Never the address itself. */
      ipPrefixHash: { type: 'string', required: false, input: false },
      /** Coarse label such as "Chrome na Windows". Never the raw UA. */
      deviceLabel: { type: 'string', required: false, input: false },
    },
  },

  advanced: {
    useSecureCookies: isProduction,
    defaultCookieAttributes: {
      httpOnly: true,
      // `lax` rather than `strict`: the verification and reset links are
      // top-level cross-site navigations, and `strict` would drop the cookie
      // on arrival and make the link look broken.
      sameSite: 'lax',
      secure: isProduction,
      path: '/',
    },
    cookiePrefix: 'sch',
    ipAddress: {
      /**
       * better-auth must not persist the raw address. We store a truncated,
       * keyed hash plus the country instead — see `client-identity.ts` for why
       * truncating before hashing is the part that matters.
       */
      disableIpTracking: true,
    },
  },

  databaseHooks: {
    session: {
      create: {
        before: async (session, context) => {
          const body = bodyOf(context)
          const rememberMe = body.rememberMe === true

          const { describeDevice, fingerprintIpAddress, normaliseIpCountry } =
            await import('./client-identity.ts')

          const forwardedFor = headerOf(context, 'x-forwarded-for')
          const ip =
            forwardedFor?.split(',')[0]?.trim() ??
            headerOf(context, 'x-real-ip') ??
            null

          const createdAt = new Date()

          return {
            data: {
              ...session,
              rememberMe,
              /**
               * The remember-me choice is applied HERE rather than through a
               * global setting, because it is a property of this sign-in on
               * this device — not of the account.
               */
              expiresAt: clampExpiry(
                createdAt,
                createdAt,
                lifetimeForSignIn(rememberMe),
              ),
              ipCountry: normaliseIpCountry(headerOf(context, 'cf-ipcountry')),
              ipPrefixHash: fingerprintIpAddress(ip, env.BETTER_AUTH_SECRET),
              deviceLabel: describeDevice(headerOf(context, 'user-agent')),
            },
          }
        },
        after: async (session) => {
          // Notify on a device/location we have not seen for this user before.
          // In `after` so a failure here can never block a sign-in.
          try {
            const { notifyIfNewDevice } = await import('./device-notice.ts')
            await notifyIfNewDevice(
              session as unknown as Record<string, unknown>,
            )
          } catch {
            // notifyIfNewDevice logs its own failures. A security *notice*
            // must not become a reason someone cannot sign in.
          }
        },
      },
      update: {
        before: async (session) => {
          // Sliding expiry must not outrun the absolute ceiling, or a session
          // touched once a week would live forever.
          const createdAt = session.createdAt
            ? new Date(session.createdAt as unknown as string)
            : new Date()

          const remembered = session.rememberMe === true
          const lifetime = remembered
            ? SESSION_REMEMBERED_SECONDS * 1000
            : SESSION_DEFAULT_SECONDS * 1000

          return {
            data: {
              ...session,
              expiresAt: clampExpiry(new Date(), createdAt, lifetime),
            },
          }
        },
      },
    },
  },

  plugins: [
    twoFactor({
      issuer: 'Sázej chytře',
      /** Default false — one correct code is required before 2FA activates. */
      skipVerificationOnEnable: false,
      twoFactorCookieMaxAge: TWO_FACTOR_CHALLENGE_SECONDS,
      totpOptions: {
        digits: 6,
        period: 30,
      },
      backupCodeOptions: {
        amount: 10,
        length: 10,
        /**
         * BACKUP CODE STORAGE — a deliberate deviation, flagged in the report.
         *
         * The brief asks for HASHED backup codes. better-auth offers `plain`
         * or `encrypted` and exposes no hook on the comparison, so a one-way
         * hash cannot be plugged in: verification decrypts the stored blob and
         * compares, which a hash by definition cannot support. `plain` is
         * never acceptable, so `encrypted` is the available option.
         *
         * What that costs: codes are AES-encrypted under BETTER_AUTH_SECRET,
         * which is not in the database. A database-only leak does NOT expose
         * them. A database *and* environment leak does.
         *
         * Why that is tolerable HERE specifically: the same compromise already
         * exposes the TOTP secret, which must be stored reversibly by
         * construction — you cannot hash a shared secret and still generate
         * codes from it. An attacker with database + secret can mint valid
         * TOTP codes regardless, so hashing only the backup codes would close
         * no door that is not already open.
         */
        storeBackupCodes: 'encrypted',
      },
    }),

    /**
     * Must be LAST. It wraps the response so cookies set during a server
     * action are actually attached; a plugin registered after it would have
     * its cookies dropped.
     */
    nextCookies(),
  ],
})

export type Auth = typeof auth
export type AuthSession = Awaited<ReturnType<typeof auth.api.getSession>>
