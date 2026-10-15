import type { CollectionBeforeValidateHook, CollectionConfig } from 'payload'
import { APIError } from 'payload'

import { canAccessAdminPanel, isAdmin } from '@/lib/access'
import {
  BILLING_INTERVALS,
  CURRENCIES,
  ENABLED_CURRENCIES,
  toOptions,
} from '@/lib/billing/constants'
import { CurrencyNotEnabledError } from '@/lib/billing/errors'
import { assertCurrencyEnabled, isValidMinorAmount } from '@/lib/billing/money'

/**
 * What a plan costs, in one currency, for one interval.
 *
 * THE INVARIANT: at most one *active* price per (plan, currency, interval).
 * Without it, checkout has to choose between two live prices for the same
 * thing, and whichever it picks is arbitrary.
 *
 * That invariant is enforced in TWO places, on purpose:
 *
 *  1. A partial unique index in Postgres —
 *     `UNIQUE (plan_id, currency, interval) WHERE active`.
 *     This is the real guarantee. It holds against concurrent writes, against
 *     a direct `psql` session, and against any future code path that forgets
 *     to go through Payload. It is declared in `payload.config.ts` via the
 *     adapter's `afterSchemaInit`, so it ships in the generated migration.
 *  2. The hook below, which does the same check through Payload.
 *     It exists only to turn constraint violation 23505 into a sentence a
 *     human can act on, and to fail before a partially-written document. It
 *     is NOT the guarantee — it races, as any read-then-write check does.
 *
 * Superseding a price is therefore: deactivate the old row, then insert the
 * new one. The old row is kept so that an invoice issued under it can still be
 * explained, which is also why prices are never deleted in normal operation.
 */

const enforceSingleActivePrice: CollectionBeforeValidateHook = async ({
  data,
  operation,
  originalDoc,
  req,
}) => {
  if (operation !== 'create' && operation !== 'update') {
    return data
  }

  const merged = { ...originalDoc, ...data }

  if (merged.active !== true) {
    return data
  }

  const planId =
    typeof merged.plan === 'object' && merged.plan !== null
      ? (merged.plan as { id: unknown }).id
      : merged.plan

  if (!planId || !merged.currency || !merged.interval) {
    // Required-field validation will report the real problem.
    return data
  }

  const clash = await req.payload.find({
    collection: 'prices',
    depth: 0,
    limit: 1,
    pagination: false,
    overrideAccess: true,
    req,
    where: {
      and: [
        { plan: { equals: planId } },
        { currency: { equals: merged.currency } },
        { interval: { equals: merged.interval } },
        { active: { equals: true } },
        ...(originalDoc?.id ? [{ id: { not_equals: originalDoc.id } }] : []),
      ],
    },
  })

  if (clash.docs.length > 0) {
    throw new APIError(
      `An active ${String(merged.currency)} / ${String(merged.interval)} price already exists for this plan ` +
        `(price ${String(clash.docs[0]?.id)}). Deactivate it before activating another, ` +
        'so checkout never has to choose between two live prices for the same thing.',
      409,
    )
  }

  return data
}

const enforceEnabledCurrency: CollectionBeforeValidateHook = ({
  data,
  operation,
  originalDoc,
}) => {
  if (operation !== 'create' && operation !== 'update') {
    return data
  }

  const currency = (data?.currency ?? originalDoc?.currency) as
    string | undefined

  if (currency === undefined) {
    return data
  }

  try {
    assertCurrencyEnabled(currency, ENABLED_CURRENCIES)
  } catch (error) {
    if (error instanceof CurrencyNotEnabledError) {
      throw new APIError(error.message, 400)
    }

    throw error
  }

  return data
}

export const Prices: CollectionConfig = {
  slug: 'prices',
  admin: {
    useAsTitle: 'id',
    defaultColumns: [
      'plan',
      'currency',
      'interval',
      'amountMinor',
      'active',
      'validFrom',
    ],
    group: 'Billing',
  },
  access: {
    create: isAdmin,
    read: isAdmin,
    update: isAdmin,
    delete: isAdmin,
    admin: canAccessAdminPanel,
  },
  fields: [
    {
      name: 'plan',
      type: 'relationship',
      relationTo: 'plans',
      required: true,
      hasMany: false,
      admin: { description: 'The tier this price sells.' },
    },
    {
      name: 'currency',
      type: 'select',
      // Every currency the schema knows is offered here so that enabling one
      // later needs no migration. `enforceEnabledCurrency` is what restricts
      // which may actually be written today.
      options: toOptions(CURRENCIES),
      required: true,
      admin: {
        description: `Currency of amountMinor. Writable today: ${ENABLED_CURRENCIES.join(', ')}.`,
      },
    },
    {
      name: 'interval',
      type: 'select',
      options: toOptions(BILLING_INTERVALS),
      required: true,
      admin: { description: 'Billing cadence this price is charged at.' },
    },
    {
      name: 'amountMinor',
      type: 'number',
      required: true,
      admin: {
        description:
          'Price in MINOR units of `currency` (haléře for CZK). Integer only — 349 CZK is 34900.',
      },
      validate: (value: unknown) =>
        isValidMinorAmount(value)
          ? true
          : 'amountMinor must be a non-negative integer number of minor units.',
    },
    {
      name: 'active',
      type: 'checkbox',
      required: true,
      defaultValue: true,
      admin: {
        description:
          'Only one active price per plan + currency + interval. Deactivate the old one first.',
      },
    },
    {
      name: 'validFrom',
      type: 'date',
      required: true,
      admin: {
        description:
          'When this price became the offered one. Kept for audit; it does not drive selection.',
      },
    },
    {
      name: 'providerPriceId',
      type: 'text',
      admin: {
        description:
          "The billing provider's price id, once created there. Null until then.",
      },
    },
  ],
  hooks: {
    beforeValidate: [enforceEnabledCurrency, enforceSingleActivePrice],
  },
  labels: { singular: 'Price', plural: 'Prices' },
  timestamps: true,
}
