'use client'

/**
 * The history page's error boundary.
 *
 * The content lives in `RouteError`; this file exists because `error.tsx` is
 * a file convention with a fixed signature. The route-level boundary keeps
 * the header, the footer and the permanent furniture on screen, so a failed
 * track record does not cost the reader the navigation and the help-line
 * number as well.
 *
 * The thing most likely to fail here is the database read, which makes a
 * retry worth offering.
 */
import { RouteError } from '@/components/layout/RouteError'

export default function HistoryError(props: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return <RouteError {...props} event="history.render_failed" />
}
