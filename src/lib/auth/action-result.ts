/**
 * Shared shapes and helpers for the auth server actions.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * EMAIL ENUMERATION
 *
 * Registration, sign-in and password reset must not reveal whether an address
 * has an account. Three things have to match, and all three are easy to get
 * wrong separately:
 *
 *  1. THE MESSAGE. Same words either way. "Takový e-mail neexistuje" is the
 *     obvious leak; "e-mail nebo heslo je nesprávné" is the fix.
 *  2. THE SHAPE. Same fields, same status, same redirect. A caller can tell
 *     `{ok:false}` from `{ok:false, field:'email'}` just as easily as from a
 *     different sentence.
 *  3. THE TIMING. This is the one that survives careless review. Verifying a
 *     password hash takes ~100ms; not finding a user takes ~5ms. That
 *     difference is trivially measurable over a few requests, so an attacker
 *     learns which addresses exist without reading a single message.
 *
 * `withMinimumDuration` handles (3) by giving every enumeration-sensitive
 * action a fixed floor. Padding to a floor rather than measuring and matching
 * is deliberate: the floor is independent of what the code did, so a future
 * branch that happens to be fast does not reintroduce the signal.
 *
 * The floor is not a constant-time guarantee — a *slower* path can still
 * exceed it. It is chosen high enough to cover the slowest normal path
 * (hashing, a database round trip and an email enqueue), so in practice every
 * outcome lands on the floor.
 */

/** What every auth action returns. One shape, so callers cannot branch on it. */
export type ActionResult = {
  ok: boolean
  /** Shown to the user. Identical across outcomes for sensitive actions. */
  message: string
  /**
   * Set only for errors the user can act on without revealing anything —
   * a password that fails the policy, a malformed email, an expired token.
   */
  field?: 'email' | 'password' | 'code' | 'form'
  /** Where to go next, when the action succeeded. */
  redirectTo?: string
  /** True when the user should be offered a retry (e.g. email send failed). */
  retryable?: boolean
}

export const ok = (message: string, redirectTo?: string): ActionResult =>
  redirectTo ? { ok: true, message, redirectTo } : { ok: true, message }

export const fail = (
  message: string,
  field: ActionResult['field'] = 'form',
  retryable = false,
): ActionResult => ({ ok: false, message, field, retryable })

/**
 * Floor, in milliseconds, for every enumeration-sensitive action.
 *
 * 400ms comfortably exceeds a scrypt verification plus a Neon round trip, so
 * the "address exists" and "address does not exist" paths both land here.
 */
export const ENUMERATION_FLOOR_MS = 400

/**
 * Run `work`, returning no earlier than `floorMs` after it started.
 *
 * Applied to registration, sign-in and reset-request so their duration does
 * not depend on whether the account exists.
 */
export const withMinimumDuration = async <T>(
  floorMs: number,
  work: () => Promise<T>,
): Promise<T> => {
  const started = Date.now()

  try {
    return await work()
  } finally {
    const remaining = floorMs - (Date.now() - started)

    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, remaining))
    }
  }
}

/* -------------------------------------------------------------------------- */
/* The identical messages                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Registration: shown whether the address was free or already taken.
 *
 * Phrased so it is TRUE in both cases. If the address was already registered,
 * better-auth sends nothing and the owner is not disturbed; the sentence still
 * describes what the user should do, and does not promise an email has been
 * sent this second.
 */
export const REGISTRATION_MESSAGE =
  'Pokud je adresa volná, poslali jsme na ni potvrzovací odkaz. ' +
  'Zkontrolujte si e-mail včetně složky se spamem.'

/** Sign-in: shown for an unknown address, a wrong password, and nothing else. */
export const SIGN_IN_FAILED_MESSAGE = 'E-mail nebo heslo je nesprávné.'

/** Password reset request: shown whether or not the account exists. */
export const RESET_REQUEST_MESSAGE =
  'Pokud k této adrese existuje účet, poslali jsme na ni odkaz pro nastavení nového hesla.'

/** Verification resend: same reasoning as the reset request. */
export const RESEND_MESSAGE =
  'Pokud účet existuje a není potvrzený, poslali jsme na něj nový odkaz.'

/** Rate limited or locked out. Deliberately not specific about which. */
export const THROTTLED_MESSAGE =
  'Příliš mnoho pokusů. Zkuste to prosím později.'
