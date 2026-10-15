'use client'

/**
 * TEMPORARY — replaced wholesale in step 8 (design system).
 *
 * The only job of this component is to make the authentication flows clickable
 * so they can be exercised end to end. There is no design here on purpose: a
 * half-styled form would have to be thrown away twice.
 */
import { useActionState } from 'react'
import type { ReactNode } from 'react'

import type { ActionResult } from '@/lib/auth/action-result'

/**
 * The form state IS the action result. Declaring a second, wider shape here
 * (with `field?: string`) made every action fail to typecheck against it under
 * `exactOptionalPropertyTypes`, which is the compiler correctly pointing out
 * that two sources of truth had drifted.
 */
export type FormState = ActionResult

type Props = {
  action: (previous: FormState | null, formData: FormData) => Promise<FormState>
  submitLabel: string
  children: ReactNode
  /** Rendered under the submit button, e.g. a link to the other flow. */
  footer?: ReactNode
}

export function ActionForm({
  action,
  submitLabel,
  children,
  footer,
}: Props): ReactNode {
  const [state, formAction, pending] = useActionState(action, null)

  // A successful action that wants a redirect: done with a plain assignment
  // rather than `redirect()` so the server action can still return a message.
  if (state?.ok && state.redirectTo && typeof window !== 'undefined') {
    window.location.assign(state.redirectTo)
  }

  return (
    <form action={formAction} noValidate>
      {children}

      <p>
        <button type="submit" disabled={pending}>
          {pending ? 'Odesílám…' : submitLabel}
        </button>
      </p>

      {state ? (
        <p role="status" aria-live="polite">
          <strong>{state.ok ? 'OK: ' : 'Chyba: '}</strong>
          {state.message}
        </p>
      ) : null}

      {footer}
    </form>
  )
}
