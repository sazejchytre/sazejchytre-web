import type { CollectionConfig } from 'payload'

import { canAccessAdminPanel, isAdmin } from '@/lib/access'

/**
 * A league, cup or tour within a sport.
 *
 * `externalRefs` is the mapping seam to a data provider, kept as JSON rather
 * than columns because every provider names things differently and we do not
 * yet know which one we will use. A column per provider would be a migration
 * each time; a JSON map is a write.
 */
export const Competitions: CollectionConfig = {
  slug: 'competitions',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'sport', 'country', 'updatedAt'],
    group: 'Tipy',
  },
  access: {
    create: isAdmin,
    read: isAdmin,
    update: isAdmin,
    delete: isAdmin,
    admin: canAccessAdminPanel,
  },
  indexes: [{ fields: ['sport', 'name'], unique: false }],
  fields: [
    {
      name: 'sport',
      type: 'relationship',
      relationTo: 'sports',
      required: true,
      hasMany: false,
      index: true,
    },
    {
      name: 'name',
      type: 'text',
      required: true,
      admin: { description: 'e.g. Chance Liga, Premier League.' },
    },
    {
      name: 'country',
      type: 'text',
      maxLength: 2,
      admin: {
        description:
          'ISO 3166-1 alpha-2 of the competition, where it has one. Null for international tours.',
      },
    },
    {
      name: 'externalRefs',
      type: 'json',
      admin: {
        description:
          'Provider id map, e.g. { "sportmonks": "271", "oddsapi": "soccer_czech" }. Written by a sync later; by hand for now.',
      },
    },
    {
      name: 'seedMarker',
      type: 'text',
      index: true,
      admin: {
        description: 'Set by the development seed. Null for real data.',
      },
    },
  ],
  labels: { singular: 'Soutěž', plural: 'Soutěže' },
  timestamps: true,
}
