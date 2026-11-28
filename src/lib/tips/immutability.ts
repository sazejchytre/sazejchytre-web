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
 * The complete set of database rules (publication locking, the frozen event,
 * competition and sport fields, one-way settlement and recorded corrections)
 * is in migration `…_sc_023_record_invariant_triggers` and in
 * `docs/DATABASE.md`.
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
  Field,
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
 *
 * Even these move ONE WAY only, and only while the tip is PUBLISHED: an
 * outcome from PENDING to a decided value, a closing price and `settledAt`
 * from empty to a value. Changing a value that is already recorded is a
 * correction, and a correction is a new `tip-corrections` document — see
 * `lockPublishedSelection` and `src/collections/tips/TipCorrections.ts`.
 */
export const MUTABLE_SELECTION_FIELDS_AFTER_PUBLICATION: readonly string[] = [
  'outcome',
  'closingOdds',
  'settledAt',
] as const

/**
 * Fields of a reference row (event, competition, sport) that may still change
 * once a published tip depends on it. Everything else is the published
 * meaning of that tip: which fixture, when it started, which competition and
 * which sport.
 */
export const MUTABLE_REFERENCE_FIELDS_AFTER_PUBLICATION: Readonly<
  Record<'sporting-events' | 'competitions' | 'sports', readonly string[]>
> = Object.freeze({
  // The fixture still has to be played and scored after the tip is out.
  'sporting-events': ['status', 'finalScore', 'externalRefs'],
  // Provider mapping only.
  competitions: ['externalRefs'],
  // Whether NEW tips may be published for it, and its place in a list.
  sports: ['active', 'sortOrder'],
})

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

  // `settledAt` is written once, in the same update that gives the tip its
  // final status. Afterwards it is part of the record like everything else.
  const incoming = data as
    { status?: TipStatus; settledAt?: unknown } | undefined
  const nextStatus = incoming?.status ?? previousStatus
  const closing =
    previousStatus === 'PUBLISHED' &&
    (nextStatus === 'SETTLED' || nextStatus === 'VOIDED')

  if (
    incoming &&
    'settledAt' in incoming &&
    !closing &&
    !isSameValue(incoming.settledAt, originalDoc.settledAt)
  ) {
    throw new APIError(
      'Čas vyhodnocení tipu (settledAt) se zapisuje jen spolu s konečným stavem ' +
        'a poté se už nemění.',
      403,
    )
  }

  return data
}

/**
 * A tip is created as a DRAFT and published by a separate update.
 *
 * Publication is the moment the database locks the tip's selections and the
 * events, competitions and sport they refer to. A tip inserted directly in a
 * published state would skip that moment, so it is refused here and, as the
 * guarantee, by the database.
 */
export const requireDraftOnCreate: CollectionBeforeValidateHook = ({
  data,
  operation,
}) => {
  const status = (data as { status?: TipStatus } | undefined)?.status

  if (operation === 'create' && status !== undefined && status !== 'DRAFT') {
    throw new APIError(
      'Tip se zakládá jako koncept (DRAFT) a publikuje se samostatnou změnou stavu, ' +
        'až má všechny sázky.',
      400,
    )
  }

  return data
}

/** Publishing a tip with no selection would publish a claim with no content. */
export const requireSelectionToPublish: CollectionBeforeValidateHook = async ({
  data,
  operation,
  originalDoc,
  req,
}) => {
  const becomingPublished =
    operation === 'update' &&
    originalDoc?.status === 'DRAFT' &&
    (data as { status?: TipStatus } | undefined)?.status === 'PUBLISHED'

  if (!becomingPublished || originalDoc?.id === undefined) {
    return data
  }

  const { totalDocs } = await req.payload.count({
    collection: 'tip-selections',
    where: { tip: { equals: originalDoc.id } },
    overrideAccess: true,
    req,
  })

  if (totalDocs === 0) {
    throw new APIError('Tip bez jediné sázky nelze publikovat.', 400)
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

  const incoming = (data ?? {}) as Record<string, unknown>
  const original = originalDoc as Record<string, unknown>
  const sourceTipId = tipIdOf(original.tip)
  const targetTipId = 'tip' in incoming ? tipIdOf(incoming.tip) : sourceTipId

  const status = await parentTipStatus(sourceTipId, req)

  // Moving a selection changes the shape of BOTH tips involved, so the
  // destination is checked as well as the origin: a leg must not be slipped
  // into a published accumulator any more than it may be taken out of one.
  if (targetTipId !== sourceTipId) {
    const targetStatus = await parentTipStatus(targetTipId, req)

    if (
      (status !== null && isFrozenStatus(status)) ||
      (targetStatus !== null && isFrozenStatus(targetStatus))
    ) {
      throw new APIError(
        'Sázku nelze přesunout z publikovaného tipu ani do něj. ' +
          'Složení publikovaného tipu je uzavřené.',
        403,
      )
    }
  }

  if (status === null || !isFrozenStatus(status)) {
    return data
  }

  const offending = offendingFields(
    incoming,
    original,
    MUTABLE_SELECTION_FIELDS_AFTER_PUBLICATION,
  )

  if (offending.length > 0) {
    throw new APIError(
      `Sázka publikovaného tipu je neměnná. Pokus o změnu: ${offending.join(', ')}. ` +
        `Po publikaci lze změnit jen: ${MUTABLE_SELECTION_FIELDS_AFTER_PUBLICATION.join(', ')}.`,
      403,
    )
  }

  // The result fields move one way, and only while the tip is still open.
  // Anything else rewrites a recorded result, which is a correction.
  const rewritten = MUTABLE_SELECTION_FIELDS_AFTER_PUBLICATION.filter(
    (field) => {
      if (!(field in incoming)) return false

      const before = original[field]
      const after = incoming[field]

      if (isSameValue(after, before)) return false

      const firstWrite =
        field === 'outcome'
          ? before === 'PENDING' && after !== 'PENDING'
          : before === null || before === undefined

      return !(status === 'PUBLISHED' && firstWrite)
    },
  )

  if (rewritten.length > 0) {
    throw new APIError(
      `Zaznamenaný výsledek sázky nelze přepsat (${rewritten.join(', ')}). ` +
        'Oprava se zapisuje jako nový záznam v kolekci Opravy výsledků ' +
        '(tip-corrections) s důvodem; databáze ji provede ve stejné transakci.',
      403,
    )
  }

  const nextOutcome =
    'outcome' in incoming ? incoming.outcome : original.outcome
  const nextSettledAt =
    'settledAt' in incoming ? incoming.settledAt : original.settledAt

  if (
    nextOutcome === 'PENDING' &&
    nextSettledAt !== null &&
    nextSettledAt !== undefined
  ) {
    throw new APIError(
      'Čas vyhodnocení (settledAt) patří jen k rozhodnuté sázce.',
      400,
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

/* -------------------------------------------------------------------------- */
/* Events, competitions and sports a published tip depends on                 */
/* -------------------------------------------------------------------------- */

/**
 * The public record reads the fixture, its kick-off, its competition and the
 * sport from these rows, not from a copy. So once a published tip depends on
 * a row, the fields that give the tip its meaning are frozen as well.
 *
 * The database decides when that is: publication stamps `recordLockedAt` on
 * every event, competition and sport the tip refers to, inside the same
 * transaction and under the same locks as the status change. These hooks only
 * read that stamp and turn the trigger's refusal into a readable sentence.
 */
type ReferenceSlug = keyof typeof MUTABLE_REFERENCE_FIELDS_AFTER_PUBLICATION

const REFERENCE_LABELS: Readonly<Record<ReferenceSlug, string>> = {
  'sporting-events': 'Událost',
  competitions: 'Soutěž',
  sports: 'Sport',
}

const isRecordLocked = (doc: Record<string, unknown> | undefined): boolean =>
  doc?.recordLockedAt !== null && doc?.recordLockedAt !== undefined

/** Refuse an edit to a frozen field of a row a published tip depends on. */
export const lockRecordedReference =
  (slug: ReferenceSlug): CollectionBeforeValidateHook =>
  ({ data, operation, originalDoc }) => {
    if (operation !== 'update' || !isRecordLocked(originalDoc)) {
      return data
    }

    const offending = offendingFields(
      data as Record<string, unknown> | undefined,
      originalDoc as Record<string, unknown>,
      MUTABLE_REFERENCE_FIELDS_AFTER_PUBLICATION[slug],
    )

    if (offending.length > 0) {
      throw new APIError(
        `${REFERENCE_LABELS[slug]} je součástí publikovaného tipu a tato pole jsou neměnná: ` +
          `${offending.join(', ')}. Lze měnit jen: ` +
          `${MUTABLE_REFERENCE_FIELDS_AFTER_PUBLICATION[slug].join(', ')}.`,
        403,
      )
    }

    return data
  }

/** A row a published tip depends on cannot be deleted. */
export const blockRecordedReferenceDeletion =
  (slug: ReferenceSlug): CollectionBeforeDeleteHook =>
  async ({ id, req }) => {
    const doc = await req.payload.findByID({
      collection: slug,
      id: String(id),
      depth: 0,
      overrideAccess: true,
      req,
    })

    if (isRecordLocked(doc as unknown as Record<string, unknown>)) {
      throw new APIError(
        `${REFERENCE_LABELS[slug]} je součástí publikovaného tipu a nelze ji smazat.`,
        403,
      )
    }
  }

/**
 * The stamp itself, as a read-only field. Field access refuses every write
 * through Payload; the trigger refuses every write that changes it once set.
 */
export const recordLockedAtField: Field = {
  name: 'recordLockedAt',
  type: 'date',
  index: true,
  access: {
    create: () => false,
    update: () => false,
  },
  admin: {
    readOnly: true,
    position: 'sidebar',
    description:
      'Set by the database when the first tip that depends on this row is published. ' +
      'From then on the fields that give that tip its meaning are frozen.',
  },
}
