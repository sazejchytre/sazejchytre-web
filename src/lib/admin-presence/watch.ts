/**
 * The presence check as a loop: once at boot, then on a fixed interval.
 *
 * Everything with a side effect is injected — the probe, the clock, the timer
 * and what "refuse" means — so the loop is unit-tested with a fake clock and
 * the real server wires in a database query and a process exit
 * (`runtime.ts`).
 *
 * Checks never overlap: the next one is scheduled only after the previous one
 * has finished, and each probe is expected to bound itself
 * (`CHECK_TIMEOUT_MS`). That keeps the window in `policy.ts` honest: at most
 * one interval plus one timeout between a change and the check that sees it.
 *
 * Dependency-free: unit tests run it under Node's type stripping.
 */
import {
  CHECK_INTERVAL_MS,
  UNAVAILABLE_GRACE_MS,
  verdictAtBoot,
  verdictWhileRunning,
  type PresenceProbe,
  type PresenceVerdict,
} from './policy.ts'

export type RefusalReason = Extract<
  PresenceVerdict,
  { action: 'refuse' }
>['reason']

export type RefusalEvent = {
  phase: 'boot' | 'running'
  reason: RefusalReason
  probe: PresenceProbe
}

export type WatchDependencies = {
  probe: () => Promise<PresenceProbe>
  /** Stop serving. In the server this does not return. */
  refuse: (event: RefusalEvent) => void
  /** Called for a tolerated unavailable check while still within grace. */
  onDegraded?: (probe: PresenceProbe) => void
  now?: () => number
  schedule?: (callback: () => void, ms: number) => { cancel: () => void }
  intervalMs?: number
  graceMs?: number
}

export type AdministratorWatch = {
  /**
   * Run the boot check. Resolves `true` and starts the interval when an
   * administrator is confirmed; otherwise calls `refuse` and resolves `false`.
   */
  start: () => Promise<boolean>
  /** Stop the interval. Used by tests; the server never stops watching. */
  stop: () => void
  /** Run one interval check now (tests drive the loop with this). */
  checkOnce: () => Promise<PresenceVerdict>
}

const defaultSchedule = (callback: () => void, ms: number) => {
  const timer = setTimeout(callback, ms)
  // Never keep a process alive just to run the next check.
  timer.unref?.()

  return { cancel: () => clearTimeout(timer) }
}

/** A probe that throws is a probe that did not answer. */
const safeProbe = async (
  probe: () => Promise<PresenceProbe>,
): Promise<PresenceProbe> => {
  try {
    return await probe()
  } catch (error) {
    const name = error instanceof Error ? error.name : typeof error

    return { kind: 'unavailable', detail: `probe threw ${name}` }
  }
}

export const createAdministratorWatch = ({
  probe,
  refuse,
  onDegraded,
  now = Date.now,
  schedule = defaultSchedule,
  intervalMs = CHECK_INTERVAL_MS,
  graceMs = UNAVAILABLE_GRACE_MS,
}: WatchDependencies): AdministratorWatch => {
  let lastConfirmedAt = 0
  let pending: { cancel: () => void } | undefined
  let stopped = false
  let refused = false

  const refuseOnce = (event: RefusalEvent) => {
    if (refused) return
    refused = true
    stopped = true
    pending?.cancel()
    refuse(event)
  }

  const checkOnce = async (): Promise<PresenceVerdict> => {
    const result = await safeProbe(probe)
    const verdict = verdictWhileRunning(result, {
      now: now(),
      lastConfirmedAt,
      graceMs,
    })

    if (result.kind === 'present') {
      lastConfirmedAt = now()
    } else if (verdict.action === 'serve') {
      onDegraded?.(result)
    }

    if (verdict.action === 'refuse') {
      refuseOnce({ phase: 'running', reason: verdict.reason, probe: result })
    }

    return verdict
  }

  const loop = () => {
    if (stopped) return

    pending = schedule(() => {
      void checkOnce().then(loop)
    }, intervalMs)
  }

  return {
    start: async () => {
      const result = await safeProbe(probe)
      const verdict = verdictAtBoot(result)

      if (verdict.action === 'refuse') {
        refuseOnce({ phase: 'boot', reason: verdict.reason, probe: result })

        return false
      }

      lastConfirmedAt = now()
      loop()

      return true
    },
    stop: () => {
      stopped = true
      pending?.cancel()
    },
    checkOnce,
  }
}
