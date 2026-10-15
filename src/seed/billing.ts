/**
 * Seeds the three plans and their CZK prices.
 *
 * Idempotent: upserts by plan code, and by (plan, currency, interval) for
 * prices, so running it twice is a no-op rather than a duplicate-key error or
 * a second active price. Safe to run against an environment that already has
 * data.
 *
 * Run with:  pnpm seed
 *
 * YEARLY PRICING: ten times the monthly amount, i.e. two months free. Computed
 * from the monthly figure rather than written out, so the discount cannot drift
 * from the stated policy when a price changes.
 */
import { getPayload } from 'payload'

import config from '@/payload.config'
import type {
  BillingInterval,
  Currency,
  FeatureKey,
  PlanCode,
} from '@/lib/billing/constants'

/** Months charged for on an annual subscription. Twelve months, ten paid. */
const MONTHS_CHARGED_ANNUALLY = 10

type PlanSeed = {
  code: PlanCode
  name: string
  description: string
  sortOrder: number
  features: FeatureKey[]
  /** Monthly price in minor units (haléře). */
  monthlyMinor: number
}

/**
 * Feature sets are cumulative by design: each tier is a superset of the one
 * below, so "upgrade" never means losing something.
 */
const PLANS: PlanSeed[] = [
  {
    code: 'START',
    name: 'Start',
    description:
      'Tipy v reálném čase a hodnocení value. Pro začátek s datovou analýzou.',
    sortOrder: 1,
    features: ['TIPS_REALTIME', 'VALUE_RATING'],
    monthlyMinor: 34_900,
  },
  {
    code: 'PRO',
    name: 'Pro',
    description:
      'Všechny sporty, plné odůvodnění analýzy a push notifikace na nové tipy.',
    sortOrder: 2,
    features: [
      'TIPS_REALTIME',
      'VALUE_RATING',
      'TIPS_ALL_SPORTS',
      'FULL_RATIONALE',
      'PUSH_NOTIFICATIONS',
    ],
    monthlyMinor: 79_900,
  },
  {
    code: 'INSIDER',
    name: 'Insider',
    description: 'Vše z Pro, export archivu, přístup k API a tipy v předstihu.',
    sortOrder: 3,
    features: [
      'TIPS_REALTIME',
      'VALUE_RATING',
      'TIPS_ALL_SPORTS',
      'FULL_RATIONALE',
      'PUSH_NOTIFICATIONS',
      'ARCHIVE_EXPORT',
      'API_ACCESS',
      'EARLY_ACCESS',
    ],
    monthlyMinor: 189_000,
  },
]

const SEED_CURRENCY: Currency = 'CZK'

/** Price points derived from the monthly amount. */
const pricesFor = (
  plan: PlanSeed,
): { interval: BillingInterval; amountMinor: number }[] => [
  { interval: 'MONTH', amountMinor: plan.monthlyMinor },
  {
    interval: 'YEAR',
    amountMinor: plan.monthlyMinor * MONTHS_CHARGED_ANNUALLY,
  },
]

export const seedBilling = async (): Promise<void> => {
  const payload = await getPayload({ config })

  // A stable date, not `new Date()`: re-running the seed must not rewrite
  // validFrom and make it look as though pricing changed today.
  const validFrom = new Date('2026-01-01T00:00:00.000Z').toISOString()

  for (const plan of PLANS) {
    const existing = await payload.find({
      collection: 'plans',
      where: { code: { equals: plan.code } },
      limit: 1,
      pagination: false,
      depth: 0,
      overrideAccess: true,
    })

    const data = {
      code: plan.code,
      name: plan.name,
      description: plan.description,
      sortOrder: plan.sortOrder,
      active: true,
      features: plan.features,
    }

    const planDoc = existing.docs[0]
      ? await payload.update({
          collection: 'plans',
          id: existing.docs[0].id,
          data,
          depth: 0,
          overrideAccess: true,
        })
      : await payload.create({
          collection: 'plans',
          data,
          depth: 0,
          overrideAccess: true,
        })

    payload.logger.info(
      `${existing.docs[0] ? 'Updated' : 'Created'} plan ${plan.code} (id ${planDoc.id})`,
    )

    for (const price of pricesFor(plan)) {
      // Match on the triple the partial unique index constrains, regardless of
      // `active`, so a re-run updates the existing row instead of colliding
      // with it.
      const existingPrice = await payload.find({
        collection: 'prices',
        where: {
          and: [
            { plan: { equals: planDoc.id } },
            { currency: { equals: SEED_CURRENCY } },
            { interval: { equals: price.interval } },
          ],
        },
        limit: 1,
        pagination: false,
        depth: 0,
        overrideAccess: true,
      })

      const priceData = {
        plan: planDoc.id,
        currency: SEED_CURRENCY,
        interval: price.interval,
        amountMinor: price.amountMinor,
        active: true,
        validFrom,
      }

      if (existingPrice.docs[0]) {
        await payload.update({
          collection: 'prices',
          id: existingPrice.docs[0].id,
          data: priceData,
          depth: 0,
          overrideAccess: true,
        })
      } else {
        await payload.create({
          collection: 'prices',
          data: priceData,
          depth: 0,
          overrideAccess: true,
        })
      }

      payload.logger.info(
        `  ${price.interval.padEnd(5)} ${SEED_CURRENCY} ${price.amountMinor} minor units`,
      )
    }
  }

  payload.logger.info('Billing seed complete.')
}

await seedBilling()
process.exit(0)
