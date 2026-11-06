/**
 * Which message namespaces the BROWSER gets.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY NOT ALL OF THEM
 *
 * `NextIntlClientProvider` serialises whatever it is handed into the HTML of
 * every page. Handed the whole catalogue, it ships all 10 236 bytes of it
 * everywhere — and a Lighthouse run on `/historie` found a contact-form error
 * string ("Zprávu se nepodařilo odeslat") sitting in the markup of a page
 * that has no form on it.
 *
 * It is not a large number. It is pure waste, though: server components
 * resolve their text on the server through `getTranslations`, so `common`,
 * `home`, `history`, `tip`, `pricing` and `legal` — 7 889 of those bytes —
 * are never read by anything in the browser.
 *
 * Only three namespaces are, and only because three client components call
 * `useTranslations`:
 *
 *   errors      RouteError, which is an error boundary and must be able to
 *               render on any route
 *   contact     ContactForm
 *   newsletter  NewsletterForm
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE FAILURE MODE IF THIS LIST GOES STALE
 *
 * A new client component calling `useTranslations('pricing')` would find
 * nothing. In development that throws, loudly, which is fine. In PRODUCTION
 * `onError` deliberately swallows it and `getMessageFallback` returns the
 * key — so the page would quietly render `pricing.cta` as the button label.
 * A missing namespace is therefore a silent, production-only defect, which is
 * the worst shape a bug can have.
 *
 * `client-messages.test.ts` scans every `'use client'` file for
 * `useTranslations(...)` calls and fails if one names a namespace that is not
 * in this list. The list is enforced, not documented.
 */
import type { Messages } from './messages/cs.ts'

/**
 * Top-level namespaces sent to the browser.
 *
 * A client component may use a nested path — `contact.form`, `errors.generic`
 * — and the test resolves those to their top-level namespace before checking.
 */
export const CLIENT_NAMESPACES = ['errors', 'contact', 'newsletter'] as const

export type ClientNamespace = (typeof CLIENT_NAMESPACES)[number]

export type ClientMessages = Pick<Messages, ClientNamespace>

/**
 * Narrow a full catalogue to the client's share.
 *
 * Takes `Messages` rather than next-intl's loose `AbstractIntlMessages` so
 * that a renamed namespace is a type error here rather than an empty object
 * in the browser.
 */
export const pickClientMessages = (messages: Messages): ClientMessages => ({
  errors: messages.errors,
  contact: messages.contact,
  newsletter: messages.newsletter,
})
