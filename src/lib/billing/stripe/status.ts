/**
 * Stripe's subscription statuses, translated into ours.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY A TABLE AND NOT A PASS-THROUGH
 *
 * The cheap thing to do is store Stripe's string in our status column. It is
 * also the thing that makes the provider impossible to leave: every query,
 * every access check and every admin filter would then be written against
 * Stripe's vocabulary, and a second provider with different strings would
 * mean touching all of them. Worse, Stripe can add a status — it has, twice —
 * and a pass-through turns that into unknown values sitting in a column that
 * our access checks silently fail to match.
 *
 * So there is exactly one place where a provider status becomes one of ours,
 * and it is this table.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE MAPPING
 *
 * | Stripe               | Ours       | Grants access?        | Why
 * |----------------------|------------|-----------------------|----------------------------------------------------
 * | `incomplete`         | INCOMPLETE | no                    | The first payment has never succeeded. Nothing was
 * |                      |            |                       | paid for, so nothing is owed.
 * | `incomplete_expired` | EXPIRED    | no                    | As above, and the window to complete it has closed.
 * |                      |            |                       | Distinct from CANCELED: nobody cancelled anything,
 * |                      |            |                       | it simply never started.
 * | `trialing`           | ACTIVE     | yes                   | A trial is access we promised. That no money has
 * |                      |            |                       | moved yet does not make it less promised.
 * | `active`             | ACTIVE     | yes                   | Paid and current.
 * | `past_due`           | PAST_DUE   | yes, to periodEnd     | A renewal failed. The period they already paid for
 * |                      |            |                       | is still theirs; cutting access the instant a card
 * |                      |            |                       | expires punishes the customer for their bank.
 * | `unpaid`             | PAST_DUE   | yes, to periodEnd     | Stripe has given up retrying. Same reasoning, and
 * |                      |            |                       | by this point periodEnd is usually already past, so
 * |                      |            |                       | the resolver denies without needing a sixth status.
 * | `paused`             | PAST_DUE   | yes, to periodEnd     | We never pause a subscription, so this only appears
 * |                      |            |                       | from a dashboard action. Dunning semantics are the
 * |                      |            |                       | conservative read in both directions: the paid
 * |                      |            |                       | period is honoured, and nothing is granted past it.
 * |                      |            |                       | Logged as unexpected, because it is.
 * | `canceled`           | CANCELED   | no                    | Over. Whether at period end or immediately is a
 * |                      |            |                       | question about dates, not about status.
 * | anything else        | INCOMPLETE | no                    | Fail closed. A status Stripe invents after this was
 * |                      |            |                       | written must not be guessed into granting access.
 *
 * PAST_DUE granting access until `currentPeriodEnd` is not a property of this
 * table — it is what `resolveEntitlements` does with the status. The two are
 * verified against each other in `status.test.ts`, because a disagreement
 * between them is either a customer locked out of a period they paid for or a
 * customer getting a month free, and neither shows up in a type check.
 */
import type { SubscriptionStatus } from '../constants.ts'

/** Every subscription status Stripe documents, as of API `2026-09-30.endive`. */
export const STRIPE_SUBSCRIPTION_STATUSES = [
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'unpaid',
  'paused',
  'canceled',
] as const

export type StripeSubscriptionStatus =
  (typeof STRIPE_SUBSCRIPTION_STATUSES)[number]

/**
 * The table above, executable.
 *
 * Typed as a total record over the statuses we know, so adding one to
 * `STRIPE_SUBSCRIPTION_STATUSES` without deciding what it means is a compile
 * error rather than a silent fall-through to the default.
 */
export const STRIPE_STATUS_MAP: Readonly<
  Record<StripeSubscriptionStatus, SubscriptionStatus>
> = {
  incomplete: 'INCOMPLETE',
  incomplete_expired: 'EXPIRED',
  trialing: 'ACTIVE',
  active: 'ACTIVE',
  past_due: 'PAST_DUE',
  unpaid: 'PAST_DUE',
  paused: 'PAST_DUE',
  canceled: 'CANCELED',
}

/**
 * Statuses that are valid but that we never ask Stripe for.
 *
 * Seeing one means somebody acted in the dashboard, or Stripe changed a
 * default. Either is worth a log line; neither is worth failing a webhook.
 */
export const UNEXPECTED_STRIPE_STATUSES: readonly StripeSubscriptionStatus[] = [
  'paused',
]

export type StatusMappingResult = {
  status: SubscriptionStatus
  /** True when the provider sent something this table does not list. */
  unknown: boolean
  /** True for a known status we do not drive ourselves. */
  unexpected: boolean
}

/**
 * Translate a Stripe subscription status.
 *
 * Never throws. A webhook handler that threw on an unrecognised status would
 * return 500, and Stripe would retry that event every few hours for days
 * while the real problem — one unmapped string — sat unnoticed. Failing
 * closed to INCOMPLETE and flagging it is the behaviour that gets noticed
 * without breaking the endpoint.
 */
export const mapStripeSubscriptionStatus = (
  providerStatus: string,
): StatusMappingResult => {
  const known = (STRIPE_SUBSCRIPTION_STATUSES as readonly string[]).includes(
    providerStatus,
  )

  if (!known) {
    return { status: 'INCOMPLETE', unknown: true, unexpected: true }
  }

  const status = providerStatus as StripeSubscriptionStatus

  return {
    status: STRIPE_STATUS_MAP[status],
    unknown: false,
    unexpected: UNEXPECTED_STRIPE_STATUSES.includes(status),
  }
}
