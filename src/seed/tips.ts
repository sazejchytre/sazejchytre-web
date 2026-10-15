/**
 * Development seed: sports, competitions, events and fifteen historical tips.
 *
 * The track record functions are only interesting against realistic data, and
 * "realistic" has to include losses. The fixture below is deliberately NOT
 * flattering: it runs at a modest positive ROI with a losing streak in the
 * middle, a void, two Asian-handicap half outcomes and two accumulators, one
 * of which lost on its last leg.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * EVERYTHING IS MARKED
 *
 * Every row gets `seedMarker: 'seed-step-3b'`, so a developer can purge the
 * lot without guessing which rows were real:
 *
 *   pnpm seed:tips --purge
 *
 * The purge deletes through raw SQL because published tips refuse deletion —
 * by hook AND by trigger — which is exactly as intended. A seed that could be
 * removed through the normal API would mean the immutability rules had a hole
 * in them.
 *
 * Idempotent: re-running upserts by slug and by code rather than duplicating.
 */
import { getPayload } from 'payload'

import config from '@/payload.config'
import type { SelectionOutcome } from '@/lib/tips/constants'

export const SEED_MARKER = 'seed-step-3b'

/* -------------------------------------------------------------------------- */
/* Reference data                                                             */
/* -------------------------------------------------------------------------- */

const SPORTS = [
  { code: 'FOOTBALL', name: 'Fotbal', sortOrder: 1 },
  { code: 'HOCKEY', name: 'Hokej', sortOrder: 2 },
  { code: 'TENNIS', name: 'Tenis', sortOrder: 3 },
  { code: 'BASKETBALL', name: 'Basketbal', sortOrder: 4 },
] as const

const COMPETITIONS = [
  { sport: 'FOOTBALL', name: 'Chance Liga', country: 'CZ' },
  { sport: 'FOOTBALL', name: 'Premier League', country: 'GB' },
  { sport: 'HOCKEY', name: 'Tipsport extraliga', country: 'CZ' },
  { sport: 'TENNIS', name: 'ATP Tour', country: null },
  { sport: 'BASKETBALL', name: 'NBA', country: 'US' },
] as const

/* -------------------------------------------------------------------------- */
/* The fifteen tips                                                           */
/* -------------------------------------------------------------------------- */

type SeedSelection = {
  home: string
  away: string
  competition: string
  market: string
  selection: string
  line?: number
  odds: number
  minimumOdds: number
  closingOdds?: number
  outcome: SelectionOutcome
}

type SeedTip = {
  slug: string
  sport: string
  title: string
  /** Days before "now" that the tip was published. */
  daysAgo: number
  stakeUnits: number
  confidence: number
  requiredFeatureKey:
    'TIPS_REALTIME' | 'TIPS_ALL_SPORTS' | 'FULL_RATIONALE' | 'EARLY_ACCESS'
  rationale: string
  selections: SeedSelection[]
  /** VOIDED tips never settle; everything else does. */
  voided?: boolean
}

const TIPS: SeedTip[] = [
  {
    slug: 'slavia-plzen-over-25',
    sport: 'FOOTBALL',
    title: 'Slavia – Plzeň: více než 2,5 branky',
    daysAgo: 40,
    stakeUnits: 2,
    confidence: 61,
    requiredFeatureKey: 'TIPS_REALTIME',
    rationale:
      'Obě mužstva hrají vysoko postavenou obranu. Model dává 61 % na překročení 2,5 branky, trh nabízí implikovaných 52 %.',
    selections: [
      {
        home: 'Slavia Praha',
        away: 'Viktoria Plzeň',
        competition: 'Chance Liga',
        market: 'OVER_UNDER',
        selection: 'OVER',
        line: 250,
        odds: 1910,
        minimumOdds: 1830,
        closingOdds: 1800,
        outcome: 'WON',
      },
    ],
  },
  {
    slug: 'sparta-banik-home',
    sport: 'FOOTBALL',
    title: 'Sparta – Baník: domácí výhra',
    daysAgo: 38,
    stakeUnits: 3,
    confidence: 70,
    requiredFeatureKey: 'TIPS_REALTIME',
    rationale:
      'Sparta doma v posledních deseti zápasech neprohrála. Baník bez dvou stoperů.',
    selections: [
      {
        home: 'Sparta Praha',
        away: 'Baník Ostrava',
        competition: 'Chance Liga',
        market: '1X2',
        selection: 'HOME',
        odds: 1520,
        minimumOdds: 1450,
        closingOdds: 1480,
        outcome: 'WON',
      },
    ],
  },
  {
    slug: 'liverpool-arsenal-btts',
    sport: 'FOOTBALL',
    title: 'Liverpool – Arsenal: oba týmy skórují',
    daysAgo: 36,
    stakeUnits: 2,
    confidence: 58,
    requiredFeatureKey: 'TIPS_ALL_SPORTS',
    rationale:
      'Oba týmy skórovaly v posledních šesti vzájemných zápasech. Model 64 %, trh 57 %.',
    selections: [
      {
        home: 'Liverpool',
        away: 'Arsenal',
        competition: 'Premier League',
        market: 'BOTH_TEAMS_TO_SCORE',
        selection: 'YES',
        odds: 1740,
        minimumOdds: 1700,
        closingOdds: 1760,
        outcome: 'LOST',
      },
    ],
  },
  {
    slug: 'sparta-kometa-handicap',
    sport: 'HOCKEY',
    title: 'Sparta – Kometa: handicap −1,5',
    daysAgo: 34,
    stakeUnits: 1,
    confidence: 52,
    requiredFeatureKey: 'TIPS_REALTIME',
    rationale:
      'Sparta má výrazně lepší hru v přesilovkách, Kometa bez prvního brankáře.',
    selections: [
      {
        home: 'HC Sparta Praha',
        away: 'HC Kometa Brno',
        competition: 'Tipsport extraliga',
        market: 'ASIAN_HANDICAP',
        selection: 'HOME',
        line: -150,
        odds: 2250,
        minimumOdds: 2100,
        closingOdds: 2300,
        outcome: 'LOST',
      },
    ],
  },
  {
    slug: 'pardubice-treti-trinec',
    sport: 'HOCKEY',
    title: 'Pardubice – Třinec: více než 5,5 branky',
    daysAgo: 32,
    stakeUnits: 2,
    confidence: 55,
    requiredFeatureKey: 'TIPS_REALTIME',
    rationale: 'Obě mužstva hrají otevřeně, průměr 6,2 branky na zápas.',
    selections: [
      {
        home: 'HC Dynamo Pardubice',
        away: 'HC Oceláři Třinec',
        competition: 'Tipsport extraliga',
        market: 'OVER_UNDER',
        selection: 'OVER',
        line: 550,
        odds: 1950,
        minimumOdds: 1900,
        closingOdds: 1880,
        outcome: 'LOST',
      },
    ],
  },
  {
    slug: 'djokovic-alcaraz-sets',
    sport: 'TENNIS',
    title: 'Djokovič – Alcaraz: více než 3,5 setu',
    daysAgo: 30,
    stakeUnits: 1,
    confidence: 64,
    requiredFeatureKey: 'TIPS_ALL_SPORTS',
    rationale: 'Posledních pět vzájemných zápasů šlo do čtyř a více setů.',
    selections: [
      {
        home: 'Novak Djoković',
        away: 'Carlos Alcaraz',
        competition: 'ATP Tour',
        market: 'OVER_UNDER',
        selection: 'OVER',
        line: 350,
        odds: 1800,
        minimumOdds: 1750,
        closingOdds: 1700,
        outcome: 'WON',
      },
    ],
  },
  {
    slug: 'lakers-celtics-spread',
    sport: 'BASKETBALL',
    title: 'Lakers – Celtics: handicap +4,5',
    daysAgo: 28,
    stakeUnits: 2,
    confidence: 57,
    requiredFeatureKey: 'TIPS_ALL_SPORTS',
    rationale:
      'Lakers doma po dni odpočinku, Celtics třetí zápas ve čtyřech dnech.',
    selections: [
      {
        home: 'Los Angeles Lakers',
        away: 'Boston Celtics',
        competition: 'NBA',
        market: 'HANDICAP',
        selection: 'HOME',
        line: 450,
        odds: 1870,
        minimumOdds: 1820,
        closingOdds: 1900,
        outcome: 'WON',
      },
    ],
  },
  {
    slug: 'slavia-sparta-derby-void',
    sport: 'FOOTBALL',
    title: 'Derby: více než 2,5 branky (zápas odložen)',
    daysAgo: 26,
    stakeUnits: 2,
    confidence: 60,
    requiredFeatureKey: 'TIPS_REALTIME',
    // VOIDED, not settled-void: the match was postponed, so the tip was
    // withdrawn before it could resolve. Its leg stays PENDING forever, which
    // is why a VOIDED tip contributes nothing to the track record — there was
    // never a result. The accumulator below still carries a settled VOID leg,
    // so both shapes are represented in the fixture.
    voided: true,
    rationale: 'Tip zrušen — zápas byl odložen kvůli nehratelnému terénu.',
    selections: [
      {
        home: 'Slavia Praha',
        away: 'Sparta Praha',
        competition: 'Chance Liga',
        market: 'OVER_UNDER',
        selection: 'OVER',
        line: 250,
        odds: 1900,
        minimumOdds: 1850,
        outcome: 'VOID',
      },
    ],
  },
  {
    slug: 'brno-olomouc-quarter-line',
    sport: 'HOCKEY',
    title: 'Kometa – Olomouc: handicap −0,25',
    daysAgo: 24,
    stakeUnits: 2,
    confidence: 54,
    requiredFeatureKey: 'TIPS_REALTIME',
    rationale:
      'Čtvrtinová linie: polovina sázky na handicap 0, polovina na −0,5.',
    selections: [
      {
        home: 'HC Kometa Brno',
        away: 'HC Olomouc',
        competition: 'Tipsport extraliga',
        market: 'ASIAN_HANDICAP',
        selection: 'HOME',
        line: -25,
        odds: 1960,
        minimumOdds: 1900,
        closingOdds: 1940,
        outcome: 'HALF_WON',
      },
    ],
  },
  {
    slug: 'everton-fulham-quarter-line',
    sport: 'FOOTBALL',
    title: 'Everton – Fulham: handicap +0,25',
    daysAgo: 22,
    stakeUnits: 2,
    confidence: 51,
    requiredFeatureKey: 'TIPS_ALL_SPORTS',
    rationale:
      'Čtvrtinová linie na domácí, polovina sázky se vrací při remíze.',
    selections: [
      {
        home: 'Everton',
        away: 'Fulham',
        competition: 'Premier League',
        market: 'ASIAN_HANDICAP',
        selection: 'HOME',
        line: 25,
        odds: 2050,
        minimumOdds: 2000,
        closingOdds: 2100,
        outcome: 'HALF_LOST',
      },
    ],
  },
  {
    slug: 'dvojity-tip-fotbal-hokej',
    sport: 'FOOTBALL',
    title: 'Dvojitý tip: Slavia a Sparta',
    daysAgo: 20,
    stakeUnits: 1,
    confidence: 48,
    requiredFeatureKey: 'EARLY_ACCESS',
    rationale: 'Akumulátor ze dvou nezávislých doporučení modelu.',
    selections: [
      {
        home: 'Slavia Praha',
        away: 'Mladá Boleslav',
        competition: 'Chance Liga',
        market: '1X2',
        selection: 'HOME',
        odds: 1450,
        minimumOdds: 1400,
        closingOdds: 1420,
        outcome: 'WON',
      },
      {
        home: 'HC Sparta Praha',
        away: 'HC Vítkovice',
        competition: 'Tipsport extraliga',
        market: '1X2',
        selection: 'HOME',
        odds: 1800,
        minimumOdds: 1750,
        closingOdds: 1770,
        outcome: 'WON',
      },
    ],
  },
  {
    slug: 'trojity-tip-posledni-noha',
    sport: 'FOOTBALL',
    title: 'Trojitý tip: tři favorité',
    daysAgo: 18,
    stakeUnits: 1,
    confidence: 42,
    requiredFeatureKey: 'EARLY_ACCESS',
    rationale:
      'Trojkombinace favoritů. Poslední noha padla v nastavení — proto celý tip prohrál.',
    selections: [
      {
        home: 'Manchester City',
        away: 'Burnley',
        competition: 'Premier League',
        market: '1X2',
        selection: 'HOME',
        odds: 1200,
        minimumOdds: 1150,
        closingOdds: 1180,
        outcome: 'WON',
      },
      {
        home: 'Liverpool',
        away: 'Sheffield United',
        competition: 'Premier League',
        market: '1X2',
        selection: 'HOME',
        odds: 1250,
        minimumOdds: 1200,
        closingOdds: 1220,
        outcome: 'WON',
      },
      {
        home: 'Arsenal',
        away: 'Brighton',
        competition: 'Premier League',
        market: '1X2',
        selection: 'HOME',
        odds: 1550,
        minimumOdds: 1500,
        closingOdds: 1600,
        outcome: 'LOST',
      },
    ],
  },
  {
    slug: 'akumulator-s-void-nohou',
    sport: 'TENNIS',
    title: 'Dvojitý tip: dva favorité (jeden zápas skrečován)',
    daysAgo: 16,
    stakeUnits: 2,
    confidence: 50,
    requiredFeatureKey: 'TIPS_ALL_SPORTS',
    rationale:
      'Jeden ze zápasů byl skrečován — noha se ruší a tip se počítá jen z druhé.',
    selections: [
      {
        home: 'Jannik Sinner',
        away: 'Daniil Medvedev',
        competition: 'ATP Tour',
        market: '1X2',
        selection: 'HOME',
        odds: 1700,
        minimumOdds: 1650,
        closingOdds: 1680,
        outcome: 'WON',
      },
      {
        home: 'Alexander Zverev',
        away: 'Stefanos Tsitsipas',
        competition: 'ATP Tour',
        market: '1X2',
        selection: 'HOME',
        odds: 1900,
        minimumOdds: 1850,
        outcome: 'VOID',
      },
    ],
  },
  {
    slug: 'nba-totals-over',
    sport: 'BASKETBALL',
    title: 'Nuggets – Suns: více než 224,5 bodu',
    daysAgo: 12,
    stakeUnits: 3,
    confidence: 66,
    requiredFeatureKey: 'TIPS_REALTIME',
    rationale: 'Oba týmy v posledních pěti zápasech překročily 230 bodů.',
    selections: [
      {
        home: 'Denver Nuggets',
        away: 'Phoenix Suns',
        competition: 'NBA',
        market: 'TOTALS',
        selection: 'OVER',
        line: 22_450,
        odds: 1900,
        minimumOdds: 1850,
        closingOdds: 1830,
        outcome: 'WON',
      },
    ],
  },
  {
    slug: 'pardubice-sparta-posledni',
    sport: 'HOCKEY',
    title: 'Pardubice – Sparta: domácí výhra',
    daysAgo: 8,
    stakeUnits: 2,
    confidence: 59,
    requiredFeatureKey: 'TIPS_REALTIME',
    rationale: 'Pardubice doma s nejlepší formou v lize.',
    selections: [
      {
        home: 'HC Dynamo Pardubice',
        away: 'HC Sparta Praha',
        competition: 'Tipsport extraliga',
        market: '1X2',
        selection: 'HOME',
        odds: 2100,
        minimumOdds: 2000,
        closingOdds: 2050,
        outcome: 'WON',
      },
    ],
  },
]

/* -------------------------------------------------------------------------- */
/* Seeding                                                                    */
/* -------------------------------------------------------------------------- */

const DAY_MS = 24 * 60 * 60 * 1000

/** Lexical rich text with one paragraph, which is what `richText` expects. */
const asRichText = (text: string) => ({
  root: {
    type: 'root',
    // `as const` throughout: Lexical's types narrow `format` and `direction`
    // to literal unions, so a widened `string` does not satisfy them.
    format: '' as const,
    indent: 0,
    version: 1,
    direction: 'ltr' as const,
    children: [
      {
        type: 'paragraph',
        format: '' as const,
        indent: 0,
        version: 1,
        direction: 'ltr' as const,
        textFormat: 0,
        children: [
          {
            type: 'text',
            detail: 0,
            format: 0,
            mode: 'normal',
            style: '',
            text,
            version: 1,
          },
        ],
      },
    ],
  },
})

export const seedTips = async (): Promise<void> => {
  const payload = await getPayload({ config })
  const now = Date.now()

  /* --- sports ----------------------------------------------------------- */
  const sportIds = new Map<string, number>()

  for (const sport of SPORTS) {
    const existing = await payload.find({
      collection: 'sports',
      where: { code: { equals: sport.code } },
      limit: 1,
      pagination: false,
      overrideAccess: true,
      depth: 0,
    })

    const data = { ...sport, active: true, seedMarker: SEED_MARKER }

    const doc = existing.docs[0]
      ? await payload.update({
          collection: 'sports',
          id: existing.docs[0].id,
          data,
          overrideAccess: true,
          depth: 0,
        })
      : await payload.create({
          collection: 'sports',
          data,
          overrideAccess: true,
          depth: 0,
        })

    sportIds.set(sport.code, Number(doc.id))
  }

  payload.logger.info(`Sports: ${sportIds.size}`)

  /* --- competitions ----------------------------------------------------- */
  const competitionIds = new Map<string, number>()

  for (const competition of COMPETITIONS) {
    const sportId = sportIds.get(competition.sport)

    if (!sportId) {
      continue
    }

    const existing = await payload.find({
      collection: 'competitions',
      where: {
        and: [
          { name: { equals: competition.name } },
          { sport: { equals: sportId } },
        ],
      },
      limit: 1,
      pagination: false,
      overrideAccess: true,
      depth: 0,
    })

    const data = {
      sport: sportId,
      name: competition.name,
      ...(competition.country ? { country: competition.country } : {}),
      externalRefs: {
        seed: competition.name.toLowerCase().replace(/\s+/g, '-'),
      },
      seedMarker: SEED_MARKER,
    }

    const doc = existing.docs[0]
      ? await payload.update({
          collection: 'competitions',
          id: existing.docs[0].id,
          data,
          overrideAccess: true,
          depth: 0,
        })
      : await payload.create({
          collection: 'competitions',
          data,
          overrideAccess: true,
          depth: 0,
        })

    competitionIds.set(competition.name, Number(doc.id))
  }

  payload.logger.info(`Competitions: ${competitionIds.size}`)

  /* --- tips ------------------------------------------------------------- */
  let created = 0
  let skipped = 0

  for (const tip of TIPS) {
    const existing = await payload.find({
      collection: 'tips',
      where: { slug: { equals: tip.slug } },
      limit: 1,
      pagination: false,
      overrideAccess: true,
      depth: 0,
    })

    if (existing.docs[0]) {
      // A published tip is immutable, so re-seeding must not try to update it.
      // Idempotency here means "leave it alone", not "overwrite".
      skipped += 1
      continue
    }

    const sportId = sportIds.get(tip.sport)

    if (!sportId) {
      continue
    }

    const publishedAt = new Date(now - tip.daysAgo * DAY_MS)

    // 1. Create as a DRAFT, so the selections can still be attached.
    const draft = await payload.create({
      collection: 'tips',
      data: {
        slug: tip.slug,
        sport: sportId,
        title: tip.title,
        status: 'DRAFT',
        requiredFeatureKey: tip.requiredFeatureKey,
        stakeUnits: tip.stakeUnits,
        confidence: tip.confidence,
        rationale: asRichText(tip.rationale),
        sourcesSummary: [
          { kind: 'MODEL', detail: 'Seeded fixture — not a real model output' },
        ],
        seedMarker: SEED_MARKER,
      },
      overrideAccess: true,
      depth: 0,
    })

    // 2. Events and selections, while it is still a draft.
    for (const selection of tip.selections) {
      const competitionId = competitionIds.get(selection.competition)

      if (!competitionId) {
        continue
      }

      const startsAt = new Date(publishedAt.getTime() + 36 * 60 * 60 * 1000)

      const existingEvent = await payload.find({
        collection: 'sporting-events',
        where: {
          and: [
            { homeName: { equals: selection.home } },
            { awayName: { equals: selection.away } },
            { startsAt: { equals: startsAt.toISOString() } },
          ],
        },
        limit: 1,
        pagination: false,
        overrideAccess: true,
        depth: 0,
      })

      const event =
        existingEvent.docs[0] ??
        (await payload.create({
          collection: 'sporting-events',
          data: {
            competition: competitionId,
            homeName: selection.home,
            awayName: selection.away,
            startsAt: startsAt.toISOString(),
            status: tip.voided ? 'POSTPONED' : 'FINISHED',
            ...(tip.voided
              ? {}
              : { finalScore: { home: 2, away: 1, note: 'seeded' } }),
            externalRefs: { seed: `${selection.home}-${selection.away}` },
            seedMarker: SEED_MARKER,
          },
          overrideAccess: true,
          depth: 0,
        }))

      await payload.create({
        collection: 'tip-selections',
        data: {
          tip: Number(draft.id),
          sportingEvent: Number(event.id),
          market: selection.market,
          selection: selection.selection,
          ...(selection.line === undefined ? {} : { line: selection.line }),
          oddsAtPublication: selection.odds,
          minimumOdds: selection.minimumOdds,
          // PENDING for now; the outcome is recorded after publication, the
          // same way a real tip settles.
          outcome: 'PENDING',
          seedMarker: SEED_MARKER,
        },
        overrideAccess: true,
        depth: 0,
      })
    }

    // 3. Publish, BACKDATED.
    //
    // Done in one SQL UPDATE rather than through Payload, because
    // `stampPublication` deliberately overwrites `publishedAt` with the server
    // clock — which is right for a real tip and useless for a historical
    // fixture.
    //
    // No trigger has to be disabled for this: the immutability trigger lets
    // any update through while the row is still DRAFT, and this statement is
    // the DRAFT → PUBLISHED transition itself. So the seed goes through the
    // triggers rather than around them, and the moment it lands the row is
    // frozen like any other.
    const { sql } = await import('@payloadcms/db-postgres/drizzle')
    const db = (
      payload.db as unknown as {
        drizzle: { execute: (query: unknown) => Promise<unknown> }
      }
    ).drizzle

    await db.execute(sql`
      UPDATE "tips"
         SET "status" = 'PUBLISHED',
             "published_at" = ${publishedAt.toISOString()}::timestamptz,
             "public_at" = ${new Date(publishedAt.getTime() + DAY_MS).toISOString()}::timestamptz,
             "updated_at" = now()
       WHERE "id" = ${Number(draft.id)} AND "seed_marker" = ${SEED_MARKER}
    `)

    await payload.create({
      collection: 'tip-audit-events',
      data: {
        tip: Number(draft.id),
        type: 'PUBLISHED',
        occurredAt: publishedAt.toISOString(),
        actor: 'seed',
        before: { status: 'DRAFT' },
        after: { status: 'PUBLISHED', publishedAt: publishedAt.toISOString() },
        note: `Seeded fixture (${SEED_MARKER}).`,
      },
      overrideAccess: true,
      depth: 0,
    })

    // 4. Record the outcomes, which settles the tip through the normal path.
    if (!tip.voided) {
      const selections = await payload.find({
        collection: 'tip-selections',
        where: { tip: { equals: Number(draft.id) } },
        limit: 0,
        pagination: false,
        overrideAccess: true,
        depth: 0,
        sort: 'id',
      })

      for (const [index, row] of selections.docs.entries()) {
        const seeded = tip.selections[index]

        if (!seeded) {
          continue
        }

        await payload.update({
          collection: 'tip-selections',
          id: row.id,
          data: {
            outcome: seeded.outcome,
            ...(seeded.closingOdds === undefined
              ? {}
              : { closingOdds: seeded.closingOdds }),
            settledAt: new Date(
              publishedAt.getTime() + 2 * DAY_MS,
            ).toISOString(),
          },
          overrideAccess: true,
          depth: 0,
        })
      }
    } else {
      await payload.update({
        collection: 'tips',
        id: draft.id,
        data: { status: 'VOIDED' },
        overrideAccess: true,
        depth: 0,
      })
    }

    created += 1
  }

  payload.logger.info(`Tips created: ${created}, already present: ${skipped}`)
  payload.logger.info('Tips seed complete.')
}

/**
 * Remove every seeded row.
 *
 * Raw SQL because published tips refuse deletion by hook AND by trigger, which
 * is the point of this step. The triggers are disabled for the duration and
 * only rows carrying the marker are touched.
 */
export const purgeSeededTips = async (): Promise<void> => {
  const payload = await getPayload({ config })
  const { sql } = await import('@payloadcms/db-postgres/drizzle')
  const db = (
    payload.db as unknown as {
      drizzle: { execute: (query: unknown) => Promise<unknown> }
    }
  ).drizzle

  // One statement per call: Postgres refuses several commands in a prepared
  // statement, and the delete statements carry a parameter.
  //
  // The deletion triggers DO have to be disabled here — refusing to delete a
  // published tip is exactly what they are for, and a purge is the one
  // legitimate exception. Table-wide and brief, which is acceptable for a
  // development-only script and would not be in production.
  const statements = [
    sql`ALTER TABLE "tip_audit_events" DISABLE TRIGGER "tip_audit_events_no_delete"`,
    sql`ALTER TABLE "tip_selections" DISABLE TRIGGER "tip_selections_no_delete_after_publication"`,
    sql`ALTER TABLE "tips" DISABLE TRIGGER "tips_no_delete_after_publication"`,
    sql`DELETE FROM "tip_audit_events" WHERE "tip_id" IN (SELECT "id" FROM "tips" WHERE "seed_marker" = ${SEED_MARKER})`,
    sql`DELETE FROM "tip_selections" WHERE "seed_marker" = ${SEED_MARKER}`,
    sql`DELETE FROM "tips" WHERE "seed_marker" = ${SEED_MARKER}`,
    sql`DELETE FROM "sporting_events" WHERE "seed_marker" = ${SEED_MARKER}`,
    sql`DELETE FROM "competitions" WHERE "seed_marker" = ${SEED_MARKER}`,
    sql`DELETE FROM "sports" WHERE "seed_marker" = ${SEED_MARKER}`,
    sql`ALTER TABLE "tips" ENABLE TRIGGER "tips_no_delete_after_publication"`,
    sql`ALTER TABLE "tip_selections" ENABLE TRIGGER "tip_selections_no_delete_after_publication"`,
    sql`ALTER TABLE "tip_audit_events" ENABLE TRIGGER "tip_audit_events_no_delete"`,
  ]

  for (const statement of statements) {
    await db.execute(statement)
  }

  payload.logger.info(`Purged every row marked ${SEED_MARKER}.`)
}
