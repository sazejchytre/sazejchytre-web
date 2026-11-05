'use client'

/**
 * The last resort: an error thrown by the ROOT LAYOUT itself.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS, SPECIFICALLY
 *
 * `(frontend)/error.tsx` catches failures in a PAGE. It cannot catch a
 * failure in the layout that wraps it, because the boundary lives inside that
 * layout. `global-error.tsx` replaces the entire document instead — which is
 * why it has to render its own `<html>` and `<body>`.
 *
 * There is one failure that makes this more than a formality:
 * `operatorForDisplay()` in the footer THROWS in production while
 * `src/lib/legal/operator.ts` still holds placeholder register data. That is
 * deliberate — a live commercial site must not publish an invented IČO — and
 * it happens inside the layout. Without this file, the result would be Next's
 * default grey error page.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * IT IMPORTS ALMOST NOTHING, AND THAT IS THE DESIGN
 *
 * No `Footer`, which is what threw. No `getTranslations`, because the i18n
 * provider lives in the layout that failed. No site chrome at all. Its
 * styling is inline, so it does not depend on the stylesheet having been
 * linked by the document that did not render.
 *
 * The copy is therefore hard-coded Czech — the one place in this codebase
 * where that is correct, because reaching the message catalogue is exactly
 * the kind of thing that may have just failed.
 */
import { useEffect } from 'react'

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  useEffect(() => {
    console.error(
      JSON.stringify({
        scope: 'frontend',
        event: 'root_layout.render_failed',
        digest: error.digest ?? null,
        name: error.name,
      }),
    )
  }, [error])

  return (
    <html lang="cs-CZ">
      <body
        style={{
          // The token values, inlined: see the header for why the stylesheet
          // cannot be relied on here.
          margin: 0,
          padding: '48px 24px',
          fontFamily: 'system-ui, sans-serif',
          backgroundColor: '#ffffff',
          color: '#1a2e1f',
          lineHeight: 1.5,
        }}
      >
        <main style={{ maxWidth: '36rem', margin: '0 auto' }}>
          <h1
            style={{ fontSize: '2.25rem', lineHeight: 1.1, margin: '0 0 16px' }}
          >
            Něco se u nás pokazilo
          </h1>
          <p style={{ margin: '0 0 24px' }}>
            Chybu jsme si zapsali a podíváme se na ni. Zkuste to prosím za
            chvíli znovu.
          </p>

          <p style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={retry}
              style={{
                minHeight: '44px',
                padding: '10px 20px',
                borderRadius: '8px',
                border: 'none',
                // #5bc894 with #1a2e1f on it: the contrast rule holds even
                // here. White on this green is 2.07:1.
                backgroundColor: '#5bc894',
                color: '#1a2e1f',
                fontWeight: 600,
                fontSize: '1rem',
                cursor: 'pointer',
              }}
            >
              ZKUSIT ZNOVU
            </button>
            {/*
              A plain `<a>`, not `next/link`, and deliberately so: the root
              layout has just failed, so a client-side navigation would mount
              the same broken tree again. A full document load is the only
              thing that can recover.
            */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              style={{
                minHeight: '44px',
                display: 'inline-flex',
                alignItems: 'center',
                padding: '10px 20px',
                borderRadius: '8px',
                border: '1px solid #6d8775',
                color: '#1a2e1f',
                textDecoration: 'none',
                fontWeight: 600,
              }}
            >
              NA ÚVOD
            </a>
          </p>

          {/*
            Rule 5's furniture, in its minimal form. This page can be the
            only page a visitor sees, so the help line has to be on it — the
            rule is "every page", and an outage does not exempt one.
          */}
          <hr
            style={{
              border: 'none',
              borderTop: '1px solid #dde8e0',
              margin: '32px 0 16px',
            }}
          />
          <p style={{ fontSize: '0.875rem', color: '#4a5f50', margin: 0 }}>
            18+ · Informační a analytická služba o sportu. Nepřijímáme sázky a
            neprovozujeme hazardní hru. Máte problém s hazardem? Národní linka
            pro odvykání,{' '}
            <a href="tel:800350000" style={{ color: '#27714e' }}>
              800 350 000
            </a>
            .
          </p>
        </main>
      </body>
    </html>
  )
}
