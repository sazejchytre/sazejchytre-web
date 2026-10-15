'use client'

/**
 * TEMPORARY UI — replaced in step 8 (design system). Functional only.
 *
 * Two-step enrolment, because the secret must be proved before it is active:
 *
 *   1. password  → secret + QR + backup codes (factor NOT yet required)
 *   2. one code  → factor activated
 *
 * The backup codes are rendered ONCE, here, from the action's return value.
 * They are never fetched again — there is no endpoint that returns them in
 * readable form, by design.
 */
import { useActionState } from 'react'
import type { ReactNode } from 'react'

import {
  type BackupCodeResult,
  type EnrolmentStart,
  confirmTwoFactorAction,
  regenerateBackupCodesAction,
  startTwoFactorEnrolmentAction,
} from '@/lib/auth/two-factor-actions'
import type { FormState } from '../../_components/ActionForm'

const CodeList = ({ codes }: { codes: string[] }): ReactNode => (
  <>
    <p>
      <strong>Záložní kódy — uložte si je nyní.</strong> Zobrazujeme je jen
      jednou. Každý lze použít jen jednou.
    </p>
    <ul>
      {codes.map((code) => (
        <li key={code}>
          <code>{code}</code>
        </li>
      ))}
    </ul>
  </>
)

export function TwoFactorEnrolment({
  enabled,
}: {
  enabled: boolean
}): ReactNode {
  const [start, startAction, startPending] = useActionState<
    EnrolmentStart | null,
    FormData
  >(startTwoFactorEnrolmentAction, null)

  const [confirm, confirmAction, confirmPending] = useActionState<
    FormState | null,
    FormData
  >(confirmTwoFactorAction, null)

  const [regen, regenAction, regenPending] = useActionState<
    BackupCodeResult | null,
    FormData
  >(regenerateBackupCodesAction, null)

  return (
    <>
      {enabled ? (
        <section>
          <h3>Nové záložní kódy</h3>
          <p>
            <small>
              Vygenerováním nové sady okamžitě zneplatníte všechny předchozí
              kódy.
            </small>
          </p>

          <form action={regenAction}>
            <p>
              <label htmlFor="regen-password">Heslo</label>
              <br />
              <input
                id="regen-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </p>
            <p>
              <button type="submit" disabled={regenPending}>
                {regenPending ? 'Generuji…' : 'Vygenerovat nové kódy'}
              </button>
            </p>
          </form>

          {regen ? (
            <p role="status">
              <strong>{regen.ok ? 'OK: ' : 'Chyba: '}</strong>
              {regen.message}
            </p>
          ) : null}

          {regen?.backupCodes?.length ? (
            <CodeList codes={regen.backupCodes} />
          ) : null}
        </section>
      ) : (
        <section>
          <h3>Zapnout dvoufázové ověření</h3>

          <form action={startAction}>
            <p>
              <label htmlFor="enrol-password">Heslo</label>
              <br />
              <input
                id="enrol-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </p>
            <p>
              <button type="submit" disabled={startPending}>
                {startPending ? 'Připravuji…' : 'Krok 1: získat kód'}
              </button>
            </p>
          </form>

          {start ? (
            <p role="status">
              <strong>{start.ok ? 'OK: ' : 'Chyba: '}</strong>
              {start.message}
            </p>
          ) : null}

          {start?.secret ? (
            <>
              <p>
                Zadejte do aplikace (Google Authenticator, Authy) tento kód,
                nebo naskenujte QR z odkazu níže:
              </p>
              <p>
                <code>{start.secret}</code>
              </p>
              {start.totpUri ? (
                <p>
                  <small>
                    otpauth URI: <code>{start.totpUri}</code>
                  </small>
                </p>
              ) : null}

              {start.backupCodes?.length ? (
                <CodeList codes={start.backupCodes} />
              ) : null}

              <form action={confirmAction}>
                <p>
                  <label htmlFor="confirm-code">
                    Krok 2: kód z aplikace (šest číslic)
                  </label>
                  <br />
                  <input
                    id="confirm-code"
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                  />
                </p>
                <p>
                  <button type="submit" disabled={confirmPending}>
                    {confirmPending ? 'Ověřuji…' : 'Aktivovat'}
                  </button>
                </p>
              </form>

              {confirm ? (
                <p role="status">
                  <strong>{confirm.ok ? 'OK: ' : 'Chyba: '}</strong>
                  {confirm.message}
                </p>
              ) : null}
            </>
          ) : null}
        </section>
      )}
    </>
  )
}
