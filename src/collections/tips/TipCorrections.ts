import type { CollectionBeforeValidateHook, CollectionConfig } from 'payload'
import { APIError } from 'payload'

import { canAccessAdminPanel, denyAll, isAdmin } from '@/lib/access'
import { blockDeletes, lockFieldsAfterCreate } from '@/lib/billing/append-only'
import {
  MAX_ODDS,
  MIN_ODDS,
  SELECTION_OUTCOMES,
  toOptions,
} from '@/lib/tips/constants'

/**
 * A correction to the recorded result of one selection of a published tip.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE ONLY WAY A RECORDED RESULT CHANGES
 *
 * Once a published selection has an outcome or a closing price, the database
 * refuses to overwrite it with an ordinary update. A wrong result is real,
 * though: an operator can mistype it, or a fixture can be re-scored. So the
 * fix is modelled as a NEW document rather than an edit: who made it, why,
 * the value before and the value after.
 *
 * Inserting the document IS the correction. A trigger on this table:
 *
 *   - locks the selection and its tip, and copies the CURRENT values into
 *     `previousOutcome` and `previousClosingOdds` (whatever the caller sent
 *     is overwritten, so the previous value is always the true one);
 *   - stamps `recordedAt`, `databaseRole` and `transactionId` from the
 *     database itself;
 *   - then applies the new values to the selection in the same statement.
 *
 * So the correction and its record cannot exist without each other: if the
 * change fails, the insert fails, and if the transaction rolls back, both are
 * gone. The selection trigger accepts a rewritten result only when it matches
 * the latest correction recorded for that selection in the same transaction.
 *
 * Append-only, twice over, like `tip-audit-events`: access control denies
 * update and delete, the hooks refuse them for `overrideAccess: true`, and
 * database triggers refuse them for everything else.
 *
 * WHAT A CORRECTION CANNOT DO
 *
 *   - settle a pending selection, or return a decided one to PENDING. Whether
 *     a leg is decided is never changed by a correction, so a SETTLED tip
 *     keeps every leg decided;
 *   - touch a draft (edit the draft instead) or anything other than the
 *     outcome and the closing price;
 *   - clear a recorded closing price. An empty `newClosingOdds` means
 *     "unchanged".
 *
 * The tip's own status is terminal and is not corrected here.
 */

const MIN_REASON_LENGTH = 10

const idOf = (value: unknown): number | null => {
  const raw =
    typeof value === 'object' && value !== null && 'id' in value
      ? (value as { id: unknown }).id
      : value

  const id = Number(raw)

  return Number.isInteger(id) && id > 0 ? id : null
}

/**
 * Fill in what the caller must not choose, and give a readable refusal for
 * the rules the database enforces anyway.
 *
 * `actor` comes from the signed-in administrator whenever there is one, so a
 * correction made in the admin panel cannot be attributed to somebody else.
 * A server-side caller without a user (a script) must name itself.
 */
const prepareCorrection: CollectionBeforeValidateHook = async ({
  data,
  operation,
  req,
}) => {
  if (operation !== 'create') {
    return data
  }

  const incoming = { ...(data ?? {}) } as Record<string, unknown>
  const selectionId = idOf(incoming.selection)

  if (selectionId === null) {
    throw new APIError('Oprava musí odkazovat na sázku.', 400)
  }

  const selection = await req.payload.findByID({
    collection: 'tip-selections',
    id: String(selectionId),
    depth: 0,
    overrideAccess: true,
    req,
  })

  const tipId = idOf(selection.tip)

  const tip = tipId
    ? await req.payload.findByID({
        collection: 'tips',
        id: String(tipId),
        depth: 0,
        overrideAccess: true,
        req,
      })
    : null

  if (!tip || tip.status === 'DRAFT') {
    throw new APIError(
      'Opravu lze zapsat jen u publikovaného tipu. Koncept se upravuje přímo.',
      400,
    )
  }

  const userEmail =
    req.user && 'email' in req.user && typeof req.user.email === 'string'
      ? req.user.email
      : null
  const actor =
    userEmail ?? (typeof incoming.actor === 'string' ? incoming.actor : '')

  if (actor.trim() === '') {
    throw new APIError('Oprava musí mít uvedeného autora.', 400)
  }

  const previousOutcome = selection.outcome
  const previousClosingOdds = selection.closingOdds ?? null
  const newOutcome = incoming.newOutcome
  const newClosingOdds =
    incoming.newClosingOdds === null || incoming.newClosingOdds === undefined
      ? previousClosingOdds
      : incoming.newClosingOdds

  if ((previousOutcome === 'PENDING') !== (newOutcome === 'PENDING')) {
    throw new APIError(
      'Oprava nemůže vyhodnotit čekající sázku ani vrátit rozhodnutou sázku do stavu ' +
        'PENDING. Čekající sázka se vyhodnocuje běžným zápisem výsledku.',
      400,
    )
  }

  if (
    newOutcome === previousOutcome &&
    newClosingOdds === previousClosingOdds
  ) {
    throw new APIError('Oprava nic nemění.', 400)
  }

  return {
    ...incoming,
    selection: selectionId,
    tip: tipId,
    actor,
    previousOutcome,
    previousClosingOdds,
    newClosingOdds,
    recordedAt: new Date().toISOString(),
  }
}

const oddsOrEmpty = (value: unknown): true | string => {
  if (value === null || value === undefined) {
    return true
  }

  if (!Number.isInteger(value)) {
    return 'Kurz se zadává jako celé číslo v tisícinách: 2.100 je 2100.'
  }

  const odds = value as number

  return odds >= MIN_ODDS && odds <= MAX_ODDS
    ? true
    : `Kurz musí být mezi ${MIN_ODDS} a ${MAX_ODDS} tisícinami.`
}

export const TipCorrections: CollectionConfig = {
  slug: 'tip-corrections',
  admin: {
    useAsTitle: 'reason',
    defaultColumns: [
      'tip',
      'selection',
      'previousOutcome',
      'newOutcome',
      'actor',
      'recordedAt',
    ],
    group: 'Tipy',
    description:
      'Oprava zaznamenaného výsledku sázky publikovaného tipu. Záznam se jen přidává; ' +
      'databáze opravu provede ve stejné transakci a uloží původní hodnotu.',
  },
  access: {
    create: isAdmin,
    read: isAdmin,
    // Append-only: a correction that can itself be edited proves nothing.
    update: denyAll,
    delete: denyAll,
    admin: canAccessAdminPanel,
  },
  defaultSort: '-recordedAt',
  indexes: [{ fields: ['selection', 'transactionId'], unique: false }],
  fields: [
    {
      name: 'selection',
      type: 'relationship',
      relationTo: 'tip-selections',
      required: true,
      hasMany: false,
      index: true,
    },
    {
      name: 'tip',
      type: 'relationship',
      relationTo: 'tips',
      required: true,
      hasMany: false,
      index: true,
      admin: {
        readOnly: true,
        description: 'Filled in from the selection; the database checks it.',
      },
    },
    {
      name: 'newOutcome',
      type: 'select',
      options: toOptions(SELECTION_OUTCOMES),
      required: true,
      admin: {
        description:
          'The correct outcome. A correction never changes whether a leg is decided: a pending leg stays PENDING, a decided one stays decided.',
      },
    },
    {
      name: 'newClosingOdds',
      type: 'number',
      validate: oddsOrEmpty,
      admin: {
        description:
          'The correct closing price, in thousandths. Leave empty to keep the recorded one.',
      },
    },
    {
      name: 'reason',
      type: 'textarea',
      required: true,
      validate: (value: unknown) =>
        typeof value === 'string' && value.trim().length >= MIN_REASON_LENGTH
          ? true
          : `Důvod opravy musí mít alespoň ${MIN_REASON_LENGTH} znaků.`,
      admin: {
        description:
          'Why the recorded value was wrong and where the correct one comes from.',
      },
    },
    {
      name: 'actor',
      type: 'text',
      required: true,
      admin: {
        readOnly: true,
        description: 'The signed-in administrator. Not editable.',
      },
    },
    {
      name: 'previousOutcome',
      type: 'select',
      options: toOptions(SELECTION_OUTCOMES),
      required: true,
      admin: {
        readOnly: true,
        description: 'Copied from the selection by the database.',
      },
    },
    {
      name: 'previousClosingOdds',
      type: 'number',
      admin: {
        readOnly: true,
        description: 'Copied from the selection by the database.',
      },
    },
    {
      name: 'recordedAt',
      type: 'date',
      required: true,
      index: true,
      admin: {
        readOnly: true,
        description: 'Transaction time, stamped by the database.',
      },
    },
    {
      name: 'databaseRole',
      type: 'text',
      admin: {
        readOnly: true,
        description: 'The database login that wrote the correction.',
      },
    },
    {
      name: 'transactionId',
      type: 'text',
      admin: {
        hidden: true,
        description:
          'Database transaction that wrote the correction. Ties it to the change it describes.',
      },
    },
  ],
  hooks: {
    beforeValidate: [
      lockFieldsAfterCreate('A tip correction', []),
      prepareCorrection,
    ],
    beforeDelete: [blockDeletes('A tip correction')],
  },
  labels: { singular: 'Oprava výsledku', plural: 'Opravy výsledků' },
  timestamps: true,
}
