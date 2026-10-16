/**
 * Stripe errors, translated into the port's failure vocabulary.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE DIVIDING LINE
 *
 * Stripe throws for everything: a declined card, a typo in a parameter, an
 * expired API key and a DNS failure all arrive as exceptions. The port draws
 * a line through that pile:
 *
 *   - Things about this customer's payment → a `BillingFailure` value, with
 *     a message we are willing to show them in Czech.
 *   - Things about us → `BillingConfigurationError`, thrown. A bad API key is
 *     not a billing outcome and no retry or apology helps.
 *   - Things about the network → `BillingProviderUnreachableError`, thrown.
 *     Telling a customer their card was declined when Stripe is simply down
 *     is a lie that costs us the sale and generates a support ticket.
 *
 * The customer-facing messages are deliberately vague about *why* a card was
 * declined. Stripe's own guidance is that issuers do not want the real reason
 * relayed, and the detail is in `providerCode` for support anyway.
 */
import {
  type BillingFailure,
  type BillingFailureCode,
  BillingConfigurationError,
  BillingProviderUnreachableError,
  billingFail,
} from '../port.ts'

/** The shape we need off a Stripe error without importing its classes. */
type StripeErrorish = {
  type?: unknown
  code?: unknown
  decline_code?: unknown
  param?: unknown
  message?: unknown
  payment_intent?: { client_secret?: unknown } | undefined
}

const asStripeError = (error: unknown): StripeErrorish | null =>
  typeof error === 'object' && error !== null ? (error as StripeErrorish) : null

const str = (value: unknown): string | null =>
  typeof value === 'string' ? value : null

/* -------------------------------------------------------------------------- */
/* Card declines                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Stripe decline/error code → our failure code.
 *
 * Only the ones we can say something specific and useful about. Everything
 * else becomes a generic decline, which is honest: the issuer usually has not
 * told Stripe either.
 */
const DECLINE_CODE_MAP: Readonly<Record<string, BillingFailureCode>> = {
  insufficient_funds: 'INSUFFICIENT_FUNDS',
  expired_card: 'EXPIRED_CARD',
  incorrect_cvc: 'INCORRECT_CVC',
  invalid_cvc: 'INCORRECT_CVC',
  incorrect_number: 'INCORRECT_NUMBER',
  invalid_number: 'INCORRECT_NUMBER',
  authentication_required: 'AUTHENTICATION_REQUIRED',
  processing_error: 'PROCESSING_ERROR',
  try_again_later: 'PROCESSING_ERROR',
}

/** What we are willing to tell the customer, in Czech. */
const CUSTOMER_MESSAGES: Readonly<Record<BillingFailureCode, string>> = {
  CARD_DECLINED:
    'Platba byla zamítnuta vydavatelem karty. Zkuste prosím jinou kartu nebo kontaktujte svou banku.',
  INSUFFICIENT_FUNDS:
    'Na kartě není dostatek prostředků. Zkuste prosím jinou kartu.',
  EXPIRED_CARD: 'Karta už není platná. Zadejte prosím jinou kartu.',
  INCORRECT_CVC:
    'Bezpečnostní kód karty (CVC) nesouhlasí. Zkontrolujte prosím zadané údaje.',
  INCORRECT_NUMBER: 'Číslo karty nesouhlasí. Zkontrolujte prosím zadané údaje.',
  AUTHENTICATION_REQUIRED:
    'Platbu je potřeba potvrdit ve vaší bance. Pokračujte prosím podle instrukcí.',
  PROCESSING_ERROR:
    'Platbu se nepodařilo zpracovat. Zkuste to prosím za chvíli znovu.',
  CUSTOMER_NOT_FOUND: 'Zákaznický záznam nebyl nalezen.',
  SUBSCRIPTION_NOT_FOUND: 'Předplatné nebylo nalezeno.',
  PAYMENT_METHOD_NOT_FOUND: 'Platební metoda nebyla nalezena.',
  CHARGE_NOT_FOUND: 'Platba nebyla nalezena.',
  PRICE_NOT_SYNCED:
    'Tento tarif není momentálně dostupný k platbě. Zkuste to prosím později.',
  CURRENCY_MISMATCH: 'Platbu v této valutě nelze zpracovat.',
  AMOUNT_MISMATCH: 'Cena tarifu se změnila. Načtěte prosím stránku znovu.',
  ALREADY_CANCELED: 'Předplatné je již ukončeno.',
  NOT_CANCELABLE: 'Toto předplatné nelze ukončit.',
  NOTHING_TO_RESUME: 'Toto předplatné není naplánováno k ukončení.',
  REFUND_EXCEEDS_CHARGE: 'Částka vratky přesahuje zbývající částku platby.',
  ALREADY_REFUNDED: 'Platba již byla vrácena.',
  RATE_LIMITED: 'Příliš mnoho požadavků. Zkuste to prosím za chvíli znovu.',
  INVALID_REQUEST: 'Požadavek se nepodařilo zpracovat.',
}

/** The customer-facing message for one of our failure codes. */
export const customerMessageFor = (code: BillingFailureCode): string =>
  CUSTOMER_MESSAGES[code]

/* -------------------------------------------------------------------------- */
/* Missing resources                                                          */
/* -------------------------------------------------------------------------- */

/**
 * What the failing call was about.
 *
 * Needed because Stripe's `param` is frequently just `id`: a refund for a
 * charge that does not exist reports `resource_missing` with `param: 'id'`,
 * which on its own cannot be turned into anything more useful than "invalid
 * request". The call site knows what it was addressing, so it says.
 *
 * Verified against the live test API rather than guessed — the contract suite
 * running against Stripe is what found this.
 */
export type StripeCallContext =
  'CUSTOMER' | 'SUBSCRIPTION' | 'PRICE' | 'PAYMENT_METHOD' | 'CHARGE' | 'REFUND'

const CONTEXT_NOT_FOUND: Readonly<
  Record<StripeCallContext, BillingFailureCode>
> = {
  CUSTOMER: 'CUSTOMER_NOT_FOUND',
  SUBSCRIPTION: 'SUBSCRIPTION_NOT_FOUND',
  PRICE: 'PRICE_NOT_SYNCED',
  PAYMENT_METHOD: 'PAYMENT_METHOD_NOT_FOUND',
  CHARGE: 'CHARGE_NOT_FOUND',
  REFUND: 'CHARGE_NOT_FOUND',
}

/**
 * `resource_missing` says something was not found but rarely what.
 *
 * The `param` is tried first, because on a nested parameter it is specific
 * (`items[0].price`). When it is the generic `id`, or absent, the caller's
 * context decides.
 */
const resourceMissingCode = (
  param: string | null,
  context: StripeCallContext | undefined,
): BillingFailureCode => {
  if (param && param !== 'id') {
    if (/customer/i.test(param)) return 'CUSTOMER_NOT_FOUND'
    if (/subscription/i.test(param)) return 'SUBSCRIPTION_NOT_FOUND'
    if (/payment_method|source/i.test(param)) return 'PAYMENT_METHOD_NOT_FOUND'
    if (/charge|payment_intent/i.test(param)) return 'CHARGE_NOT_FOUND'
    if (/price|plan|product/i.test(param)) return 'PRICE_NOT_SYNCED'
  }

  return context ? CONTEXT_NOT_FOUND[context] : 'INVALID_REQUEST'
}

/* -------------------------------------------------------------------------- */
/* The translation                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Turn a thrown Stripe error into a `BillingFailure`, or rethrow.
 *
 * Rethrows as `BillingConfigurationError` or
 * `BillingProviderUnreachableError` for the two categories the caller cannot
 * do anything about. Anything genuinely unrecognised is also rethrown rather
 * than flattened into `INVALID_REQUEST`: an error we have never seen should
 * reach the error tracker, not be quietly reported to a customer as a
 * problem with their card.
 */
export const translateStripeError = (
  error: unknown,
  context?: StripeCallContext,
): BillingFailure => {
  const stripeError = asStripeError(error)
  const type = str(stripeError?.type)
  const code = str(stripeError?.code)
  const declineCode = str(stripeError?.decline_code)
  const param = str(stripeError?.param)

  switch (type) {
    case 'StripeCardError': {
      // `decline_code` is the issuer's reason and more specific; `code` is
      // Stripe's classification. Prefer the specific one when it maps.
      const mapped =
        (declineCode ? DECLINE_CODE_MAP[declineCode] : undefined) ??
        (code ? DECLINE_CODE_MAP[code] : undefined) ??
        'CARD_DECLINED'

      const clientSecret = str(stripeError?.payment_intent?.client_secret)

      // The issuer's own reason when there is one, otherwise Stripe's
      // classification. Support looks this up; the customer never sees it.
      const providerCode = declineCode ?? code

      return billingFail(mapped, CUSTOMER_MESSAGES[mapped], {
        ...(providerCode ? { providerCode } : {}),
        // Only for 3-D Secure, where the front end needs it to finish the
        // payment. It is a bearer credential; `redactForLog` keeps it out of
        // logs even though it travels in this value.
        ...(mapped === 'AUTHENTICATION_REQUIRED' && clientSecret
          ? { clientSecret }
          : {}),
      })
    }

    case 'StripeInvalidRequestError': {
      const mapped: BillingFailureCode =
        code === 'resource_missing'
          ? resourceMissingCode(param, context)
          : code === 'charge_already_refunded'
            ? 'ALREADY_REFUNDED'
            : // An over-refund arrives with NO code at all — only
              // `param: 'amount'`. Verified against the live API; relying on
              // a code here would have left it as a generic failure with a
              // useless message.
              context === 'REFUND' && param === 'amount'
              ? 'REFUND_EXCEEDS_CHARGE'
              : 'INVALID_REQUEST'

      return billingFail(mapped, CUSTOMER_MESSAGES[mapped], {
        ...(code ? { providerCode: code } : {}),
        ...(!code && param ? { providerCode: `invalid_param_${param}` } : {}),
      })
    }

    case 'StripeRateLimitError':
      return billingFail('RATE_LIMITED', CUSTOMER_MESSAGES.RATE_LIMITED, {
        ...(code ? { providerCode: code } : {}),
      })

    case 'StripeIdempotencyError':
      // The same idempotency key was reused with different parameters. Always
      // our bug, but surfacing it as a failure rather than a crash keeps a
      // retry storm from taking the endpoint down with it.
      return billingFail('INVALID_REQUEST', CUSTOMER_MESSAGES.INVALID_REQUEST, {
        providerCode: 'idempotency_key_in_use',
      })

    case 'StripeAuthenticationError':
    case 'StripePermissionError':
      throw new BillingConfigurationError(
        'Stripe rejected our credentials. Check STRIPE_SECRET_KEY and, for a ' +
          'restricted key, that it has the permissions this operation needs.',
      )

    case 'StripeConnectionError':
    case 'StripeAPIError':
      throw new BillingProviderUnreachableError('STRIPE', { cause: error })

    default:
      throw error
  }
}
