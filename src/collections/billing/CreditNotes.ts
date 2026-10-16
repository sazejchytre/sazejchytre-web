import type { CollectionConfig } from 'payload'

import { canAccessAdminPanel, denyAll, isAdmin } from '@/lib/access'
import {
  blockDeletes,
  lockFieldsAfterCreate,
  lockOnceSet,
} from '@/lib/billing/append-only'
import {
  CURRENCIES,
  DOCUMENT_DELIVERY_STATES,
  toOptions,
} from '@/lib/billing/constants'
import { isValidMinorAmount } from '@/lib/billing/money'

/**
 * A correction to an issued invoice (opravný daňový doklad).
 *
 * Every refund, partial refund, cancellation and billing mistake becomes one of
 * these. The invoice it corrects is NEVER touched beyond its `status`, so the
 * history reads as "we invoiced X, then credited Y" rather than silently
 * becoming "we invoiced X − Y". That matters for the same reason the invoice is
 * immutable: the customer and the accountant each hold a copy of the original.
 *
 * Its own numbering series, allocated by the same atomic allocator. Sharing the
 * invoice counter would put gaps in both series.
 *
 * `amountMinor` is the credited amount and may be less than the invoice total —
 * partial refunds are normal. Several credit notes may therefore reference one
 * invoice. Whether their sum may exceed the invoice total is a business rule
 * for the step that actually issues refunds; it is deliberately not guessed at
 * here, because the answer depends on how over-crediting should be surfaced.
 */
export const CreditNotes: CollectionConfig = {
  slug: 'credit-notes',
  admin: {
    useAsTitle: 'number',
    defaultColumns: [
      'number',
      'invoice',
      'amountMinor',
      'currency',
      'issuedAt',
    ],
    group: 'Billing',
  },
  access: {
    create: isAdmin,
    read: isAdmin,
    // Its CONTENT may never change — it is a tax document in its own right.
    // Relaxed from denyAll only so the rendered PDF and the delivery outcome
    // can be recorded after creation, which cannot happen at creation because
    // the PDF needs the allocated number. The hooks below allow exactly those
    // fields and exactly one write each.
    update: isAdmin,
    delete: denyAll,
    admin: canAccessAdminPanel,
  },
  indexes: [
    { fields: ['numberYear', 'numberSequence'], unique: true },
    { fields: ['invoice'], unique: false },
  ],
  fields: [
    {
      name: 'number',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: {
        description:
          'Own strictly sequential series, separate from invoices (e.g. OD2026-000001).',
      },
    },
    {
      name: 'numberYear',
      type: 'number',
      required: true,
      validate: (value: unknown) =>
        Number.isInteger(value) ? true : 'numberYear must be an integer.',
    },
    {
      name: 'numberSequence',
      type: 'number',
      required: true,
      validate: (value: unknown) =>
        Number.isInteger(value) && (value as number) >= 1
          ? true
          : 'numberSequence must be an integer >= 1.',
    },
    {
      name: 'invoice',
      type: 'relationship',
      relationTo: 'invoices',
      required: true,
      hasMany: false,
      index: true,
      admin: { description: 'The invoice this corrects.' },
    },
    {
      name: 'currency',
      type: 'select',
      options: toOptions(CURRENCIES),
      required: true,
      admin: {
        description:
          "Must match the invoice's currency. Carried explicitly so no row depends on a join to know its own currency.",
      },
    },
    {
      name: 'amountMinor',
      type: 'number',
      required: true,
      admin: {
        description:
          'Credited amount in minor units. May be less than the invoice total for a partial refund.',
      },
      validate: (value: unknown) =>
        isValidMinorAmount(value)
          ? true
          : 'amountMinor must be a non-negative integer number of minor units.',
    },
    {
      name: 'reason',
      type: 'textarea',
      required: true,
      admin: {
        description:
          'Why this was credited. Appears on the document and in reporting.',
      },
    },
    {
      name: 'issuedAt',
      type: 'date',
      required: true,
      index: true,
    },
    {
      name: 'providerRefundId',
      type: 'text',
      unique: true,
      admin: {
        description:
          'The provider refund this records, when it came from one. Unique, which is what makes the refund webhook idempotent by itself rather than only through the event claim: a replay cannot produce a second credit note. Null for a credit note issued by hand.',
      },
    },
    {
      name: 'billingCountry',
      type: 'text',
      maxLength: 2,
      index: true,
      admin: {
        description:
          'Copied from the invoice so cross-border totals can net credits without a join.',
      },
    },
    {
      name: 'deliveryState',
      type: 'select',
      options: toOptions(DOCUMENT_DELIVERY_STATES),
      required: true,
      defaultValue: 'PENDING',
      index: true,
      admin: {
        description:
          'How far this document has got towards the customer. Separate from its existence: an issued document stays issued whatever happens to the email.',
      },
    },
    {
      name: 'deliveredAt',
      type: 'date',
      admin: {
        description: 'When the email was accepted by the provider. Write-once.',
      },
    },
    {
      name: 'deliveryAttempts',
      type: 'number',
      required: true,
      defaultValue: 0,
      admin: {
        description:
          'How many times delivery has been tried. Integer — see src/lib/billing/schema.ts.',
      },
    },
    {
      name: 'deliveryError',
      type: 'text',
      admin: {
        description:
          'Why the last attempt failed, for the retry sweep. Never carries the message body or the attachment.',
      },
    },
    {
      name: 'pdfStorageKey',
      type: 'text',
      admin: { description: 'Object key of the rendered PDF in R2.' },
    },
  ],
  hooks: {
    beforeValidate: [
      lockFieldsAfterCreate('A credit note', [
        'pdfStorageKey',
        'deliveryState',
        'deliveredAt',
        'deliveryAttempts',
        'deliveryError',
      ]),
      lockOnceSet('A credit note', ['pdfStorageKey', 'deliveredAt']),
    ],
    beforeDelete: [blockDeletes('A credit note')],
  },
  labels: { singular: 'Credit note', plural: 'Credit notes' },
  timestamps: true,
}
