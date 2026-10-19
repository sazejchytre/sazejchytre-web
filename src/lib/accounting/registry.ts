/**
 * Resolves the active accounting adapter.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE DEFAULT IS THE FAKE, AND THAT IS A SAFETY DECISION
 *
 * The billing registry defaults to the real provider, because a Stripe test
 * key is harmless. This one cannot: there is no Fakturoid sandbox. The
 * credentials point at the operator's actual accounting account, where every
 * document created is real, permanently numbered in a statutory series, and
 * impossible to remove without leaving a gap that has to be explained to a
 * tax inspection.
 *
 * So the real adapter is used only when `ACCOUNTING_PROVIDER` explicitly says
 * `FAKTUROID`. Anything else — unset, a typo, a test process that forgot to
 * configure itself — gets the in-memory fake. The failure mode of that choice
 * is a document that was never issued, which is recoverable. The failure mode
 * of the opposite choice is a real document in real books, which is not.
 */
import { AccountingConfigurationError, type AccountingPort } from './port.ts'

export const ACCOUNTING_PROVIDERS = ['FAKTUROID', 'FAKE'] as const

export type AccountingProvider = (typeof ACCOUNTING_PROVIDERS)[number]

type AdapterLoader = () => Promise<AccountingPort>

/**
 * Provider → adapter. Lazy, so the inactive one's credentials are never read.
 */
const ADAPTERS: Record<AccountingProvider, AdapterLoader> = {
  FAKTUROID: async () => {
    const { createFakturoidAccountingPort } =
      await import('./fakturoid/adapter.ts')

    return createFakturoidAccountingPort()
  },
  FAKE: async () => {
    const { createFakeAccountingPort } = await import('./fake-adapter.ts')

    return createFakeAccountingPort()
  },
}

let cached: Promise<AccountingPort> | null = null
let override: AccountingPort | null = null

/**
 * Install a port for the duration of a test. Pass `null` to restore.
 *
 * Named so that it is obvious in a diff if it ever appears in application
 * code, where it has no business being.
 */
export const setAccountingPortForTesting = (
  port: AccountingPort | null,
): void => {
  override = port
  cached = null
}

/**
 * Which provider is configured.
 *
 * Reads `process.env` directly rather than the validated env module, so that
 * requiring the Fakturoid credentials is not a precondition for booting an
 * application that does not issue documents.
 */
export const configuredAccountingProvider = (): AccountingProvider => {
  const configured = process.env.ACCOUNTING_PROVIDER?.trim().toUpperCase()

  // Note the direction of the default: anything unrecognised means the fake,
  // never the real account. See the header.
  return configured === 'FAKTUROID' ? 'FAKTUROID' : 'FAKE'
}

/**
 * Are we inside a test runner that is not the opt-in live suite?
 *
 * `NODE_TEST_CONTEXT` is set by `node --test` in every mode, and only the
 * dedicated live script sets `FAKTUROID_LIVE_TEST`.
 *
 * This is the second lock, not the first. The first is `ACCOUNTING_PROVIDER`
 * defaulting to FAKE. The reason for a second one is that the first can be
 * undone by editing a file: putting `ACCOUNTING_PROVIDER=FAKTUROID` in a
 * local `.env` is a perfectly reasonable thing to do while working on the
 * real integration, and it would also silently point `pnpm test:db` at the
 * operator's actual books. Those runs create invoices.
 *
 * The cost of being wrong here is asymmetric and that is the whole argument:
 * a refused test is a message, and a real document in a statutory series
 * cannot be taken back.
 */
const inNonLiveTestRunner = (): boolean =>
  process.env.NODE_TEST_CONTEXT !== undefined &&
  process.env.FAKTUROID_LIVE_TEST !== '1'

export const getAccountingPort = async (): Promise<AccountingPort> => {
  if (override) return override

  const provider = configuredAccountingProvider()

  if (provider === 'FAKTUROID' && inNonLiveTestRunner()) {
    throw new AccountingConfigurationError(
      'ACCOUNTING_PROVIDER is FAKTUROID, but this is a test run that did not ' +
        'opt in to touching the real accounting account. Refusing: there is ' +
        'no Fakturoid sandbox, and every document created in that account is ' +
        'permanently numbered in a statutory series. Use the fake, or run ' +
        '`pnpm test:fakturoid` if you really mean it.',
    )
  }

  cached ??= ADAPTERS[provider]().catch((error: unknown) => {
    cached = null
    throw error
  })

  return cached
}

/** Forget the cached adapter. For tests that swap configuration. */
export const resetAccountingPortCache = (): void => {
  cached = null
}
