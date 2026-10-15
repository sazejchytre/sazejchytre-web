import type { CollectionConfig } from 'payload'

import { canAccessAdminPanel, denyAll, isAdmin } from '@/lib/access'
import { blockDeletes, lockFieldsAfterCreate } from '@/lib/billing/append-only'
import { CONSENT_TYPES, toOptions } from '@/lib/billing/constants'

/**
 * Evidence that a specific person agreed to a specific text at a specific
 * moment.
 *
 * `consentTextSnapshot` stores the EXACT WORDING SHOWN, not a reference to a
 * document version. This is the whole point of the collection. A reference
 * proves which version we *believe* was displayed; if the terms are later
 * edited, re-rendered from a template, or served from a cache that drifted,
 * the reference is worthless precisely when it matters. The snapshot is what
 * can be put in front of a regulator.
 *
 * `DIGITAL_CONTENT_WAIVER` is the Czech-law waiver of the 14-day right of
 * withdrawal for digital content supplied before that period elapses. Without a
 * recorded waiver carrying the words the customer actually saw, a subscriber
 * can demand a refund within 14 days regardless of how much content they
 * consumed — so this row is the difference between a defensible sale and an
 * unconditional one.
 *
 * `customer` is nullable because consent can precede the account: the waiver is
 * shown at checkout, which is before we necessarily have a customer row.
 *
 * Append-only apart from `withdrawnAt`. Withdrawal is additive evidence, never
 * an erasure of the original consent — "they agreed, then later withdrew" is a
 * different fact from "they never agreed", and only the first is true.
 */
export const ConsentRecords: CollectionConfig = {
  slug: 'consent-records',
  admin: {
    useAsTitle: 'type',
    defaultColumns: [
      'type',
      'customer',
      'documentVersion',
      'grantedAt',
      'withdrawnAt',
    ],
    group: 'Billing',
  },
  access: {
    create: isAdmin,
    read: isAdmin,
    // Permitted so that `withdrawnAt` can be set; the hook restricts the
    // update to that one field.
    update: isAdmin,
    // Never. Deleting consent evidence destroys the only proof we had.
    delete: denyAll,
    admin: canAccessAdminPanel,
  },
  indexes: [
    { fields: ['customer', 'type'], unique: false },
    { fields: ['type', 'documentVersion'], unique: false },
  ],
  fields: [
    {
      name: 'customer',
      type: 'relationship',
      relationTo: 'customers',
      hasMany: false,
      index: true,
      admin: {
        description:
          'Nullable: consent at checkout can precede the customer record. Backfilled once the account exists.',
      },
    },
    {
      name: 'type',
      type: 'select',
      options: toOptions(CONSENT_TYPES),
      required: true,
    },
    {
      name: 'documentVersion',
      type: 'text',
      required: true,
      admin: {
        description:
          'Version identifier of the document shown, for correlation. The authority is consentTextSnapshot.',
      },
    },
    {
      name: 'consentTextSnapshot',
      type: 'textarea',
      required: true,
      admin: {
        description:
          'The exact text displayed to this person, verbatim. Never a reference, never regenerated.',
      },
    },
    {
      name: 'grantedAt',
      type: 'date',
      required: true,
      index: true,
    },
    {
      name: 'ipAddress',
      type: 'text',
      admin: {
        description:
          'Source address at the moment of consent. Nullable — absent evidence is better than invented evidence.',
      },
    },
    {
      name: 'userAgent',
      type: 'text',
      admin: { description: 'Client user agent at the moment of consent.' },
    },
    {
      name: 'withdrawnAt',
      type: 'date',
      admin: {
        description:
          'The only mutable field. Records that consent was later withdrawn, without erasing that it was given.',
      },
    },
  ],
  hooks: {
    beforeValidate: [
      lockFieldsAfterCreate('A consent record', ['withdrawnAt']),
    ],
    beforeDelete: [blockDeletes('A consent record')],
  },
  labels: { singular: 'Consent record', plural: 'Consent records' },
  timestamps: true,
}
