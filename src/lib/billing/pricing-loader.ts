/**
 * Reading the price list out of Payload for the public pages.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * PRICES COME FROM THE TABLE THAT IS RECONCILED INTO STRIPE
 *
 * `plans` and `prices`, read live. Not a CMS field, not a constant, not the
 * message catalogue: the row in `prices` is the one `pnpm sync:prices`
 * reconciles against Stripe, so it is the only number that is guaranteed to
 * match what a customer is actually charged. A price shown anywhere else is a
 * second source of truth, and the day they diverge the cheaper one is on the
 * page and the dearer one is on the card statement.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ONLY ACTIVE, ONLY IN FORCE, ONLY THE ENABLED CURRENCY
 *
 * `active`, `validFrom` in the past, and the currency the operator actually
 * sells in. A future `validFrom` is a scheduled price change and is
 * legitimate to have in the table — it must simply not be advertised yet.
 *
 * NOT cached. A stale price is a wrong number about money, which is the one
 * category of staleness this codebase does not trade for a saved query. The
 * table is three rows per plan.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * `overrideAccess: true`, WHICH IS THE OPPOSITE OF THE CONTENT LOADERS
 *
 * `src/lib/content/loaders.ts` reads with access control ON, because the
 * content collections carry a public read predicate and running it is what
 * applies it. `plans` and `prices` are different: step 4 made them
 * ADMIN-ONLY on read, deliberately, and that decision is still right.
 *
 * Opening them up so this page could read them with access control on would
 * publish more than the page shows — `/api/prices` would then serve
 * scheduled future price changes, deactivated prices and provider price ids
 * to anybody. So the collection stays closed and this one function reads
 * past it with a query narrower than the page's own needs: active, in force,
 * one currency.
 *
 * The rule being followed is "a public page may expose only what it renders",
 * not "a public page must read through public access control".
 */
import type { Payload } from 'payload'

import type { Plan, Price } from '@/payload-types'

import { type Currency, type FeatureKey, type PlanCode } from './constants.ts'
import type { TierPrice, TierView } from './pricing-view.ts'

const pickPrice = (
  prices: readonly Price[],
  interval: 'MONTH' | 'YEAR',
): TierPrice | null => {
  const row = prices.find((price) => price.interval === interval)

  if (!row) return null

  return {
    interval: row.interval,
    amountMinor: row.amountMinor,
    currency: row.currency,
    providerPriceId: row.providerPriceId ?? null,
  }
}

/** The plan id a price row points at, whether or not it was populated. */
const planIdOf = (price: Price): number | null => {
  const plan = price.plan

  if (typeof plan === 'number') return plan
  if (plan && typeof plan === 'object') return plan.id

  return null
}

export const loadPublicTiers = async (
  payload: Payload,
  currency: Currency,
): Promise<readonly TierView[]> => {
  const now = new Date().toISOString()

  const [plans, prices] = await Promise.all([
    payload.find({
      collection: 'plans',
      depth: 0,
      limit: 20,
      pagination: false,
      // See the header: the collection is admin-only on read by design.
      overrideAccess: true,
      sort: 'sortOrder',
      where: { active: { equals: true } },
    }),
    payload.find({
      collection: 'prices',
      depth: 0,
      limit: 100,
      pagination: false,
      overrideAccess: true,
      where: {
        active: { equals: true },
        currency: { equals: currency },
        // A price that comes into force next month must not be advertised as
        // today's price.
        validFrom: { less_than_equal: now },
      },
    }),
  ])

  const byPlan = new Map<number, Price[]>()

  for (const price of prices.docs as Price[]) {
    const planId = planIdOf(price)

    if (planId === null) continue

    const list = byPlan.get(planId) ?? []
    list.push(price)
    byPlan.set(planId, list)
  }

  return (plans.docs as Plan[]).map((plan) => {
    const planPrices = byPlan.get(plan.id) ?? []

    return {
      code: plan.code as PlanCode,
      name: plan.name,
      description: plan.description ?? null,
      sortOrder: plan.sortOrder,
      features: (plan.features ?? []) as readonly FeatureKey[],
      monthly: pickPrice(planPrices, 'MONTH'),
      yearly: pickPrice(planPrices, 'YEAR'),
    }
  })
}
