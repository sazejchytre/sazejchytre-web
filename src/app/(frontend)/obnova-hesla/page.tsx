/** TEMPORARY UI — replaced in step 8 (design system). Functional only. */
import type { Metadata } from 'next'

import { ActionForm } from '../_components/ActionForm'
import { resetPasswordAction } from '@/lib/auth/actions'
import { MIN_PASSWORD_LENGTH } from '@/lib/auth/password-policy'

export const metadata: Metadata = { title: 'Nové heslo' }

/**
 * better-auth puts the one-time token in the query string. It is passed
 * straight into a hidden field and never rendered as text or logged.
 */
export default async function ObnovaHeslaPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>
}) {
  const params = await searchParams
  const token = Array.isArray(params.token) ? params.token[0] : params.token

  if (!token) {
    return (
      <main>
        <h1>Nové heslo</h1>
        <p>
          Odkaz je neplatný nebo mu vypršela platnost. Vyžádejte si nový na
          stránce Zapomenuté heslo.
        </p>
      </main>
    )
  }

  return (
    <main>
      <h1>Nové heslo</h1>

      <ActionForm action={resetPasswordAction} submitLabel="Nastavit heslo">
        <input type="hidden" name="token" value={token} />
        <p>
          <label htmlFor="password">Nové heslo</label>
          <br />
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
          />
          <br />
          <small>Alespoň {MIN_PASSWORD_LENGTH} znaků.</small>
        </p>
      </ActionForm>
    </main>
  )
}
