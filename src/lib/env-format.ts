import type { ZodError } from 'zod'

/**
 * Render Zod issues as `KEY: reason` lines.
 *
 * Deliberately prints only the variable NAME and the validation reason —
 * never the received value. A malformed `DATABASE_URL` must not end up in a
 * crash log, a CI transcript, or a Vercel build log.
 */
export function formatEnvIssues(error: ZodError): string {
  const lines = error.issues.map((issue) => {
    const key = issue.path.join('.') || '(root)'
    return `  - ${key}: ${issue.message}`
  })

  return [...new Set(lines)].sort().join('\n')
}
