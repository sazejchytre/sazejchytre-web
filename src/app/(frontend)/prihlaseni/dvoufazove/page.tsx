/** TEMPORARY UI — replaced in step 8 (design system). Functional only. */
import type { Metadata } from 'next'

import { ActionForm } from '../../_components/ActionForm'
import {
  verifyBackupCodeAction,
  verifyTwoFactorAction,
} from '@/lib/auth/two-factor-actions'

export const metadata: Metadata = { title: 'Dvoufázové ověření' }

export default function DvoufazovePage() {
  return (
    <main>
      <h1>Dvoufázové ověření</h1>
      <p>Zadejte kód z aplikace.</p>

      <ActionForm action={verifyTwoFactorAction} submitLabel="Ověřit kód">
        <p>
          <label htmlFor="code">Kód z aplikace</label>
          <br />
          <input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
          />
        </p>
        <p>
          <label htmlFor="trustDevice">
            <input id="trustDevice" name="trustDevice" type="checkbox" />{' '}
            Důvěřovat tomuto zařízení
          </label>
        </p>
      </ActionForm>

      <hr />

      <h2>Nemáte přístup k aplikaci?</h2>
      <p>Použijte jeden ze záložních kódů. Každý lze použít jen jednou.</p>

      <ActionForm
        action={verifyBackupCodeAction}
        submitLabel="Použít záložní kód"
      >
        <p>
          <label htmlFor="backup-code">Záložní kód</label>
          <br />
          <input id="backup-code" name="code" type="text" required />
        </p>
      </ActionForm>
    </main>
  )
}
