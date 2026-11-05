'use client'

/**
 * The contact form.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * `useActionState`, SO THE FORM WORKS BEFORE HYDRATION
 *
 * The form's `action` is the server action itself. That means a submission
 * made before the JavaScript has loaded still posts and still works — React
 * progressively enhances it rather than replacing it. The hook gives us the
 * pending flag and the returned state; it is not what makes the form
 * function.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE RESULT IS ANNOUNCED
 *
 * `role="status"` with `aria-live="polite"` on the message, and
 * `role="alert"` on each field error (inside `Field`). Without them a screen
 * reader user submits the form and hears nothing at all: the page has not
 * navigated, so there is no new document to read.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE FIELDS KEEP WHAT WAS TYPED
 *
 * `defaultValue` from `formData` is NOT used here — the form is not reset on
 * a failed submit, because React keeps the DOM between renders and the inputs
 * are uncontrolled. That is the behaviour we want: a visitor who mistyped
 * their email does not lose the message they just wrote. It is worth stating
 * because the instinct is to add `key={...}` or controlled values, and both
 * would throw the text away.
 */
import { useActionState } from 'react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/Button'
import { Field, Input, Textarea } from '@/components/ui/Input'
import { idleState } from '@/lib/forms/state'
import type { ContactFormState } from '@/lib/forms/contact'
import { submitContactForm } from '@/lib/forms/contact'

import { HoneypotField } from './HoneypotField'
import { Turnstile } from './Turnstile'

export const ContactForm = ({ siteKey }: { siteKey: string }) => {
  const t = useTranslations('contact.form')
  const [state, action, pending] = useActionState<ContactFormState, FormData>(
    submitContactForm,
    idleState(),
  )

  const sent = state.status === 'success'

  return (
    <form action={action} className="flex flex-col gap-6" noValidate>
      <HoneypotField />

      <Field
        id="kontakt-jmeno"
        label={t('name')}
        required
        error={state.errors?.name}
      >
        {({ id, describedBy }) => (
          <Input
            id={id}
            name="name"
            autoComplete="name"
            required
            aria-describedby={describedBy}
            invalid={Boolean(state.errors?.name)}
          />
        )}
      </Field>

      <Field
        id="kontakt-email"
        label={t('email')}
        required
        error={state.errors?.email}
      >
        {({ id, describedBy }) => (
          <Input
            id={id}
            name="email"
            type="email"
            autoComplete="email"
            // `inputMode` so a phone shows the keyboard with the @ on it.
            inputMode="email"
            required
            aria-describedby={describedBy}
            invalid={Boolean(state.errors?.email)}
          />
        )}
      </Field>

      <Field
        id="kontakt-predmet"
        label={t('subject')}
        required
        error={state.errors?.subject}
      >
        {({ id, describedBy }) => (
          <Input
            id={id}
            name="subject"
            required
            aria-describedby={describedBy}
            invalid={Boolean(state.errors?.subject)}
          />
        )}
      </Field>

      <Field
        id="kontakt-zprava"
        label={t('message')}
        required
        error={state.errors?.message}
      >
        {({ id, describedBy }) => (
          <Textarea
            id={id}
            name="message"
            required
            aria-describedby={describedBy}
            invalid={Boolean(state.errors?.message)}
          />
        )}
      </Field>

      <Turnstile siteKey={siteKey} reset={state.resetChallenge ?? false} />

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" variant="primary" size="lg" disabled={pending}>
          {pending ? t('sending') : t('submit')}
        </Button>
      </div>

      {state.message !== '' ? (
        <p
          // `status` rather than `alert` even for an error: the message
          // appears next to the control the visitor just used, so a polite
          // announcement is enough and an assertive one interrupts whatever
          // they were reading.
          role="status"
          aria-live="polite"
          className={
            sent ? 'text-body text-result-win' : 'text-body text-result-loss'
          }
        >
          {state.message}
        </p>
      ) : null}
    </form>
  )
}
