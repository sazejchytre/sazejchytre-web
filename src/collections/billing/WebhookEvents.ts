import type { CollectionConfig } from 'payload'

import { canAccessAdminPanel, isAdmin } from '@/lib/access'
import { BILLING_PROVIDERS, toOptions } from '@/lib/billing/constants'

/**
 * Inbox for provider webhooks, and the basis of idempotency.
 *
 * Payment providers guarantee at-least-once delivery, which means duplicates
 * are normal, not exceptional. Processing one twice would double-count a
 * payment, issue two invoices, or extend a period twice. The defence is a
 * UNIQUE index on (provider, externalEventId) plus an atomic claim — see
 * `src/lib/billing/webhook-events.ts`.
 *
 * The unique index is the guarantee. Checking "have we seen this id" with a
 * SELECT before inserting is the classic version of this bug: two concurrent
 * deliveries both read "no" and both proceed. Only the database can arbitrate,
 * so the claim is written as a single conditional INSERT.
 *
 * THE KEY IS (provider, externalEventId), not `externalEventId` alone.
 * An event id is only unique within the provider that issued it. Keying on the
 * id by itself would mean a second provider whose id space overlaps Stripe's
 * could produce a false duplicate — one provider's event would silently
 * suppress another's, and the symptom would be a payment that never got
 * processed rather than an error. Widening the key costs nothing and removes
 * that class of bug before a second provider exists.
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
  indexes: [
    // THE idempotency key. An event id is unique per provider, so the pair is
    // the correct grain. This index is what `claimWebhookEvent` conflicts on.
    { fields: ['provider', 'externalEventId'], unique: true },
    { fields: ['provider', 'type'], unique: false },
  ],
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
      // Not unique on its own: uniqueness is (provider, externalEventId), see
      // `indexes` above. A single-column unique index here would be wrong as
      // soon as a second provider exists.
      index: true,
      admin: {
        description:
          "The provider's event id. Unique together with `provider` — that pair is what makes processing idempotent.",
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
