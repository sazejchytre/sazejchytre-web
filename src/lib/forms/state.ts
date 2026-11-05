/**
 * What a form server action returns.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY NOT `ActionResult` FROM THE AUTH MODULE
 *
 * `src/lib/auth/action-result.ts` carries ONE `field` because that is what
 * its actions need: sign-in has one answer, and — more importantly — it must
 * not vary its shape, because a caller that can tell
 * `{ok:false}` from `{ok:false, field:'email'}` can enumerate accounts.
 *
 * These forms are the opposite case. Nothing about a contact form is
 * enumeration-sensitive, and a visitor who mistyped their address and left
 * the subject empty should be told both at once rather than made to submit
 * four times to discover four problems.
 *
 * So this shape carries a map of field errors, and the two modules stay
 * separate rather than one growing an option the other must never use.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * `status` RATHER THAN `ok`
 *
 * Because `null` is the initial state of `useActionState`, and a boolean
 * `ok: false` is indistinguishable from "not submitted yet" once it has been
 * through a serialisation boundary. An explicit `idle` means the form can
 * render its own untouched state without guessing.
 */

export type FormStatus = 'idle' | 'success' | 'error'

export type FormState<TField extends string = string> = {
  status: FormStatus
  /** Shown to the visitor. Always Czech, always from the catalogue. */
  message: string
  /** Per-field messages, already resolved into Czech. */
  errors?: Partial<Record<TField, string>>
  /**
   * Tells the client to fetch a fresh Turnstile token before retrying.
   *
   * A Turnstile token is single use: retrying with the same one fails as a
   * duplicate, so a form that does not reset the widget gets stuck in a loop
   * where every retry is refused for a different reason than the first.
   */
  resetChallenge?: boolean
}

export const idleState = <TField extends string>(): FormState<TField> => ({
  status: 'idle',
  message: '',
})

export const successState = <TField extends string>(
  message: string,
): FormState<TField> => ({ status: 'success', message })

export const errorState = <TField extends string>(
  message: string,
  errors?: Partial<Record<TField, string>>,
  resetChallenge = false,
): FormState<TField> => ({
  status: 'error',
  message,
  ...(errors ? { errors } : {}),
  ...(resetChallenge ? { resetChallenge: true } : {}),
})
