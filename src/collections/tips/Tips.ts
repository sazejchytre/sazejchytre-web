import type { CollectionConfig } from 'payload'
import { APIError } from 'payload'

import { canAccessAdminPanel, isAdmin } from '@/lib/access'
import {
  FEATURE_KEYS,
  toOptions as billingOptions,
} from '@/lib/billing/constants'
import {
  MAX_CONFIDENCE,
  MAX_STAKE_UNITS,
  MIN_CONFIDENCE,
  MIN_STAKE_UNITS,
  TIP_STATUSES,
  toOptions,
} from '@/lib/tips/constants'
import {
  blockPublishedTipDeletion,
  enforceTipStatusTransition,
  lockPublishedTip,
  stampPublication,
} from '@/lib/tips/immutability'

/**
 * A published recommendation. The unit of the product and of the record.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * IMMUTABLE AFTER PUBLICATION
 *
 * The moment this moves to PUBLISHED, everything about the claim freezes —
 * the stake, the reasoning, the publication time, the entitlement it sits
 * behind, and (in the selections) the picks and the prices. Only `status` and
 * `settledAt` may still move.
 *
 * Enforced in two places: the hooks on this collection, and database triggers
 * from the `tip_immutability_triggers` migration. The triggers are the
 * guarantee, because the threat worth defending against is our own code
 * running with `overrideAccess: true` — see `src/lib/tips/immutability.ts`.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT IS NOT STORED HERE
 *
 * No profit, no ROI, no derived result. Those are computed by
 * `src/lib/tips/settlement.ts` from the selections, every time they are asked
 * for. Storing them would be faster and would introduce the one failure this
 * model cannot tolerate: a cached figure that disagrees with the rows it was
 * derived from. A track record with two answers has none.
 */
export const Tips: CollectionConfig = {
  slug: 'tips',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'sport', 'status', 'stakeUnits', 'publishedAt'],
    group: 'Tipy',
    description:
      'Po publikaci je tip neměnný. Opravy se řeší publikací nového tipu.',
  },
  access: {
    create: isAdmin,
    read: isAdmin,
    // Permitted so a tip can be published and settled; the hooks and the
    // triggers decide which fields an update may actually touch.
    update: isAdmin,
    // Permitted only for drafts — `blockPublishedTipDeletion` refuses the rest.
    delete: isAdmin,
    admin: canAccessAdminPanel,
  },
  defaultSort: '-publishedAt',
  indexes: [
    { fields: ['status', 'publishedAt'], unique: false },
    { fields: ['sport', 'status'], unique: false },
  ],
  fields: [
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: {
        description:
          'URL identifier. Frozen at publication — a changed slug breaks every link and citation to the tip.',
      },
    },
    {
      name: 'sport',
      type: 'relationship',
      relationTo: 'sports',
      required: true,
      hasMany: false,
      index: true,
    },
    {
      name: 'title',
      type: 'text',
      required: true,
      admin: { description: 'Czech headline shown in listings.' },
    },
    {
      name: 'status',
      type: 'select',
      options: toOptions(TIP_STATUSES),
      required: true,
      defaultValue: 'DRAFT',
      index: true,
      admin: {
        description:
          'DRAFT → PUBLISHED → SETTLED or VOIDED. SETTLED and VOIDED are final.',
      },
    },
    {
      name: 'publishedAt',
      type: 'date',
      index: true,
      admin: {
        description:
          'Stamped by the server at publication, never accepted from the caller — "we said this before kick-off" is only a claim if we control the clock.',
        readOnly: true,
      },
    },
    {
      name: 'publicAt',
      type: 'date',
      admin: {
        description:
          'When the free tier may see it. Defaults to publishedAt + 24 h.',
      },
    },
    {
      name: 'requiredFeatureKey',
      type: 'select',
      options: billingOptions(FEATURE_KEYS),
      required: true,
      defaultValue: 'TIPS_REALTIME',
      admin: {
        description:
          'The entitlement that unlocks this tip immediately. Everyone else sees it from publicAt.',
      },
    },
    {
      name: 'stakeUnits',
      type: 'number',
      required: true,
      defaultValue: 1,
      admin: {
        description: `Recommended stake in whole units, ${MIN_STAKE_UNITS}–${MAX_STAKE_UNITS}. A factor in every profit figure, so it is frozen at publication.`,
      },
      validate: (value: unknown) =>
        Number.isInteger(value) &&
        (value as number) >= MIN_STAKE_UNITS &&
        (value as number) <= MAX_STAKE_UNITS
          ? true
          : `stakeUnits must be an integer between ${MIN_STAKE_UNITS} and ${MAX_STAKE_UNITS}.`,
    },
    {
      name: 'confidence',
      type: 'number',
      admin: {
        description: `Analyst or model confidence, ${MIN_CONFIDENCE}–${MAX_CONFIDENCE}. Presentational — never an input to profit.`,
      },
      validate: (value: unknown) =>
        value === null ||
        value === undefined ||
        (Number.isInteger(value) &&
          (value as number) >= MIN_CONFIDENCE &&
          (value as number) <= MAX_CONFIDENCE)
          ? true
          : `confidence must be an integer between ${MIN_CONFIDENCE} and ${MAX_CONFIDENCE}.`,
    },
    {
      name: 'rationale',
      type: 'richText',
      admin: {
        description:
          'The reasoning. Frozen at publication: a rationale rewritten after the result is known is the clearest possible way to destroy the record.',
      },
    },
    {
      name: 'sourcesSummary',
      type: 'json',
      admin: {
        description:
          'Where the signal came from, for the "why trust this" section. e.g. [{ "kind": "MODEL", "detail": "xG v4, 61 %" }].',
      },
    },
    {
      name: 'settledAt',
      type: 'date',
      index: true,
      admin: {
        description:
          'Stamped when the last selection gets an outcome. One of the two fields that may change after publication.',
        readOnly: true,
      },
    },
    {
      name: 'ingestionExternalId',
      type: 'text',
      unique: true,
      index: true,
      admin: {
        description:
          "The partner application's own id, when the tip arrived that way. The idempotency key — see docs/tip-ingestion-contract.md.",
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
  hooks: {
    beforeValidate: [
      // Immutability FIRST, so a frozen field is reported as immutability
      // rather than as whichever content rule the new value broke.
      lockPublishedTip,
      enforceTipStatusTransition,
      ({ data, originalDoc }) => {
        // A tip cannot be published without something to publish. Checked here
        // rather than in the database because it spans two tables.
        const becomingPublished =
          (data as { status?: string } | undefined)?.status === 'PUBLISHED' &&
          originalDoc?.status === 'DRAFT'

        if (becomingPublished && !originalDoc?.id) {
          throw new APIError('Tip bez identifikátoru nelze publikovat.', 400)
        }

        return data
      },
    ],
    beforeChange: [stampPublication],
    beforeDelete: [blockPublishedTipDeletion],
  },
  labels: { singular: 'Tip', plural: 'Tipy' },
  timestamps: true,
}
