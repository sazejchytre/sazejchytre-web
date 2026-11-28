import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { PresenceProbe } from './policy.ts'
import { createAdministratorWatch, type RefusalEvent } from './watch.ts'

/** A fake clock and timer queue, driven by the test. */
const harness = (probes: PresenceProbe[] | (() => Promise<PresenceProbe>)) => {
  let time = 0
  const timers: { at: number; callback: () => void; cancelled: boolean }[] = []
  const refusals: RefusalEvent[] = []
  const degraded: PresenceProbe[] = []
  let probeCalls = 0

  const probe =
    typeof probes === 'function'
      ? probes
      : async () => {
          const next = probes[Math.min(probeCalls, probes.length - 1)]
          probeCalls += 1
          if (!next) throw new Error('no probe scripted')

          return next
        }

  const watch = createAdministratorWatch({
    probe,
    refuse: (event) => refusals.push(event),
    onDegraded: (result) => degraded.push(result),
    now: () => time,
    schedule: (callback, ms) => {
      const timer = { at: time + ms, callback, cancelled: false }
      timers.push(timer)

      return { cancel: () => (timer.cancelled = true) }
    },
    intervalMs: 5_000,
    graceMs: 15_000,
  })

  /** Advance the clock, firing due timers and letting their checks finish. */
  const advance = async (ms: number) => {
    const target = time + ms
    for (;;) {
      const due = timers
        .filter((timer) => !timer.cancelled && timer.at <= target)
        .sort((a, b) => a.at - b.at)[0]
      if (!due) break
      due.cancelled = true
      time = due.at
      due.callback()
      // Let the probe and the re-scheduling settle.
      for (let i = 0; i < 10; i += 1) await Promise.resolve()
    }
    time = target
  }

  const scheduled = () => timers.filter((timer) => !timer.cancelled).length

  return { watch, advance, refusals, degraded, scheduled }
}

const present: PresenceProbe = { kind: 'present', count: 1 }
const absent: PresenceProbe = { kind: 'absent' }
const down: PresenceProbe = {
  kind: 'unavailable',
  detail: 'Error ECONNREFUSED',
}

describe('administrator watch: boot', () => {
  it('starts and schedules the next check when an administrator exists', async () => {
    const h = harness([present])
    assert.equal(await h.watch.start(), true)
    assert.equal(h.refusals.length, 0)
    assert.equal(h.scheduled(), 1)
  })

  it('refuses at boot on a fresh install (no administrator)', async () => {
    const h = harness([absent])
    assert.equal(await h.watch.start(), false)
    assert.deepEqual(h.refusals, [
      { phase: 'boot', reason: 'absent', probe: absent },
    ])
    assert.equal(h.scheduled(), 0)
  })

  it('refuses at boot on an empty restored database (no table)', async () => {
    const h = harness([{ kind: 'schema-missing' }])
    assert.equal(await h.watch.start(), false)
    assert.equal(h.refusals[0]?.reason, 'schema-missing')
  })

  it('refuses at boot when the database does not answer', async () => {
    const h = harness([down])
    assert.equal(await h.watch.start(), false)
    assert.equal(h.refusals[0]?.reason, 'unavailable')
  })

  it('refuses at boot when the probe itself throws', async () => {
    const h = harness(async () => {
      throw new Error('boom')
    })
    assert.equal(await h.watch.start(), false)
    assert.equal(h.refusals[0]?.reason, 'unavailable')
  })
})

describe('administrator watch: running', () => {
  it('refuses within one interval after the last administrator is removed', async () => {
    const h = harness([present, present, absent])
    await h.watch.start()

    await h.advance(5_000) // second check: still present
    assert.equal(h.refusals.length, 0)

    await h.advance(5_000) // third check: absent
    assert.deepEqual(h.refusals, [
      { phase: 'running', reason: 'absent', probe: absent },
    ])
    assert.equal(h.scheduled(), 0, 'no further checks after refusing')
  })

  it('refuses once and only once', async () => {
    const h = harness([present, absent, absent, absent])
    await h.watch.start()
    await h.advance(30_000)
    assert.equal(h.refusals.length, 1)
  })

  it('tolerates an unreachable database within the grace period', async () => {
    const h = harness([present, down, down, present, present])
    await h.watch.start()
    await h.advance(20_000)
    assert.equal(h.refusals.length, 0)
    assert.equal(h.degraded.length, 2)
  })

  it('refuses once the database has been unreachable for the grace period', async () => {
    const h = harness([present, down])
    await h.watch.start()
    await h.advance(10_000) // 5 s and 10 s since the last good check
    assert.equal(h.refusals.length, 0)
    await h.advance(5_000) // 15 s: grace exhausted
    assert.equal(h.refusals[0]?.reason, 'unavailable')
  })

  it('a database swapped for one without the table refuses at once', async () => {
    const h = harness([present, { kind: 'schema-missing' }])
    await h.watch.start()
    await h.advance(5_000)
    assert.equal(h.refusals[0]?.reason, 'schema-missing')
  })

  it('does not overlap checks: the next is scheduled after the previous finishes', async () => {
    let release: (() => void) | undefined
    let calls = 0
    const h = harness(async () => {
      calls += 1
      if (calls === 2) {
        await new Promise<void>((resolve) => (release = resolve))
      }

      return present
    })
    await h.watch.start()
    await h.advance(5_000) // second check starts and hangs
    assert.equal(calls, 2)
    assert.equal(h.scheduled(), 0, 'nothing scheduled while a check runs')
    await h.advance(20_000)
    assert.equal(calls, 2)
    release?.()
    for (let i = 0; i < 10; i += 1) await Promise.resolve()
    assert.equal(h.scheduled(), 1)
  })

  it('stop() cancels the next check', async () => {
    const h = harness([present])
    await h.watch.start()
    h.watch.stop()
    assert.equal(h.scheduled(), 0)
  })
})
