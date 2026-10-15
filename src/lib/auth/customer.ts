/**
 * The bridge between an authenticated session and a billing `Customer`.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ONE WAY IN
 *
 * `getCurrentCustomer()` is the ONLY way application code may reach a Customer
 * from a request. Nothing else should read the session cookie, look up
 * `authUserId`, or query the `customers` collection on a user's behalf.
 *
 * That is a deliberate constraint, not tidiness. A second path is how an
 * authorisation bug gets in: one call site forgets the verification check,
 * another trusts a customer id from a form field, a third reads the session
 * but not the absolute session cap. Funnelling everything through one function
 * means those checks exist in exactly one place and cannot be forgotten
 * individually.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THE CUSTOMER IS CREATED AT VERIFICATION, NOT AT SIGN-UP
 *
 * A `Customer` is a billing counterparty. Creating one for every sign-up would
 * fill the table with unverified addresses — including every address an
 * attacker probes registration with — and each of those rows holds the unique
 * email index hostage, so the real owner could never register later.
 *
 * Verification is the first moment we know the address belongs to whoever is
 * using it, so that is when the billing record appears.
 */
import { getPayload } from 'payload'
import type { Customer } from '@/payload-types'

import config from '../../payload.config.ts'
import { resolveEntitlements } from '../entitlements.ts'
import type { FeatureKey } from '../billing/constants.ts'
import { loadCustomerEntitlementState } from '../billing/entitlement-loader.ts'
import { auth } from './config.ts'
import { authLog } from './logging.ts'
import { isBeyondAbsoluteMax } from './session-policy.ts'

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

/** Not signed in at all. */
export class NotAuthenticatedError extends Error {
  readonly code = 'NOT_AUTHENTICATED'

  constructor() {
    super('Pro tuto akci je potřeba se přihlásit.')
    this.name = 'NotAuthenticatedError'
  }
}

/** Signed in, but the address has not been confirmed. */
export class EmailNotVerifiedError extends Error {
  readonly code = 'EMAIL_NOT_VERIFIED'

  constructor() {
    super(
      'Nejdřív potvrďte svůj e-mail. Bez potvrzení nelze objednat předplatné.',
    )
    this.name = 'EmailNotVerifiedError'
  }
}

/** Signed in and verified, but the plan does not include this feature. */
export class MissingEntitlementError extends Error {
  readonly code = 'MISSING_ENTITLEMENT'
  readonly feature: FeatureKey

  constructor(feature: FeatureKey) {
    super(`Tato funkce není součástí vašeho předplatného (${feature}).`)
    this.name = 'MissingEntitlementError'
    this.feature = feature
  }
}

/* -------------------------------------------------------------------------- */
/* Session                                                                    */
/* -------------------------------------------------------------------------- */

export type CustomerSession = {
  authUserId: string
  email: string
  /** Typed on the session so callers never re-derive it from the user row. */
  isVerified: boolean
  twoFactorEnabled: boolean
  sessionId: string
  expiresAt: Date
}

/**
 * Read and validate the current session.
 *
 * Applies the absolute session cap on READ as well as on refresh: a row whose
 * `expiresAt` was written before the cap existed, or by a path that bypassed
 * the clamp, must still be refused. Sliding expiry without this check is how a
 * stolen cookie becomes permanent access.
 *
 * @returns the session, or `null` when not signed in or no longer valid.
 */
export const getCustomerSession = async (
  headers: Headers,
): Promise<CustomerSession | null> => {
  const result = await auth.api.getSession({ headers })

  if (!result?.user || !result.session) {
    return null
  }

  const createdAt = result.session.createdAt
    ? new Date(result.session.createdAt)
    : null

  if (createdAt && isBeyondAbsoluteMax(new Date(), createdAt)) {
    authLog.warn('session.beyond_absolute_max', {
      userId: result.user.id,
      createdAt: createdAt.toISOString(),
    })

    return null
  }

  const user = result.user as typeof result.user & {
    twoFactorEnabled?: boolean | null
  }

  return {
    authUserId: user.id,
    email: user.email,
    isVerified: user.emailVerified === true,
    twoFactorEnabled: user.twoFactorEnabled === true,
    sessionId: result.session.id,
    expiresAt: new Date(result.session.expiresAt),
  }
}

/* -------------------------------------------------------------------------- */
/* Customer                                                                   */
/* -------------------------------------------------------------------------- */

export type CurrentCustomer = {
  session: CustomerSession
  customer: Customer | null
}

/**
 * The Customer behind the current session, or `null`.
 *
 * `customer` is null for a session whose address is not verified yet — the
 * billing record does not exist until then. That is why the return type pairs
 * the session with an optional customer rather than returning a Customer
 * directly: an unverified user is signed in and has an account page, they just
 * have nothing to bill.
 */
export const getCurrentCustomer = async (
  headers: Headers,
): Promise<CurrentCustomer | null> => {
  const session = await getCustomerSession(headers)

  if (!session) {
    return null
  }

  const payload = await getPayload({ config })

  const found = await payload.find({
    collection: 'customers',
    where: { authUserId: { equals: session.authUserId } },
    limit: 1,
    pagination: false,
    depth: 0,
    overrideAccess: true,
  })

  return { session, customer: (found.docs[0] as Customer | undefined) ?? null }
}

/**
 * Require a signed-in, verified customer with a billing record.
 *
 * @throws {NotAuthenticatedError} not signed in.
 * @throws {EmailNotVerifiedError} signed in but unverified — the gate for
 *   every paid action.
 */
export const requireVerifiedCustomer = async (
  headers: Headers,
): Promise<{ session: CustomerSession; customer: Customer }> => {
  const current = await getCurrentCustomer(headers)

  if (!current) {
    throw new NotAuthenticatedError()
  }

  if (!current.session.isVerified) {
    throw new EmailNotVerifiedError()
  }

  if (!current.customer) {
    // Verified but unlinked: the linking hook failed, or verification happened
    // before it existed. Repair it rather than refusing, so a customer is not
    // stranded by our own bug.
    const repaired = await linkCustomerToAuthUser({
      authUserId: current.session.authUserId,
      email: current.session.email,
    })

    return { session: current.session, customer: repaired }
  }

  return { session: current.session, customer: current.customer }
}

/* -------------------------------------------------------------------------- */
/* Entitlement guard                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Require that the current customer has a feature.
 *
 * Reads our own database and calls `resolveEntitlements` — the payment
 * provider is never consulted. A webhook we have not processed yet, or a
 * provider outage, must not change what somebody can see.
 *
 * @throws {NotAuthenticatedError | EmailNotVerifiedError | MissingEntitlementError}
 */
export const requireEntitlement = async (
  headers: Headers,
  feature: FeatureKey,
  now: Date = new Date(),
): Promise<{ session: CustomerSession; customer: Customer }> => {
  const { session, customer } = await requireVerifiedCustomer(headers)

  const payload = await getPayload({ config })

  const state = await loadCustomerEntitlementState({
    payload,
    customerId: customer.id,
  })

  if (!resolveEntitlements(state, now).has(feature)) {
    throw new MissingEntitlementError(feature)
  }

  return { session, customer }
}

/* -------------------------------------------------------------------------- */
/* Linking                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Find or create the Customer for a verified auth user, and record the link.
 *
 * Called from better-auth's `afterEmailVerification` hook.
 *
 * ONE AUTH USER ↔ ONE CUSTOMER is enforced by the existing unique index on
 * `customers.auth_user_id`, not by this function's checks. The lookups below
 * are the ordinary path; the index is what holds under a concurrent double
 * verification, where both calls would otherwise create a row.
 */
export const linkCustomerToAuthUser = async ({
  authUserId,
  email,
  name,
}: {
  authUserId: string
  email: string
  name?: string | null
}): Promise<Customer> => {
  const payload = await getPayload({ config })
  const normalisedEmail = email.trim().toLowerCase()

  // Already linked?
  const linked = await payload.find({
    collection: 'customers',
    where: { authUserId: { equals: authUserId } },
    limit: 1,
    pagination: false,
    depth: 0,
    overrideAccess: true,
  })

  if (linked.docs[0]) {
    return linked.docs[0] as Customer
  }

  // A Customer may already exist for this address — created by an admin, or
  // imported — in which case we attach rather than duplicate.
  const byEmail = await payload.find({
    collection: 'customers',
    where: { email: { equals: normalisedEmail } },
    limit: 1,
    pagination: false,
    depth: 0,
    overrideAccess: true,
  })

  const existing = byEmail.docs[0] as Customer | undefined

  if (existing) {
    if (existing.authUserId && existing.authUserId !== authUserId) {
      // Two auth users claiming one billing record. Refuse loudly: picking
      // either one silently would hand somebody else's invoices to whoever
      // verified second.
      authLog.error('customer.link_conflict', {
        email: normalisedEmail,
        existingCustomerId: String(existing.id),
      })

      throw new Error(
        `Customer ${existing.id} is already linked to a different auth user.`,
      )
    }

    const updated = await payload.update({
      collection: 'customers',
      id: existing.id,
      data: { authUserId },
      depth: 0,
      overrideAccess: true,
    })

    authLog.info('customer.linked_existing', {
      email: normalisedEmail,
      customerId: String(updated.id),
    })

    return updated as Customer
  }

  const created = await payload.create({
    collection: 'customers',
    data: {
      email: normalisedEmail,
      name: name?.trim() || normalisedEmail,
      // Launch market. `assertSupportedBillingCountry` gates checkout; this is
      // only the default on the record and is editable later.
      billingCountry: 'CZ',
      preferredLocale: 'cs',
      authUserId,
    },
    depth: 0,
    overrideAccess: true,
  })

  authLog.info('customer.created_on_verification', {
    email: normalisedEmail,
    customerId: String(created.id),
  })

  return created as Customer
}
