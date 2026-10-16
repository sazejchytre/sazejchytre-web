import type { CollectionConfig } from 'payload'

import { canAccessAdminPanel, denyAll, isAdmin } from '@/lib/access'
import { blockDeletes, lockFieldsAfterCreate } from '@/lib/billing/append-only'
import {
  BILLING_PROVIDERS,
  CURRENCIES,
  DISPUTE_STATUSES,
  toOptions,
} from '@/lib/billing/constants'

/**
 * Chargebacks.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A COLLECTION AND NOT A DASHBOARD TAB
 *
 * A dispute could be left in Stripe's dashboard: Stripe emails about it,
 * shows it, and manages the evidence deadline. That is exactly the problem.
 * A chargeback is the one billing event where somebody has to act inside a
 * fixed window or the money is gone by default, and the person who has to act
 * is whoever is looking at our admin panel — not whoever happens to have
 * Stripe dashboard access and to have read that email.
 *
 * It also has to be here because a dispute changes what a customer may see,
 * and that decision is ours to make from our own database. The subscription
 * stays perfectly ACTIVE throughout a dispute — the dispute is a fact about a
 * charge, not about the subscription — so nothing in the subscription record
 * would stop us serving paid content to somebody who has already reversed the
 * payment. An open row here does, via `EntitlementSuspensionSnapshot`.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT IS IMMUTABLE AND WHAT IS NOT
 *
 * Unlike an invoice, a dispute legitimately changes: it opens, evidence goes
 * in, an issuer decides. So `status`, `resolvedAt` and `notes` stay editable,
 * while everything that identifies the dispute and the money at stake is
 * frozen at creation. A dispute whose amount or charge could be edited
 * afterwards would be useless as a record of what was clawed back.
 */
export const Disputes: CollectionConfig = {
  slug: 'disputes',
  admin: {
    useAsTitle: 'providerDisputeId',
    defaultColumns: [
      'status',
      'customer',
      'amountMinor',
      'currency',
      'reason',
      'evidenceDueAt',
      'openedAt',
    ],
    group: 'Billing',
    description:
      'Chargebacks. An OPEN or UNDER_REVIEW dispute suspends the customer’s access immediately.',
  },
  access: {
    // Created by the webhook handler, which runs with overrideAccess.
    create: isAdmin,
    read: isAdmin,
    // Resolution is recorded by hand or by webhook; the frozen fields below
    // are what stops an update from rewriting the facts.
    update: isAdmin,
    delete: denyAll,
    admin: canAccessAdminPanel,
  },
  indexes: [
    // One row per provider dispute. The webhook handler relies on this to
    // recognise a replay it has already recorded.
    { fields: ['provider', 'providerDisputeId'], unique: true },
    { fields: ['customer', 'status'], unique: false },
  ],
  fields: [
    {
      name: 'customer',
      type: 'relationship',
      relationTo: 'customers',
      required: true,
      hasMany: false,
      index: true,
      admin: {
        description:
          'Whose access this suspends. Required: a dispute we cannot attribute is one we cannot act on.',
      },
    },
    {
      name: 'subscription',
      type: 'relationship',
      relationTo: 'subscriptions',
      hasMany: false,
      index: true,
      admin: {
        description:
          'The subscription the disputed charge belongs to, when it can be identified.',
      },
    },
    {
      name: 'invoice',
      type: 'relationship',
      relationTo: 'invoices',
      hasMany: false,
      admin: {
        description:
          'The invoice the disputed charge paid, when it can be identified. Never modified by the dispute.',
      },
    },
    {
      name: 'status',
      type: 'select',
      options: toOptions(DISPUTE_STATUSES),
      required: true,
      defaultValue: 'OPEN',
      index: true,
      admin: {
        description:
          'OPEN and UNDER_REVIEW suspend access. WON restores it; LOST leaves it withdrawn.',
      },
    },
    {
      name: 'reason',
      type: 'text',
      required: true,
      admin: {
        description:
          "The issuer's stated reason, as the provider reported it. Kept verbatim because it decides what evidence is worth submitting.",
      },
    },
    {
      name: 'amountMinor',
      type: 'number',
      required: true,
      admin: {
        description:
          'Amount under dispute, in minor units of `currency`. Integer — see src/lib/billing/schema.ts.',
      },
    },
    {
      name: 'currency',
      type: 'select',
      options: toOptions(CURRENCIES),
      required: true,
      admin: {
        description:
          'Carried on the row, like every other monetary record here. No implicit currency.',
      },
    },
    {
      name: 'openedAt',
      type: 'date',
      required: true,
      index: true,
      admin: {
        description:
          'When the issuer opened the dispute, as reported by the provider — not when we stored it.',
      },
    },
    {
      name: 'evidenceDueAt',
      type: 'date',
      admin: {
        description:
          'The provider’s deadline for submitting evidence. Past this, the dispute is lost by default.',
      },
    },
    {
      name: 'resolvedAt',
      type: 'date',
      admin: {
        description:
          'When the dispute closed. Access is restored from this instant if the outcome was WON.',
      },
    },
    {
      name: 'provider',
      type: 'select',
      options: toOptions(BILLING_PROVIDERS),
      required: true,
    },
    {
      name: 'providerDisputeId',
      type: 'text',
      required: true,
      admin: {
        description:
          'The provider’s dispute id. Unique per provider — see the compound index.',
      },
    },
    {
      name: 'providerChargeId',
      type: 'text',
      required: true,
      admin: {
        description:
          'The charge being clawed back. The link back to the payment and, through it, to the invoice.',
      },
    },
    {
      name: 'notes',
      type: 'textarea',
      admin: {
        description:
          'What we submitted and why. Free text, editable — this is the working record, not the audit trail.',
      },
    },
  ],
  hooks: {
    // Everything identifying the dispute and the money is frozen; status,
    // resolvedAt and notes are deliberately left mutable.
    beforeValidate: [
      lockFieldsAfterCreate('A dispute', [
        'status',
        'resolvedAt',
        'notes',
        'evidenceDueAt',
        'subscription',
        'invoice',
        'updatedAt',
      ]),
    ],
    beforeDelete: [blockDeletes('A dispute')],
  },
  labels: { singular: 'Dispute', plural: 'Disputes' },
  timestamps: true,
}
