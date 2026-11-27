/**
 * Would the gate serve this internal link?
 *
 * Navigation and calls to action ask this before they render a link, so the
 * public site never offers a control that leads to a closed area. The answer
 * comes from `decide()` itself, the same function the proxy runs, so a link
 * and the gate cannot disagree about whether a destination is open: there is
 * no second list of "what is open in which mode" to keep in step.
 *
 * Leaving a link out is presentation only. The proxy refuses the destination
 * whether or not anything links to it.
 *
 * Only root-relative links are judged. Anything else — an absolute URL, a
 * protocol-relative `//host`, a `/\host` that a browser reads as one, an
 * unparsable string — answers false: this helper is for internal links, and
 * a caller that hands it something else gets the narrow answer.
 *
 * Dependency-free apart from `decide.ts`, so it runs under Node's native type
 * stripping in the unit tests.
 */
import { decide } from './decide.ts'

const BASE = 'http://launch-gate-link.invalid'

export const isLinkServedInMode = (mode: unknown, href: string): boolean => {
  if (!href.startsWith('/')) {
    return false
  }

  let url: URL

  try {
    url = new URL(href, BASE)
  } catch {
    return false
  }

  // `//host/x` and `/\host/x` are root-relative only in appearance.
  if (url.origin !== BASE) {
    return false
  }

  return (
    decide({
      mode,
      method: 'GET',
      pathname: url.pathname,
      development: false,
    }).action === 'pass'
  )
}
