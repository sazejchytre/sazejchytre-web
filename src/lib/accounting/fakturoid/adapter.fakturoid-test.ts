/* eslint-disable no-console --
 * This suite's OUTPUT is its deliverable. It prints the number of every real
 * document it created in the operator's statutory series, so those documents
 * can be accounted for; `console.warn` would be a lie about what the lines
 * are, and the logger is not available in a bare test process.
 */
/**
 * The accounting contract, run against the REAL Fakturoid account.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * READ THIS BEFORE RUNNING IT
 *
 * There is no Fakturoid sandbox. This talks to the operator's actual
 * accounting account. Every document it creates is a real document, carrying
 * a real number in a statutory series, and it CANNOT be cleaned up: deleting
 * one leaves a gap in a numbered sequence that has to be explained to a tax
 * inspection. A stray document can at least be accounted for; a gap cannot.
 *
 * So:
 *
 *   - This file is NOT in `pnpm test` or `pnpm test:db`. Its name ends
 *     `.fakturoid-test.ts`, which neither glob matches.
 *   - It refuses to run unless FAKTUROID_LIVE_TEST=1, which only `pnpm
 *     test:fakturoid` sets. A hand-written glob cannot start it by accident.
 *   - It creates the MINIMUM: one subject, one invoice, one correction.
 *   - It deletes NOTHING, ever.
 *   - It prints every document number it created, so the operator can account
 *     for them.
 *
 * Run it once. Then read the numbers it printed and file them.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { type AccountingDocument, type AccountingPort } from '../port.ts'
import { runAccountingPortContract } from '../port-contract.ts'
import { readFakturoidConfig } from './config.ts'
import { createFakturoidAccountingPort } from './adapter.ts'
import { createFakturoidHttp } from './http.ts'
import { createTokenSource } from './token.ts'
import { fakturoidAccountSchema, parseFakturoid } from './schemas.ts'

const OPTED_IN = process.env.FAKTUROID_LIVE_TEST === '1'

/** Every document this run created, printed at the end. */
const created: AccountingDocument[] = []

if (!OPTED_IN) {
  describe('Fakturoid live contract', () => {
    it('is skipped unless explicitly opted in', (t) => {
      t.skip(
        'Set FAKTUROID_LIVE_TEST=1 (or use `pnpm test:fakturoid`) to run ' +
          'against the real accounting account. Every document it creates is ' +
          'real and permanent.',
      )
    })
  })
} else {
  const config = readFakturoidConfig()

  const tokens = createTokenSource({ config })
  const http = createFakturoidHttp({ config, tokens })

  describe('Fakturoid account preflight', () => {
    it('is the account we expect, and is a non-VAT-payer account', async () => {
      const outcome = await http.request({
        method: 'GET',
        path: '/account.json',
      })

      assert.equal(outcome.kind, 'json', 'could not read the account')

      const parsed = parseFakturoid(
        fakturoidAccountSchema,
        outcome.body,
        'account',
      )

      assert.ok(
        parsed.ok,
        `unreadable account: ${parsed.ok ? '' : parsed.detail}`,
      )

      // The operator is a Czech sole trader who is NOT VAT registered, and
      // that fact lives here as an account setting rather than as a branch in
      // our code — which is one of the reasons for moving to Fakturoid at
      // all. Asserted so that a change to it surfaces as a failed test rather
      // than as VAT lines appearing on documents the rest of the system does
      // not model.
      assert.equal(
        parsed.value.vat_mode,
        'non_vat_payer',
        'the account is no longer in non-VAT-payer mode — our documents and ' +
          'our export both assume no VAT',
      )
      assert.equal(parsed.value.currency, 'CZK')

      console.log(
        `[fakturoid] account ${config.slug}: ${String(parsed.value.name)}, ` +
          `vat_mode=${String(parsed.value.vat_mode)}, ` +
          `currency=${String(parsed.value.currency)}`,
      )

      const limit = http.rateLimit()

      console.log(
        `[fakturoid] rate limit: ${String(limit.remaining)} requests left, ` +
          `window resets in ${String(limit.resetsInSeconds)}s`,
      )
    })
  })

  const port: AccountingPort = createFakturoidAccountingPort({ config })

  // A fresh run id every run. A reused one would be ADOPTED from the previous
  // run, so the create path would silently never execute and the suite would
  // pass without testing anything — the trap the Stripe contract's hard-coded
  // idempotency keys set in step 4.
  const runId = `qa${String(Date.now()).slice(-9)}`

  before(() => {
    console.log(
      `[fakturoid] LIVE RUN ${runId} against account ${config.slug}. ` +
        'Documents created here are real and will not be deleted.',
    )
  })

  runAccountingPortContract({
    label: `live Fakturoid account ${config.slug}`,
    mode: 'live',
    port,
    runId,
    onPdfFetched: (pdf, document) => {
      // Kept so the rendered document can be looked at. What Fakturoid
      // actually prints is not knowable from the API, and this account's
      // settings include a natural-person DIČ derived from a rodné číslo —
      // which we never store and would not choose to publish. Whether it
      // appears on the document is a question only the file can answer.
      const out = path.join(
        tmpdir(),
        `fakturoid-${document.documentType.toLowerCase()}-${document.number.replace(/[^\w.-]/g, '_')}.pdf`,
      )

      writeFileSync(out, pdf)
      console.log(`[fakturoid] saved ${document.number} PDF to ${out}`)
    },
    onDocumentCreated: (document) => {
      created.push(document)

      // Printed as it happens, not only at the end: if the suite dies
      // halfway, the operator still needs the numbers of what was created.
      console.log(
        `[fakturoid] CREATED ${document.documentType} ${document.number} ` +
          `(id ${document.providerDocumentId}, ` +
          `${String(document.totalMinor)} minor ${document.currency})`,
      )
    },
  })

  after(() => {
    console.log('')
    console.log('─'.repeat(72))
    console.log(
      `REAL DOCUMENTS CREATED IN ACCOUNT ${config.slug}, run ${runId}`,
    )
    console.log('─'.repeat(72))

    if (created.length === 0) {
      console.log('  (none)')
    }

    for (const document of created) {
      console.log(
        `  ${document.documentType.padEnd(11)} ${document.number.padEnd(16)} ` +
          `${String(document.totalMinor).padStart(8)} minor ${document.currency}` +
          `  id=${document.providerDocumentId}`,
      )
    }

    console.log('─'.repeat(72))
    console.log(
      'These were NOT deleted. Deleting a document leaves a gap in a ' +
        'statutory number series.',
    )
    console.log(
      'Account for them, or have the accountant cancel them properly.',
    )
    console.log('─'.repeat(72))
  })
}
