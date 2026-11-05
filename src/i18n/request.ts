/**
 * next-intl's per-request configuration.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * NO MIDDLEWARE, ON PURPOSE
 *
 * next-intl's usual setup routes requests through middleware to detect a
 * locale from the path or the Accept-Language header. With one unprefixed
 * locale there is nothing to detect: every request is Czech, and every path
 * is already the Czech path.
 *
 * Adding the middleware anyway would mean a second thing in the request
 * pipeline next to `src/proxy.ts`, negotiating a locale that cannot vary, and
 * a rewrite layer that every future route has to be checked against. So the
 * locale is simply returned here.
 *
 * When a second locale arrives this file grows a lookup and the routing
 * middleware goes in — which is the configuration change the i18n groundwork
 * exists to make possible. No component changes either way.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE CATALOGUE IS A TYPESCRIPT MODULE
 *
 * Not JSON, because the copy rules are legal constraints that have to sit
 * next to the strings they govern, and JSON cannot hold a comment. See the
 * header of `messages/cs.ts`.
 */
import { getRequestConfig } from 'next-intl/server'

import { DEFAULT_LOCALE, INTL_LOCALE } from './config.ts'
import { cs } from './messages/cs.ts'

export default getRequestConfig(async () => {
  // Awaiting nothing, but the signature is async and will be doing real work
  // the moment a second locale exists.
  await Promise.resolve()

  return {
    locale: DEFAULT_LOCALE,
    messages: cs,
    /**
     * Czech formatting for dates and numbers, so `Intl` output matches the
     * prose around it. Prague rather than UTC: a tip published at 23:30 CET
     * must not display as the next day.
     */
    timeZone: 'Europe/Prague',
    formats: {
      dateTime: {
        /** `5. 11. 2026` — the Czech convention, with the spaces. */
        short: { day: 'numeric', month: 'numeric', year: 'numeric' },
        long: { day: 'numeric', month: 'long', year: 'numeric' },
        withTime: {
          day: 'numeric',
          month: 'numeric',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        },
      },
    },
    /**
     * A missing message is a bug, and in development it should be loud.
     *
     * In production it must NOT throw: a missing key would take down a whole
     * page over a label. The key is rendered instead, which is ugly and
     * obvious — exactly what you want someone to report.
     */
    onError(error) {
      if (process.env.NODE_ENV !== 'production') {
        throw error
      }
    },
    getMessageFallback({ key }) {
      return key
    },
  }
})

export { INTL_LOCALE }
