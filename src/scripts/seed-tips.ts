/**
 * Seeds (or purges) the development tips fixture.
 *
 *   pnpm seed:tips         upsert sports, competitions, events and 15 tips
 *   pnpm seed:tips:purge   delete every row marked seed-step-3b
 *
 * The mode comes from SEED_PURGE, not from argv: `payload run` consumes extra
 * flags itself and does not forward them, so `--purge` silently ran the seed.
 *
 * Uses TOP-LEVEL await rather than `main().then(…)`: `payload run` exits once
 * module evaluation finishes, so a floating promise is abandoned half-done and
 * the script appears to succeed having written nothing.
 */
import { purgeSeededTips, seedTips } from '@/seed/tips'

if (process.env.SEED_PURGE === '1') {
  await purgeSeededTips()
} else {
  await seedTips()
}

process.exit(0)
