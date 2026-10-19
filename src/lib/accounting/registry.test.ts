/**
 * Which accounting adapter gets resolved, and what cannot happen.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THIS FILE IS A SAFETY TEST, NOT A WIRING TEST
 *
 * There is no Fakturoid sandbox. The credentials point at the operator's real
 * accounting account, where every document created is permanently numbered in
 * a statutory series and deleting one leaves a gap that has to be explained to
 * a tax inspection.
 *
 * So the resolution rules are asserted rather than assumed: the default is the
 * fake, and a test run cannot reach the real provider even if somebody has
 * pointed the configuration at it.
 */
import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  configuredAccountingProvider,
  getAccountingPort,
  resetAccountingPortCache,
  setAccountingPortForTesting,
} from './registry.ts'
import { createFakeAccountingPort } from './fake-adapter.ts'
import { AccountingConfigurationError } from './port.ts'

const original = process.env.ACCOUNTING_PROVIDER

afterEach(() => {
  if (original === undefined) {
    delete process.env.ACCOUNTING_PROVIDER
  } else {
    process.env.ACCOUNTING_PROVIDER = original
  }

  setAccountingPortForTesting(null)
  resetAccountingPortCache()
})

describe('configuredAccountingProvider', () => {
  it('defaults to the FAKE provider, never the real one', () => {
    delete process.env.ACCOUNTING_PROVIDER

    // The opposite of the billing registry, which defaults to STRIPE. A
    // Stripe test key is harmless; there is no harmless Fakturoid account.
    assert.equal(configuredAccountingProvider(), 'FAKE')
  })

  it('treats anything unrecognised as FAKE', () => {
    for (const value of ['', '  ', 'fakturoíd', 'FAKTUROID_TEST', 'nonsense']) {
      process.env.ACCOUNTING_PROVIDER = value

      assert.equal(
        configuredAccountingProvider(),
        'FAKE',
        `${JSON.stringify(value)} must not resolve to the real provider`,
      )
    }
  })

  it('accepts the real provider only when named exactly', () => {
    process.env.ACCOUNTING_PROVIDER = 'fakturoid'
    assert.equal(configuredAccountingProvider(), 'FAKTUROID')

    process.env.ACCOUNTING_PROVIDER = ' FAKTUROID '
    assert.equal(configuredAccountingProvider(), 'FAKTUROID')
  })
})

describe('getAccountingPort', () => {
  it('refuses the real provider inside an ordinary test run', async () => {
    process.env.ACCOUNTING_PROVIDER = 'FAKTUROID'

    // The second lock. The first is the default above, and the first can be
    // undone by editing a `.env` — which is a reasonable thing to do while
    // working on the real integration, and would also silently point
    // `pnpm test:db` at the operator's actual books. Those runs create
    // invoices.
    //
    // This test runs under `node --test` without FAKTUROID_LIVE_TEST, which
    // is exactly the situation being refused.
    await assert.rejects(
      () => getAccountingPort(),
      (error: unknown) => {
        assert.ok(error instanceof AccountingConfigurationError)
        assert.match(error.message, /no Fakturoid sandbox/)

        return true
      },
    )
  })

  it('hands back the fake when nothing is configured', async () => {
    delete process.env.ACCOUNTING_PROVIDER

    const port = await getAccountingPort()

    assert.equal(port.provider, 'FAKTUROID')
    // The fake names itself after the provider it models, so callers logging
    // `port.provider` say something true. What distinguishes it is that it
    // never touches a network — proven by the fact that this assertion runs
    // at all, with no credentials present.
    assert.equal(typeof port.issueInvoice, 'function')
  })

  it('returns an installed test port without consulting configuration', async () => {
    process.env.ACCOUNTING_PROVIDER = 'FAKTUROID'

    const injected = createFakeAccountingPort({ provider: 'INJECTED' })

    setAccountingPortForTesting(injected)

    // Takes precedence over everything, including the refusal above: a test
    // that supplies its own port has already answered the question.
    const port = await getAccountingPort()

    assert.equal(port.provider, 'INJECTED')
  })
})
