import { getTranslations } from 'next-intl/server'

import { Card } from '@/components/ui/Card'
import { LoadingAnnouncement, Skeleton } from '@/components/ui/States'

/**
 * The history page's loading state.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE SKELETON IS THE SHAPE OF THE PAGE, NOT A SPINNER
 *
 * This page does real work — it reads every settled tip — so the fallback is
 * on screen for a measurable moment on a cold cache. A centred spinner would
 * leave the reader with no idea what is coming and would then be replaced by
 * a full page of content, which is a large layout shift at the exact moment
 * they start reading.
 *
 * So the blocks match the real page's structure and roughly its heights: a
 * heading, the figure grid, the chart box, and the first rows of the table.
 * The chart block carries the same 3:1 aspect ratio as the SVG, so the
 * swap costs nothing in CLS.
 *
 * One `role="status"` announcement for a screen reader; every grey block is
 * `aria-hidden`, because forty announced rectangles are worse than silence.
 */
export default async function HistoryLoading() {
  const t = await getTranslations('common')

  return (
    <div className="page-shell page-gutter flex flex-col gap-12 py-10">
      <LoadingAnnouncement label={t('loading')} />

      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-80 max-w-full" />
        <Skeleton className="h-6 w-full max-w-prose" />
        <Skeleton className="h-5 w-64" />
      </div>

      {/* The figure grid: same columns, same gap. */}
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="flex flex-col gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-9 w-28" />
          </div>
        ))}
      </div>

      {/* The chart. 960×320 in the real SVG, so 3:1 here. */}
      <Card>
        <Skeleton className="aspect-[3/1] w-full" rounded="card" />
      </Card>

      {/* The first rows of the table. */}
      <div className="flex flex-col gap-3">
        <Skeleton className="h-6 w-48" />
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </div>
    </div>
  )
}
