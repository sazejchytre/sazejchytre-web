/**
 * Deletes `auth_lockouts` rows past their retention window.
 *
 * No scheduler yet, by design: this is the callable, so the behaviour exists
 * and is tested before anything automates it.
 *
 *   pnpm sweep:lockouts            sweep at the default 90 days
 *   pnpm sweep:lockouts --days=30  sweep at a shorter window
 *   pnpm sweep:lockouts --dry      report what would go, delete nothing
 */
/* eslint-disable no-console -- this is a CLI; stdout is its interface. */
import { getPayload } from 'payload'

import config from '@/payload.config'
import {
  LOCKOUT_RETENTION_DAYS,
  lockoutRetentionCutoff,
  sweepAuthLockouts,
} from '@/lib/auth/lockout-retention'

const arg = (name: string): string | undefined =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.split('=')[1]

const main = async (): Promise<void> => {
  const dry = process.argv.includes('--dry')
  const days = arg('days') ? Number(arg('days')) : LOCKOUT_RETENTION_DAYS
  const now = new Date()
  const cutoff = lockoutRetentionCutoff(now, days)

  const payload = await getPayload({ config })

  const expired = await payload.count({
    collection: 'auth-lockouts',
    where: { createdAt: { less_than: cutoff.toISOString() } },
    overrideAccess: true,
  })

  console.log(`Retention: ${days} days`)
  console.log(`Cutoff:    ${cutoff.toISOString()}`)
  console.log(`Expired:   ${expired.totalDocs}`)

  if (dry) {
    console.log('\nDry run — nothing deleted.')
    return
  }

  const result = await sweepAuthLockouts({ payload, now, retentionDays: days })

  console.log(`Deleted:   ${result.deleted}`)
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(
      error instanceof Error ? `${error.name}: ${error.message}` : error,
    )
    process.exit(1)
  })
