/**
 * Billing country guard.
 *
 * Pure and side-effect free: it takes the supported set as an argument rather
 * than reading the environment, so it is testable without a loaded `.env` and
 * usable from both a request and a script.
 *
 * Production call sites pass `env.SUPPORTED_BILLING_COUNTRIES`. The default
 * exists so the one-argument form in the task brief works and so a forgotten
 * argument fails closed on the launch market rather than opening up the world.
 *
 * This module must not import `../env.ts`: that module validates and throws at
 * import time, which would make every unit test depend on a populated
 * environment.
 */
import {
  InvalidCountryCodeError,
  UnsupportedBillingCountryError,
} from './errors.ts'

/**
 * Fallback supported set.
 *
 * Mirrors the zod default on `SUPPORTED_BILLING_COUNTRIES`. Kept here, not
 * imported from the env module, to keep this file pure — the two are pinned
 * together by a test.
 */
export const DEFAULT_SUPPORTED_BILLING_COUNTRIES: readonly string[] = [
  'CZ',
] as const

const ALPHA2 = /^[A-Za-z]{2}$/

/**
 * Normalise a country code to ISO 3166-1 alpha-2 upper case.
 *
 * @throws {InvalidCountryCodeError} if it is not two letters.
 */
export const normaliseCountryCode = (code: string): string => {
  const trimmed = typeof code === 'string' ? code.trim() : ''

  if (!ALPHA2.test(trimmed)) {
    throw new InvalidCountryCodeError(String(code))
  }

  return trimmed.toUpperCase()
}

/** Non-throwing form, for UI that wants to grey out a country rather than fail. */
export const isSupportedBillingCountry = (
  code: string,
  supported: readonly string[] = DEFAULT_SUPPORTED_BILLING_COUNTRIES,
): boolean => {
  let normalised: string

  try {
    normalised = normaliseCountryCode(code)
  } catch {
    return false
  }

  return supported.some((entry) => entry.toUpperCase() === normalised)
}

/**
 * Assert that we are set up to sell into this country.
 *
 * Checkout will call this before creating anything chargeable. It is a domain
 * invariant rather than a UI concern: the country decides which tax regime
 * applies, and we are only set up for one.
 *
 * @returns the normalised code, so callers can store the canonical form.
 * @throws {InvalidCountryCodeError} if the code is malformed.
 * @throws {UnsupportedBillingCountryError} if the country is not supported.
 */
export const assertSupportedBillingCountry = (
  code: string,
  supported: readonly string[] = DEFAULT_SUPPORTED_BILLING_COUNTRIES,
): string => {
  const normalised = normaliseCountryCode(code)

  if (!supported.some((entry) => entry.toUpperCase() === normalised)) {
    throw new UnsupportedBillingCountryError(normalised, supported)
  }

  return normalised
}
