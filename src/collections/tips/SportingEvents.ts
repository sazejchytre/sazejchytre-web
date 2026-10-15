import type { CollectionBeforeValidateHook, CollectionConfig } from 'payload'
import { APIError } from 'payload'

import { canAccessAdminPanel, isAdmin } from '@/lib/access'
import { EVENT_STATUSES, toOptions } from '@/lib/tips/constants'

/**
 * A fixture: two sides, a kick-off time, and eventually a score.
 *
 * Populated by hand or by the partner application in this step. No provider
 * integration — that is step 7.
 *
 * WHY THE TEAM NAMES ARE PLAIN TEXT
 *
 * `homeName` and `awayName` rather than relations to a `teams` table. A team
 * table sounds tidier and would be the wrong trade here: it needs name
 * reconciliation across providers, aliases, renames and merges, and all of
 * that complexity would sit between a tip and the event it refers to. The
 * event is a label on a fixture, and a tip's correctness never depends on the
 * club's canonical identity. If a teams table is ever needed, it can be added
 * alongside and backfilled — the other way round is much harder.
 *
 * `finalScore` is JSON because scorelines are not one shape: 2–1 in football,
 * 6–4 7–5 in tennis, 3–2 after overtime in hockey. A pair of integer columns
 * would be wrong for two of those three.
 */

/** A finished event needs a score; an unfinished one must not claim to have one. */
const enforceScoreMatchesStatus: CollectionBeforeValidateHook = ({
  data,
  operation,
  originalDoc,
}) => {
  if (operation !== 'create' && operation !== 'update') {
    return data
  }

  const merged = { ...originalDoc, ...data } as Record<string, unknown>
  const status = merged.status
  const score = merged.finalScore

  const hasScore = score !== null && score !== undefined

  if (status === 'FINISHED' && !hasScore) {
    throw new APIError(
      'Dokončená událost musí mít výsledek (finalScore). Bez něj nelze vyhodnotit tipy.',
      400,
    )
  }

  if (hasScore && status !== 'FINISHED') {
    throw new APIError(
      `Událost se stavem ${String(status)} nemůže mít výsledek. ` +
        'Výsledek patří jen k dokončené události.',
      400,
    )
  }

  return data
}

export const SportingEvents: CollectionConfig = {
  slug: 'sporting-events',
  admin: {
    useAsTitle: 'homeName',
    defaultColumns: ['homeName', 'awayName', 'startsAt', 'status'],
    group: 'Tipy',
  },
  access: {
    create: isAdmin,
    read: isAdmin,
    update: isAdmin,
    delete: isAdmin,
    admin: canAccessAdminPanel,
  },
  defaultSort: '-startsAt',
  indexes: [
    { fields: ['competition', 'startsAt'], unique: false },
    { fields: ['status', 'startsAt'], unique: false },
  ],
  fields: [
    {
      name: 'competition',
      type: 'relationship',
      relationTo: 'competitions',
      required: true,
      hasMany: false,
      index: true,
    },
    {
      name: 'homeName',
      type: 'text',
      required: true,
      admin: { description: 'Home side, as displayed.' },
    },
    {
      name: 'awayName',
      type: 'text',
      required: true,
      admin: { description: 'Away side, as displayed.' },
    },
    {
      name: 'startsAt',
      type: 'date',
      required: true,
      index: true,
      admin: {
        description:
          'Scheduled start. The deadline a tip is measured against: a tip published after kick-off is not a prediction.',
      },
    },
    {
      name: 'status',
      type: 'select',
      options: toOptions(EVENT_STATUSES),
      required: true,
      defaultValue: 'SCHEDULED',
      index: true,
    },
    {
      name: 'finalScore',
      type: 'json',
      admin: {
        description:
          'Shape depends on the sport, e.g. { "home": 2, "away": 1 } or { "sets": [[6,4],[7,5]] }. Null until FINISHED.',
      },
    },
    {
      name: 'externalRefs',
      type: 'json',
      admin: {
        description:
          'Provider id map. The partner application resolves tips against this — see docs/tip-ingestion-contract.md.',
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
    beforeValidate: [enforceScoreMatchesStatus],
  },
  labels: { singular: 'Událost', plural: 'Události' },
  timestamps: true,
}
