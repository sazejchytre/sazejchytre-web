/**
 * An in-memory stand-in for the Fakturoid API.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS WHEN THERE IS ALREADY A FAKE ADAPTER
 *
 * They test different things. The fake adapter implements the PORT, so it
 * proves callers behave. This implements the TRANSPORT, so it proves the
 * Fakturoid adapter itself behaves — its `custom_id` lookups, its decimal
 * conversion, its status-code mapping, its handling of a 204 PDF.
 *
 * Without it, the adapter's own logic could only be exercised against the
 * operator's real accounting account, where every attempt leaves a permanent
 * numbered document behind. That is not somewhere to discover that a query
 * parameter was misspelled.
 *
 * It is a `fetch` implementation, so the adapter under test is the real one,
 * unmodified, with nothing stubbed inside it.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * IT IS DELIBERATELY STRICT WHERE FAKTUROID IS STRICT
 *
 * In particular it answers 400 to any request without a `User-Agent`, exactly
 * as Fakturoid does. That requirement is easy to satisfy and easy to lose in
 * a refactor, and the real failure — every call suddenly 400ing with a body
 * that talks about malformed input — does not point at a missing header. So
 * it is enforced here, where forgetting it is a failed test rather than a
 * confusing afternoon.
 */
import { minorToDecimalString } from '../decimal.ts'
import { FAKTUROID_BASE_URL, type FakturoidConfig } from './config.ts'

export type StubScript = {
  /** Answer the next matching request with this status, once. */
  status: number
  /** Only for requests whose path contains this. */
  pathContains?: string
  /**
   * Only for this method.
   *
   * Worth having: `/invoices.json` is both the custom_id lookup (GET) and the
   * create (POST), so a script without a method lands on whichever comes
   * first — which is the lookup, every time, since the lookup is what makes
   * the create safe.
   */
  method?: 'GET' | 'POST' | 'PATCH'
  body?: unknown
  headers?: Record<string, string>
}

export type StubInvoice = {
  id: string
  custom_id: string | null
  number: string
  document_type: string
  subject_id: string
  currency: string
  total: string
  remaining_amount: string
  issued_on: string
  taxable_fulfillment_due: string
  status: string
  locked_at: string | null
  correction_id: string | null
  /** How many times the PDF has been asked for, to model the 204. */
  pdfRequests: number
}

export type FakturoidStub = {
  fetchImpl: typeof fetch
  /** Requests seen, for asserting what the adapter actually sent. */
  calls: {
    method: string
    url: string
    body: unknown
    userAgent: string | null
  }[]
  invoices(): StubInvoice[]
  subjects(): { id: string; custom_id: string | null }[]
  /** Answer the next matching request this way, once. */
  script(script: StubScript): void
  /** The next invoice POST creates the invoice and then fails the response. */
  loseNextCreateResponse(): void
  tokenRequests(): number
  config: FakturoidConfig
}

const json = (
  body: unknown,
  status = 200,
  headers: HeadersInit = {},
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })

/** A minimal but genuinely well-formed PDF, so the %PDF- check is real. */
const PDF_BYTES = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  'latin1',
)

export type StubOptions = {
  /**
   * The account's VAT mode. Defaults to the REAL account's setting.
   *
   * It decides which documents may exist: Fakturoid refuses a `correction`
   * document type outright for a non-VAT payer, because an opravný daňový
   * doklad is a VAT instrument. Defaulting to the real setting means the
   * ordinary tests exercise the path production actually takes.
   */
  vatMode?: 'non_vat_payer' | 'vat_payer'
}

export const createFakturoidStub = (
  overrides: Partial<FakturoidConfig> = {},
  options: StubOptions = {},
): FakturoidStub => {
  const vatMode = options.vatMode ?? 'non_vat_payer'
  const config: FakturoidConfig = {
    clientId: 'stub-client-id',
    clientSecret: 'stub-client-secret',
    slug: 'stub-account',
    userAgent: 'sazejchytre.cz-test (test@example.com)',
    baseUrl: FAKTUROID_BASE_URL,
    ...overrides,
  }

  const calls: FakturoidStub['calls'] = []
  const invoices = new Map<string, StubInvoice>()
  const subjects = new Map<string, { id: string; custom_id: string | null }>()
  const scripts: StubScript[] = []

  let nextId = 1000
  let invoiceSeq = 0
  let correctionSeq = 0
  let tokenRequests = 0
  let loseNextCreate = false

  const id = (): string => String(++nextId)

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : String(input)
    const method = init?.method ?? 'GET'
    const headers = new Headers(init?.headers)
    const userAgent = headers.get('user-agent')

    let body: unknown = undefined

    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body)
      } catch {
        body = init.body
      }
    }

    calls.push({ method, url, body, userAgent })

    // Fakturoid's own rule, enforced. A missing User-Agent is a 400 whose
    // body says nothing about headers.
    if (!userAgent || userAgent.trim().length === 0) {
      return json({ errors: { base: ['User-Agent header is required'] } }, 400)
    }

    const parsed = new URL(url)
    const { pathname } = parsed

    if (pathname.endsWith('/oauth/token')) {
      tokenRequests += 1

      const authorization = headers.get('authorization') ?? ''

      if (!authorization.startsWith('Basic ')) {
        return json({ error: 'invalid_client' }, 401)
      }

      // Fakturoid's own rule, and the stub did not have it until a live run
      // paid for the lesson: without `Accept: application/json` the token
      // endpoint answers 415, which reads like a complaint about the body.
      //
      // Enforced here so the mistake cannot come back quietly. The whole
      // point of a stub that models the provider's fussiness is that the
      // fussiness is what you forget.
      if (!(headers.get('accept') ?? '').includes('application/json')) {
        return json(
          {
            error: 'invalid_request',
            error_description:
              "Only JSON requests are allowed. Please set 'Accept' header to " +
              "'application/json' or add '.json' extension to the URL.",
          },
          415,
        )
      }

      return json({
        access_token: `stub-token-${String(tokenRequests)}`,
        token_type: 'Bearer',
        expires_in: 7_200,
      })
    }

    // A scripted answer takes precedence, so failure mapping can be tested.
    const scriptIndex = scripts.findIndex(
      (script) =>
        (script.pathContains === undefined ||
          pathname.includes(script.pathContains)) &&
        (script.method === undefined || script.method === method),
    )

    if (scriptIndex >= 0) {
      const [script] = scripts.splice(scriptIndex, 1)

      if (!script) throw new Error('unreachable')

      return new Response(
        script.body === undefined ? '' : JSON.stringify(script.body),
        {
          status: script.status,
          headers: {
            'Content-Type': 'application/json',
            ...(script.headers ?? {}),
          },
        },
      )
    }

    const accountPrefix = `/api/v3/accounts/${config.slug}`

    if (!pathname.startsWith(accountPrefix)) {
      return json({ errors: { base: ['unknown account'] } }, 404)
    }

    const path = pathname.slice(accountPrefix.length)

    /* --- account ---------------------------------------------------------- */

    if (path === '/account.json') {
      return json({
        name: 'Stub Operator',
        registration_no: '00000000',
        vat_mode: vatMode,
        currency: 'CZK',
        invoice_language: 'cz',
      })
    }

    /* --- subjects --------------------------------------------------------- */

    if (path === '/subjects.json' && method === 'GET') {
      const wanted = parsed.searchParams.get('custom_id')

      return json(
        [...subjects.values()].filter(
          (subject) => wanted === null || subject.custom_id === wanted,
        ),
      )
    }

    if (path === '/subjects.json' && method === 'POST') {
      const payload = (body ?? {}) as { custom_id?: string; name?: string }
      const subject = {
        id: id(),
        custom_id: payload.custom_id ?? null,
        name: payload.name ?? null,
      }

      subjects.set(subject.id, subject)

      return json(subject, 201)
    }

    /* --- invoices --------------------------------------------------------- */

    if (path === '/invoices.json' && method === 'GET') {
      const wanted = parsed.searchParams.get('custom_id')

      return json(
        [...invoices.values()]
          .filter((invoice) => wanted === null || invoice.custom_id === wanted)
          .map(({ pdfRequests: _pdf, ...rest }) => rest),
      )
    }

    if (path === '/invoices.json' && method === 'POST') {
      const payload = (body ?? {}) as {
        custom_id?: string
        subject_id?: string
        currency?: string
        document_type?: string
        correction_id?: string
        issued_on?: string
        taxable_fulfillment_due?: string
        lines?: { unit_price?: string; quantity?: string }[]
      }

      if (!payload.subject_id || !subjects.has(String(payload.subject_id))) {
        return json({ errors: { subject_id: ['is invalid'] } }, 422)
      }

      const isCorrection = payload.document_type === 'correction'

      if (isCorrection && vatMode === 'non_vat_payer') {
        // Verbatim from the live account. An opravný daňový doklad is a VAT
        // instrument, so a trader who is not registered for VAT cannot issue
        // one — their credit note is an invoice with negative amounts.
        //
        // Modelled here because the adapter chooses the document type from
        // the account's VAT mode, and a stub that accepted both would let a
        // wrong choice pass every test and fail only against real books.
        return json(
          {
            errors: {
              correction_id: [
                'Opravný daňový doklad lze vytvořit pouze k faktuře od plátce DPH',
              ],
            },
          },
          422,
        )
      }

      if (isCorrection && !invoices.has(String(payload.correction_id))) {
        return json({ errors: { correction_id: ['is invalid'] } }, 422)
      }

      // Totalled from the lines, in minor units, so the stub never introduces
      // a float of its own while testing code that exists to avoid floats.
      const totalMinor = (payload.lines ?? []).reduce((sum, line) => {
        const [whole = '0', fraction = '0'] = String(line.unit_price ?? '0')
          .replace('-', '')
          .split('.')
        const negative = String(line.unit_price ?? '').startsWith('-')
        const minor =
          Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2))

        return sum + (negative ? -minor : minor) * Number(line.quantity ?? 1)
      }, 0)

      const number = isCorrection
        ? `OD2026-${String(++correctionSeq).padStart(6, '0')}`
        : `FA2026-${String(++invoiceSeq).padStart(6, '0')}`

      const invoice: StubInvoice = {
        id: id(),
        custom_id: payload.custom_id ?? null,
        number,
        document_type: payload.document_type ?? 'invoice',
        subject_id: String(payload.subject_id),
        currency: payload.currency ?? 'CZK',
        total: minorToDecimalString(totalMinor, 'CZK'),
        remaining_amount: minorToDecimalString(totalMinor, 'CZK'),
        issued_on: payload.issued_on ?? '2026-10-16',
        taxable_fulfillment_due:
          payload.taxable_fulfillment_due ?? payload.issued_on ?? '2026-10-16',
        status: 'open',
        locked_at: null,
        correction_id: isCorrection ? String(payload.correction_id) : null,
        pdfRequests: 0,
      }

      invoices.set(invoice.id, invoice)

      if (loseNextCreate) {
        loseNextCreate = false

        // The document is committed and the response never arrives. THE
        // failure that produces duplicates on retry.
        throw new TypeError('fetch failed')
      }

      const { pdfRequests: _pdf, ...visible } = invoice

      return json(visible, 201)
    }

    const invoiceMatch = /^\/invoices\/(\d+)(\/[a-z.]+|\.json)$/.exec(path)

    if (invoiceMatch) {
      const [, invoiceId = '', tail = ''] = invoiceMatch
      const invoice = invoices.get(invoiceId)

      if (!invoice) {
        return json({ errors: { base: ['not found'] } }, 404)
      }

      const { pdfRequests: _pdf, ...visible } = invoice

      if (tail === '.json' && method === 'GET') {
        return json(visible)
      }

      if (tail === '/payments.json' && method === 'POST') {
        if (invoice.status === 'paid') {
          // Fakturoid's answer for "already paid", which a retry must treat
          // as success rather than as a failure.
          return json({ errors: { base: ['already paid'] } }, 403)
        }

        invoice.status = 'paid'
        invoice.remaining_amount = '0.00'

        return json({ id: id(), amount: invoice.total }, 201)
      }

      if (tail === '/fire.json' && method === 'POST') {
        const event = parsed.searchParams.get('event')

        if (event !== 'lock') {
          return json({ errors: { event: ['is invalid'] } }, 422)
        }

        if (invoice.locked_at) {
          return json({ errors: { base: ['already locked'] } }, 403)
        }

        invoice.locked_at = '2026-10-16T09:00:00+02:00'

        return json({ ...visible, locked_at: invoice.locked_at })
      }

      if (tail === '/download.pdf' && method === 'GET') {
        invoice.pdfRequests += 1

        // 204 the first time, as Fakturoid does while it renders. A stub that
        // handed one over immediately would let a caller that forgot to poll
        // pass its tests and then hang in production.
        if (invoice.pdfRequests <= 1) {
          return new Response(null, { status: 204 })
        }

        return new Response(new Uint8Array(PDF_BYTES), {
          status: 200,
          headers: { 'Content-Type': 'application/pdf' },
        })
      }
    }

    return json({ errors: { base: ['not found'] } }, 404)
  }

  return {
    fetchImpl,
    calls,
    invoices: () => [...invoices.values()],
    subjects: () => [...subjects.values()],
    script: (script) => {
      scripts.push(script)
    },
    loseNextCreateResponse: () => {
      loseNextCreate = true
    },
    tokenRequests: () => tokenRequests,
    config,
  }
}
