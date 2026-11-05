'use client'

/**
 * The tip page's error boundary. See `RouteError` for the reasoning.
 *
 * A missing tip is NOT an error — `notFound()` renders `not-found.tsx` and
 * answers 404. This boundary is for a genuine failure: the database read, or
 * a malformed row the renderer cannot make sense of.
 */
import { RouteError } from '@/components/layout/RouteError'

export default function TipError(props: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return <RouteError {...props} event="tip.render_failed" />
}
