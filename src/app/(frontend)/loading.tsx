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
 *
 * ──────────────────────────────────────────────────────────────────────────
 * `min-h-screen` IS THE WHOLE CLS FIX, AND IT TOOK THREE GUESSES TO FIND
 *
 * These pages are `force-dynamic`, so Next streams them: the shell and this
 * fallback paint first, inside a Suspense boundary, and the real content
 * replaces it when the render finishes. Verified in the response itself —
 * `<template id="B:0">` for the placeholder, `hidden id="S:0"` for the
 * content that follows.
 *
 * This skeleton was about 400px tall. Every real page is several thousand.
 * So the footer PAINTED IN THE VIEWPORT during the fallback and was then
 * pushed far down the page, and Lighthouse measured CLS 0.104 on the home
 * page — naming the `<footer>`, which was the element that moved rather than
 * the cause. `/historie` never shifted, because its own skeleton is roughly
 * as tall as its real content, so its footer was never on screen to move.
 *
 * Reserving a viewport means the footer starts below the fold, where a later
 * move costs nothing: CLS only counts shifts of content that was visible.
 * Two wrong guesses first — Turnstile's unreserved iframe (a real CLS source
 * on its own, now also fixed) and the hero heading's font-swap wrap point
 * (not a factor; next/font's metric-adjusted fallback handles it).
 */
export default async function FrontendLoading() {
  const t = await getTranslations('common')

  return (
    // `min-h-screen`: see the header. This is a layout-stability measure, not
    // spacing — it stops the footer being painted above the fold and then
    // displaced when the real page arrives.
    <div className="page-shell page-gutter flex min-h-screen flex-col gap-8 py-10">
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
