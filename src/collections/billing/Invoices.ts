import type { CollectionBeforeValidateHook, CollectionConfig } from 'payload'
import { APIError } from 'payload'

import { canAccessAdminPanel, denyAll, isAdmin } from '@/lib/access'
import {
  blockDeletes,
  lockFieldsAfterCreate,
  lockOnceSet,
} from '@/lib/billing/append-only'
import {
  CURRENCIES,
  DOCUMENT_DELIVERY_STATES,
  INVOICE_STATUSES,
  TAX_TREATMENTS,
  toOptions,
} from '@/lib/billing/constants'
import { isValidMinorAmount } from '@/lib/billing/money'

/**
 * An issued invoice. Immutable.
 *
 * WHY THE SNAPSHOTS
 *
 * An invoice has to stay readable and defensible years after it was issued,
 * when the plan has been renamed, the price has changed, the customer has
 * moved and the operator's address is different. So it carries its own copy of
 * everything it asserts: both parties' identities, the amounts, the tax
 * treatment and the rate. Nothing on it is a live join. Re-deriving an invoice
 * from today's data would quietly produce a different document from the one the
 * customer received, which is the one thing an invoice must never do.
 *
 * IMMUTABILITY
 *
 * Only `status` may change, and only to mark the invoice credited. Everything
 * else is frozen by `lockFieldsAfterCreate`, and deletion is blocked outright.
 * Corrections are credit notes: the original is never edited, so the pair
 * (invoice, credit note) always shows what happened rather than only the
 * corrected end state.
 *
 * NUMBERING
 *
 * `number` is allocated by `allocateDocumentNumber` only once a payment is
 * confirmed, so an abandoned checkout burns nothing. `numberYear` and
 * `numberSequence` are stored alongside the rendered string so the series can
 * be checked for gaps with a query instead of by parsing text.
 */

/** The arithmetic has to hold, or the document contradicts itself. */
const enforceTotals: CollectionBeforeValidateHook = ({
  data,
  operation,
  originalDoc,
}) => {
  if (operation !== 'create' && operation !== 'update') {
    return data
  }

  const merged = { ...originalDoc, ...data }
  const { subtotalMinor, taxMinor, totalMinor } = merged as Record<
    string,
    unknown
  >

  if (
    !isValidMinorAmount(subtotalMinor) ||
    !isValidMinorAmount(taxMinor) ||
    !isValidMinorAmount(totalMinor)
  ) {
    // Field-level validation reports which one; nothing to add here.
    return data
  }

  if (subtotalMinor + taxMinor !== totalMinor) {
    throw new APIError(
      `Invoice totals do not add up: subtotalMinor (${subtotalMinor}) + taxMinor (${taxMinor}) ` +
        `must equal totalMinor (${totalMinor}).`,
      400,
    )
  }

  return data
}

/**
 * Keep the tax fields consistent with the declared treatment.
 *
 * This is not tax calculation — it is a consistency check on what the caller
 * asserted. The operator is not VAT registered, so a non-zero tax under
 * `NONE_NOT_VAT_REGISTERED` would be a bug producing an invoice that claims to
 * charge VAT the operator cannot legally charge.
 */
const enforceTaxTreatmentConsistency: CollectionBeforeValidateHook = ({
  data,
  operation,
  originalDoc,
}) => {
  if (operation !== 'create' && operation !== 'update') {
    return data
  }

  const merged = { ...originalDoc, ...data } as Record<string, unknown>

  if (merged.taxTreatment !== 'NONE_NOT_VAT_REGISTERED') {
    return data
  }

  if (merged.taxMinor !== 0 || merged.taxRateBasisPoints !== 0) {
    throw new APIError(
      'taxTreatment NONE_NOT_VAT_REGISTERED requires taxMinor = 0 and taxRateBasisPoints = 0. ' +
        'The operator is not VAT registered and cannot charge VAT.',
      400,
    )
  }

  return data
}

export const Invoices: CollectionConfig = {
  slug: 'invoices',
  admin: {
    useAsTitle: 'number',
    defaultColumns: [
      'number',
      'customer',
      'issuedAt',
      'totalMinor',
      'currency',
      'status',
    ],
    group: 'Billing',
  },
  access: {
    create: isAdmin,
    read: isAdmin,
    // Permitted only so `status` can move to CREDITED; the hook freezes the rest.
    update: isAdmin,
    // Never. An issued invoice is a tax document.
    delete: denyAll,
    admin: canAccessAdminPanel,
  },
  indexes: [
    // Gap checking and per-year reporting both scan this.
    { fields: ['numberYear', 'numberSequence'], unique: true },
    { fields: ['customer', 'issuedAt'], unique: false },
    // Drives the cross-border revenue aggregation.
    { fields: ['billingCountry', 'issuedAt'], unique: false },
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
          'Human-readable, strictly sequential per year (e.g. FA2026-000001). Allocated only after payment is confirmed.',
      },
    },
    {
      name: 'numberYear',
      type: 'number',
      required: true,
      admin: { description: 'Year component of `number`, for gap queries.' },
      validate: (value: unknown) =>
        Number.isInteger(value) ? true : 'numberYear must be an integer.',
    },
    {
      name: 'numberSequence',
      type: 'number',
      required: true,
      admin: {
        description: 'Sequence component of `number`, for gap queries.',
      },
      validate: (value: unknown) =>
        Number.isInteger(value) && (value as number) >= 1
          ? true
          : 'numberSequence must be an integer >= 1.',
    },
    {
      name: 'customer',
      type: 'relationship',
      relationTo: 'customers',
      required: true,
      hasMany: false,
      index: true,
    },
    {
      name: 'subscription',
      type: 'relationship',
      relationTo: 'subscriptions',
      // Nullable: a one-off charge (a single analysis, a manual correction)
      // has no subscription behind it. Every caller must handle null rather
      // than assert it away — an invoice with no subscription is a valid
      // document, not a broken one.
      required: false,
      hasMany: false,
      admin: {
        description:
          'The subscription being billed, when there is one. Null for a one-off charge.',
      },
    },
    {
      name: 'issuedAt',
      type: 'date',
      required: true,
      index: true,
      admin: { description: 'Date of issue (datum vystavení).' },
    },
    {
      name: 'taxableSupplyDate',
      type: 'date',
      required: true,
      admin: {
        description:
          'Date of taxable supply (datum uskutečnění plnění). Separate from issuedAt because the two legitimately differ and the tax period follows this one.',
      },
    },
    {
      name: 'currency',
      type: 'select',
      options: toOptions(CURRENCIES),
      required: true,
    },
    {
      name: 'subtotalMinor',
      type: 'number',
      required: true,
      admin: { description: 'Net amount in minor units. Integer only.' },
      validate: (value: unknown) =>
        isValidMinorAmount(value)
          ? true
          : 'subtotalMinor must be a non-negative integer number of minor units.',
    },
    {
      name: 'taxMinor',
      type: 'number',
      required: true,
      defaultValue: 0,
      admin: {
        description:
          'Tax amount in minor units. Always 0 while the operator is not VAT registered.',
      },
      validate: (value: unknown) =>
        isValidMinorAmount(value)
          ? true
          : 'taxMinor must be a non-negative integer number of minor units.',
    },
    {
      name: 'totalMinor',
      type: 'number',
      required: true,
      admin: {
        description: 'subtotalMinor + taxMinor, in minor units. Integer only.',
      },
      validate: (value: unknown) =>
        isValidMinorAmount(value)
          ? true
          : 'totalMinor must be a non-negative integer number of minor units.',
    },
    {
      name: 'taxTreatment',
      type: 'select',
      options: toOptions(TAX_TREATMENTS),
      required: true,
      defaultValue: 'NONE_NOT_VAT_REGISTERED',
      admin: {
        description:
          'Frozen at issue. The other members exist so registering for VAT later needs no enum migration.',
      },
    },
    {
      name: 'taxRateBasisPoints',
      type: 'number',
      required: true,
      defaultValue: 0,
      admin: {
        description:
          'Tax rate in BASIS POINTS, frozen at issue. 0 = 0%, 2100 = 21%, 1250 = 12.5%. ' +
          'Basis points rather than whole percent so a fractional rate is representable without a decimal column.',
      },
      validate: (value: unknown) =>
        Number.isInteger(value) &&
        (value as number) >= 0 &&
        (value as number) <= 10_000
          ? true
          : 'taxRateBasisPoints must be an integer between 0 and 10000 (0% to 100%).',
    },
    {
      name: 'pdfStorageKey',
      type: 'text',
      admin: {
        description:
          'Object key of the rendered PDF in R2. Null until the PDF exists.',
      },
    },
    {
      name: 'providerPaymentId',
      type: 'text',
      // UNIQUE, and that is what makes issuing idempotent.
      //
      // One confirmed payment is one invoice. The application checks for an
      // existing invoice first, but two concurrent webhook deliveries can both
      // pass that check; this index is what actually stops the second one.
      // Two invoices for one payment means two sequence numbers burnt, two
      // documents sent and a VAT return that double-counts revenue.
      unique: true,
      admin: {
        description:
          'The provider charge or payment-intent id that settled this invoice. Unique: one payment, one invoice. Also the only way a later refund or chargeback can be traced back to the document it reverses — a dispute webhook names a charge, not an invoice.',
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
      name: 'status',
      type: 'select',
      options: toOptions(INVOICE_STATUSES),
      required: true,
      defaultValue: 'ISSUED',
      index: true,
      admin: {
        description:
          'The only mutable field. CREDITED means a credit note corrects this invoice in full.',
      },
    },

    /* ---------------- Tax location evidence (task 6) ------------------- */
    {
      name: 'billingCountry',
      type: 'text',
      maxLength: 2,
      index: true,
      admin: {
        description:
          'Signal 1 of 3: the country the customer declared, as at payment time. Never recalculated.',
      },
    },
    {
      name: 'ipCountry',
      type: 'text',
      maxLength: 2,
      admin: {
        description:
          'Signal 2 of 3: country inferred from the payer IP at payment time. Nullable.',
      },
    },
    {
      name: 'cardCountry',
      type: 'text',
      maxLength: 2,
      admin: {
        description:
          'Signal 3 of 3: issuing country of the payment instrument. Nullable.',
      },
    },

    /* ---------------- Identity snapshots ------------------------------- */
    {
      name: 'serviceSnapshot',
      type: 'group',
      admin: {
        description:
          'What was sold, as it read at the moment of sale. Copied, not joined — a plan renamed or repriced later must not change a document already sent.',
      },
      fields: [
        {
          name: 'planName',
          type: 'text',
          required: true,
          admin: { description: 'Plan name at the moment of sale.' },
        },
        {
          name: 'description',
          type: 'text',
          required: true,
          admin: {
            description:
              'The supplied service in plain Czech, as printed on the document.',
          },
        },
        {
          name: 'periodStart',
          type: 'date',
          required: true,
          admin: {
            description: 'First day of the period this invoice covers.',
          },
        },
        {
          name: 'periodEnd',
          type: 'date',
          required: true,
          admin: { description: 'Last day of the period this invoice covers.' },
        },
      ],
    },
    {
      name: 'paymentSnapshot',
      type: 'group',
      admin: {
        description:
          'How it was paid. An invoice exists here only because a payment was confirmed, so the document can state that it is already settled.',
      },
      fields: [
        {
          name: 'method',
          type: 'text',
          required: true,
          admin: { description: 'Our vocabulary: CARD or OTHER.' },
        },
        {
          name: 'paidAt',
          type: 'date',
          required: true,
          admin: {
            description:
              'When the provider says the money arrived — not when we found out.',
          },
        },
        {
          name: 'cardBrand',
          type: 'text',
          admin: { description: 'e.g. visa. Null for a non-card payment.' },
        },
        {
          name: 'cardLast4',
          type: 'text',
          maxLength: 4,
          admin: {
            description:
              'LAST FOUR DIGITS ONLY. There is deliberately nowhere here to put a card number.',
          },
        },
      ],
    },
    {
      name: 'operatorSnapshot',
      type: 'group',
      admin: {
        description:
          "The operator's identity as printed on this invoice. Copied, not joined.",
      },
      fields: [
        { name: 'legalName', type: 'text', required: true },
        { name: 'address', type: 'textarea', required: true },
        {
          name: 'businessId',
          type: 'text',
          required: true,
          admin: { description: 'IČO.' },
        },
        {
          name: 'taxId',
          type: 'text',
          admin: {
            description: 'DIČ. Null while the operator is not VAT registered.',
          },
        },
        {
          name: 'vatRegistered',
          type: 'checkbox',
          required: true,
          defaultValue: false,
          admin: {
            description:
              'Whether the operator was VAT registered when this invoice was issued.',
          },
        },
        { name: 'email', type: 'text' },
      ],
    },
    {
      name: 'customerSnapshot',
      type: 'group',
      admin: {
        description:
          "The customer's identity as printed on this invoice. Copied, not joined — a later address change must not alter an issued document.",
      },
      fields: [
        { name: 'name', type: 'text', required: true },
        { name: 'email', type: 'text', required: true },
        { name: 'address', type: 'textarea' },
        {
          name: 'country',
          type: 'text',
          required: true,
          maxLength: 2,
          admin: { description: 'ISO 3166-1 alpha-2 at issue time.' },
        },
        { name: 'businessId', type: 'text' },
        { name: 'taxId', type: 'text' },
      ],
    },
  ],
  hooks: {
    // The immutability lock runs FIRST, so an attempt to edit a frozen field
    // is reported as immutability rather than as whichever content rule the
    // new values happened to break.
    beforeValidate: [
      lockFieldsAfterCreate('An issued invoice', [
        'status',
        // The artefact and its delivery are not knowable at creation: the PDF
        // needs the allocated number, and the email needs the PDF. Which
        // fields may move is decided here; how often is decided by
        // `lockOnceSet` below.
        'pdfStorageKey',
        'deliveryState',
        'deliveredAt',
        'deliveryAttempts',
        'deliveryError',
      ]),
      // Written once, never rewritten. A second PDF under the same number
      // would mean two files could both claim to be this invoice.
      lockOnceSet('An issued invoice', ['pdfStorageKey', 'deliveredAt']),
      enforceTotals,
      enforceTaxTreatmentConsistency,
    ],
    beforeDelete: [blockDeletes('An issued invoice')],
  },
  labels: { singular: 'Invoice', plural: 'Invoices' },
  timestamps: true,
}
