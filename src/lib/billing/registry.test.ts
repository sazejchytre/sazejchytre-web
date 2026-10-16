import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import type { BillingProvider } from './constants.ts'
import { createFakeBillingPort } from './fake-adapter.ts'
import { BillingConfigurationError } from './port.ts'
import {
  getBillingPortFor,
  resetBillingPortCache,
  setBillingPortForTesting,
} from './registry.ts'

afterEach(() => {
  setBillingPortForTesting(null)
  resetBillingPortCache()
})

describe('billing registry', () => {
  it('returns an installed test port without loading an adapter', async () => {
    // The point of the seam: no SDK client is constructed, no environment is
    // read, and no provider credentials are needed.
    const fake = createFakeBillingPort()
    setBillingPortForTesting(fake)

    const resolved = await getBillingPortFor('STRIPE')

    assert.equal(resolved, fake)
  })

  it('lets a test port stand in for any provider', async () => {
    const fake = createFakeBillingPort()
    setBillingPortForTesting(fake)

    // Including one with no adapter at all, which is what makes it possible
    // to write a second provider's tests before its adapter exists.
    const resolved = await getBillingPortFor('PAYPAL' as BillingProvider)

    assert.equal(resolved, fake)
  })

  it('fails loudly for a provider with no adapter', async () => {
    await assert.rejects(
      () => getBillingPortFor('PAYPAL' as BillingProvider),
      (error: unknown) => {
        // An exception, not a BillingResult: being asked for a provider we
        // have never implemented is a deployment fault, and no caller can do
        // anything useful with it.
        assert.ok(error instanceof BillingConfigurationError)
        assert.match(error.message, /PAYPAL/)
        // The message names the file to edit, because the person reading it
        // is looking for where to add the adapter.
        assert.match(error.message, /registry\.ts/)

        return true
      },
    )
  })

  it('stops overriding once the override is cleared', async () => {
    setBillingPortForTesting(createFakeBillingPort())
    setBillingPortForTesting(null)

    await assert.rejects(
      () => getBillingPortFor('PAYPAL' as BillingProvider),
      BillingConfigurationError,
    )
  })
})
