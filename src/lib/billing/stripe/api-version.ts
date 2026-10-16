/**
 * Reasoning about which Stripe API version a payload was rendered at.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THERE ARE TWO VERSIONS, AND THEY ARE ALLOWED TO DISAGREE
 *
 * This is the thing that is easy to get wrong, so it is written down here
 * rather than left to be rediscovered:
 *
 *   - OUTBOUND calls use the version pinned in `client.ts`. That is ours, it
 *     lives in code, and nothing else can change it.
 *   - INBOUND webhook payloads are rendered at the version of the webhook
 *     ENDPOINT, or, if the endpoint does not pin one, at the ACCOUNT's
 *     default version. Neither of those is in this repository, and both can
 *     be changed by somebody in a dashboard.
 *
 * So the shape we send is not necessarily the shape we receive. Every event
 * carries `api_version`, and that — not our pin — is what says how to read
 * its payload.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THAT MATTERS CONCRETELY
 *
 * In `2025-03-31.basil`, `current_period_start` and `current_period_end`
 * moved off the Subscription object and onto each subscription item. A
 * payload rendered BEFORE that version has them in the old place, so code
 * reading the new place gets `undefined` — not an error, just a subscription
 * whose period is unknown. Stored, that is a row which grants access until
 * never, or forever, depending on which way the comparison falls.
 *
 * `isPreRelocationVersion` is what lets a refusal say "this payload is older
 * than the field move" instead of "could not translate", which is the
 * difference between a one-line diagnosis and an afternoon.
 */

/**
 * The version in which subscription periods moved onto items.
 *
 * Also the version that moved `invoice.subscription` to
 * `invoice.parent.subscription_details.subscription` and replaced
 * `invoice.payment_intent` with the `invoice.payments` list.
 */
export const FIELD_RELOCATION_VERSION = '2025-03-31.basil'

/**
 * The date part of a Stripe version string, or null if it is not one.
 *
 * Stripe versions are `YYYY-MM-DD.codename`. The date prefix is fixed-width,
 * so comparing the prefixes as strings orders them correctly — no parsing
 * required, and no dependency on the codenames, which are not ordered.
 */
export const apiVersionDate = (apiVersion: string | null | undefined) => {
  if (typeof apiVersion !== 'string') return null

  const match = /^(\d{4}-\d{2}-\d{2})(?:\.|$)/.exec(apiVersion)

  return match?.[1] ?? null
}

/**
 * Compare two Stripe API versions.
 *
 * Returns a negative number when `a` is older, zero when they are the same
 * day, and a positive number when `a` is newer. Returns null when either is
 * unparseable, because guessing an order would be worse than admitting we
 * cannot tell.
 */
export const compareApiVersions = (
  a: string | null | undefined,
  b: string | null | undefined,
): number | null => {
  const left = apiVersionDate(a)
  const right = apiVersionDate(b)

  if (!left || !right) return null

  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Is this payload older than the version that moved the period fields?
 *
 * True means the payload cannot be read by the current translation code and
 * no amount of retrying will change that. Null-safe: an absent or
 * unparseable version returns false, because an unknown version is not
 * evidence of an old one.
 */
export const isPreRelocationVersion = (
  apiVersion: string | null | undefined,
): boolean => {
  const comparison = compareApiVersions(apiVersion, FIELD_RELOCATION_VERSION)

  return comparison !== null && comparison < 0
}
