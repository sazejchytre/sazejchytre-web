/**
 * The contract for a tip arriving from the partner application.
 *
 * CONTRACT ONLY. There is no HTTP endpoint, no authentication and no
 * implementation in this step, on purpose: the partner needs the shape fixed
 * so they can build against it, and fixing the shape is cheaper than
 * un-shipping an endpoint whose payload turned out wrong.
 *
 * What is here:
 *   - the Zod schema, which IS the contract;
 *   - a pure validator that turns an unknown payload into either a typed
 *     command or a list of problems;
 *   - the documented signature the eventual handler will have.
 *
 * See `docs/tip-ingestion-contract.md` for the same thing written for a reader
 * who is not in this codebase, with a worked example payload.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * DESIGN NOTES THE PARTNER NEEDS TO KNOW
 *
 * 1. EVERY NUMBER IS AN INTEGER IN A STATED SCALE. Odds in thousandths, lines
 *    in hundredths. `2.1` is rejected; send `2100`. This is not fussiness: a
 *    float would make the published ROI irreproducible, and the whole product
 *    rests on that number being checkable.
 *
 * 2. THE PAYLOAD IS IDEMPOTENT BY `externalId`. Re-sending the same tip must
 *    be safe, because a partner retry after a timeout is normal and must not
 *    produce a second published tip. The handler will key on it the same way
 *    the billing model keys webhooks on (provider, externalEventId).
 *
 * 3. EVENTS ARE REFERENCED, NOT EMBEDDED. A selection names an event by the
 *    partner's own id, and the handler resolves it against `sporting_events`
 *    via `externalRefs`. An unknown event is a rejection, not an implicit
 *    create — a tip on an event we cannot identify is a tip we cannot settle.
 *
 * 4. A TIP ARRIVES COMPLETE OR NOT AT ALL. Selections cannot be added later:
 *    published tips are immutable, and a partially-ingested accumulator would
 *    be a published claim that changed shape afterwards.
 *
 * 5. THE PARTNER DOES NOT SET `status`. Everything arrives as a draft and is
 *    published by a separate, deliberate act. Letting an inbound payload
 *    publish directly would mean a partner bug becomes a public claim.
 */
import { z } from 'zod'

import { FEATURE_KEYS } from '../billing/constants.ts'
import {
  MAX_CONFIDENCE,
  MAX_ODDS,
  MAX_STAKE_UNITS,
  MIN_CONFIDENCE,
  MIN_ODDS,
  MIN_STAKE_UNITS,
} from './constants.ts'

/* -------------------------------------------------------------------------- */
/* Schema                                                                     */
/* -------------------------------------------------------------------------- */

/** Odds in thousandths: 2.100 → 2100. */
const oddsThousandths = z
  .number()
  .int({ error: 'odds must be an integer in thousandths, e.g. 2100 for 2.100' })
  .min(MIN_ODDS, { error: `odds must be at least ${MIN_ODDS} (1.001)` })
  .max(MAX_ODDS, { error: `odds must be at most ${MAX_ODDS} (1000.000)` })

/** A handicap or total in hundredths: −0.75 → −75. */
const lineHundredths = z
  .number()
  .int({ error: 'line must be an integer in hundredths, e.g. -75 for -0.75' })
  .min(-100_000)
  .max(100_000)

export const tipSelectionPayloadSchema = z
  .object({
    /**
     * The partner's id for the event. Resolved against
     * `sporting_events.externalRefs`; an unknown id is rejected.
     */
    eventExternalId: z.string().min(1).max(200),
    /**
     * Market code, free text. Not an enum: new markets appear constantly, and
     * an enum would make "we can price a new market" a schema migration.
     * See KNOWN_MARKETS for the ones we understand today.
     */
    market: z.string().min(1).max(60),
    /** The actual pick, e.g. `HOME`, `OVER`, `AWAY_-1.5`. */
    selection: z.string().min(1).max(120),
    /** Handicap or total, where the market has one. */
    line: lineHundredths.nullable().optional(),
    oddsAtPublication: oddsThousandths,
    /**
     * The price below which the tip is not worth taking. Must not exceed the
     * published price, or the tip would be un-takeable the moment it is made.
     */
    minimumOdds: oddsThousandths,
  })
  .strict()
  .refine((value) => value.minimumOdds <= value.oddsAtPublication, {
    error:
      'minimumOdds must be at or below oddsAtPublication — otherwise the tip is not takeable at the price it was published at',
    path: ['minimumOdds'],
  })

export const tipIngestionPayloadSchema = z
  .object({
    /** Contract version, so a change is explicit rather than inferred. */
    version: z.literal(1),
    /**
     * The partner's own id for this tip. The idempotency key: re-sending the
     * same id must not create a second tip.
     */
    externalId: z.string().min(1).max(200),
    /** Sport code, matched against `sports.code`. */
    sportCode: z.string().min(1).max(40),
    title: z.string().min(3).max(200),
    /** Lexical/portable rich text, or plain paragraphs. Stored verbatim. */
    rationale: z.string().min(1).max(20_000),
    /** Where the signal came from, for the "why trust this" section. */
    sourcesSummary: z
      .array(
        z
          .object({
            kind: z.string().min(1).max(60),
            detail: z.string().min(1).max(500),
          })
          .strict(),
      )
      .max(20)
      .optional(),
    stakeUnits: z.number().int().min(MIN_STAKE_UNITS).max(MAX_STAKE_UNITS),
    confidence: z
      .number()
      .int()
      .min(MIN_CONFIDENCE)
      .max(MAX_CONFIDENCE)
      .optional(),
    /** Which entitlement unlocks the tip immediately. */
    requiredFeatureKey: z.enum(FEATURE_KEYS),
    /**
     * When the free tier may see it. Omit for the default of publication plus
     * 24 hours; the handler computes it at publication time.
     */
    publicAfterHours: z.number().int().min(0).max(720).optional(),
    /** At least one selection. Several make it an accumulator. */
    selections: z.array(tipSelectionPayloadSchema).min(1).max(12),
  })
  .strict()

export type TipSelectionPayload = z.infer<typeof tipSelectionPayloadSchema>
export type TipIngestionPayload = z.infer<typeof tipIngestionPayloadSchema>

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

export type IngestionProblem = {
  /** Dot path into the payload, e.g. `selections.0.minimumOdds`. */
  path: string
  message: string
}

export type IngestionValidation =
  | { ok: true; payload: TipIngestionPayload }
  | { ok: false; problems: readonly IngestionProblem[] }

/**
 * Validate an unknown payload. PURE — no database, no network.
 *
 * Returns every problem rather than the first: a partner fixing an integration
 * should see the whole list in one response instead of discovering them one
 * deploy at a time.
 */
export const validateTipIngestionPayload = (
  input: unknown,
): IngestionValidation => {
  const parsed = tipIngestionPayloadSchema.safeParse(input)

  if (parsed.success) {
    return { ok: true, payload: parsed.data }
  }

  return {
    ok: false,
    problems: parsed.error.issues.map((issue) => ({
      path: issue.path.map((segment) => String(segment)).join('.') || '(root)',
      message: issue.message,
    })),
  }
}

/* -------------------------------------------------------------------------- */
/* The handler signature                                                      */
/* -------------------------------------------------------------------------- */

export type IngestionOutcome =
  | { status: 'CREATED'; tipId: string | number }
  /** The same `externalId` was already ingested. Not an error. */
  | { status: 'ALREADY_INGESTED'; tipId: string | number }
  | { status: 'REJECTED'; problems: readonly IngestionProblem[] }

/**
 * The function the partner's requests will eventually reach.
 *
 * DECLARED, NOT IMPLEMENTED. The signature is the deliverable of this step;
 * the body arrives with the endpoint.
 *
 * Contract the implementation must honour:
 *
 *  - Validate with `validateTipIngestionPayload` first, and reject with the
 *    full problem list.
 *  - Resolve `sportCode` and every `eventExternalId` against existing rows.
 *    An unknown reference is a REJECTED, never an implicit create.
 *  - Be idempotent on `externalId`: a second call with the same id returns
 *    ALREADY_INGESTED and the original tip id, and writes nothing.
 *  - Create the tip as DRAFT with all its selections in ONE transaction, so a
 *    partial accumulator can never exist.
 *  - Never publish. Publication is a separate, deliberate act, because
 *    publishing freezes the claim.
 */
export type IngestTipFn = (args: {
  payload: unknown
  /** Who sent it, for the audit trail. Resolved from the credential. */
  actor: string
}) => Promise<IngestionOutcome>

/** A payload that satisfies the contract, used by the docs and the tests. */
export const EXAMPLE_TIP_PAYLOAD: TipIngestionPayload = {
  version: 1,
  externalId: 'partner-tip-2026-03-14-0001',
  sportCode: 'FOOTBALL',
  title: 'Slavia – Plzeň: více než 2,5 branky',
  rationale:
    'Obě mužstva hrají vysoko postavenou obranu a v posledních pěti ' +
    'vzájemných zápasech padlo v průměru 3,4 branky. Model dává 61 % na ' +
    'překročení 2,5 branky, trh nabízí implikovaných 52 %.',
  sourcesSummary: [
    { kind: 'MODEL', detail: 'xG model v4, 61,2 % na Over 2.5' },
    { kind: 'MARKET', detail: 'Průměr tří burz, implikovaných 52,4 %' },
  ],
  stakeUnits: 2,
  confidence: 61,
  requiredFeatureKey: 'TIPS_REALTIME',
  publicAfterHours: 24,
  selections: [
    {
      eventExternalId: 'partner-event-884213',
      market: 'OVER_UNDER',
      selection: 'OVER',
      line: 250,
      oddsAtPublication: 1910,
      minimumOdds: 1830,
    },
  ],
}
