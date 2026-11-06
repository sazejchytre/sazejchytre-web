/**
 * Reading tips out of the database for the public site.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THIS MODULE IS THE ONE `visibility.ts` HAS BEEN WAITING FOR
 *
 * `publicTrackRecord` has a note saying "`loadAllSettledTips` in the loader
 * module is the intended source and applies no filter of its own". Until now
 * that module did not exist, so the pure logic step 3b shipped had nothing
 * feeding it. This is it.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE QUERY IS UNFILTERED, AND THAT IS THE WHOLE POINT
 *
 * `loadAllSettledTips` takes NO filter argument. Not "takes an optional
 * one" — takes none. A published track record whose query could be narrowed
 * is a track record that proves nothing, because the narrowing is invisible
 * in the output.
 *
 * Filtering for display happens AFTER the figures are computed, in the page,
 * over the rows this returns. So the headline numbers are always the whole
 * sample, and a filter changes which rows are listed rather than what the
 * record says. `consideredTips` and `countedTipIds` come back with the record
 * so the arithmetic can be reconciled row by row.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY IT PAGES RATHER THAN TRUSTING `limit: 0`
 *
 * Payload's `limit: 0` means "no limit", which is correct until the table is
 * large enough that one query is a bad idea. Paging in blocks keeps the
 * memory and the statement time bounded, and — more importantly — makes a
 * truncated read impossible to miss: a page that came back short ends the
 * loop, and a page that came back full is followed by another request.
 */
import type { Payload, PayloadRequest } from 'payload'

import type { FeatureKey } from '../billing/constants.ts'
import type { SelectionOutcome, TipStatus } from './constants.ts'
import type { SelectionResult, TrackRecordTip } from './settlement.ts'
import type { VisibilityTip } from './visibility.ts'

/** How many tips to fetch per round trip. */
const PAGE_SIZE = 200

/** A guard against an unbounded loop if a page never comes back short. */
const MAX_PAGES = 100

/* -------------------------------------------------------------------------- */
/* Shapes                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A tip as the public pages need it.
 *
 * Deliberately a superset of `TrackRecordTip` and `VisibilityTip`, so one
 * read serves the arithmetic, the visibility decision and the table. The
 * alternative — three queries returning three shapes — is three chances for
 * them to disagree about which tips exist.
 */
/**
 * `selections` is OMITTED from `TrackRecordTip` before the intersection and
 * redeclared below. Intersecting two array properties
 * (`readonly SelectionResult[]` and `readonly PublicSelection[]`) narrows
 * element access to the first of them, so `tip.selections[0].eventName` stops
 * existing — a confusing error a long way from its cause.
 */
export type PublicTip = Omit<TrackRecordTip, 'selections'> &
  VisibilityTip & {
    slug: string
    title: string
    sportName: string
    settledAt: Date | string | null
    /** Only ever rendered when `tipDisclosure` says so. */
    rationale: unknown
    selections: readonly PublicSelection[]
  }

export type PublicSelection = SelectionResult & {
  market: string
  selection: string
  line: string | null
  eventName: string
  eventStartsAt: Date | string | null
  minimumOddsThousandths: number | null
}

/* -------------------------------------------------------------------------- */
/* Row mapping                                                                */
/* -------------------------------------------------------------------------- */

type Related = { id: number | string } & Record<string, unknown>

const relatedName = (value: unknown, field = 'name'): string => {
  if (typeof value === 'object' && value !== null) {
    const name = (value as Related)[field]

    if (typeof name === 'string') return name
  }

  return ''
}

/**
 * A fixture's display name: `Pardubice – Sparta`.
 *
 * `sporting-events` has NO `name` field — it has `homeName` and `awayName`,
 * because a fixture is two sides and storing a joined string would mean
 * reformatting it to sort or filter by either one. So the name is composed
 * here.
 *
 * This was `relatedName(event)` reading a `.name` that does not exist, which
 * returned an empty string: the history table rendered fourteen links with no
 * text in them. Lighthouse caught it as `link-name` — a type check could not,
 * because `relatedName` is correctly typed and the field it reads is simply
 * absent at runtime.
 *
 * An en dash with spaces, which is the Czech convention for a fixture, not a
 * hyphen and not an em dash.
 */
const eventDisplayName = (value: unknown): string => {
  const home = relatedName(value, 'homeName')
  const away = relatedName(value, 'awayName')

  if (home !== '' && away !== '') {
    return `${home} – ${away}`
  }

  // One side is better than none, and an empty string is better than a
  // dangling dash.
  return home || away
}

/**
 * One selection row into the shape settlement expects.
 *
 * `outcome` and `oddsAtPublication` are what the arithmetic needs;
 * `closingOdds` is optional and drives the closing-line figure only when
 * every leg has one.
 */
const toSelection = (row: Record<string, unknown>): PublicSelection => {
  const event = row.sportingEvent

  return {
    outcome: row.outcome as SelectionOutcome,
    // The field names match `SelectionResult` in settlement.ts exactly, so a
    // loaded row can be handed to the arithmetic without a second mapping
    // step that could rename something wrongly.
    oddsAtPublication: Number(row.oddsAtPublication ?? 0),
    closingOdds:
      row.closingOdds === null || row.closingOdds === undefined
        ? null
        : Number(row.closingOdds),
    market: typeof row.market === 'string' ? row.market : '',
    selection: typeof row.selection === 'string' ? row.selection : '',
    line: typeof row.line === 'string' && row.line !== '' ? row.line : null,
    eventName: eventDisplayName(event),
    eventStartsAt:
      typeof event === 'object' && event !== null
        ? (((event as Related).startsAt as string | null) ?? null)
        : null,
    minimumOddsThousandths:
      row.minimumOdds === null || row.minimumOdds === undefined
        ? null
        : Number(row.minimumOdds),
  }
}

const toPublicTip = (
  row: Record<string, unknown>,
  selections: readonly PublicSelection[],
): PublicTip => ({
  id: row.id as number,
  slug: typeof row.slug === 'string' ? row.slug : '',
  title: typeof row.title === 'string' ? row.title : '',
  sportCode: relatedName(row.sport, 'code') || relatedName(row.sport),
  sportName: relatedName(row.sport),
  status: row.status as TipStatus,
  publishedAt: (row.publishedAt as string | null) ?? null,
  publicAt: (row.publicAt as string | null) ?? null,
  requiredFeatureKey: row.requiredFeatureKey as FeatureKey,
  stakeUnits: Number(row.stakeUnits ?? 0),
  settledAt: (row.settledAt as string | null) ?? null,
  rationale: row.rationale ?? null,
  selections,
})

/* -------------------------------------------------------------------------- */
/* Loading                                                                    */
/* -------------------------------------------------------------------------- */

type LoadArgs = {
  payload: Payload
  req?: PayloadRequest
}

/** Every selection belonging to the given tips, grouped by tip id. */
const loadSelectionsFor = async (
  { payload, req }: LoadArgs,
  tipIds: readonly (number | string)[],
): Promise<Map<number | string, PublicSelection[]>> => {
  const grouped = new Map<number | string, PublicSelection[]>()

  if (tipIds.length === 0) return grouped

  // One query for the whole batch rather than one per tip: a 300-tip history
  // would otherwise be 301 round trips, which is the classic way a list page
  // becomes slow without anything looking wrong in the code.
  const found = await payload.find({
    collection: 'tip-selections',
    depth: 1,
    limit: 0,
    pagination: false,
    overrideAccess: true,
    ...(req ? { req } : {}),
    where: { tip: { in: [...tipIds] } },
  })

  for (const row of found.docs as unknown as Record<string, unknown>[]) {
    const tipRef = row.tip
    const tipId =
      typeof tipRef === 'object' && tipRef !== null
        ? (tipRef as Related).id
        : (tipRef as number | string)

    const list = grouped.get(tipId) ?? []
    list.push(toSelection(row))
    grouped.set(tipId, list)
  }

  return grouped
}

/**
 * EVERY settled tip. No filter, no limit, no caller-supplied narrowing.
 *
 * The signature takes no filter on purpose — see the module header. If you
 * are reaching for one, filter the returned array instead, and show the
 * sample size next to whatever you computed.
 */
export const loadAllSettledTips = async (
  args: LoadArgs,
): Promise<PublicTip[]> => {
  const { payload, req } = args
  const rows: Record<string, unknown>[] = []

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const found = await payload.find({
      collection: 'tips',
      depth: 1,
      limit: PAGE_SIZE,
      page,
      overrideAccess: true,
      ...(req ? { req } : {}),
      // Newest first for display; the arithmetic is order-independent, which
      // `publicTrackRecord`'s own test asserts.
      sort: '-publishedAt',
      where: { status: { equals: 'SETTLED' } },
    })

    rows.push(...(found.docs as unknown as Record<string, unknown>[]))

    if (found.docs.length < PAGE_SIZE) break

    if (page === MAX_PAGES) {
      // Loud rather than silently short. A truncated track record is a wrong
      // track record, and it would look entirely plausible.
      payload.logger.error(
        {
          scope: 'tips',
          event: 'track_record.truncated',
          pages: MAX_PAGES,
          pageSize: PAGE_SIZE,
        },
        'Stopped paging settled tips at the page guard. The published record ' +
          'would be incomplete — raise MAX_PAGES.',
      )
    }
  }

  const selections = await loadSelectionsFor(
    args,
    rows.map((row) => row.id as number),
  )

  return rows.map((row) =>
    toPublicTip(row, selections.get(row.id as number) ?? []),
  )
}

/**
 * The tips whose result is public and which are published, for the archive.
 *
 * Includes VOIDED alongside SETTLED, because a voided tip resolved to "no
 * result" and that is part of the record — hiding it would make it look like
 * a tip that vanished.
 */
export const loadPublicArchive = async (
  args: LoadArgs,
): Promise<PublicTip[]> => {
  const { payload, req } = args

  const found = await payload.find({
    collection: 'tips',
    depth: 1,
    limit: PAGE_SIZE,
    overrideAccess: true,
    ...(req ? { req } : {}),
    sort: '-publishedAt',
    where: {
      status: { in: ['PUBLISHED', 'SETTLED', 'VOIDED'] },
    },
  })

  const rows = found.docs as unknown as Record<string, unknown>[]

  const selections = await loadSelectionsFor(
    args,
    rows.map((row) => row.id as number),
  )

  return rows.map((row) =>
    toPublicTip(row, selections.get(row.id as number) ?? []),
  )
}

/** One tip by slug, or null. Used by `/tipy/[slug]`. */
export const loadTipBySlug = async (
  args: LoadArgs,
  slug: string,
): Promise<PublicTip | null> => {
  const { payload, req } = args

  const found = await payload.find({
    collection: 'tips',
    depth: 1,
    limit: 1,
    pagination: false,
    overrideAccess: true,
    ...(req ? { req } : {}),
    where: {
      slug: { equals: slug },
      // A DRAFT is not reachable by URL. Not because the slug is secret, but
      // because an unpublished tip has no publication date and the visibility
      // rules have nothing to reason about.
      status: { in: ['PUBLISHED', 'SETTLED', 'VOIDED'] },
    },
  })

  const row = found.docs[0] as unknown as Record<string, unknown> | undefined

  if (!row) return null

  const selections = await loadSelectionsFor(args, [row.id as number])

  return toPublicTip(row, selections.get(row.id as number) ?? [])
}

/**
 * The most recent tip whose delay has elapsed, for the homepage.
 *
 * "Yesterday's free tip": a real tip, shown late rather than a different kind
 * of tip. The page says so explicitly — a delayed tip presented as a sample
 * would be the dishonest version of this.
 */
export const loadLatestPublicTip = async (
  args: LoadArgs,
  now: Date,
): Promise<PublicTip | null> => {
  const { payload, req } = args

  const found = await payload.find({
    collection: 'tips',
    depth: 1,
    limit: 1,
    pagination: false,
    overrideAccess: true,
    ...(req ? { req } : {}),
    sort: '-publishedAt',
    where: {
      status: { in: ['PUBLISHED', 'SETTLED', 'VOIDED'] },
      // The delay has passed, so the free tier may see it.
      publicAt: { less_than_equal: now.toISOString() },
    },
  })

  const row = found.docs[0] as unknown as Record<string, unknown> | undefined

  if (!row) return null

  const selections = await loadSelectionsFor(args, [row.id as number])

  return toPublicTip(row, selections.get(row.id as number) ?? [])
}

/** Distinct sports that actually have a public tip, for the filter. */
export const loadSportsWithTips = async (
  tips: readonly PublicTip[],
): Promise<readonly { code: string; name: string }[]> => {
  const seen = new Map<string, string>()

  for (const tip of tips) {
    if (tip.sportCode && !seen.has(tip.sportCode)) {
      seen.set(tip.sportCode, tip.sportName || tip.sportCode)
    }
  }

  // Derived from the loaded rows rather than queried separately: a sport with
  // no tips in the filter list is a dead option, and a second query could
  // disagree with the table about which sports exist.
  return [...seen.entries()]
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'cs-CZ'))
}
