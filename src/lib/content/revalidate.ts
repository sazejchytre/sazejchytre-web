/**
 * Throwing away a cached content tag when the operator edits something.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS MODULE EXISTS AT ALL
 *
 * Because without it, the cache tags in `src/lib/cache/keys.ts` were
 * decoration. The loaders attached them to every cached read and nothing
 * anywhere called `revalidateTag`, so the only thing that ever expired a
 * cached legal page was the five-minute clock.
 *
 * Five minutes is a usable fallback, not an acceptable primary mechanism. The
 * operator edits the privacy policy, opens the page, sees the old text, and
 * reasonably concludes the admin panel did not save. Then they edit it again.
 *
 * With this wired in, a save in the admin panel invalidates the tag and the
 * next request re-reads — immediately. The clock stays as the backstop for
 * anything that writes without going through a hook.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY `next/cache` IS IMPORTED DYNAMICALLY
 *
 * Collection configs are loaded by the Payload CLI — `payload migrate`,
 * `payload generate:types` — in plain Node, with no Next runtime at all.
 * A static `import { revalidateTag } from 'next/cache'` at the top of a
 * collection file would therefore be evaluated by every migration command.
 * Dynamic, inside the hook, means the module is only reached when a hook
 * actually runs, which is only ever inside a Next request.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY A FAILURE IS SWALLOWED
 *
 * `revalidateTag` throws if it is called outside a request scope — which is
 * exactly what happens when a document is written by a seed script or a
 * migration. Failing the WRITE because the cache could not be cleared would
 * be the wrong trade in every case: the data is saved, and the worst outcome
 * of a missed invalidation is content that is up to five minutes stale.
 *
 * It is logged at warn, so a systematic failure is visible rather than
 * inferred from "the admin panel feels stale".
 */
import type { CacheTag } from '../cache/keys.ts'

export const revalidateContentTag = async (tag: CacheTag): Promise<void> => {
  try {
    const { revalidateTag } = await import('next/cache')

    /**
     * `{ expire: 0 }`, not the recommended `'max'`.
     *
     * Next 16 made the second argument mandatory — it says how long stale
     * content may still be served while the revalidation runs. `'max'` is the
     * right default for a blog, where being fast matters more than being
     * current for a year.
     *
     * It is the wrong answer here, for the exact reason this hook exists. The
     * operator has just saved a legal document and is about to look at it. If
     * the next request is served the stale copy while a background refresh
     * runs, they see the old text — which is the behaviour the five-minute
     * clock already gave us and the thing this is meant to fix. `expire: 0`
     * makes the next request block and re-read, which for a page nobody is
     * requesting thousands of times a second costs one query.
     *
     * (`updateTag` would be the idiomatic call, but it is for Server Actions.
     * This runs in a Payload collection hook, inside the admin panel's REST
     * route handler.)
     */
    revalidateTag(tag, { expire: 0 })
  } catch (error) {
    console.warn(
      JSON.stringify({
        scope: 'content',
        event: 'revalidate.skipped',
        tag,
        reason: error instanceof Error ? error.name : 'unknown',
      }),
    )
  }
}

/**
 * The Payload hook, ready to drop into a collection or a global.
 *
 * Returns the document untouched — a revalidation hook that altered its
 * input would be a surprising place to find a data change.
 */
export const revalidateOnChange =
  (tag: CacheTag) =>
  async <T>({ doc }: { doc: T }): Promise<T> => {
    await revalidateContentTag(tag)

    return doc
  }

/**
 * The delete variant.
 *
 * Payload's `afterDelete` passes the deleted document and its return value is
 * ignored, so this one returns nothing. A deleted FAQ entry has to clear the
 * cache for the same reason a changed one does — otherwise the answer stays
 * on the page, and in the structured data, for five minutes after it was
 * removed.
 */
export const revalidateOnDelete =
  (tag: CacheTag) => async (): Promise<void> => {
    await revalidateContentTag(tag)
  }
