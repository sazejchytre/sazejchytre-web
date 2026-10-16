/**
 * Deciding whether a provider event is new enough to act on.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WEBHOOKS ARRIVE OUT OF ORDER. THIS IS NOT AN EDGE CASE.
 *
 * Stripe makes no ordering guarantee, and the ways order gets lost are
 * ordinary rather than exotic:
 *
 *   - two events are generated in the same second and delivered on different
 *     connections;
 *   - the first delivery fails and is retried minutes later, by which time
 *     the next event has already been processed;
 *   - our own handler runs concurrently in two serverless instances.
 *
 * The damage from ignoring this is specific and bad. A `subscription.updated`
 * carrying `past_due`, retried after the recovery event, would move a paying
 * customer back to PAST_DUE. A stale `canceled` event would cut off somebody
 * who has already resubscribed. Both look like data corruption with no
 * obvious cause, and both are silent.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE RULE
 *
 * Every subscription row carries `providerSequence`: the provider-side
 * millisecond at which its current contents were true. An event says when it
 * was created. Older than what we hold → record the event, change nothing.
 *
 * Two guards, not one, because the timestamp alone is not quite enough:
 *
 *   1. SEQUENCE. Strictly older events are refused.
 *   2. TERMINAL STATE. Stripe never revives a `canceled` or
 *      `incomplete_expired` subscription, so an event that would move one of
 *      ours out of CANCELED or EXPIRED is wrong whatever its timestamp says.
 *      This catches the same-second tie that guard 1 cannot: cancellation and
 *      a last `updated` often share a second, and resolving that tie by
 *      arrival order is a coin flip over whether a customer keeps access.
 *
 * Refusing to apply is NOT refusing to acknowledge. The event is still
 * claimed, still written to `SubscriptionEvents`, and still answered 200 —
 * the audit trail should show what the provider said, including the parts we
 * decided were stale.
 */
import type { SubscriptionStatus } from './constants.ts'

/**
 * Statuses the provider cannot come back from.
 *
 * Our EXPIRED and CANCELED both correspond to terminal Stripe states. A
 * subscription that becomes active again does so under a NEW provider
 * subscription id, which is a different row.
 */
export const TERMINAL_STATUSES: readonly SubscriptionStatus[] = [
  'CANCELED',
  'EXPIRED',
]

export const isTerminalStatus = (status: SubscriptionStatus): boolean =>
  TERMINAL_STATUSES.includes(status)

/** What we currently hold. */
export type StoredSubscriptionState = {
  status: SubscriptionStatus
  /**
   * Provider-side milliseconds for the contents above.
   *
   * Null for a row written before this field existed, or one created by us
   * rather than from an event. Treated as "no opinion", so the first event
   * wins — the alternative is a row nothing can ever update.
   */
  providerSequence: number | null
}

/** What an event is telling us. */
export type IncomingSubscriptionState = {
  status: SubscriptionStatus
  /** Provider-side milliseconds, from the event's creation time. */
  sequence: number
}

export type OrderingDecision =
  | { apply: true }
  | {
      apply: false
      reason: 'STALE_SEQUENCE' | 'TERMINAL_STATE'
      /** Safe to log; carries no customer or payment data. */
      detail: string
    }

/**
 * Should this event's view of a subscription be written?
 *
 * Pure, so the rule can be tested exhaustively without a database, a provider
 * or a clock — which matters, because every branch here is a decision about
 * whether a real customer keeps access.
 */
export const decideSubscriptionWrite = (
  stored: StoredSubscriptionState,
  incoming: IncomingSubscriptionState,
): OrderingDecision => {
  // Guard 2 first: it is the stronger claim, and it holds even when the
  // incoming event is genuinely newer. Stripe does not un-cancel.
  if (isTerminalStatus(stored.status) && !isTerminalStatus(incoming.status)) {
    return {
      apply: false,
      reason: 'TERMINAL_STATE',
      detail: `refusing ${stored.status} -> ${incoming.status}`,
    }
  }

  if (stored.providerSequence === null) {
    return { apply: true }
  }

  if (incoming.sequence < stored.providerSequence) {
    return {
      apply: false,
      reason: 'STALE_SEQUENCE',
      detail: `event at ${incoming.sequence} is older than stored ${stored.providerSequence}`,
    }
  }

  // Equal sequences fall through to apply. Two events in the same provider
  // millisecond are indistinguishable here, and the terminal guard above has
  // already caught the one tie whose outcome actually matters.
  return { apply: true }
}

/**
 * Stripe's event creation time as our sequence value.
 *
 * Stripe reports `created` in whole seconds. Multiplying to milliseconds
 * keeps the unit consistent with a fresh adapter read, which uses wall-clock
 * milliseconds — mixing the two units would make every event look either
 * ancient or impossibly new.
 *
 * The cost is that all events within one second tie. That is a property of
 * Stripe's own data, not of this conversion, and the terminal guard is there
 * precisely because no arithmetic can recover an ordering the provider never
 * recorded.
 */
export const sequenceFromEventCreated = (createdSeconds: number): number =>
  Math.round(createdSeconds * 1000)
