/** TEMPORARY UI — replaced in step 8 (design system). Functional only. */
import Link from 'next/link'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { ActionForm } from '../../_components/ActionForm'
import { TwoFactorEnrolment } from './TwoFactorEnrolment'
import {
  listSessionsAction,
  revokeOtherSessionsAction,
  revokeSessionAction,
} from '@/lib/auth/account-actions'
import { getCustomerSession } from '@/lib/auth/customer'
import { disableTwoFactorAction } from '@/lib/auth/two-factor-actions'

export const metadata: Metadata = { title: 'Zabezpečení' }

const formatWhen = (date: Date): string =>
  new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Prague',
  }).format(date)

export default async function ZabezpeceniPage() {
  const session = await getCustomerSession(await headers())

  if (!session) {
    redirect('/prihlaseni')
  }

  const sessions = await listSessionsAction()

  return (
    <main>
      <h1>Zabezpečení</h1>
      <p>
        <Link href="/ucet">← Zpět na účet</Link>
      </p>

      <section>
        <h2>Dvoufázové ověření</h2>
        <p>
          Stav:{' '}
          <strong>{session.twoFactorEnabled ? 'zapnuto' : 'vypnuto'}</strong>
        </p>

        {session.twoFactorEnabled ? (
          <>
            <p>
              <small>
                Vypnutí vyžaduje heslo <em>a</em> platný kód — z aplikace nebo
                záložní. Samotné heslo nestačí.
              </small>
            </p>

            <ActionForm
              action={disableTwoFactorAction}
              submitLabel="Vypnout dvoufázové ověření"
            >
              <p>
                <label htmlFor="disable-password">Heslo</label>
                <br />
                <input
                  id="disable-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </p>
              <p>
                <label htmlFor="disable-code">
                  Kód z aplikace nebo záložní kód
                </label>
                <br />
                <input id="disable-code" name="code" type="text" required />
              </p>
            </ActionForm>
          </>
        ) : null}

        <TwoFactorEnrolment enabled={session.twoFactorEnabled} />
      </section>

      <hr />

      <section>
        <h2>Přihlášená zařízení</h2>
        <p>
          <small>
            Zobrazujeme jen zemi, ne přesné místo. Celou IP adresu neukládáme —
            jen zkrácený a zahashovaný údaj.
          </small>
        </p>

        {sessions.length === 0 ? (
          <p>Žádná aktivní přihlášení.</p>
        ) : (
          <ul>
            {sessions.map((item) => (
              <li key={item.id}>
                <strong>{item.device}</strong>
                {item.country ? ` · ${item.country}` : ''}
                {item.current ? ' · toto zařízení' : ''}
                <br />
                <small>
                  Naposledy: {formatWhen(item.lastSeen)} · platí do:{' '}
                  {formatWhen(item.expiresAt)}
                  {item.remembered ? ' · zapamatováno' : ''}
                </small>

                {item.current ? null : (
                  <ActionForm
                    action={revokeSessionAction}
                    submitLabel="Odhlásit toto zařízení"
                  >
                    <input type="hidden" name="token" value={item.token} />
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}

        <ActionForm
          action={revokeOtherSessionsAction}
          submitLabel="Odhlásit všechna ostatní zařízení"
        >
          <></>
        </ActionForm>
      </section>
    </main>
  )
}
