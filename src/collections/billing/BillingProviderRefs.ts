import type { CollectionConfig } from 'payload'

import { canAccessAdminPanel, isAdmin } from '@/lib/access'
import { BILLING_PROVIDERS, toOptions } from '@/lib/billing/constants'

/**
 * The seam between a customer of ours and a customer record at a payment
 * provider.
 *
 * Why this is its own table rather than a `stripeCustomerId` column:
 *
 *  - Swapping or adding a provider becomes a row, not a migration plus a
 *    rename of every reference.
 *  - Nothing in the domain model mentions Stripe. `provider` is an enum, and
 *    the rest of the schema only ever joins through here.
 *  - It makes the two uniqueness rules expressible, which a nullable column on
 *    `customers` could not do.
 *
 * BOTH uniqueness rules are real Postgres unique indexes, declared through
 * Payload's compound `indexes`, so they hold under concurrency:
 *
 *  - (provider, externalId) — one provider-side record maps to at most one of
 *    our customers. Without it, two of our customers could both claim the same
 *    Stripe customer and a webhook would be ambiguous.
 *  - (provider, customer) — one of our customers has at most one record per
 *    provider. Without it, we could open two provider customers for the same
 *    person and silently split their billing history.
 */
export const BillingProviderRefs: CollectionConfig = {
  slug: 'billing-provider-refs',
  admin: {
    useAsTitle: 'externalId',
    defaultColumns: ['provider', 'externalId', 'customer', 'updatedAt'],
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
    { fields: ['provider', 'externalId'], unique: true },
    { fields: ['provider', 'customer'], unique: true },
  ],
  fields: [
    {
      name: 'customer',
      type: 'relationship',
      relationTo: 'customers',
      required: true,
      hasMany: false,
    },
    {
      name: 'provider',
      type: 'select',
      options: toOptions(BILLING_PROVIDERS),
      required: true,
      admin: {
        description:
          'Which external system `externalId` belongs to. An enum from the start so a second provider is a data change.',
      },
    },
    {
      name: 'externalId',
      type: 'text',
      required: true,
      admin: {
        description:
          "The provider's own customer id (e.g. a Stripe `cus_…`). Opaque to us.",
      },
    },
  ],
  labels: {
    singular: 'Billing provider reference',
    plural: 'Billing provider references',
  },
  timestamps: true,
}
