import type { CollectionConfig } from 'payload'

import { canAccessAdminPanel, isAdmin } from '@/lib/access'
import { BILLING_PROVIDERS, toOptions } from '@/lib/billing/constants'

/**
 * Inbox for provider webhooks, and the basis of idempotency.
 *
 * Payment providers guarantee at-least-once delivery, which means duplicates
 * are normal, not exceptional. Processing one twice would double-count a
 * payment, issue two invoices, or extend a period twice. The defence is a
 * UNIQUE index on `externalEventId` plus an atomic claim — see
 * `src/lib/billing/webhook-events.ts`.
 *
 * The unique index is the guarantee. Checking "have we seen this id" with a
 * SELECT before inserting is the classic version of this bug: two concurrent
 * deliveries both read "no" and both proceed. Only the database can arbitrate,
 * so the claim is written as a single conditional INSERT.
 *
 * NOTE ON THE KEY: the brief specifies `externalEventId` unique on its own,
 * and that is what is implemented. It is stricter than (provider,
 * externalEventId) and so is safe today; if a second provider is ever added
 * whose id space could collide with Stripe's `evt_…`, this becomes a
 * cross-provider false duplicate and the index should widen to the pair.
 * Flagged rather than pre-solved.
 *
 * No handler logic lives here. Step 4 adds handlers; this step only makes
 * processing-exactly-once possible.
 */
export const WebhookEvents: CollectionConfig = {
  slug: 'webhook-events',
  admin: {
    useAsTitle: 'externalEventId',
    defaultColumns: [
      'provider',
      'type',
      'externalEventId',
      'receivedAt',
      'processedAt',
    ],
    group: 'Billing',
  },
  access: {
    create: isAdmin,
    read: isAdmin,
    // Updatable: claiming an event and recording its outcome are updates.
    update: isAdmin,
    // Deletable by an admin so a poisoned event can be cleared deliberately.
    // Note this is the one inbox-shaped collection where retention, not
    // immutability, is the concern.
    delete: isAdmin,
    admin: canAccessAdminPanel,
  },
  indexes: [{ fields: ['provider', 'type'], unique: false }],
  fields: [
    {
      name: 'provider',
      type: 'select',
      options: toOptions(BILLING_PROVIDERS),
      required: true,
    },
    {
      name: 'externalEventId',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: {
        description:
          "The provider's event id. UNIQUE — this is what makes processing idempotent.",
      },
    },
    {
      name: 'type',
      type: 'text',
      required: true,
      admin: {
        description:
          'Provider event type, free text rather than an enum: providers add event types without warning and an unknown one must still be storable.',
      },
    },
    {
      name: 'receivedAt',
      type: 'date',
      required: true,
      index: true,
    },
    {
      name: 'processedAt',
      type: 'date',
      admin: {
        description:
          'Null while unprocessed or in flight. Set once handling succeeded.',
      },
    },
    {
      name: 'processingError',
      type: 'textarea',
      admin: {
        description:
          'Last failure, if any. A row with an error and no processedAt is what a retry sweep looks for.',
      },
    },
    {
      name: 'rawPayload',
      type: 'json',
      required: true,
      admin: {
        description:
          'The event exactly as received. Kept so a handler bug can be replayed against the original after it is fixed.',
      },
    },
  ],
  labels: { singular: 'Webhook event', plural: 'Webhook events' },
  timestamps: true,
}
