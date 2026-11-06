'use client'

/**
 * The newsletter signup.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE CONSENT BOX IS SEPARATE AND UNTICKED
 *
 * Not `defaultChecked`. Not bundled into "by submitting you agree". A
 * pre-ticked marketing consent is not consent under the GDPR, and a
 * `ConsentRecord` created from one is evidence of nothing — so the server
 * schema demands the literal `'on'` that only a ticked box sends, and a
 * missing box is a validation error rather than a silent `false`.
 *
 * The sentence shown here is the sentence snapshotted into the consent
 * record, verbatim, from the same catalogue string. `consent.ts`
 * fingerprints it so the wording cannot drift from the version it is
 * recorded under.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT IT PROMISES, AND WHAT IT DOES NOT
 *
 * "Jeden e-mail, když je co říct. Žádné tipy v e-mailu." The second half
 * matters: a newsletter that delivered tips would be a paid product given
 * away, and — more to the point — an email containing a pick is the one place
 * the copy rules are hardest to hold.
 */
import { useActionState, useState } from 'react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/Button'
import { Checkbox, Field, Input } from '@/components/ui/Input'
import { idleState } from '@/lib/forms/state'
import type { NewsletterFormState } from '@/lib/forms/newsletter'
import { submitNewsletterForm } from '@/lib/forms/newsletter'

import { HoneypotField } from './HoneypotField'
import { Turnstile } from './Turnstile'

export const NewsletterForm = ({ siteKey }: { siteKey: string }) => {
  const t = useTranslations('newsletter')
  const [state, action, pending] = useActionState<
    NewsletterFormState,
    FormData
  >(submitNewsletterForm, idleState())

  const sent = state.status === 'success'

  /**
   * Has the visitor touched the form?
   *
   * Turnstile's script is ~1.7 MB of challenge platform and it is not
   * fetched until this is true — see the header of `Turnstile.tsx` for the
   * measurement that motivated it. `onFocus` on the form captures focus from
   * any field in it (focus events bubble in React), so one handler covers
   * every control, including arriving by keyboard.
   *
   * It only ever goes from false to true. A visitor who clicks away has still
   * engaged, and tearing the widget back down would throw away a token they
   * are about to need.
   */
  const [engaged, setEngaged] = useState(false)

  return (
    <form
      action={action}
      className="flex flex-col gap-4"
      noValidate
      onFocus={() => setEngaged(true)}
    >
      <HoneypotField />

      <Field
        id="novinky-email"
        label={t('email')}
        required
        error={state.errors?.email}
      >
        {({ id, describedBy }) => (
          <Input
            id={id}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            aria-describedby={describedBy}
            invalid={Boolean(state.errors?.email)}
          />
        )}
      </Field>

      {/* Unticked. Never `defaultChecked`. See the header. */}
      <Checkbox
        id="novinky-souhlas"
        name="consent"
        label={t('consent')}
        error={state.errors?.consent}
        required
      />

      <Turnstile
        siteKey={siteKey}
        active={engaged}
        reset={state.resetChallenge ?? false}
      />

      <div>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? t('sending') : t('submit')}
        </Button>
      </div>

      {state.message !== '' ? (
        <p
          role="status"
          aria-live="polite"
          className={
            sent
              ? 'text-body-sm text-result-win'
              : 'text-body-sm text-result-loss'
          }
        >
          {state.message}
        </p>
      ) : null}
    </form>
  )
}
