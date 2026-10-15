/** TEMPORARY UI — replaced in step 8 (design system). Functional only. */
import Link from 'next/link'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { ActionForm } from '../_components/ActionForm'
import {
  changeEmailAction,
  changePasswordAction,
} from '@/lib/auth/account-actions'
import { signOutAction } from '@/lib/auth/actions'
import { getCurrentCustomer } from '@/lib/auth/customer'
import { MIN_PASSWORD_LENGTH } from '@/lib/auth/password-policy'

export const metadata: Metadata = { title: 'Můj účet' }

export default async function UcetPage() {
  const current = await getCurrentCustomer(await headers())

  if (!current) {
    redirect('/prihlaseni')
  }

  const { session, customer } = current

  return (
    <main>
      <h1>Můj účet</h1>

      <p>
        <strong>E-mail:</strong> {session.email}
      </p>
      <p>
        <strong>Stav:</strong>{' '}
        {session.isVerified ? 'potvrzeno' : 'e-mail není potvrzený'}
      </p>

      {/*
        An unverified account may see this page and nothing more. The paid-action
        gate is requireVerifiedCustomer(), not this banner — the banner only
        explains it.
      */}
      {!session.isVerified ? (
        <section>
          <h2>Potvrďte e-mail</h2>
          <p>
            Dokud e-mail nepotvrdíte, nelze objednat předplatné. Odkaz jsme vám
            poslali; nový si můžete vyžádat na stránce{' '}
            <Link href="/overeni-emailu">Potvrzení e-mailu</Link>.
          </p>
        </section>
      ) : null}

      <p>
        <strong>Zákaznický záznam:</strong>{' '}
        {customer
          ? `#${customer.id} (${customer.billingCountry})`
          : 'vznikne po potvrzení e-mailu'}
      </p>

      <p>
        <Link href="/ucet/zabezpeceni">Zabezpečení a přihlášená zařízení</Link>
      </p>

      <hr />

      <section>
        <h2>Změna hesla</h2>
        <p>
          <small>Změna hesla vás odhlásí na všech ostatních zařízeních.</small>
        </p>

        <ActionForm action={changePasswordAction} submitLabel="Změnit heslo">
          <p>
            <label htmlFor="currentPassword">Současné heslo</label>
            <br />
            <input
              id="currentPassword"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
            />
          </p>
          <p>
            <label htmlFor="newPassword">Nové heslo</label>
            <br />
            <input
              id="newPassword"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
            />
          </p>
        </ActionForm>
      </section>

      <section>
        <h2>Změna e-mailu</h2>
        <p>
          <small>
            Potvrzovací odkaz pošleme na vaši <em>současnou</em> adresu. Dokud
            ho nepotvrdíte, adresa se nezmění.
          </small>
        </p>

        <ActionForm action={changeEmailAction} submitLabel="Změnit e-mail">
          <p>
            <label htmlFor="newEmail">Nový e-mail</label>
            <br />
            <input
              id="newEmail"
              name="newEmail"
              type="email"
              autoComplete="email"
              required
            />
          </p>
        </ActionForm>
      </section>

      <hr />

      <ActionForm action={signOutAction} submitLabel="Odhlásit se">
        <></>
      </ActionForm>
    </main>
  )
}
