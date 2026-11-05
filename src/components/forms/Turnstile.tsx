'use client'

/**
 * The Turnstile widget.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * IMPLICIT RENDERING, ON PURPOSE
 *
 * The `cf-turnstile` class plus `data-sitekey` is all Cloudflare's script
 * needs: it finds the element, renders the challenge and puts the token in a
 * hidden input called `cf-turnstile-response` inside the surrounding form.
 * The explicit JavaScript API would mean managing a widget id, a container
 * ref and a callback for a form that posts by itself.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE RESET IS THE PART THAT IS EASY TO MISS
 *
 * A Turnstile token is SINGLE USE and expires after about five minutes.
 * Submit, fail validation, correct the field, submit again — and the second
 * attempt sends the same token, which Cloudflare refuses as
 * `timeout-or-duplicate`. The visitor then sees "we could not verify you"
 * for a problem that no longer exists, and every further attempt fails the
 * same way.
 *
 * So the server returns `resetChallenge`, and this component calls
 * `turnstile.reset()` when it sees it. That is the entire reason the state
 * shape carries that flag.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THE SITE KEY IS A PROP
 *
 * It arrives from the server component that renders the form, which reads
 * `TURNSTILE_SITE_KEY` from the validated env. It is world-readable either
 * way; passing it rather than inlining it as a `NEXT_PUBLIC_` value means the
 * widget can be rotated without a rebuild.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * NO WIDGET, NO SUBMISSION
 *
 * If the script is blocked — a privacy extension, a corporate proxy — no
 * token is produced and the server refuses the submission with a message
 * saying so. That is a real cost, and it is why the contact page also shows
 * the operator's email address in plain text: there is always a route that
 * does not depend on a third-party script.
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
  /** Set by the server when the last token was spent. See the header. */
  reset?: boolean
  /** `auto` follows the page; the tokens below are not available to it. */
  theme?: 'auto' | 'light' | 'dark'
}

export const Turnstile = ({
  siteKey,
  reset = false,
  theme = 'auto',
}: TurnstileProps) => {
  useEffect(() => {
    if (!reset) return

    // Optional-chained because the script may not have loaded, and because a
    // blocked script must not turn into a TypeError that takes the form with
    // it.
    window.turnstile?.reset()
  }, [reset])

  return (
    <>
      <div
        className="cf-turnstile"
        data-sitekey={siteKey}
        data-theme={theme}
        // Czech, so the challenge is in the same language as the form.
        data-language="cs"
      />

      {/*
        `afterInteractive`: the widget has to exist before the visitor
        submits, so it cannot wait for idle. It is still after hydration, so
        it is off the critical rendering path.
      */}
      <Script src={SCRIPT_SRC} strategy="afterInteractive" />
    </>
  )
}
