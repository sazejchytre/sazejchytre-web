import type { CollectionConfig } from 'payload'

import { canAccessAdminPanel, isAdmin } from '@/lib/access'

/**
 * A sport. Reference data.
 *
 * Nothing public reads this directly in this step; the tips UI arrives later.
 * Access is admin-only on every operation, like every other collection here —
 * Payload's defaults grant public read, and inheriting one is how a table ends
 * up world-readable by accident.
 */
export const Sports: CollectionConfig = {
  slug: 'sports',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['code', 'name', 'sortOrder', 'active'],
    group: 'Tipy',
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
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: {
        description:
          'Stable machine code, e.g. FOOTBALL. Referenced by seeds, the track record and the ingestion contract — never renamed.',
      },
    },
    {
      name: 'name',
      type: 'text',
      required: true,
      admin: { description: 'Czech display name.' },
    },
    {
      name: 'active',
      type: 'checkbox',
      required: true,
      defaultValue: true,
      admin: {
        description:
          'Whether new tips may be published for it. Never affects existing tips or the track record.',
      },
    },
    {
      name: 'sortOrder',
      type: 'number',
      required: true,
      defaultValue: 0,
      validate: (value: unknown) =>
        Number.isInteger(value) ? true : 'sortOrder must be an integer.',
    },
    {
      name: 'seedMarker',
      type: 'text',
      index: true,
      admin: {
        description:
          'Set by the development seed so seeded rows can be purged. Null for real data.',
      },
    },
  ],
  labels: { singular: 'Sport', plural: 'Sporty' },
  timestamps: true,
}
