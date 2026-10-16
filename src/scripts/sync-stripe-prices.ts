/**
 * Reconcile our Plan and Price rows into Stripe.
 *
 *   pnpm sync:prices            # report what would change, touch nothing
 *   pnpm sync:prices:apply      # apply it
 *
 * ──────────────────────────────────────────────────────────────────────────
 * OUR DATABASE IS THE SOURCE OF TRUTH
 *
 * Prices are defined in `Plans` and `Prices` and pushed outwards. The
 * alternative — defining them in the Stripe dashboard and importing — means
 * the amount a customer is charged lives in a web form with no history, no
 * review and no migration, and that a dashboard typo is a production pricing
 * change. This direction also means a second provider gets the same prices
 * from the same rows.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY RE-RUNNING IS SAFE
 *
 * Three mechanisms, because this script will be run repeatedly and by hand:
 *
 *   1. A deterministic `lookup_key` per Price row. Stripe enforces that it is
 *      unique among active prices, so a second run finds the existing price
 *      instead of making another one — even if `providerPriceId` was never
 *      written back because the first run died between the API call and the
 *      database write.
 *   2. An idempotency key on every create, which covers a retry inside
 *      Stripe's 24-hour window.
 *   3. Reading before writing. Nothing is created if a matching price exists.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY AN AMOUNT CHANGE IS REFUSED, NOT PERFORMED
 *
 * A Stripe price is immutable in amount by design; changing what customers
 * pay means creating a new price and moving subscriptions to it. That is a
 * business decision with customer communication attached — in the EU,
 * changing a recurring charge without notice is not merely rude — so this
 * script will not do it implicitly. If a price already has subscriptions
 * attached, it reports the divergence and stops. Creating the new price and
 * migrating people is a separate, deliberate act.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE LIVE-KEY GUARD
 *
 * With a live key this script refuses to run unless `CONFIRM_LIVE=1` is set.
 * It writes pricing; the blast radius of running it against production by
 * accident with a half-finished local Prices table is every customer's next
 * invoice.
 *
 * `payload run` swallows extra argv flags, so the switches are environment
 * variables rather than `--flags` — the same reason `SEED_PURGE` works that
 * way in the tips seed script.
 */
/* eslint-disable no-console -- this is a CLI; stdout is its interface. */
import { getPayload } from 'payload'
import config from '@payload-config'

import { isLiveStripeKey } from '../lib/billing/stripe/client.ts'
import { getStripeClient } from '../lib/billing/stripe/client.ts'
import { env } from '../lib/env.ts'
import { describeProviderError } from '../lib/billing/redact.ts'
import type { BillingInterval, Currency } from '../lib/billing/constants.ts'

/* -------------------------------------------------------------------------- */
/* Switches                                                                   */
/* -------------------------------------------------------------------------- */

/** Default is a dry run: say what would change, change nothing. */
const APPLY = process.env.APPLY === '1'
/** Required to touch live mode at all. */
const CONFIRM_LIVE = process.env.CONFIRM_LIVE === '1'

/* -------------------------------------------------------------------------- */
/* Naming                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The deterministic key that makes this idempotent.
 *
 * Derived from our own row id, so it is stable across runs and across a lost
 * `providerPriceId`. Prefixed because the key namespace is shared with
 * anything else in the Stripe account.
 */
const lookupKeyFor = (priceId: number | string): string =>
  `sazejchytre_price_${String(priceId)}`

const STRIPE_INTERVAL: Readonly<Record<BillingInterval, 'month' | 'year'>> = {
  MONTH: 'month',
  YEAR: 'year',
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

type Action =
  | 'product.created'
  | 'product.would_create'
  | 'product.updated'
  | 'product.unchanged'
  | 'price.created'
  | 'price.adopted'
  | 'price.unchanged'
  | 'price.refused_amount_change'
  | 'price.would_create'
  | 'price.would_adopt'
  | 'price.archived'
  | 'error'

type Row = { what: string; action: Action; detail: string }

const rows: Row[] = []
const note = (what: string, action: Action, detail: string): void => {
  rows.push({ what, action, detail })
  console.log(`  ${action.padEnd(30)} ${what}  ${detail}`)
}

/* -------------------------------------------------------------------------- */
/* Main                                                                       */
/* -------------------------------------------------------------------------- */

const live = isLiveStripeKey(env.STRIPE_SECRET_KEY)

console.log('')
console.log('Stripe product and price reconciliation')
console.log(`  mode:    ${APPLY ? 'APPLY' : 'DRY RUN (set APPLY=1 to write)'}`)
console.log(`  account: ${live ? 'LIVE' : 'test'}`)
console.log('')

if (live && !CONFIRM_LIVE) {
  // Fails closed, and says exactly what to do rather than making the operator
  // guess at a flag name.
  console.error(
    'REFUSING TO RUN: STRIPE_SECRET_KEY is a live key.\n\n' +
      'This script writes pricing. Against live keys that means every ' +
      "customer's next invoice.\n\n" +
      'If that is genuinely what you want:\n' +
      '  CONFIRM_LIVE=1 pnpm sync:prices        # dry run against live\n' +
      '  CONFIRM_LIVE=1 APPLY=1 pnpm sync:prices\n',
  )
  process.exit(1)
}

if (live && APPLY) {
  console.log('*** APPLYING CHANGES TO LIVE STRIPE DATA ***')
  console.log('')
}

const payload = await getPayload({ config })
const stripe = getStripeClient()

/* --- 1. Plans become Stripe products ------------------------------------- */

const plans = await payload.find({
  collection: 'plans',
  depth: 0,
  limit: 0,
  pagination: false,
  overrideAccess: true,
})

const productIdByPlan = new Map<string, string>()
/**
 * Plans whose product does not exist yet, during a dry run.
 *
 * Without this the dry run is useless: no product is created, so every price
 * under it reports "no Stripe product" and the preview shows six errors that
 * are not errors. A preview that cries wolf is a preview nobody reads, and the
 * non-zero exit would also make a scheduled dry run look broken.
 */
const plansAwaitingProduct = new Set<string>()

for (const plan of plans.docs) {
  const planKey = String(plan.id)
  const what = `plan ${plan.code}`

  try {
    if (plan.providerProductId) {
      const existing = await stripe.products.retrieve(plan.providerProductId)

      productIdByPlan.set(planKey, existing.id)

      if (existing.name !== plan.name || existing.active !== plan.active) {
        if (APPLY) {
          await stripe.products.update(existing.id, {
            name: plan.name,
            active: plan.active ?? true,
          })
        }

        note(what, 'product.updated', `${existing.id} name/active synced`)
      } else {
        note(what, 'product.unchanged', existing.id)
      }

      continue
    }

    if (!APPLY) {
      plansAwaitingProduct.add(planKey)
      note(what, 'product.would_create', plan.name)
      continue
    }

    const created = await stripe.products.create(
      {
        name: plan.name,
        active: plan.active ?? true,
        metadata: {
          sazejchytrePlanCode: plan.code,
          sazejchytrePlanId: planKey,
        },
      },
      // Covers a retry that lands after the create succeeded but before the
      // write-back below.
      { idempotencyKey: `sync-product:${planKey}` },
    )

    productIdByPlan.set(planKey, created.id)

    await payload.update({
      collection: 'plans',
      id: plan.id,
      overrideAccess: true,
      data: { providerProductId: created.id },
    })

    note(what, 'product.created', created.id)
  } catch (error) {
    note(what, 'error', JSON.stringify(describeProviderError(error)))
  }
}

/* --- 2. Prices ------------------------------------------------------------ */

const prices = await payload.find({
  collection: 'prices',
  depth: 0,
  limit: 0,
  pagination: false,
  overrideAccess: true,
})

let refusals = 0
let errors = 0

for (const price of prices.docs) {
  const planKey = String(
    typeof price.plan === 'object' && price.plan !== null
      ? (price.plan as { id: unknown }).id
      : price.plan,
  )
  const productId = productIdByPlan.get(planKey)
  const lookupKey = lookupKeyFor(price.id)
  const what = `price ${lookupKey}`
  const amountMinor = price.amountMinor as number
  const currency = (price.currency as Currency).toLowerCase()
  const interval = STRIPE_INTERVAL[price.interval as BillingInterval]

  if (!productId) {
    if (plansAwaitingProduct.has(planKey)) {
      // Not an error: the product above would be created first, and this
      // price with it. Reported so the preview shows the whole plan.
      note(
        what,
        'price.would_create',
        `${String(amountMinor)} ${currency} / ${interval} (with its new product)`,
      )
      continue
    }

    note(what, 'error', `no Stripe product for plan ${planKey}`)
    errors += 1
    continue
  }

  try {
    /* --- Does a Stripe price already exist for this row? ---------------- */

    // `providerPriceId` first, then the lookup key. The second lookup is what
    // makes a run that died halfway through recoverable: the price exists in
    // Stripe but we never recorded it, and without this we would create a
    // duplicate every single run.
    let existing = null

    if (price.providerPriceId) {
      existing = await stripe.prices.retrieve(price.providerPriceId)
    } else {
      const found = await stripe.prices.list({
        lookup_keys: [lookupKey],
        limit: 1,
      })

      existing = found.data[0] ?? null
    }

    /* --- Nothing there: create it --------------------------------------- */

    if (!existing) {
      if (!APPLY) {
        note(
          what,
          'price.would_create',
          `${String(amountMinor)} ${currency} / ${interval}`,
        )
        continue
      }

      const created = await stripe.prices.create(
        {
          product: productId,
          // Our integer minor units, passed through unconverted. Stripe uses
          // minor units too, so any arithmetic here would be a bug.
          unit_amount: amountMinor,
          currency,
          recurring: { interval, interval_count: 1 },
          lookup_key: lookupKey,
          active: price.active ?? true,
          metadata: { sazejchytrePriceId: String(price.id) },
        },
        {
          idempotencyKey: `sync-price:${String(price.id)}:${String(amountMinor)}`,
        },
      )

      await payload.update({
        collection: 'prices',
        id: price.id,
        overrideAccess: true,
        data: { providerPriceId: created.id },
      })

      note(what, 'price.created', created.id)
      continue
    }

    /* --- It exists: does it agree with us? ------------------------------ */

    const agrees =
      existing.unit_amount === amountMinor &&
      existing.currency === currency &&
      existing.recurring?.interval === interval &&
      existing.recurring?.interval_count === 1

    if (agrees) {
      if (!price.providerPriceId) {
        // Adopt it: the price was created by an earlier run that never got to
        // write the id back.
        if (APPLY) {
          await payload.update({
            collection: 'prices',
            id: price.id,
            overrideAccess: true,
            data: { providerPriceId: existing.id },
          })
        }

        note(what, APPLY ? 'price.adopted' : 'price.would_adopt', existing.id)
      } else {
        note(what, 'price.unchanged', existing.id)
      }

      continue
    }

    /* --- It disagrees: is anybody paying it? ---------------------------- */

    // Asked of Stripe rather than of our own tables, because Stripe is
    // authoritative about what is attached to a Stripe price, and because a
    // subscription created outside this application would be invisible to us.
    const attached = await stripe.subscriptions.list({
      price: existing.id,
      status: 'all',
      limit: 1,
    })

    if (attached.data.length > 0) {
      refusals += 1

      note(
        what,
        'price.refused_amount_change',
        `Stripe has ${existing.unit_amount ?? '?'} ${existing.currency}, ` +
          `we have ${String(amountMinor)} ${currency}, and subscriptions are ` +
          `attached (e.g. ${attached.data[0]?.id ?? '?'}). ` +
          'Create a new Price row and migrate deliberately.',
      )

      continue
    }

    // Nothing attached, so the old price is safe to retire. A Stripe price's
    // amount cannot be edited, so this is a create-and-archive, not an update.
    if (!APPLY) {
      note(
        what,
        'price.would_create',
        `replacing ${existing.id} (${existing.unit_amount ?? '?'} -> ${String(amountMinor)}), nothing attached`,
      )
      continue
    }

    // Free the lookup key first: Stripe allows only one active price per key.
    await stripe.prices.update(existing.id, {
      active: false,
      lookup_key: `${lookupKey}_archived_${String(Date.now())}`,
    })

    const replacement = await stripe.prices.create(
      {
        product: productId,
        unit_amount: amountMinor,
        currency,
        recurring: { interval, interval_count: 1 },
        lookup_key: lookupKey,
        active: price.active ?? true,
        metadata: { sazejchytrePriceId: String(price.id) },
      },
      {
        idempotencyKey: `sync-price:${String(price.id)}:${String(amountMinor)}`,
      },
    )

    await payload.update({
      collection: 'prices',
      id: price.id,
      overrideAccess: true,
      data: { providerPriceId: replacement.id },
    })

    note(what, 'price.archived', existing.id)
    note(what, 'price.created', replacement.id)
  } catch (error) {
    errors += 1
    note(what, 'error', JSON.stringify(describeProviderError(error)))
  }
}

/* --- Summary -------------------------------------------------------------- */

console.log('')
console.log(
  `  ${String(rows.length)} actions, ${String(refusals)} refused, ${String(errors)} errors`,
)

if (!APPLY) {
  console.log('  DRY RUN — nothing was written. Set APPLY=1 to apply.')
}

console.log('')

// Non-zero on a refusal or an error so a scheduled run is noisy rather than
// quietly out of sync.
if (refusals > 0 || errors > 0) {
  process.exit(1)
}
