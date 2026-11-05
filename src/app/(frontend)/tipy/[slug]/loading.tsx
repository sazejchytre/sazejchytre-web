import { getTranslations } from 'next-intl/server'

import { Card } from '@/components/ui/Card'
import { LoadingAnnouncement, Skeleton } from '@/components/ui/States'

/**
 * The tip page's loading state.
 *
 * Shaped like the real page: badges, a display heading, the result block and
 * the selections table. The result block is reserved whether or not this tip
 * has settled — a skeleton that guessed would shift the page for half the
 * tips on the site.
 */
export default async function TipLoading() {
  const t = await getTranslations('common')

  return (
    <div className="page-shell page-gutter flex flex-col gap-10 py-10">
      <LoadingAnnouncement label={t('loading')} />

      <div className="flex flex-col gap-4">
        <div className="flex gap-3">
          <Skeleton className="h-6 w-24" rounded="pill" />
          <Skeleton className="h-6 w-28" rounded="pill" />
        </div>
        <Skeleton className="h-10 w-96 max-w-full" />
        <Skeleton className="h-5 w-56" />
      </div>

      <Card>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-7 w-32" rounded="pill" />
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="flex flex-col gap-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-9 w-24" />
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      </Card>
    </div>
  )
}
