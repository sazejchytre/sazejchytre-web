import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  EXAMPLE_TIP_PAYLOAD,
  validateTipIngestionPayload,
} from './ingestion.ts'

/** A deep clone, so a test can mutate without affecting the next one. */
const payload = (): Record<string, unknown> =>
  JSON.parse(JSON.stringify(EXAMPLE_TIP_PAYLOAD)) as Record<string, unknown>

const problemsFor = (input: unknown): string[] => {
  const result = validateTipIngestionPayload(input)

  assert.equal(result.ok, false, 'expected the payload to be rejected')

  return result.ok ? [] : result.problems.map((p) => `${p.path}: ${p.message}`)
}

describe('the documented example', () => {
  it('validates', () => {
    // If this fails, docs/tip-ingestion-contract.md is lying to the partner.
    const result = validateTipIngestionPayload(EXAMPLE_TIP_PAYLOAD)

    assert.equal(result.ok, true)
  })

  it('round-trips through JSON unchanged', () => {
    // The partner sends JSON, so the example has to survive serialisation.
    const result = validateTipIngestionPayload(payload())

    assert.equal(result.ok, true)
  })
})

describe('integers in a stated scale', () => {
  it('rejects decimal odds', () => {
    const input = payload()
    ;(input.selections as Record<string, unknown>[])[0]!.oddsAtPublication = 2.1

    assert.match(
      problemsFor(input).join('\n'),
      /thousandths/,
      'the message must tell the partner what to send instead',
    )
  })

  it('rejects a decimal line', () => {
    const input = payload()
    ;(input.selections as Record<string, unknown>[])[0]!.line = 2.5

    assert.match(problemsFor(input).join('\n'), /hundredths/)
  })

  it('rejects a decimal stake', () => {
    const input = payload()
    input.stakeUnits = 1.5

    assert.ok(problemsFor(input).some((p) => p.startsWith('stakeUnits')))
  })

  it('rejects odds below evens', () => {
    const input = payload()
    ;(input.selections as Record<string, unknown>[])[0]!.oddsAtPublication = 999

    assert.ok(problemsFor(input).length > 0)
  })

  it('rejects implausibly large odds', () => {
    const input = payload()
    ;(input.selections as Record<string, unknown>[])[0]!.oddsAtPublication =
      99_000_000

    assert.ok(problemsFor(input).length > 0)
  })
})

describe('minimumOdds', () => {
  it('may equal the published price', () => {
    const input = payload()
    const selection = (input.selections as Record<string, unknown>[])[0]!
    selection.minimumOdds = selection.oddsAtPublication

    assert.equal(validateTipIngestionPayload(input).ok, true)
  })

  it('may not exceed it', () => {
    // A tip whose minimum is above its published price is un-takeable at the
    // price it was published at, which is a contradiction, not a strict rule.
    const input = payload()
    const selection = (input.selections as Record<string, unknown>[])[0]!
    selection.minimumOdds = 2500
    selection.oddsAtPublication = 1910

    assert.match(problemsFor(input).join('\n'), /not takeable/)
  })
})

describe('structure', () => {
  it('requires at least one selection', () => {
    const input = payload()
    input.selections = []

    assert.ok(problemsFor(input).some((p) => p.startsWith('selections')))
  })

  it('accepts an accumulator', () => {
    const input = payload()
    input.selections = [
      {
        eventExternalId: 'e1',
        market: 'OVER_UNDER',
        selection: 'OVER',
        line: 250,
        oddsAtPublication: 1910,
        minimumOdds: 1850,
      },
      {
        eventExternalId: 'e2',
        market: '1X2',
        selection: 'HOME',
        oddsAtPublication: 1750,
        minimumOdds: 1700,
      },
    ]

    assert.equal(validateTipIngestionPayload(input).ok, true)
  })

  it('rejects an unknown property rather than ignoring it', () => {
    // A typo in a field name must be an error, not silently dropped data.
    const input = payload()
    input.stakeUnts = 3

    assert.ok(problemsFor(input).length > 0)
  })

  it('rejects an unknown property inside a selection', () => {
    const input = payload()
    ;(input.selections as Record<string, unknown>[])[0]!.odds = 2100

    assert.ok(problemsFor(input).length > 0)
  })

  it('has no status field — the partner cannot publish', () => {
    const input = payload()
    input.status = 'PUBLISHED'

    assert.ok(
      problemsFor(input).length > 0,
      'a payload that tries to set status must be rejected',
    )
  })

  it('rejects an unknown entitlement key', () => {
    const input = payload()
    input.requiredFeatureKey = 'TIPS_EVERYTHING'

    assert.ok(problemsFor(input).some((p) => p.includes('requiredFeatureKey')))
  })

  it('requires the contract version', () => {
    const input = payload()
    delete input.version

    assert.ok(problemsFor(input).some((p) => p.startsWith('version')))
  })

  it('rejects a future contract version', () => {
    const input = payload()
    input.version = 2

    assert.ok(problemsFor(input).length > 0)
  })

  it('requires the idempotency key', () => {
    const input = payload()
    delete input.externalId

    assert.ok(problemsFor(input).some((p) => p.startsWith('externalId')))
  })
})

describe('error reporting', () => {
  it('reports every problem, not just the first', () => {
    const input = payload()
    delete input.externalId
    input.stakeUnits = 99
    ;(input.selections as Record<string, unknown>[])[0]!.oddsAtPublication = 1.5

    const problems = problemsFor(input)

    assert.ok(
      problems.length >= 3,
      `expected at least three problems, got ${problems.length}: ${problems.join('; ')}`,
    )
  })

  it('gives a dotted path into the payload', () => {
    const input = payload()
    ;(input.selections as Record<string, unknown>[])[0]!.oddsAtPublication = 1.5

    assert.ok(
      problemsFor(input).some((p) =>
        p.startsWith('selections.0.oddsAtPublication'),
      ),
    )
  })

  it('rejects a non-object payload without throwing', () => {
    for (const input of [null, undefined, 42, 'tip', []]) {
      const result = validateTipIngestionPayload(input)
      assert.equal(result.ok, false, String(input))
    }
  })
})
