import type { CollectionConfig } from 'payload'

import { canAccessAdminPanel, denyAll, isAdmin } from '@/lib/access'
import { blockDeletes, lockFieldsAfterCreate } from '@/lib/billing/append-only'
import { TIP_AUDIT_EVENT_TYPES, toOptions } from '@/lib/tips/constants'

/**
 * Append-only history of everything that happened to a tip.
 *
 * WHY IT MATTERS HERE MORE THAN ANYWHERE ELSE
 *
 * The immutability rules stop a published tip being edited. This is what shows
 * that nothing was: every status transition and every settlement leaves a row
 * with who did it, when, and the before and after values. Immutability is the
 * lock; this is the record of the lock never having been forced.
 *
 * Without it, "we never edited that tip" is a claim about our own behaviour
 * that nobody can check. With it, the absence of a row is itself evidence.
 *
 * Blocked TWICE over, as with the billing model's subscription events:
 *
 *   - `access.update` / `access.delete` deny it, which stops a caller that
 *     should not be writing at all;
 *   - the hooks also fire for `overrideAccess: true`, which every server-side
 *     path uses — including the settlement automation that writes these rows.
 *     Without the hooks, our own code could rewrite the history it just made.
 *
 * `before` and `after` are JSON because the shape differs per event type: a
 * status transition carries two statuses, a settlement carries a list of
 * outcomes. Typed columns would fit one and be null for the rest.
 */
export const TipAuditEvents: CollectionConfig = {
  slug: 'tip-audit-events',
  admin: {
    useAsTitle: 'type',
    defaultColumns: ['tip', 'type', 'occurredAt', 'actor'],
    group: 'Tipy',
    description:
      'Neměnná historie. Zápis je možný jen přidáním, nikdy úpravou.',
  },
  access: {
    create: isAdmin,
    read: isAdmin,
    // Append-only: a history that can be edited is not a history.
    update: denyAll,
    delete: denyAll,
    admin: canAccessAdminPanel,
  },
  indexes: [
    { fields: ['tip', 'occurredAt'], unique: false },
    { fields: ['type', 'occurredAt'], unique: false },
  ],
  fields: [
    {
      name: 'tip',
      type: 'relationship',
      relationTo: 'tips',
      required: true,
      hasMany: false,
      index: true,
    },
    {
      name: 'type',
      type: 'select',
      options: toOptions(TIP_AUDIT_EVENT_TYPES),
      required: true,
    },
    {
      name: 'occurredAt',
      type: 'date',
      required: true,
      index: true,
      admin: {
        description:
          'When it happened, as reported by whatever caused it. `createdAt` is when we stored it.',
      },
    },
    {
      name: 'actor',
      type: 'text',
      required: true,
      admin: {
        description:
          'Who caused it — an admin email, or `system` for the settlement automation. Required: an unattributed change to the record is the one we would most want to trace.',
      },
    },
    {
      name: 'before',
      type: 'json',
      admin: { description: 'Relevant values before the change.' },
    },
    {
      name: 'after',
      type: 'json',
      admin: { description: 'Relevant values after the change.' },
    },
    {
      name: 'note',
      type: 'textarea',
      admin: { description: 'Optional human explanation.' },
    },
  ],
  hooks: {
    beforeValidate: [lockFieldsAfterCreate('A tip audit event', [])],
    beforeDelete: [blockDeletes('A tip audit event')],
  },
  labels: { singular: 'Záznam o tipu', plural: 'Záznamy o tipech' },
  timestamps: true,
}
