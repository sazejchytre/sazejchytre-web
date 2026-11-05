'use client'

/**
 * The catch-all route error boundary: the 500 page, in the site's design.
 *
 * Covers any route under `(frontend)` that does not have its own boundary.
 * The root LAYOUT's own failures are not caught here — nothing inside a
 * layout can be — which is what `src/app/global-error.tsx` is for.
 */
import { RouteError } from '@/components/layout/RouteError'

export default function FrontendError(props: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return <RouteError {...props} event="frontend.render_failed" />
}
