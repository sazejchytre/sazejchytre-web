import type { CollectionBeforeValidateHook, CollectionConfig } from 'payload'
import { APIError } from 'payload'

import { canAccessAdminPanel, isAdmin } from '@/lib/access'
import { FEATURE_KEYS, toOptions } from '@/lib/billing/constants'

/**
 * A manual entitlement, for support cases and comped access.
 *
 * Needed because not every reason to grant access is a payment: an apology for
 * an outage, a reviewer, a partner, a customer whose card failed through no
 * fault of theirs. Without this, support's only tool is a fake subscription —
 * which corrupts revenue reporting and the provider's records at once.
 *
 * A grant names EITHER one feature OR a whole plan, never both and never
 * neither. The plan form exists so "give them PRO for a month" does not have
 * to be expanded into a feature list that then drifts when the plan changes.
 *
 * Grants are additive and never subtractive: there is no "deny" grant. Taking
 * access away is done by revoking a grant or ending a subscription, so that
 * every grant row can be read as a reason someone *has* something.
 *
 * Revocation is `revokedAt`, not a delete — why access was removed is as
 * auditable as why it was given.
 */

const requireExactlyOneTarget: CollectionBeforeValidateHook = ({
  data,
  operation,
  originalDoc,
}) => {
  if (operation !== 'create' && operation !== 'update') {
    return data
  }

  const merged = { ...originalDoc, ...data }
  const hasFeature = Boolean(merged.featureKey)
  const hasPlan = Boolean(merged.plan)

  if (hasFeature === hasPlan) {
    throw new APIError(
      hasFeature
        ? 'A grant must name either a featureKey or a plan, not both — otherwise which one applies is ambiguous.'
        : 'A grant must name either a featureKey or a plan. One that names neither grants nothing.',
      400,
    )
  }

  return data
}

const requireSaneWindow: CollectionBeforeValidateHook = ({
  data,
  operation,
  originalDoc,
}) => {
  if (operation !== 'create' && operation !== 'update') {
    return data
  }

  const merged = { ...originalDoc, ...data }

  if (!merged.startsAt || !merged.endsAt) {
    return data
  }

  const starts = new Date(merged.startsAt as string).getTime()
  const ends = new Date(merged.endsAt as string).getTime()

  if (!Number.isNaN(starts) && !Number.isNaN(ends) && ends < starts) {
    throw new APIError(
      'endsAt is before startsAt, which would create a grant that never applies.',
      400,
    )
  }

  return data
}

export const EntitlementGrants: CollectionConfig = {
  slug: 'entitlement-grants',
  admin: {
    useAsTitle: 'reason',
    defaultColumns: [
      'customer',
      'featureKey',
      'plan',
      'startsAt',
      'endsAt',
      'revokedAt',
    ],
    group: 'Billing',
  },
  access: {
    create: isAdmin,
    read: isAdmin,
    // Updatable so a grant can be revoked or its window corrected; every
    // change is attributable through `grantedBy` plus Payload's timestamps.
    update: isAdmin,
    delete: isAdmin,
    admin: canAccessAdminPanel,
  },
  indexes: [{ fields: ['customer', 'revokedAt'], unique: false }],
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
      name: 'featureKey',
      type: 'select',
      options: toOptions(FEATURE_KEYS),
      admin: {
        description: 'Grant a single feature. Mutually exclusive with `plan`.',
      },
    },
    {
      name: 'plan',
      type: 'relationship',
      relationTo: 'plans',
      hasMany: false,
      admin: {
        description:
          "Grant everything in a plan's current feature list. Mutually exclusive with `featureKey`.",
      },
    },
    {
      name: 'grantedBy',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      hasMany: false,
      admin: {
        description:
          'The admin accountable for this grant. Required — a comped account with no name attached is how free access quietly spreads.',
      },
    },
    {
      name: 'reason',
      type: 'textarea',
      required: true,
      admin: {
        description:
          'Why this was granted, in enough detail to be audited months later.',
      },
    },
    {
      name: 'startsAt',
      type: 'date',
      required: true,
    },
    {
      name: 'endsAt',
      type: 'date',
      admin: {
        description: 'Null means open-ended. Prefer an end date.',
      },
    },
    {
      name: 'revokedAt',
      type: 'date',
      admin: {
        description:
          'Set to withdraw the grant. Revocation wins over the window, immediately.',
      },
    },
  ],
  hooks: {
    beforeValidate: [requireExactlyOneTarget, requireSaneWindow],
  },
  labels: { singular: 'Entitlement grant', plural: 'Entitlement grants' },
  timestamps: true,
}
