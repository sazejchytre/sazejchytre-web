'use client'

/**
 * The Turnstile widget — deferred, and in a box that does not move.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT A LIGHTHOUSE RUN SHOWED, AND WHY THIS COMPONENT CHANGED SHAPE
 *
 * The first version rendered the widget and loaded Cloudflare's script on
 * page load. Measured on the home page, that cost:
 *
 *   - 1 711 kB of third-party transfer, of a 2 148 kB page. The newsletter
 *     widget was FOUR FIFTHS of the home page's weight — a 1 466 kB XHR to
 *     the challenge platform, a 215 kB document and a 28 kB api.js.
 *   - ~310 ms of total blocking time.
 *   - CLS 0.104, over the 0.1 "good" threshold. The widget appeared with no
 *     reserved height and pushed the footer down; Lighthouse named the
 *     `<footer>` as the shifting element, which is why the cause was not
 *     obvious from the markup.
 *
 * All of it paid by every visitor, for a newsletter box almost none of them
 * will use. So two changes:
 *
 * 1. THE SCRIPT LOADS ON ENGAGEMENT. The form tells this component when
 *    somebody has focused a field, and nothing is fetched until then. A
 *    visitor who reads the page and leaves downloads none of it.
 *
 *    This is safe because the widget only has to produce a token by the time
 *    the form is SUBMITTED, and both forms require typing into a field first.
 *    Turnstile normally solves in well under a second, and the server already
 *    handles a missing token by asking the visitor to try again rather than
 *    failing silently.
 *
 * 2. THE BOX IS RESERVED EITHER WAY. `.turnstile-slot` holds the widget's
 *    documented 300x65 from first paint, so the appearing widget displaces
 *    nothing.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE RESET IS STILL THE PART THAT IS EASY TO MISS
 *
 * A Turnstile token is SINGLE USE and expires after about five minutes.
 * Submit, fail validation, fix the field, submit again — and the second
 * attempt sends the same token, which Cloudflare refuses as
 * `timeout-or-duplicate`. The visitor then sees "we could not verify you"
 * for a problem that no longer exists. The server returns `resetChallenge`
 * and this calls `turnstile.reset()`.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * NO WIDGET, NO SUBMISSION
 *
 * If the script is blocked — a privacy extension, a corporate proxy — no
 * token is produced and the server refuses. That is a real cost, and it is
 * why the contact page shows the operator's email address in plain text:
 * there is always a route that does not depend on a third-party script.
 */
import Script from 'next/script'
import { useEffect } from 'react'

const SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=auto'

/** The sliver of Cloudflare's global API this component uses. */
type TurnstileApi = { reset: (container?: string | HTMLElement) => void }

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

export type TurnstileProps = {
  siteKey: string
  /**
   * Has the visitor engaged with the form?
   *
   * Nothing is fetched while this is false. See the header.
   */
  active: boolean
  /** Set by the server when the last token was spent. See the header. */
  reset?: boolean
  /** `auto` follows the page. */
  theme?: 'auto' | 'light' | 'dark'
}

export const Turnstile = ({
  siteKey,
  active,
  reset = false,
  theme = 'auto',
}: TurnstileProps) => {
  useEffect(() => {
    if (!reset) return

    // Optional-chained because the script may never have loaded — a blocked
    // script must not become a TypeError that takes the form with it.
    window.turnstile?.reset()
  }, [reset])

  return (
    // The slot keeps its size whether or not the widget is in it, so the
    // widget's arrival cannot shift the page. See `globals.css`.
    <div className="turnstile-slot">
      {active ? (
        <>
          <div
            className="cf-turnstile"
            data-sitekey={siteKey}
            data-theme={theme}
            // Czech, so the challenge matches the language of the form.
            data-language="cs"
          />

          {/*
            `afterInteractive` rather than `lazyOnload`: by the time this
            mounts the visitor is already filling the form in, so the token
            is wanted promptly rather than at the next idle moment.
          */}
          <Script src={SCRIPT_SRC} strategy="afterInteractive" />
        </>
      ) : null}
    </div>
  )
}
