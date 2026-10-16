import type {
  CollectionAfterChangeHook,
  CollectionBeforeValidateHook,
  CollectionConfig,
} from 'payload'
import { APIError } from 'payload'

import { canAccessAdminPanel, isAdmin } from '@/lib/access'
import {
  BILLING_INTERVALS,
  BILLING_PROVIDERS,
  CURRENCIES,
  ENABLED_CURRENCIES,
  SUBSCRIPTION_STATUSES,
  toOptions,
} from '@/lib/billing/constants'
import {
  CurrencyLockedError,
  CurrencyNotEnabledError,
} from '@/lib/billing/errors'
import { assertCurrencyEnabled, isValidMinorAmount } from '@/lib/billing/money'

/**
 * A customer's ongoing right to a plan.
 *
 * `priceMinor` is a SNAPSHOT, not a relation to Price. This is the single most
 * important decision in this collection: a subscriber keeps the price they
 * agreed to, and raising the list price must never silently reprice them. A
 * relation would do exactly that, retroactively, and would also make an old
 * invoice impossible to explain once the price row changed.
 *
 * `currency` and `interval` are snapshotted for the same reason.
 */

const idOf = (value: unknown): unknown =>
  typeof value === 'object' && value !== null
    ? (value as { id: unknown }).id
    : value

/**
 * CURRENCY LOCK.
 *
 * Once a customer has any subscription, their settlement currency is fixed.
 *
 * This is a domain invariant rather than a UI rule because an external
 * provider cannot change the currency of a live subscription: a mixed-currency
 * customer would produce a second provider subscription we could not reconcile,
 * invoices that cannot be summed, and a refund that cannot be matched to its
 * charge. A new currency therefore means a new customer record.
 *
 * ENFORCEMENT HONESTY: this is a read-then-write check, so it is not
 * race-proof. Two genuinely simultaneous *first* subscriptions in different
 * currencies could both pass. See the report for the composite-foreign-key
 * design that would make this a database guarantee, and why it is not worth its
 * cost at this stage. Every realistic path — one checkout at a time, or a
 * provider webhook — is serialised well before this.
 */
const enforceCurrencyLock: CollectionBeforeValidateHook = async ({
  data,
  operation,
  originalDoc,
  req,
}) => {
  if (operation !== 'create' && operation !== 'update') {
    return data
  }

  const merged = { ...originalDoc, ...data }
  const currency = merged.currency as string | undefined
  const customerId = idOf(merged.customer)

  if (!currency || !customerId) {
    return data
  }

  try {
    assertCurrencyEnabled(currency, ENABLED_CURRENCIES)
  } catch (error) {
    if (error instanceof CurrencyNotEnabledError) {
      throw new APIError(error.message, 400)
    }

    throw error
  }

  const customer = await req.payload.findByID({
    collection: 'customers',
    id: String(customerId),
    depth: 0,
    overrideAccess: true,
    req,
  })

  const lockedTo = customer?.currency as string | null | undefined

  if (lockedTo && lockedTo !== currency) {
    throw new APIError(new CurrencyLockedError(lockedTo, currency).message, 409)
  }

  // Belt and braces: the customer row may not carry the lock yet if it was
  // created before this hook existed, or if a previous write was interrupted
  // between the subscription insert and the customer update.
  const existing = await req.payload.find({
    collection: 'subscriptions',
    depth: 0,
    limit: 1,
    pagination: false,
    overrideAccess: true,
    req,
    where: {
      and: [
        { customer: { equals: customerId } },
        { currency: { not_equals: currency } },
        ...(originalDoc?.id ? [{ id: { not_equals: originalDoc.id } }] : []),
      ],
    },
  })

  const clash = existing.docs[0] as { currency?: string } | undefined

  if (clash?.currency) {
    throw new APIError(
      new CurrencyLockedError(clash.currency, currency).message,
      409,
    )
  }

  return data
}

/** Write the lock onto the customer the first time they take a subscription. */
const lockCustomerCurrency: CollectionAfterChangeHook = async ({
  doc,
  operation,
  req,
}) => {
  if (operation !== 'create') {
    return doc
  }

  const customerId = idOf(doc.customer)

  if (!customerId || !doc.currency) {
    return doc
  }

  const customer = await req.payload.findByID({
    collection: 'customers',
    id: String(customerId),
    depth: 0,
    overrideAccess: true,
    req,
  })

  if (customer && !customer.currency) {
    await req.payload.update({
      collection: 'customers',
      id: String(customerId),
      data: { currency: doc.currency },
      depth: 0,
      overrideAccess: true,
      req,
    })
  }

  return doc
}

export const Subscriptions: CollectionConfig = {
  slug: 'subscriptions',
  admin: {
    useAsTitle: 'id',
    defaultColumns: [
      'customer',
      'plan',
      'status',
      'currency',
      'interval',
      'currentPeriodEnd',
    ],
    group: 'Billing',
  },
  access: {
    create: isAdmin,
    read: isAdmin,
    update: isAdmin,
    delete: isAdmin,
    admin: canAccessAdminPanel,
  },
  indexes: [
    // Entitlement resolution always queries by customer; status and period end
    // are the other two columns it filters on.
    { fields: ['customer', 'status'], unique: false },
    // One provider subscription maps to at most one of ours. Prevents a
    // duplicated webhook from opening a second local subscription.
    { fields: ['provider', 'providerSubscriptionId'], unique: true },
  ],
  fields: [
    {
      name: 'customer',
      type: 'relationship',
      relationTo: 'customers',
      required: true,
      hasMany: false,
      index: true,
    },
    {
      name: 'plan',
      type: 'relationship',
      relationTo: 'plans',
      required: true,
      hasMany: false,
      admin: {
        description:
          'The tier. Its current `features` decide entitlement; the price does not come from here.',
      },
    },
    {
      name: 'currency',
      type: 'select',
      options: toOptions(CURRENCIES),
      required: true,
      admin: {
        description:
          'Snapshot. Locked to the customer on their first subscription and never changed.',
      },
    },
    {
      name: 'interval',
      type: 'select',
      options: toOptions(BILLING_INTERVALS),
      required: true,
      admin: { description: 'Snapshot of the cadence agreed at purchase.' },
    },
    {
      name: 'priceMinor',
      type: 'number',
      required: true,
      admin: {
        description:
          'SNAPSHOT of the amount in minor units at purchase time. Deliberately not a relation to Price — a list-price change must never reprice an existing subscriber.',
      },
      validate: (value: unknown) =>
        isValidMinorAmount(value)
          ? true
          : 'priceMinor must be a non-negative integer number of minor units.',
    },
    {
      name: 'status',
      type: 'select',
      options: toOptions(SUBSCRIPTION_STATUSES),
      required: true,
      defaultValue: 'INCOMPLETE',
      index: true,
      admin: {
        description:
          'A cancellation scheduled for period end stays ACTIVE until then — see cancelAtPeriodEnd.',
      },
    },
    {
      name: 'currentPeriodStart',
      type: 'date',
      required: true,
      admin: { description: 'Start of the period currently paid for.' },
    },
    {
      name: 'currentPeriodEnd',
      type: 'date',
      required: true,
      index: true,
      admin: {
        description:
          'End of the period currently paid for. Access stops here even if the status has not been reconciled yet.',
      },
    },
    {
      name: 'cancelAtPeriodEnd',
      type: 'checkbox',
      required: true,
      defaultValue: false,
      admin: {
        description:
          'Set when the customer cancels but has paid through the period. Status stays ACTIVE until currentPeriodEnd.',
      },
    },
    {
      name: 'canceledAt',
      type: 'date',
      admin: {
        description: 'When cancellation was requested, not when access ends.',
      },
    },
    {
      name: 'endedAt',
      type: 'date',
      admin: { description: 'When access actually ended.' },
    },
    {
      name: 'provider',
      type: 'select',
      options: toOptions(BILLING_PROVIDERS),
      required: true,
      admin: { description: 'Which external system bills this subscription.' },
    },
    {
      name: 'providerSubscriptionId',
      type: 'text',
      required: true,
      admin: {
        description:
          "The provider's subscription id. Unique per provider — see the compound index.",
      },
    },
    {
      name: 'providerUpdatedAt',
      type: 'date',
      admin: {
        description:
          'Provider-side time the fields above were last known true. Webhooks arrive out of order; an event older than this is recorded but not applied. See src/lib/billing/ordering.ts.',
      },
    },
  ],
  hooks: {
    beforeValidate: [enforceCurrencyLock],
    afterChange: [lockCustomerCurrency],
  },
  labels: { singular: 'Subscription', plural: 'Subscriptions' },
  timestamps: true,
}
