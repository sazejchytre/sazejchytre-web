/** TEMPORARY UI — replaced in step 8 (design system). Functional only. */
import Link from 'next/link'
import type { Metadata } from 'next'

import { ActionForm } from '../_components/ActionForm'
import { signInAction } from '@/lib/auth/actions'

export const metadata: Metadata = { title: 'Přihlášení' }

export default function PrihlaseniPage() {
  return (
    <main>
      <h1>Přihlášení</h1>

      <ActionForm
        action={signInAction}
        submitLabel="Přihlásit se"
        footer={
          <>
            <p>
              <Link href="/zapomenute-heslo">Zapomenuté heslo</Link>
            </p>
            <p>
              Nemáte účet? <Link href="/registrace">Zaregistrujte se</Link>.
            </p>
          </>
        }
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
        <p>
          <label htmlFor="password">Heslo</label>
          <br />
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </p>
        <p>
          <label htmlFor="rememberMe">
            <input id="rememberMe" name="rememberMe" type="checkbox" />{' '}
            Zapamatovat si mě
          </label>
          <br />
          <small>
            Bez zaškrtnutí platí přihlášení 7 dní, se zaškrtnutím 30 dní. Volba
            platí jen pro toto zařízení.
          </small>
        </p>
      </ActionForm>
    </main>
  )
}
