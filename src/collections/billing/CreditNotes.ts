import type { CollectionConfig } from 'payload'

import { canAccessAdminPanel, denyAll, isAdmin } from '@/lib/access'
import {
  blockDeletes,
  lockFieldsAfterCreate,
  lockOnceSet,
} from '@/lib/billing/append-only'
import {
  ACCOUNTING_DOCUMENT_STATES,
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
 * Fakturoid numbers it, as a correction document bound to the invoice it
 * corrects (`document_type: "correction"` with `correction_id`). We no longer
 * allocate a series of our own — two numbering series inside one accounting
 * year is not something an accountant can reconcile.
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
    useAsTitle: 'fakturoidNumber',
    defaultColumns: [
      'fakturoidNumber',
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
    // Relaxed from denyAll only so the accounting document, the stored PDF
    // and the delivery outcome can be recorded after creation — none of which
    // is knowable at creation, because the document is issued at a third
    // party afterwards. The hooks below allow exactly those fields and
    // exactly one write each.
    update: isAdmin,
    delete: denyAll,
    admin: canAccessAdminPanel,
  },
  indexes: [
    { fields: ['invoice'], unique: false },
    // Finds the rows the retry cron has to pick up.
    { fields: ['accountingState', 'issuedAt'], unique: false },
  ],
  fields: [
    {
      name: 'accountingState',
      type: 'select',
      required: true,
      defaultValue: 'PENDING',
      index: true,
      options: toOptions(ACCOUNTING_DOCUMENT_STATES),
      admin: {
        description:
          'Whether Fakturoid holds a correction document for this row yet.',
      },
    },
    {
      name: 'fakturoidDocumentId',
      type: 'text',
      // Nullable: the row records the refund the moment it happens, which is
      // before the correction document can be created at Fakturoid.
      required: false,
      unique: true,
      index: true,
      admin: { description: "The correction document's id at Fakturoid." },
    },
    {
      name: 'fakturoidNumber',
      type: 'text',
      required: false,
      unique: true,
      index: true,
      admin: {
        description:
          'The correction document number as issued by Fakturoid, in its own series.',
      },
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
        'accountingState',
        'fakturoidDocumentId',
        'fakturoidNumber',
        'pdfStorageKey',
        'deliveryState',
        'deliveredAt',
        'deliveryAttempts',
        'deliveryError',
      ]),
      // Repointing a row at a different correction document would silently
      // reassign a statutory number and orphan the original at Fakturoid.
      lockOnceSet('A credit note', [
        'fakturoidDocumentId',
        'fakturoidNumber',
        'pdfStorageKey',
        'deliveredAt',
      ]),
    ],
    beforeDelete: [blockDeletes('A credit note')],
  },
  labels: { singular: 'Credit note', plural: 'Credit notes' },
  timestamps: true,
}
