/**
 * Typed billing domain errors.
 *
 * These are thrown by pure guards, so they carry no HTTP concern and no
 * Payload dependency. The Payload hooks that call the guards translate them
 * into `APIError` with a status code; a checkout route will translate them
 * into a user-facing message. Keeping them plain means the guards stay unit
 * testable and reusable outside a request.
 *
 * Each error exposes a stable `code` so a caller can branch on the reason
 * without matching on message text.
 */

/** Base class for every billing invariant violation. */
export class BillingDomainError extends Error {
  /** Stable, machine-readable discriminator. */
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = new.target.name
    this.code = code
    // Keeps `instanceof` working for subclasses when targeting older runtimes.
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** The billing country is outside the set we are set up to sell into. */
export class UnsupportedBillingCountryError extends BillingDomainError {
  readonly country: string
  readonly supported: readonly string[]

  constructor(country: string, supported: readonly string[]) {
    super(
      'UNSUPPORTED_BILLING_COUNTRY',
      `Billing country ${country} is not supported. Supported: ${supported.join(', ') || '(none)'}.`,
    )
    this.country = country
    this.supported = [...supported]
  }
}

/** The value is not a syntactically valid ISO 3166-1 alpha-2 country code. */
export class InvalidCountryCodeError extends BillingDomainError {
  readonly value: string

  constructor(value: string) {
    super(
      'INVALID_COUNTRY_CODE',
      `"${value}" is not an ISO 3166-1 alpha-2 country code (expected two letters).`,
    )
    this.value = value
  }
}

/** The currency exists in the schema but is not switched on yet. */
export class CurrencyNotEnabledError extends BillingDomainError {
  readonly currency: string
  readonly enabled: readonly string[]

  constructor(currency: string, enabled: readonly string[]) {
    super(
      'CURRENCY_NOT_ENABLED',
      `Currency ${currency} is not enabled. Enabled: ${enabled.join(', ') || '(none)'}.`,
    )
    this.currency = currency
    this.enabled = [...enabled]
  }
}

/**
 * A customer tried to transact in a currency other than the one they are
 * locked to.
 */
export class CurrencyLockedError extends BillingDomainError {
  readonly lockedTo: string
  readonly attempted: string

  constructor(lockedTo: string, attempted: string) {
    super(
      'CURRENCY_LOCKED',
      `This customer is locked to ${lockedTo} and cannot be billed in ${attempted}. ` +
        'An external provider cannot change the currency of a live subscription, ' +
        'so a new currency requires a new customer record.',
    )
    this.lockedTo = lockedTo
    this.attempted = attempted
  }
}

/** A money value was not a non-negative integer count of minor units. */
export class InvalidMoneyAmountError extends BillingDomainError {
  readonly value: unknown

  constructor(field: string, value: unknown) {
    super(
      'INVALID_MONEY_AMOUNT',
      `${field} must be a non-negative integer number of minor units, received ${String(value)}. ` +
        'Money is never stored as a decimal or a float.',
    )
    this.value = value
  }
}
