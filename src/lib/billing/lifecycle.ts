/**
 * Subscription lifecycle policy.
 *
 * The rules about when a change takes effect and who is allowed to make it,
 * kept pure and in one file so they can be tested exhaustively and so that no
 * caller gets to decide them for itself. The adapter knows how to execute a
 * plan change; this knows which plan change is permitted and when.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE RULES, AND THE REASONING
 *
 * UPGRADE — immediately, with proration.
 *   Someone who just paid more expects the better plan now. Deferring it to
 *   the next period means taking money for something they cannot use yet,
 *   which generates a support ticket at best and a chargeback at worst.
 *
 * DOWNGRADE — at the end of the paid period.
 *   They have already paid for the dearer plan through to `currentPeriodEnd`.
 *   Switching now and refunding the difference is worse for them (less than
 *   they paid for) and worse for us (a partial refund, a credit note and an
 *   invoice correction for a change nobody asked to be immediate).
 *
 * CANCELLATION — at the end of the paid period, by default.
 *   Same reasoning. The customer keeps what they paid for; we keep the
 *   revenue; nobody has to compute a pro-rata refund.
 *
 * IMMEDIATE CANCELLATION — exists, ADMIN ONLY.
 *   It forfeits a period the customer has paid for, so it is a decision
 *   someone has to take responsibility for: closing a fraudulent account,
 *   honouring a legal request, resolving a complaint by agreement. Exposing
 *   it on a self-service account page would mean a customer could destroy
 *   three weeks of their own paid access with one misread button, and the
 *   refund conversation that follows is ours to lose.
 */
import { PLAN_CODES, type BillingInterval, type PlanCode } from './constants.ts'
import {
  type BillingFailure,
  type BillingResult,
  billingFail,
  billingOk,
} from './port.ts'

/* -------------------------------------------------------------------------- */
/* Plan ranking                                                               */
/* -------------------------------------------------------------------------- */

/**
 * How plans rank against each other.
 *
 * Derived from `PLAN_CODES`, which is declared cheapest-first, so adding a
 * tier in the right position needs no change here. Rank is about what the
 * plan contains, NOT about price: a yearly START costs more than a monthly
 * PRO but moving from PRO to START is still a downgrade, and classifying it
 * by amount would hand the customer a better plan for less money.
 */
export const PLAN_RANK: Readonly<Record<PlanCode, number>> = Object.freeze(
  Object.fromEntries(PLAN_CODES.map((code, index) => [code, index])) as Record<
    PlanCode,
    number
  >,
)

export type PlanChangeDirection = 'UPGRADE' | 'DOWNGRADE' | 'UNCHANGED'

export type PlanChangeRequest = {
  fromPlan: PlanCode
  toPlan: PlanCode
  fromInterval: BillingInterval
  toInterval: BillingInterval
}

/**
 * Which direction a plan change goes.
 *
 * Plan rank decides first. When the plan is the same, the interval decides:
 * monthly → yearly is an upgrade (more commitment, charged now, usually
 * discounted) and yearly → monthly is a downgrade, which must wait until the
 * year they paid for is over.
 */
export const classifyPlanChange = ({
  fromPlan,
  toPlan,
  fromInterval,
  toInterval,
}: PlanChangeRequest): PlanChangeDirection => {
  const fromRank = PLAN_RANK[fromPlan]
  const toRank = PLAN_RANK[toPlan]

  if (toRank > fromRank) return 'UPGRADE'
  if (toRank < fromRank) return 'DOWNGRADE'

  if (fromInterval === toInterval) return 'UNCHANGED'

  return toInterval === 'YEAR' ? 'UPGRADE' : 'DOWNGRADE'
}

/** When a change in this direction takes effect. */
export const effectOfPlanChange = (
  direction: Exclude<PlanChangeDirection, 'UNCHANGED'>,
): 'IMMEDIATE' | 'AT_PERIOD_END' =>
  direction === 'UPGRADE' ? 'IMMEDIATE' : 'AT_PERIOD_END'

/* -------------------------------------------------------------------------- */
/* Cancellation                                                               */
/* -------------------------------------------------------------------------- */

export type CancellationMode = 'AT_PERIOD_END' | 'IMMEDIATE'

/** The default, and the only mode a customer may choose for themselves. */
export const DEFAULT_CANCELLATION_MODE: CancellationMode = 'AT_PERIOD_END'

/**
 * Who is asking.
 *
 * An explicit value rather than "is there a session": a server action and a
 * webhook and a script all reach this code, and "no session" means something
 * different in each. Making the caller state it means a new call site has to
 * think about it instead of inheriting whatever the ambient request happened
 * to be.
 */
export type BillingActor =
  | { kind: 'ADMIN'; adminUserId: string | number }
  | { kind: 'CUSTOMER'; customerId: string | number }
  /** A scheduled job or a webhook. No human decided this. */
  | { kind: 'SYSTEM' }

/**
 * May this actor cancel this way?
 *
 * Returns a `BillingResult` rather than throwing, so a route can turn it into
 * a 403 with a message. Fails closed: SYSTEM is refused an immediate
 * cancellation too, because a scheduled job destroying paid access is not
 * something to discover afterwards from a log.
 */
export const authorizeCancellation = (
  mode: CancellationMode,
  actor: BillingActor,
): BillingResult<CancellationMode> => {
  if (mode === 'AT_PERIOD_END') {
    return billingOk(mode)
  }

  if (actor.kind !== 'ADMIN') {
    return billingFail(
      'NOT_CANCELABLE',
      'Předplatné lze ukončit k datu konce zaplaceného období. ' +
        'Okamžité ukončení může provést pouze podpora.',
      { providerCode: `immediate_cancel_requires_admin_${actor.kind}` },
    )
  }

  return billingOk(mode)
}

/* -------------------------------------------------------------------------- */
/* Plan change authorisation                                                  */
/* -------------------------------------------------------------------------- */

/**
 * May this actor make this plan change, and when does it land?
 *
 * The direction is computed here rather than taken from the caller so that a
 * mislabelled request cannot smuggle a downgrade through as an immediate
 * change — which would hand somebody a cheaper plan and a prorated credit at
 * the same time.
 */
export const authorizePlanChange = (
  request: PlanChangeRequest,
  actor: BillingActor,
): BillingResult<{
  direction: Exclude<PlanChangeDirection, 'UNCHANGED'>
  effect: 'IMMEDIATE' | 'AT_PERIOD_END'
}> => {
  const direction = classifyPlanChange(request)

  if (direction === 'UNCHANGED') {
    return billingFail('INVALID_REQUEST', 'Tento tarif už máte.', {
      providerCode: 'plan_change_noop',
    })
  }

  if (actor.kind === 'SYSTEM') {
    return billingFail(
      'INVALID_REQUEST',
      'Požadavek se nepodařilo zpracovat.',
      { providerCode: 'plan_change_requires_actor' },
    )
  }

  return billingOk({ direction, effect: effectOfPlanChange(direction) })
}

/**
 * The failure to return when a subscription is in no state to be changed.
 *
 * Shared by the callers so the customer sees the same sentence whichever
 * route they came in by.
 */
export const notChangeableFailure = (): BillingFailure =>
  billingFail(
    'NOT_CANCELABLE',
    'U tohoto předplatného nelze provést změnu. Obraťte se prosím na podporu.',
  )
