import type {
  CollectionAfterChangeHook,
  CollectionBeforeValidateHook,
  CollectionConfig,
} from 'payload'
import { APIError } from 'payload'

import { canAccessAdminPanel, isAdmin } from '@/lib/access'
import {
  KNOWN_MARKETS,
  MAX_ODDS,
  MIN_ODDS,
  ODDS_SCALE,
  SELECTION_OUTCOMES,
  toOptions,
} from '@/lib/tips/constants'
import {
  blockSelectionAddedToPublishedTip,
  blockSelectionRemovedFromPublishedTip,
  lockPublishedSelection,
} from '@/lib/tips/immutability'
import { isFullySettled } from '@/lib/tips/settlement'

/**
 * One leg of a tip. A tip with a single selection is a single; with several it
 * is an accumulator, priced as the product of its legs.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A COLLECTION AND NOT AN ARRAY FIELD ON THE TIP
 *
 * Payload would happily model these as a repeating field, and that would be
 * less code. It would also put every leg in a child table Payload rewrites
 * wholesale on each save — deleting and re-inserting rows — which makes
 * "this leg's price was never changed" impossible to enforce with a trigger
 * and impossible to prove afterwards. A real table with real rows and real
 * primary keys is what lets the database refuse the edit.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ONE LEG DOES NOT SETTLE THE TIP
 *
 * Recording an outcome here settles THIS leg. The tip settles only when every
 * leg has one, which `maybeSettleParentTip` below checks after each write. A
 * three-leg accumulator with two results is still PENDING, and its profit is
 * not yet a number.
 */

const oddsValidator =
  (label: string) =>
  (value: unknown): true | string => {
    if (value === null || value === undefined) {
      return label === 'closingOdds'
        ? true
        : `${label} is required, as an integer in thousandths.`
    }

    if (!Number.isInteger(value)) {
      return `${label} must be an integer in thousandths — 2.100 is 2100, never 2.1.`
    }

    const odds = value as number

    if (odds < MIN_ODDS || odds > MAX_ODDS) {
      return `${label} must be between ${MIN_ODDS} and ${MAX_ODDS} thousandths.`
    }

    return true
  }

/** The minimum price must be takeable at the published price. */
const enforceMinimumOdds: CollectionBeforeValidateHook = ({
  data,
  operation,
  originalDoc,
}) => {
  if (operation !== 'create' && operation !== 'update') {
    return data
  }

  const merged = { ...originalDoc, ...data } as Record<string, unknown>
  const published = merged.oddsAtPublication
  const minimum = merged.minimumOdds

  if (typeof published !== 'number' || typeof minimum !== 'number') {
    return data
  }

  if (minimum > published) {
    throw new APIError(
      `minimumOdds (${minimum}) nemůže být vyšší než oddsAtPublication (${published}). ` +
        'Jinak by tip nebyl za publikovaný kurz vůbec hratelný.',
      400,
    )
  }

  return data
}

/**
 * Settle the parent tip once every leg has an outcome.
 *
 * In `afterChange`, so the leg is already committed: a tip must never be
 * marked SETTLED on the strength of a write that then failed.
 *
 * Writes the audit trail for both the leg and, when it happens, the tip.
 */
const maybeSettleParentTip: CollectionAfterChangeHook = async ({
  doc,
  operation,
  previousDoc,
  req,
}) => {
  if (operation !== 'create' && operation !== 'update') {
    return doc
  }

  // A relationship arrives either as an id or as a populated document.
  // Payload's ids are `serial`, so the numeric form is what writes need;
  // `findByID` takes the string form.
  const rawTip =
    typeof doc.tip === 'object' && doc.tip !== null
      ? (doc.tip as { id: unknown }).id
      : doc.tip

  const tipId = Number(rawTip)

  if (!Number.isInteger(tipId)) {
    return doc
  }

  const outcomeChanged = previousDoc?.outcome !== doc.outcome

  if (outcomeChanged && doc.outcome !== 'PENDING') {
    await req.payload.create({
      collection: 'tip-audit-events',
      data: {
        tip: tipId,
        type: 'SELECTION_SETTLED' as const,
        occurredAt: new Date().toISOString(),
        actor: req.user ? String(req.user.email) : 'system',
        before: { selectionId: doc.id, outcome: previousDoc?.outcome ?? null },
        after: { selectionId: doc.id, outcome: doc.outcome },
      },
      overrideAccess: true,
      depth: 0,
      req,
    })
  }

  const tip = await req.payload.findByID({
    collection: 'tips',
    id: String(tipId),
    depth: 0,
    overrideAccess: true,
    req,
  })

  // Only a published tip can settle. A draft's outcomes are not a result yet.
  if (!tip || tip.status !== 'PUBLISHED') {
    return doc
  }

  const siblings = await req.payload.find({
    collection: 'tip-selections',
    where: { tip: { equals: tipId } },
    limit: 0,
    pagination: false,
    depth: 0,
    overrideAccess: true,
    req,
  })

  const selections = siblings.docs.map((row) => ({
    outcome: row.outcome as (typeof SELECTION_OUTCOMES)[number],
    oddsAtPublication: row.oddsAtPublication as number,
  }))

  if (!isFullySettled(selections)) {
    return doc
  }

  const settledAt = new Date().toISOString()

  await req.payload.update({
    collection: 'tips',
    id: String(tipId),
    data: { status: 'SETTLED', settledAt },
    overrideAccess: true,
    depth: 0,
    req,
  })

  await req.payload.create({
    collection: 'tip-audit-events',
    data: {
      tip: tipId,
      type: 'SETTLED',
      occurredAt: settledAt,
      actor: req.user ? String(req.user.email) : 'system',
      before: { status: 'PUBLISHED' },
      after: {
        status: 'SETTLED',
        settledAt,
        outcomes: selections.map((s) => s.outcome),
      },
    },
    overrideAccess: true,
    depth: 0,
    req,
  })

  return doc
}

export const TipSelections: CollectionConfig = {
  slug: 'tip-selections',
  admin: {
    useAsTitle: 'selection',
    defaultColumns: [
      'tip',
      'market',
      'selection',
      'oddsAtPublication',
      'outcome',
    ],
    group: 'Tipy',
    description: 'Po publikaci tipu lze měnit jen výsledek a zavírací kurz.',
  },
  access: {
    create: isAdmin,
    read: isAdmin,
    update: isAdmin,
    delete: isAdmin,
    admin: canAccessAdminPanel,
  },
  indexes: [
    { fields: ['tip', 'outcome'], unique: false },
    { fields: ['sportingEvent'], unique: false },
  ],
  fields: [
    {
      name: 'tip',
      type: 'relationship',
      relationTo: 'tips',
      required: true,
      hasMany: false,
      index: true,
    },
    {
      name: 'sportingEvent',
      type: 'relationship',
      relationTo: 'sporting-events',
      required: true,
      hasMany: false,
      index: true,
    },
    {
      name: 'market',
      type: 'text',
      required: true,
      admin: {
        description: `Free text, not an enum — new markets appear constantly and an enum would make each one a migration. Known today: ${KNOWN_MARKETS.join(', ')}.`,
      },
    },
    {
      name: 'selection',
      type: 'text',
      required: true,
      admin: { description: 'The actual pick, e.g. HOME, OVER, AWAY_-1.5.' },
    },
    {
      name: 'line',
      type: 'number',
      admin: {
        description:
          'Handicap or total in HUNDREDTHS: −0.75 is −75, 2.5 is 250. Null for markets with no line.',
      },
      validate: (value: unknown) =>
        value === null || value === undefined || Number.isInteger(value)
          ? true
          : 'line must be an integer in hundredths — 2.5 is 250, never 2.5.',
    },
    {
      name: 'oddsAtPublication',
      type: 'number',
      required: true,
      admin: {
        description: `Decimal odds in THOUSANDTHS at publication: 2.100 is 2100. Scale ${ODDS_SCALE}. Frozen once the tip is published.`,
      },
      validate: oddsValidator('oddsAtPublication'),
    },
    {
      name: 'minimumOdds',
      type: 'number',
      required: true,
      admin: {
        description:
          'The price below which the tip is not worth taking, in thousandths. Must be at or below oddsAtPublication.',
      },
      validate: oddsValidator('minimumOdds'),
    },
    {
      name: 'closingOdds',
      type: 'number',
      admin: {
        description:
          'Price at kick-off, in thousandths. Filled at settlement; drives closing line value. One of the two fields that may change after publication.',
      },
      validate: oddsValidator('closingOdds'),
    },
    {
      name: 'outcome',
      type: 'select',
      options: toOptions(SELECTION_OUTCOMES),
      required: true,
      defaultValue: 'PENDING',
      index: true,
      admin: {
        description:
          'HALF_WON and HALF_LOST are Asian-handicap quarter lines. A VOID leg drops out of an accumulator at 1.000; it does not void the tip.',
      },
    },
    {
      name: 'settledAt',
      type: 'date',
      admin: { description: 'When this leg got its outcome.' },
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
      // Immutability first, for the same reason as on the tip.
      lockPublishedSelection,
      blockSelectionAddedToPublishedTip,
      enforceMinimumOdds,
    ],
    afterChange: [maybeSettleParentTip],
    beforeDelete: [blockSelectionRemovedFromPublishedTip],
  },
  labels: { singular: 'Sázka', plural: 'Sázky' },
  timestamps: true,
}
