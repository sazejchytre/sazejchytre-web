/**
 * Compare our subscriptions with the provider's and report the differences.
 *
 *   pnpm reconcile:subscriptions
 *
 * ──────────────────────────────────────────────────────────────────────────
 * IT REPORTS. IT DOES NOT FIX.
 *
 * That is a deliberate constraint, not an unfinished feature. A script that
 * silently reconciled would be the second system writing subscription status,
 * racing the webhook handler and bypassing the ordering rules that make
 * out-of-order events safe. Worse, it would hide the thing worth knowing:
 * divergence means an event was lost, mishandled or arrived in an order we
 * did not survive, and auto-healing the symptom removes the only evidence of
 * the cause.
 *
 * So it prints a diff and exits non-zero. Deciding what to do about each
 * difference is a person's job, and usually a small one — the value is in
 * finding out at all.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY IT GOES THROUGH THE PORT
 *
 * It calls `getSubscription` on the billing port rather than Stripe directly,
 * so it works against any adapter and exercises the same translation the
 * webhook handler uses. If the translation is wrong, this script finds it
 * across every live subscription rather than only the ones that happened to
 * send an event.
 */
/* eslint-disable no-console -- this is a CLI; stdout is its interface. */
import { getPayload } from 'payload'
import config from '@payload-config'

import { getBillingPort } from '../lib/billing/registry.ts'
import { describeProviderError } from '../lib/billing/redact.ts'
import type { SubscriptionStatus } from '../lib/billing/constants.ts'

/** Minutes of clock slack when comparing period boundaries. */
const PERIOD_TOLERANCE_MS = 60_000

type Divergence = {
  subscriptionId: string
  providerSubscriptionId: string
  field: string
  ours: string
  theirs: string
}

const divergences: Divergence[] = []
const errors: { providerSubscriptionId: string; detail: string }[] = []

const sameInstant = (ours: unknown, theirs: Date | null): boolean => {
  if (!ours && !theirs) return true
  if (!ours || !theirs) return false

  const oursTime = new Date(ours as string).getTime()

  if (Number.isNaN(oursTime)) return false

  return Math.abs(oursTime - theirs.getTime()) <= PERIOD_TOLERANCE_MS
}

const show = (value: unknown): string => {
  if (value === null || value === undefined) return '(none)'
  if (value instanceof Date) return value.toISOString()

  return String(value)
}

console.log('')
console.log('Subscription reconciliation (report only)')
console.log('')

const payload = await getPayload({ config })
const port = await getBillingPort()

const subscriptions = await payload.find({
  collection: 'subscriptions',
  depth: 0,
  limit: 0,
  pagination: false,
  overrideAccess: true,
  where: { provider: { equals: port.provider } },
})

console.log(`  ${String(subscriptions.docs.length)} subscription(s) to check`)
console.log('')

for (const row of subscriptions.docs) {
  const providerSubscriptionId = row.providerSubscriptionId as string
  const subscriptionId = String(row.id)

  if (!providerSubscriptionId) {
    errors.push({
      providerSubscriptionId: `(row ${subscriptionId})`,
      detail: 'row has no providerSubscriptionId',
    })
    continue
  }

  let theirs
  try {
    const result = await port.getSubscription({ providerSubscriptionId })

    if (!result.ok) {
      // A failure value, not a crash: the provider answered, it just could
      // not give us this subscription. SUBSCRIPTION_NOT_FOUND is itself a
      // divergence worth reporting — it usually means a test-mode id in a
      // live database or a subscription deleted out from under us.
      errors.push({
        providerSubscriptionId,
        detail: `${result.code}: ${result.message}`,
      })
      continue
    }

    theirs = result.value
  } catch (error) {
    // Thrown means unreachable or misconfigured. Stop rather than report
    // every remaining subscription as broken.
    console.error('')
    console.error(
      'Aborting: the provider could not be reached.',
      JSON.stringify(describeProviderError(error)),
    )
    process.exit(2)
  }

  const record = (field: string, ours: unknown, mine: unknown): void => {
    divergences.push({
      subscriptionId,
      providerSubscriptionId,
      field,
      ours: show(ours),
      theirs: show(mine),
    })
  }

  if ((row.status as SubscriptionStatus) !== theirs.status) {
    record('status', row.status, theirs.status)
  }

  if (row.currency !== theirs.currency) {
    // The one divergence that is never safe to accept: our row is locked to a
    // currency and every invoice under it has been issued in that currency.
    record('currency', row.currency, theirs.currency)
  }

  if (row.interval !== theirs.interval) {
    record('interval', row.interval, theirs.interval)
  }

  if ((row.priceMinor as number) !== theirs.priceMinor) {
    record('priceMinor', row.priceMinor, theirs.priceMinor)
  }

  if (!sameInstant(row.currentPeriodEnd, theirs.currentPeriodEnd)) {
    // The field that decides access. A divergence here means somebody is
    // being served, or denied, on the wrong date.
    record('currentPeriodEnd', row.currentPeriodEnd, theirs.currentPeriodEnd)
  }

  if (!sameInstant(row.currentPeriodStart, theirs.currentPeriodStart)) {
    record(
      'currentPeriodStart',
      row.currentPeriodStart,
      theirs.currentPeriodStart,
    )
  }

  if ((row.cancelAtPeriodEnd ?? false) !== theirs.cancelAtPeriodEnd) {
    record('cancelAtPeriodEnd', row.cancelAtPeriodEnd, theirs.cancelAtPeriodEnd)
  }

  if (!sameInstant(row.endedAt, theirs.endedAt)) {
    record('endedAt', row.endedAt, theirs.endedAt)
  }
}

/* --- Report --------------------------------------------------------------- */

if (divergences.length === 0 && errors.length === 0) {
  console.log('  No divergence. Our records and the provider agree.')
  console.log('')
  process.exit(0)
}

if (divergences.length > 0) {
  console.log(`  ${String(divergences.length)} divergence(s):`)
  console.log('')

  for (const item of divergences) {
    console.log(
      `    ${item.providerSubscriptionId} (row ${item.subscriptionId})  ${item.field}`,
    )
    console.log(`      ours:   ${item.ours}`)
    console.log(`      theirs: ${item.theirs}`)
  }

  console.log('')
}

if (errors.length > 0) {
  console.log(`  ${String(errors.length)} subscription(s) could not be read:`)
  console.log('')

  for (const item of errors) {
    console.log(`    ${item.providerSubscriptionId}  ${item.detail}`)
  }

  console.log('')
}

console.log(
  '  Nothing was changed. Each difference above is a decision for a person: ' +
    'a lost webhook usually wants the event replaying from the Stripe ' +
    'dashboard, while a currency or price difference wants investigating ' +
    'before anything is touched.',
)
console.log('')

process.exit(1)
