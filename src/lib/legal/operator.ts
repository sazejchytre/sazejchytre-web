/**
 * Operator identity — THE single source of truth.
 *
 * The footer, legal pages (Obchodní podmínky, Zásady ochrany osobních údajů),
 * invoice templates, Stripe metadata and the JSON-LD `Organization` block all
 * import from this file. Never retype the operator name, address or IČO
 * anywhere else in the codebase: one wrong copy is a legal problem, and a grep
 * for the string is not a migration plan.
 *
 * PRIVACY: never add a date of birth, birth number (rodné číslo) or any other
 * personal identifier of the operator here or anywhere else. A sole trader's
 * business address and IČO are public register data; a date of birth is not,
 * and must not be stored or rendered.
 */

/** Marks a value that still needs to be supplied from the business register. */
const TODO_PREFIX = 'TODO:'

export interface OperatorIdentity {
  /** Registered business name exactly as it appears in the public register. */
  readonly name: string
  /** Street and number of the registered place of business. */
  readonly street: string
  /** City. */
  readonly city: string
  /** Postal code, e.g. "110 00". */
  readonly postalCode: string
  /** ISO 3166-1 alpha-2. */
  readonly countryCode: 'CZ'
  /** IČO — 8-digit Czech company identification number. */
  readonly ico: string
  /** Whether the operator is registered for VAT (plátce DPH). */
  readonly vatPayer: boolean
  /**
   * Register entry line shown in the footer and on invoices, e.g. the trade
   * licence office that maintains the entry.
   */
  readonly registryNote: string
  /** Primary contact address for legal and business correspondence. */
  readonly email: string
  /** Customer support address. May equal `email`. */
  readonly supportEmail: string
}

/**
 * TODO(legal): replace every `TODO:` value with the real register data before
 * anything public ships. Values are intentionally NOT invented — an incorrect
 * IČO or address on a live commercial site is a compliance failure, and a
 * plausible-looking fake is far more dangerous than an obvious placeholder.
 *
 * Once filled in, flip `OPERATOR_DETAILS_CONFIRMED` to `true`.
 */
export const OPERATOR: OperatorIdentity = Object.freeze({
  name: `${TODO_PREFIX} registered business name`,
  street: `${TODO_PREFIX} street and number`,
  city: `${TODO_PREFIX} city`,
  postalCode: `${TODO_PREFIX} postal code`,
  countryCode: 'CZ',
  ico: `${TODO_PREFIX} 8-digit IČO`,
  // TODO(legal): confirm VAT status. `false` here is a placeholder, not a
  // finding — it is covered by OPERATOR_DETAILS_CONFIRMED below.
  vatPayer: false,
  registryNote: `${TODO_PREFIX} register entry / issuing trade licence office`,
  email: `${TODO_PREFIX} info@sazejchytre.cz`,
  supportEmail: `${TODO_PREFIX} podpora@sazejchytre.cz`,
})

/**
 * Set to `true` only after every field above has been verified against the
 * public register AND the VAT status has been confirmed. Booleans cannot carry
 * a `TODO:` marker, so this flag covers them.
 */
export const OPERATOR_DETAILS_CONFIRMED = false

/** Fields still holding a placeholder. Empty once the data is filled in. */
export function unresolvedOperatorFields(): readonly string[] {
  return Object.entries(OPERATOR)
    .filter(
      ([, value]) => typeof value === 'string' && value.startsWith(TODO_PREFIX),
    )
    .map(([key]) => key)
}

/**
 * Throw if operator data is still placeholder.
 *
 * Call this from any code path that renders operator identity publicly —
 * footer, invoice, JSON-LD — so placeholders can never reach production.
 */
export function assertOperatorConfigured(): void {
  const unresolved = unresolvedOperatorFields()

  if (unresolved.length > 0 || !OPERATOR_DETAILS_CONFIRMED) {
    throw new Error(
      'Operator identity is not configured. Fill in src/lib/legal/operator.ts ' +
        `and set OPERATOR_DETAILS_CONFIRMED = true. Unresolved: ${
          unresolved.length > 0 ? unresolved.join(', ') : '(none)'
        }.`,
    )
  }
}

/** Single-line address, e.g. for invoice headers and JSON-LD. */
export function formatOperatorAddress(): string {
  return `${OPERATOR.street}, ${OPERATOR.postalCode} ${OPERATOR.city}`
}

/* -------------------------------------------------------------------------- */
/* Responsible gambling                                                       */
/* -------------------------------------------------------------------------- */

export interface ResponsibleGambling {
  /** Minimum age to use the service. */
  readonly minimumAge: 18
  readonly helpline: {
    readonly name: string
    readonly phone: string
    readonly url: string
  }
  /**
   * Czech-language disclaimer shown in the footer and before any tip content.
   *
   * TODO(legal): must state, in reviewed Czech wording, that the service
   *   1. provides informational analysis only,
   *   2. does not accept bets,
   *   3. does not broker or arrange gambling in any form,
   *   4. guarantees no result whatsoever.
   * Wording is deliberately not drafted here — it needs a lawyer, not an
   * approximation. Do not ship this string as-is.
   */
  readonly disclaimerCs: string
}

export const RESPONSIBLE_GAMBLING: ResponsibleGambling = Object.freeze({
  minimumAge: 18,
  helpline: Object.freeze({
    // TODO(legal): verify the current name, number and URL before publishing.
    // Czech national addiction help-line, which covers gambling.
    name: 'Národní linka pro odvykání',
    phone: '800 350 000',
    url: 'https://www.narodnilinka.cz/',
  }),
  disclaimerCs: `${TODO_PREFIX} Czech disclaimer wording — pending legal review`,
})

/** True once the disclaimer has been replaced with reviewed legal copy. */
export function isResponsibleGamblingCopyReady(): boolean {
  return !RESPONSIBLE_GAMBLING.disclaimerCs.startsWith(TODO_PREFIX)
}
