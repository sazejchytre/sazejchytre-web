/**
 * Immutability of a published tip — the Payload-side half.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE THREAT MODEL IS US
 *
 * Everywhere else in this codebase, a hook is enough: the thing it defends
 * against is a bad request, and a request has to go through Payload. Here it is
 * not enough, because the thing worth defending against is **our own server
 * code** quietly improving the record after the fact — a migration, a support
 * script, a "fix" applied with `overrideAccess: true`, a well-meant patch that
 * nudges an odds figure from 1.900 to 2.100 on a tip that won.
 *
 * A hook cannot see any of that. So these rules exist TWICE:
 *
 *   - here, so a rejected edit produces a readable error naming the field;
 *   - as DATABASE TRIGGERS (migration `…_tip_immutability_triggers`), which
 *     hold against `overrideAccess`, against raw SQL, against a migration and
 *     against anything that reaches Postgres at all.
 *
 * The trigger is the guarantee. This file is the error message. Where they
 * disagree, the trigger wins — and the trigger is deliberately the stricter of
 * the two, so an edit that slips past a bug here still fails at the database.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE WHITELIST
 *
 * `MUTABLE_*_AFTER_PUBLICATION` lists what may still change, and everything
 * else is frozen. A whitelist rather than a list of locked fields on purpose:
 * a field somebody adds next month must be frozen by default, not accidentally
 * editable because nobody remembered to add it to a blacklist.
 */
import type {
  CollectionBeforeChangeHook,
  CollectionBeforeDeleteHook,
  CollectionBeforeValidateHook,
} from 'payload'
import { APIError } from 'payload'

import { isSameValue } from '../billing/append-only.ts'
import {
  type TipStatus,
  isFrozenStatus,
  isLegalTipTransition,
} from './constants.ts'

/** Fields Payload manages itself; a change to these is never a user edit. */
const PAYLOAD_MANAGED = new Set(['id', 'updatedAt', 'createdAt'])

/**
 * What may still change on a published tip.
 *
 * `status` only along its legal transitions — enforced separately below.
 * `settledAt` is written once, when the last selection settles.
 */
export const MUTABLE_TIP_FIELDS_AFTER_PUBLICATION: readonly string[] = [
  'status',
  'settledAt',
] as const

/**
 * What may still change on a selection of a published tip.
 *
 * The result, and the closing price recorded at kick-off. Nothing about the
 * pick itself: not the event, the market, the selection, the line, the price
 * taken or the minimum price.
 */
export const MUTABLE_SELECTION_FIELDS_AFTER_PUBLICATION: readonly string[] = [
  'outcome',
  'closingOdds',
  'settledAt',
] as const

const offendingFields = (
  data: Record<string, unknown> | undefined,
  original: Record<string, unknown>,
  allowed: readonly string[],
): string[] => {
  const permitted = new Set(allowed)

  return Object.keys(data ?? {}).filter((field) => {
    if (PAYLOAD_MANAGED.has(field) || permitted.has(field)) {
      return false
    }

    return !isSameValue(data?.[field], original[field])
  })
}

/* -------------------------------------------------------------------------- */
/* Tips                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Refuse any edit to a published tip outside the whitelist.
 *
 * Registered as `beforeValidate` and FIRST, so a frozen field is reported as
 * immutability rather than as whichever content rule the new value happened to
 * break — the same ordering lesson as the invoices in the billing model.
 */
export const lockPublishedTip: CollectionBeforeValidateHook = ({
  data,
  operation,
  originalDoc,
}) => {
  if (operation !== 'update' || !originalDoc) {
    return data
  }

  const previousStatus = originalDoc.status as TipStatus

  if (!isFrozenStatus(previousStatus)) {
    return data
  }

  const offending = offendingFields(
    data as Record<string, unknown> | undefined,
    originalDoc as Record<string, unknown>,
    MUTABLE_TIP_FIELDS_AFTER_PUBLICATION,
  )

  if (offending.length > 0) {
    throw new APIError(
      `Tip je po publikaci neměnný. Pokus o změnu: ${offending.join(', ')}. ` +
        `Po publikaci lze změnit jen: ${MUTABLE_TIP_FIELDS_AFTER_PUBLICATION.join(', ')}. ` +
        'Oprava se řeší publikací nového tipu, nikoli úpravou starého.',
      403,
    )
  }

  return data
}

/** Refuse an illegal status move, including re-settling a settled tip. */
export const enforceTipStatusTransition: CollectionBeforeValidateHook = ({
  data,
  operation,
  originalDoc,
}) => {
  if (operation !== 'update' || !originalDoc) {
    return data
  }

  const from = originalDoc.status as TipStatus
  const to = (data as { status?: TipStatus } | undefined)?.status

  if (to === undefined || to === from) {
    return data
  }

  if (!isLegalTipTransition(from, to)) {
    throw new APIError(
      `Nedovolený přechod stavu tipu: ${from} → ${to}. ` +
        'SETTLED a VOIDED jsou konečné — vyhodnocený tip nelze vyhodnotit znovu.',
      403,
    )
  }

  return data
}

/**
 * Stamp `publishedAt` at the moment of publication.
 *
 * Set here rather than accepted from the caller, because the publication time
 * is what the whole record is defended with: "we said this before the event"
 * is only a claim if we control the clock. An incoming value is overwritten.
 */
export const stampPublication: CollectionBeforeChangeHook = ({
  data,
  operation,
  originalDoc,
}) => {
  const becomingPublished =
    (data as { status?: TipStatus } | undefined)?.status === 'PUBLISHED' &&
    (operation === 'create' || originalDoc?.status === 'DRAFT')

  if (!becomingPublished) {
    return data
  }

  const publishedAt = new Date()

  return {
    ...data,
    publishedAt: publishedAt.toISOString(),
    // Default the public delay from the real publication moment, so the free
    // tier's 24 hours is measured from when the claim was actually made.
    publicAt:
      (data as { publicAt?: unknown }).publicAt ??
      new Date(publishedAt.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  }
}

/** A published tip is a permanent record. It cannot be deleted. */
export const blockPublishedTipDeletion: CollectionBeforeDeleteHook = async ({
  id,
  req,
}) => {
  const tip = await req.payload.findByID({
    collection: 'tips',
    id: String(id),
    depth: 0,
    overrideAccess: true,
    req,
  })

  if (tip && isFrozenStatus(tip.status as TipStatus)) {
    throw new APIError(
      'Publikovaný tip nelze smazat. Je součástí veřejné bilance; ' +
        'odstranění prohraného tipu by znehodnotilo celý track record.',
      403,
    )
  }
}

/* -------------------------------------------------------------------------- */
/* Selections                                                                 */
/* -------------------------------------------------------------------------- */

const tipIdOf = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    return String((value as { id: unknown }).id)
  }

  return String(value)
}

/** Status of the tip a selection belongs to, or null if it cannot be found. */
const parentTipStatus = async (
  tipId: string | null,
  req: Parameters<CollectionBeforeValidateHook>[0]['req'],
): Promise<TipStatus | null> => {
  if (!tipId) {
    return null
  }

  try {
    const tip = await req.payload.findByID({
      collection: 'tips',
      id: tipId,
      depth: 0,
      overrideAccess: true,
      req,
    })

    return (tip?.status as TipStatus | undefined) ?? null
  } catch {
    return null
  }
}

/** Refuse any edit to a selection of a published tip outside the whitelist. */
export const lockPublishedSelection: CollectionBeforeValidateHook = async ({
  data,
  operation,
  originalDoc,
  req,
}) => {
  if (operation !== 'update' || !originalDoc) {
    return data
  }

  const status = await parentTipStatus(tipIdOf(originalDoc.tip), req)

  if (status === null || !isFrozenStatus(status)) {
    return data
  }

  // Moving a selection to another tip would let a published accumulator
  // silently change shape, so `tip` is frozen like everything else.
  const offending = offendingFields(
    data as Record<string, unknown> | undefined,
    originalDoc as Record<string, unknown>,
    MUTABLE_SELECTION_FIELDS_AFTER_PUBLICATION,
  )

  if (offending.length > 0) {
    throw new APIError(
      `Sázka publikovaného tipu je neměnná. Pokus o změnu: ${offending.join(', ')}. ` +
        `Po publikaci lze změnit jen: ${MUTABLE_SELECTION_FIELDS_AFTER_PUBLICATION.join(', ')}.`,
      403,
    )
  }

  return data
}

/** A published tip's set of selections is closed. Nothing may be added. */
export const blockSelectionAddedToPublishedTip: CollectionBeforeValidateHook =
  async ({ data, operation, req }) => {
    if (operation !== 'create') {
      return data
    }

    const status = await parentTipStatus(
      tipIdOf((data as { tip?: unknown } | undefined)?.tip),
      req,
    )

    if (status !== null && isFrozenStatus(status)) {
      throw new APIError(
        'K publikovanému tipu nelze přidat sázku. Počet nohou akumulátoru ' +
          'je součástí publikovaného tvrzení.',
        403,
      )
    }

    return data
  }

/** Nor removed. */
export const blockSelectionRemovedFromPublishedTip: CollectionBeforeDeleteHook =
  async ({ id, req }) => {
    const selection = await req.payload.findByID({
      collection: 'tip-selections',
      id: String(id),
      depth: 0,
      overrideAccess: true,
      req,
    })

    const status = await parentTipStatus(tipIdOf(selection?.tip), req)

    if (status !== null && isFrozenStatus(status)) {
      throw new APIError(
        'Sázku publikovaného tipu nelze smazat. Odstranění prohrané nohy ' +
          'by změnilo výsledek už zveřejněného tipu.',
        403,
      )
    }
  }
