'use client'

/**
 * The body of every route-level error boundary.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ONE COMPONENT, SEVERAL BOUNDARIES
 *
 * `error.tsx` has to be a client component and has to default-export a
 * component with Next's signature, so each boundary file is a thin wrapper.
 * The content lives here, once, because an error page is exactly the kind of
 * page that gets written four times and diverges four ways — and the last
 * place a visitor should meet an inconsistent design is the page that tells
 * them something went wrong.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * `retry`, NOT `reset`
 *
 * Next 16 renamed the prop. A boundary still destructuring `reset` gets
 * `undefined`, and its retry button silently does nothing — a page that is
 * broken twice.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE ERROR IS LOGGED, NOT SHOWN
 *
 * A rendered `error.message` says something like
 * "connect ECONNREFUSED 10.0.0.4:5432", which tells the visitor nothing and
 * tells everybody else our topology. The `digest` goes to the console, which
 * is what correlates this render with the server-side log entry holding the
 * real stack.
 */
import { useTranslations } from 'next-intl'
import { useEffect } from 'react'

import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/States'

export type RouteErrorProps = {
  error: Error & { digest?: string }
  retry: () => void
  /** Appears in the log line, so the failing route is identifiable. */
  event: string
}

export const RouteError = ({ error, retry, event }: RouteErrorProps) => {
  const t = useTranslations('errors.generic')
  const notFound = useTranslations('errors.notFound')

  useEffect(() => {
    console.error(
      JSON.stringify({
        scope: 'frontend',
        event,
        digest: error.digest ?? null,
        name: error.name,
      }),
    )
  }, [error, event])

  return (
    <div className="page-shell page-gutter py-16">
      <ErrorState
        title={t('heading')}
        action={
          <div className="flex flex-wrap gap-3">
            <Button onClick={retry} variant="primary">
              {t('retryCta')}
            </Button>
            <Button href="/" variant="secondary">
              {notFound('homeCta')}
            </Button>
          </div>
        }
      >
        {t('body')}
      </ErrorState>
    </div>
  )
}
