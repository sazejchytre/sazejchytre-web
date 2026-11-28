/**
 * Seeds development tips or retires the entire confirmed fixture database.
 *
 *   pnpm seed:tips         upsert sports, competitions, events and 15 tips
 *   pnpm seed:tips:purge   owner-only retirement of a confirmed fixture database
 *
 * The package scripts select the operation through SEED_PURGE. Top-level
 * await keeps Payload's CLI alive until the selected operation finishes.
 */
if (process.env.SEED_PURGE === '1') {
  const { disposeDatabase } = await import('../lib/testing/dispose-database.ts')
  await disposeDatabase(
    process.env.DATABASE_URL,
    process.env.DISPOSABLE_DROP_DATABASE,
    process.env.DISPOSABLE_MAINTENANCE_DATABASE,
  )
} else {
  const { seedTips } = await import('@/seed/tips')
  await seedTips()
}

process.exit(0)
