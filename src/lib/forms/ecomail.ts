/**
 * Ecomail — the newsletter list. One fetch, no SDK.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE API, AS DOCUMENTED
 *
 *   POST https://api2.ecomailapp.cz/lists/{list_id}/subscribe
 *   key: <API key>            ← the header is literally called `key`
 *   content-type: application/json
 *
 * The response is 200 with the subscriber, and carries
 * `already_subscribed: true` when the address was on the list. A validation
 * failure is 422 with `{ success: false, message, data }`.
 *
 * Note the host: `api2`, not `api`. And Ecomail refuses browser requests
 * outright (no CORS), which is one more reason the call lives in a server
 * action rather than in the form component.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * DOUBLE OPT-IN STAYS ON
 *
 * `skip_confirmation` is left at its default of `false`, so Ecomail sends a
 * confirmation email and the subscriber lands with status 6 (unconfirmed)
 * until they click it.
 *
 * That is not belt-and-braces over the consent checkbox — it does a different
 * job. The checkbox proves the person at the keyboard agreed to the wording;
 * the confirmation click proves the person who OWNS the address did. Anyone
 * can type a stranger's address into a public form, and without double opt-in
 * our list fills with addresses whose owners never asked for anything, which
 * is both a GDPR problem and the fastest route to a poor sending reputation.
 *
 * `resubscribe: true` for the same reason: someone who unsubscribed and has
 * now filled the form in again is asking to come back, and they still have to
 * click the confirmation before anything is sent. Refusing them would make
 * our own success message ("confirmation sent") a lie.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT IS *NOT* SENT
 *
 * No name, no IP, no user agent, no page URL. The form asks for an address
 * and a consent, so an address and a consent is what leaves the building.
 * Custom fields are a standing invitation to quietly export more than was
 * asked for, and `source` is the one that earns its place: it says "web
 * form" so the operator can tell these apart from an imported list.
 */

export const ECOMAIL_BASE_URL = 'https://api2.ecomailapp.cz'

const REQUEST_TIMEOUT_MS = 8_000

/** Tags the subscriber with where they came from. */
export const ECOMAIL_SOURCE = 'sazejchytre.cz / web form'

export type EcomailOutcome =
  /** Accepted. `alreadySubscribed` is Ecomail's own flag, not a guess. */
  | { readonly ok: true; readonly alreadySubscribed: boolean }
  /** Ecomail answered and refused — a 4xx. Retrying will not help. */
  | { readonly ok: false; readonly reason: 'rejected'; readonly detail: string }
  /** Ecomail could not be reached, or answered 5xx. A retry might work. */
  | {
      readonly ok: false
      readonly reason: 'unavailable'
      readonly detail: string
    }

export type SubscribeArgs = {
  email: string
  /** `ECOMAIL_LIST_ID`. A list id, not a name. */
  listId: string
  /** `ECOMAIL_API_KEY`. */
  apiKey: string
  /** Injected for tests. */
  fetchImpl?: typeof fetch
}

type SubscribeResponse = {
  already_subscribed?: unknown
  message?: unknown
}

/**
 * Add an address to the list.
 *
 * Never throws: a newsletter provider having a bad minute must not take down
 * the page the form is on, and the caller needs to tell "they refused it"
 * from "we could not ask" in order to decide what to tell the visitor.
 */
export const subscribeToEcomail = async ({
  email,
  listId,
  apiKey,
  fetchImpl = fetch,
}: SubscribeArgs): Promise<EcomailOutcome> => {
  const url = `${ECOMAIL_BASE_URL}/lists/${encodeURIComponent(listId)}/subscribe`

  let response: Response

  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        // Not `Authorization`. Ecomail's header is `key`.
        key: apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        subscriber_data: {
          email,
          source: ECOMAIL_SOURCE,
        },
        // Let a welcome automation exist, once the address is confirmed.
        trigger_autoresponders: true,
        // A second submission of the same address updates rather than 422s.
        update_existing: true,
        // See the header: safe only because the confirmation email stays on.
        resubscribe: true,
        // Left explicit rather than defaulted, because flipping it to `true`
        // would silently turn double opt-in off.
        skip_confirmation: false,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    return {
      ok: false,
      reason: 'unavailable',
      detail: error instanceof Error ? error.name : 'FetchFailed',
    }
  }

  if (response.ok) {
    try {
      const parsed = (await response.json()) as SubscribeResponse

      return { ok: true, alreadySubscribed: parsed.already_subscribed === true }
    } catch {
      // A 2xx we could not parse still means the address was accepted. The
      // only thing lost is whether they were already on the list, which no
      // visitor-facing decision depends on.
      return { ok: true, alreadySubscribed: false }
    }
  }

  if (response.status >= 500) {
    return {
      ok: false,
      reason: 'unavailable',
      detail: `HTTP ${response.status}`,
    }
  }

  /**
   * A 4xx. The body may carry a reason; it must not be shown to the visitor.
   *
   * Ecomail's validation messages are English and name internal fields, so
   * repeating one to a Czech reader would be both confusing and a small leak
   * of how the integration is shaped. The caller logs this and shows the
   * catalogue's sentence instead.
   */
  let detail = `HTTP ${response.status}`

  try {
    const parsed = (await response.json()) as SubscribeResponse

    if (typeof parsed.message === 'string' && parsed.message !== '') {
      detail = `${detail}: ${parsed.message}`
    }
  } catch {
    // Nothing to add.
  }

  return { ok: false, reason: 'rejected', detail }
}
