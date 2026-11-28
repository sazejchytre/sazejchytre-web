import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  ABSENCE_WINDOW_MS,
  CHECK_INTERVAL_MS,
  CHECK_TIMEOUT_MS,
  COUNT_VERIFIED_ADMINISTRATORS_SQL,
  UNAVAILABLE_GRACE_MS,
  VERIFIED_ADMINISTRATOR_CONDITION,
  decideCreation,
  decideRemoval,
  isPresenceEnforced,
  probeFromCount,
  probeFromError,
  verdictAtBoot,
  verdictWhileRunning,
} from './policy.ts'

describe('isPresenceEnforced', () => {
  it('is enforced for a production server', () => {
    assert.equal(
      isPresenceEnforced({ development: false, runtime: 'nodejs' }),
      true,
    )
  })

  it('is enforced when the runtime is not reported (fail closed)', () => {
    assert.equal(isPresenceEnforced({ development: false }), true)
  })

  it('is not enforced under the development server', () => {
    assert.equal(
      isPresenceEnforced({ development: true, runtime: 'nodejs' }),
      false,
    )
  })

  it('is not enforced while Next builds', () => {
    assert.equal(
      isPresenceEnforced({
        development: false,
        nextPhase: 'phase-production-build',
        runtime: 'nodejs',
      }),
      false,
    )
  })

  it('is enforced in the production server phase', () => {
    assert.equal(
      isPresenceEnforced({
        development: false,
        nextPhase: 'phase-production-server',
        runtime: 'nodejs',
      }),
      true,
    )
  })
})

describe('the window', () => {
  it('is a few seconds, and the constants agree with each other', () => {
    assert.equal(ABSENCE_WINDOW_MS, CHECK_INTERVAL_MS + CHECK_TIMEOUT_MS)
    assert.ok(ABSENCE_WINDOW_MS <= 10_000, 'removal acted on within 10 s')
    assert.ok(UNAVAILABLE_GRACE_MS > CHECK_INTERVAL_MS)
    assert.ok(UNAVAILABLE_GRACE_MS <= 30_000)
  })
})

describe('the count query', () => {
  it('requires an email, a hash and a salt', () => {
    for (const column of ['"email"', '"hash"', '"salt"']) {
      assert.match(VERIFIED_ADMINISTRATOR_CONDITION, new RegExp(column))
    }
    assert.match(COUNT_VERIFIED_ADMINISTRATORS_SQL, /FROM "users" WHERE/)
    assert.ok(
      COUNT_VERIFIED_ADMINISTRATORS_SQL.endsWith(
        VERIFIED_ADMINISTRATOR_CONDITION,
      ),
    )
  })
})

describe('probeFromCount', () => {
  it('reads a positive count as present', () => {
    assert.deepEqual(probeFromCount(2), { kind: 'present', count: 2 })
    assert.deepEqual(probeFromCount('1'), { kind: 'present', count: 1 })
  })

  it('reads zero as absent', () => {
    assert.deepEqual(probeFromCount(0), { kind: 'absent' })
  })

  it('reads anything unreadable as absent, never as present', () => {
    for (const value of [undefined, null, 'x', -1, 1.5, NaN, {}]) {
      assert.deepEqual(probeFromCount(value), { kind: 'absent' }, String(value))
    }
  })
})

describe('probeFromError', () => {
  it('treats a missing table, schema or database as schema-missing', () => {
    for (const code of ['42P01', '3F000', '3D000']) {
      assert.deepEqual(
        probeFromError(Object.assign(new Error('x'), { code })),
        {
          kind: 'schema-missing',
        },
      )
    }
  })

  it('treats connection failures as unavailable', () => {
    const probe = probeFromError(
      Object.assign(new Error('connect ECONNREFUSED'), {
        code: 'ECONNREFUSED',
      }),
    )
    assert.equal(probe.kind, 'unavailable')
  })

  it('never copies the driver message into the detail', () => {
    const probe = probeFromError(
      Object.assign(
        new Error('password authentication failed for user "x" at db.example'),
        {
          code: '28P01',
        },
      ),
    )
    assert.equal(probe.kind, 'unavailable')
    assert.ok(probe.kind === 'unavailable' && !probe.detail.includes('example'))
    assert.ok(probe.kind === 'unavailable' && !probe.detail.includes('"x"'))
  })
})

describe('verdictAtBoot', () => {
  it('serves only with a confirmed administrator', () => {
    assert.deepEqual(verdictAtBoot({ kind: 'present', count: 1 }), {
      action: 'serve',
    })
  })

  it('refuses on absent, schema-missing and unavailable', () => {
    assert.deepEqual(verdictAtBoot({ kind: 'absent' }), {
      action: 'refuse',
      reason: 'absent',
    })
    assert.deepEqual(verdictAtBoot({ kind: 'schema-missing' }), {
      action: 'refuse',
      reason: 'schema-missing',
    })
    assert.deepEqual(verdictAtBoot({ kind: 'unavailable', detail: 'x' }), {
      action: 'refuse',
      reason: 'unavailable',
    })
  })
})

describe('verdictWhileRunning', () => {
  const at = { now: 100_000, lastConfirmedAt: 99_000, graceMs: 15_000 }

  it('refuses at once on absence, whatever the last good check', () => {
    assert.equal(verdictWhileRunning({ kind: 'absent' }, at).action, 'refuse')
    assert.equal(
      verdictWhileRunning({ kind: 'schema-missing' }, at).action,
      'refuse',
    )
  })

  it('tolerates an unavailable database within the grace period', () => {
    assert.equal(
      verdictWhileRunning({ kind: 'unavailable', detail: 'x' }, at).action,
      'serve',
    )
  })

  it('refuses once the grace period has passed', () => {
    assert.deepEqual(
      verdictWhileRunning(
        { kind: 'unavailable', detail: 'x' },
        { now: 115_000, lastConfirmedAt: 100_000, graceMs: 15_000 },
      ),
      { action: 'refuse', reason: 'unavailable' },
    )
  })
})

describe('decideCreation', () => {
  it('allows anything under the development server', () => {
    assert.deepEqual(
      decideCreation({
        development: true,
        actorIsAdministrator: false,
        bootstrap: false,
      }),
      { action: 'allow' },
    )
  })

  it('allows a signed-in administrator', () => {
    assert.deepEqual(
      decideCreation({
        development: false,
        actorIsAdministrator: true,
        bootstrap: false,
      }),
      { action: 'allow' },
    )
  })

  it('allows the initialization command only if none exist', () => {
    assert.deepEqual(
      decideCreation({
        development: false,
        actorIsAdministrator: false,
        bootstrap: true,
      }),
      { action: 'allow-if-none-exist' },
    )
  })

  it('refuses everyone else outside development', () => {
    assert.deepEqual(
      decideCreation({
        development: false,
        actorIsAdministrator: false,
        bootstrap: false,
      }),
      { action: 'refuse' },
    )
  })
})

describe('decideRemoval', () => {
  it('refuses removing the last verified administrator', () => {
    assert.equal(
      decideRemoval({ targetIsVerified: true, otherVerified: 0 }),
      'refuse',
    )
  })

  it('allows removing one of several', () => {
    assert.equal(
      decideRemoval({ targetIsVerified: true, otherVerified: 1 }),
      'allow',
    )
  })

  it('allows removing a record that is not a verified administrator', () => {
    assert.equal(
      decideRemoval({ targetIsVerified: false, otherVerified: 0 }),
      'allow',
    )
  })
})
