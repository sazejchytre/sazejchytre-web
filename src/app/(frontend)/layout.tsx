import type { Metadata } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages, getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'

import { Footer } from '@/components/layout/Footer'
import { Header } from '@/components/layout/Header'
import { pickClientMessages } from '@/i18n/client-messages'
import type { Messages } from '@/i18n/messages/cs'
import { loadSiteSettings } from '@/lib/content/loaders'
import { fontVariables } from '@/lib/design/fonts'
import { HTML_LANG, resolveLocale } from '@/i18n/config'
import { SITE_NAME, indexingAllowed, metadataBaseUrl } from '@/lib/seo/metadata'

import './globals.css'

/**
 * The public shell.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * `robots` IS NO LONGER A BLANKET `noindex`
 *
 * It was, through steps 1–5: nothing public had shipped, so advertising the
 * site to a crawler would have indexed a placeholder. This is the step that
 * flips it — but not to an unconditional "index everything".
 *
 * `indexingAllowed()` compares the CONFIGURED ORIGIN against the production
 * host, so a preview deployment stays `noindex` while production does not.
 * `NODE_ENV` cannot answer that question: a preview build is a production
 * build and reports `production` too, which is exactly how every preview URL
 * ends up competing with the real site in an index.
 *
 * Individual pages override this through `pageMetadata`, which applies the
 * same rule plus a per-page switch.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * `metadataBase` IS SET HERE AND NOWHERE ELSE
 *
 * With it in place Next resolves relative URLs in page metadata against the
 * right origin. Pages still pass absolute canonicals — belt and braces,
 * because a missing `metadataBase` silently produces relative tags rather
 * than failing.
 */
/**
 * EVERY PAGE IN THIS GROUP IS RENDERED PER REQUEST.
 *
 * Declared once, on the layout, because the reasons belong to the layout and
 * to the nature of the content rather than to any one page. There are three,
 * and they are worth separating because only one of them is temporary.
 *
 * 1. THE FIGURES ARE CLAIMS ABOUT MONEY. The home page and `/historie` carry
 *    the ROI, the profit and the loss count. A statically generated copy
 *    would keep serving yesterday's numbers after a tip settles, and a stale
 *    ROI is not a slightly old number — it is a wrong statement about a
 *    return, on a page whose whole purpose is being checkable.
 *
 * 2. "YESTERDAY'S FREE TIP" IS A FUNCTION OF `now`. `loadLatestPublicTip`
 *    picks the most recent tip whose 24-hour delay has elapsed. Freeze that
 *    at build time and the home page advertises a free tip that stopped being
 *    the latest one hours ago.
 *
 * 3. THE FOOTER REFUSES TO RENDER IN PRODUCTION TODAY. `operatorForDisplay()`
 *    throws while `src/lib/legal/operator.ts` holds placeholder register
 *    data — deliberately, so an invented IČO cannot be published. Because the
 *    footer is in THIS file, that throw would happen during a production
 *    build for every statically prerendered page, and the build would fail
 *    rather than the page. This is the temporary reason: once the register
 *    data is filled in, `/kontakt`, the four legal documents and the
 *    checkout stub could each take `export const revalidate = 300` and be
 *    prerendered again. The two reasons above would still apply to `/`,
 *    `/historie` and `/cenik`.
 *
 * The cost is small and bounded: the content these pages read — site
 * settings, the FAQ, the legal documents — goes through
 * `src/lib/content/loaders.ts`, which caches for five minutes. A request is
 * therefore a cache hit and a render, not a page of database queries.
 */
export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('common')

  return {
    metadataBase: metadataBaseUrl(),
    title: {
      default: SITE_NAME,
      template: `%s · ${SITE_NAME}`,
    },
    // Rule 2: describes the work, promises no outcome.
    description: `${t('tagline')}. ${t('serviceStatement')}`,
    applicationName: SITE_NAME,
    robots: indexingAllowed()
      ? { index: true, follow: true }
      : { index: false, follow: false, noarchive: true },
    // Follows the system; `globals.css` re-themes by swapping token values
    // rather than through Tailwind's `dark:` variant.
    other: {},
  }
}

export default async function FrontendLayout({
  children,
}: {
  children: ReactNode
}) {
  /**
   * The locale, from next-intl's request config.
   *
   * There is one, it is Czech, and it is unprefixed — so this is a constant
   * today. It is read rather than hard-coded because the day a second locale
   * arrives, this file should not need to change: that is the whole point of
   * wiring the plumbing up while there is nothing to translate.
   */
  const locale = resolveLocale(await getLocale())

  /**
   * Only the namespaces a CLIENT component reads.
   *
   * `NextIntlClientProvider` serialises whatever it is given into the HTML of
   * every page. Given the whole catalogue it shipped all of it everywhere —
   * a Lighthouse run found a contact-form error string in the markup of
   * `/historie`, which has no form on it. Server components resolve their
   * text through `getTranslations` and need none of this.
   *
   * `client-messages.test.ts` scans every `'use client'` file and fails if one
   * asks for a namespace this does not include, because in production a
   * missing namespace renders the key instead of the text, silently.
   */
  const messages = pickClientMessages(
    // One narrow cast, at the boundary. `getMessages()` is typed
    // `Record<string, any>` because next-intl cannot know our catalogue;
    // `pickClientMessages` wants the real shape so that a renamed namespace
    // is a type error rather than an empty object in the browser.
    //
    // The alternative is next-intl's global `IntlMessages` augmentation,
    // which would type this properly AND start checking every `t()` key.
    // That is worth doing, and it is not a one-line change: keys built from
    // template literals (`features.${key}`) and `t.raw()` calls would all
    // need revisiting. Its own piece of work.
    (await getMessages()) as Messages,
  )
  const settings = await loadSiteSettings(locale)
  const t = await getTranslations('common')

  return (
    <html lang={HTML_LANG[locale]} className={fontVariables}>
      <body className="flex min-h-screen flex-col bg-surface-page text-ink">
        {/*
          The skip link. First focusable element on the page, invisible until
          focused, and it has to come before the header or it skips nothing.
          Without it, a keyboard user tabs through the whole navigation on
          every page before reaching the content — which on the history page
          is four links and a button, every time.
        */}
        <a
          href="#obsah"
          // `min-h-11` + `inline-flex`: a real tab-through measured this at
          // 40px, under the 44px floor. `py-2` on 24px type is 40, not 44.
          className="sr-only-focusable absolute start-4 top-4 z-10 inline-flex min-h-11 items-center rounded-button bg-brand px-4 py-2 text-body font-semibold text-ink-on-brand"
        >
          {t('skipToContent')}
        </a>

        <NextIntlClientProvider locale={locale} messages={messages}>
          <Header />

          {/*
            `id` matches the skip link. `tabIndex={-1}` so that following the
            link actually moves focus here — without it some browsers scroll
            the page but leave focus where it was, and the next Tab goes back
            into the navigation.
          */}
          <main id="obsah" tabIndex={-1} className="flex-1">
            {children}
          </main>

          <Footer settings={settings} />
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
