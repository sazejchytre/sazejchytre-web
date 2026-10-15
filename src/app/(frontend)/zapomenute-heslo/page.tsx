/** TEMPORARY UI — replaced in step 8 (design system). Functional only. */
import type { Metadata } from 'next'

import { ActionForm } from '../_components/ActionForm'
import { requestPasswordResetAction } from '@/lib/auth/actions'

export const metadata: Metadata = { title: 'Zapomenuté heslo' }

export default function ZapomenuteHesloPage() {
  return (
    <main>
      <h1>Zapomenuté heslo</h1>
      <p>Zadejte svůj e-mail a pošleme vám odkaz pro nastavení nového hesla.</p>

      <ActionForm
        action={requestPasswordResetAction}
        submitLabel="Poslat odkaz"
      >
        <p>
          <label htmlFor="email">E-mail</label>
          <br />
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
          />
        </p>
      </ActionForm>
    </main>
  )
}
