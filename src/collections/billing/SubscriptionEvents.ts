import type { CollectionConfig } from 'payload'

import { canAccessAdminPanel, denyAll, isAdmin } from '@/lib/access'
import { blockDeletes, lockFieldsAfterCreate } from '@/lib/billing/append-only'
import { SUBSCRIPTION_EVENT_TYPES, toOptions } from '@/lib/billing/constants'

/**
 * Append-only audit log of everything that happened to a subscription.
 *
 * This is the record that makes a billing dispute answerable: what we were
 * told, when, and what we did about it. It is only trustworthy if it cannot be
 * rewritten, so updates and deletes are blocked TWICE over — once in access
 * control, once in a hook.
 *
 * That is not redundant. `access.update` returning false stops the operation
 * before it starts, which is what protects against a caller who should not be
 * writing at all. The hook also fires for writes that bypass access control —
 * `overrideAccess: true`, which every server-side path uses, including the
 * webhook handlers arriving in step 4. Without the hook, our own code would be
 * free to rewrite history; with it, the only way is raw SQL.
 *
 * `sourceEventId` ties a row back to the provider event that caused it, so a
 * replayed webhook is visible as such rather than appearing to be a second
 * real-world event.
 */
export const SubscriptionEvents: CollectionConfig = {
  slug: 'subscription-events',
  admin: {
    useAsTitle: 'type',
    defaultColumns: ['subscription', 'type', 'occurredAt', 'sourceEventId'],
    group: 'Billing',
  },
  access: {
    create: isAdmin,
    read: isAdmin,
    // Append-only: nothing may ever change or remove a logged event.
    update: denyAll,
    delete: denyAll,
    admin: canAccessAdminPanel,
  },
  indexes: [{ fields: ['subscription', 'occurredAt'], unique: false }],
  fields: [
    {
      name: 'subscription',
      type: 'relationship',
      relationTo: 'subscriptions',
      required: true,
      hasMany: false,
      index: true,
    },
    {
      name: 'type',
      type: 'select',
      options: toOptions(SUBSCRIPTION_EVENT_TYPES),
      required: true,
    },
    {
      name: 'occurredAt',
      type: 'date',
      required: true,
      index: true,
      admin: {
        description:
          'When the event happened, as reported by its source — not when we stored it. `createdAt` is the latter.',
      },
    },
    {
      name: 'payload',
      type: 'json',
      admin: {
        description:
          'Verbatim detail of the event. Stored as received so a later dispute can be read against the original.',
      },
    },
    {
      name: 'sourceEventId',
      type: 'text',
      index: true,
      admin: {
        description:
          'The provider event id that caused this, when there was one. Lets a replay be recognised rather than double-counted.',
      },
    },
  ],
  hooks: {
    // beforeValidate, not beforeChange: an append-only row is refused before
    // anything looks at what the new values would have been.
    beforeValidate: [lockFieldsAfterCreate('A subscription event', [])],
    beforeDelete: [blockDeletes('A subscription event')],
  },
  labels: { singular: 'Subscription event', plural: 'Subscription events' },
  timestamps: true,
}
