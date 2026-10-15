import type { CollectionConfig } from 'payload'
import { APIError } from 'payload'

import { canAccessAdminPanel, isAdmin } from '@/lib/access'
import { FEATURE_KEYS, PLAN_CODES, toOptions } from '@/lib/billing/constants'

/**
 * A subscription tier.
 *
 * A plan carries no price. Prices live in their own collection so that one
 * plan can be sold in several currencies and intervals, and so that changing
 * what a plan costs never rewrites what an existing subscriber agreed to.
 *
 * `features` is the authority on what the tier unlocks. It is read by
 * `resolveEntitlements`, which means entitlement is a property of our data —
 * not of anything the payment provider says.
 *
 * Access: admin only on every operation. Nothing in this step is publicly
 * readable; a pricing page in a later step will read plans through a
 * purpose-built, explicitly public endpoint rather than by loosening this.
 */
export const Plans: CollectionConfig = {
  slug: 'plans',
  admin: {
    useAsTitle: 'code',
    defaultColumns: ['code', 'name', 'sortOrder', 'active'],
    group: 'Billing',
  },
  access: {
    create: isAdmin,
    read: isAdmin,
    update: isAdmin,
    delete: isAdmin,
    admin: canAccessAdminPanel,
  },
  defaultSort: 'sortOrder',
  fields: [
    {
      name: 'code',
      type: 'select',
      options: toOptions(PLAN_CODES),
      required: true,
      unique: true,
      admin: {
        description:
          'Stable machine code. Referenced by seeds, reports and support tooling — never renamed.',
      },
    },
    {
      name: 'name',
      type: 'text',
      required: true,
      admin: { description: 'Customer-facing name.' },
    },
    {
      name: 'description',
      type: 'textarea',
      admin: { description: 'Short customer-facing summary of the tier.' },
    },
    {
      name: 'sortOrder',
      type: 'number',
      required: true,
      defaultValue: 0,
      admin: {
        description:
          'Display order, ascending. Forced to an integer column by the schema override in payload.config.ts.',
      },
      validate: (value: unknown) =>
        Number.isInteger(value) ? true : 'sortOrder must be an integer.',
    },
    {
      name: 'active',
      type: 'checkbox',
      required: true,
      defaultValue: true,
      admin: {
        description:
          'Whether the plan may be sold. Deactivating never affects existing subscriptions.',
      },
    },
    {
      name: 'features',
      type: 'select',
      hasMany: true,
      options: toOptions(FEATURE_KEYS),
      required: true,
      admin: {
        description:
          'Feature keys this tier unlocks. This is what resolveEntitlements reads.',
      },
    },
    {
      name: 'providerProductId',
      type: 'text',
      admin: {
        description:
          'Optional product id at the billing provider. Reconciliation convenience only — never an input to entitlement.',
      },
    },
  ],
  hooks: {
    beforeValidate: [
      ({ data }) => {
        // `required` on a hasMany select does not reject an empty array, and a
        // plan that unlocks nothing is a silently broken product.
        if (Array.isArray(data?.features) && data.features.length === 0) {
          throw new APIError(
            'A plan must unlock at least one feature, otherwise a subscription to it grants nothing.',
            400,
          )
        }

        return data
      },
    ],
  },
  labels: { singular: 'Plan', plural: 'Plans' },
  timestamps: true,
}
