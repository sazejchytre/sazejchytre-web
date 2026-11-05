import { getTranslations } from 'next-intl/server'

import { LoadingAnnouncement, Skeleton } from '@/components/ui/States'

/**
 * The default loading state for every page under `(frontend)`.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ONE GENERIC SKELETON, PLUS SPECIFIC ONES WHERE IT MATTERS
 *
 * `/historie` and `/tipy/[slug]` have their own, because their shapes are
 * distinctive enough that a generic block would be a visible layout shift
 * when the real page arrives. Everything else is a heading, a paragraph and
 * a card or two, which is what this is.
 *
 * A boundary at the route-group root also means the header, the footer and
 * the permanent furniture render immediately on a cold navigation — so the
 * 18+ marker and the help-line number are on screen before the content is,
 * rather than arriving with it.
 */
export default async function FrontendLoading() {
  const t = await getTranslations('common')

  return (
    <div className="page-shell page-gutter flex flex-col gap-8 py-10">
      <LoadingAnnouncement label={t('loading')} />

      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-72 max-w-full" />
        <Skeleton className="h-6 w-full max-w-prose" />
      </div>

      <Skeleton className="h-48 w-full" rounded="card" />
      <Skeleton className="h-32 w-full max-w-xl" rounded="card" />
    </div>
  )
}
