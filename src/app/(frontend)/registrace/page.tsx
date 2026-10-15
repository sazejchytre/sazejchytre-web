/** TEMPORARY UI — replaced in step 8 (design system). Functional only. */
import Link from 'next/link'
import type { Metadata } from 'next'

import { ActionForm } from '../_components/ActionForm'
import { registerAction } from '@/lib/auth/actions'
import { MIN_PASSWORD_LENGTH } from '@/lib/auth/password-policy'

export const metadata: Metadata = { title: 'Registrace' }

export default function RegistracePage() {
  return (
    <main>
      <h1>Registrace</h1>

      <ActionForm
        action={registerAction}
        submitLabel="Zaregistrovat se"
        footer={
          <p>
            Už máte účet? <Link href="/prihlaseni">Přihlaste se</Link>.
          </p>
        }
      >
        <p>
          <label htmlFor="name">Jméno</label>
          <br />
          <input id="name" name="name" type="text" autoComplete="name" />
        </p>
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
        <p>
          <label htmlFor="password">Heslo</label>
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
          <small>
            Alespoň {MIN_PASSWORD_LENGTH} znaků. Žádné požadavky na velká
            písmena ani symboly — délka je důležitější.
          </small>
        </p>
      </ActionForm>
    </main>
  )
}
