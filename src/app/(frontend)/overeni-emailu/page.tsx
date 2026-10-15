/** TEMPORARY UI — replaced in step 8 (design system). Functional only. */
import type { Metadata } from 'next'

import { ActionForm } from '../_components/ActionForm'
import { resendVerificationAction } from '@/lib/auth/actions'

export const metadata: Metadata = { title: 'Potvrzení e-mailu' }

export default function OvereniEmailuPage() {
  return (
    <main>
      <h1>Potvrďte svůj e-mail</h1>
      <p>
        Poslali jsme vám odkaz. Dokud e-mail nepotvrdíte, můžete se přihlásit a
        vidět svůj účet, ale nelze objednat předplatné.
      </p>

      <h2>Nepřišel e-mail?</h2>
      <ActionForm action={resendVerificationAction} submitLabel="Poslat znovu">
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
