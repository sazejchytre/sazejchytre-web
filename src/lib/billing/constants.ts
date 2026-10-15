/**
 * Billing domain vocabulary.
 *
 * Every enum here becomes a Postgres enum type through Payload's `select`
 * fields, so the values are schema. Two rules follow from that:
 *
 *  1. ADD values here before they are needed, not when they are needed. Adding
 *     a value later means an `ALTER TYPE ... ADD VALUE` migration. That is
 *     cheap, but it has to be deployed before any row can use it, which turns
 *     a config change into a release. Currencies, tax treatments and providers
 *     are all declared ahead of use for exactly this reason.
 *  2. NEVER rename or remove a value. Rows in the wild reference it.
 *
 * Whether a declared value is *accepted right now* is a separate question from
 * whether the database knows about it — see `ENABLED_CURRENCIES` below. That
 * split is what lets us turn on EUR without migrating live subscriptions.
 *
 * This module is intentionally dependency-free and side-effect-free so it can
 * be imported from pure functions, from Payload collections, and from tests
 * that run under Node's native type stripping.
 */

/* -------------------------------------------------------------------------- */
/* Plans                                                                      */
/* -------------------------------------------------------------------------- */

export const PLAN_CODES = ['START', 'PRO', 'INSIDER'] as const
export type PlanCode = (typeof PLAN_CODES)[number]

/* -------------------------------------------------------------------------- */
/* Money                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Currencies the schema knows about.
 *
 * All of these exist in the Postgres enum. Only `ENABLED_CURRENCIES` may be
 * written today.
 */
export const CURRENCIES = ['CZK', 'EUR'] as const
export type Currency = (typeof CURRENCIES)[number]

/**
 * Currencies accepted right now. Launch is Czech market only.
 *
 * Widening this is a one-line change with no migration, because EUR is already
 * in the database enum.
 */
export const ENABLED_CURRENCIES: readonly Currency[] = ['CZK'] as const

/**
 * Minor units per major unit, per currency.
 *
 * Money is stored exclusively as an integer count of minor units (haléře for
 * CZK, cents for EUR). This table exists for formatting and for tests — never
 * to convert an amount into a float for storage.
 */
export const MINOR_UNITS_PER_MAJOR: Readonly<Record<Currency, number>> = {
  CZK: 100,
  EUR: 100,
}

/** Billing cadence. */
export const BILLING_INTERVALS = ['MONTH', 'YEAR'] as const
export type BillingInterval = (typeof BILLING_INTERVALS)[number]

/* -------------------------------------------------------------------------- */
/* Subscriptions                                                              */
/* -------------------------------------------------------------------------- */

export const SUBSCRIPTION_STATUSES = [
  /** Created, awaiting a first successful payment. Grants nothing. */
  'INCOMPLETE',
  /** Paid and current. */
  'ACTIVE',
  /** Payment failed but the paid-for period has not elapsed yet. */
  'PAST_DUE',
  /** Terminated. A cancellation scheduled for period end stays ACTIVE until then. */
  'CANCELED',
  /** Ran to the end of its term without renewing. */
  'EXPIRED',
] as const
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number]

/**
 * Statuses that can grant access, subject to the period window.
 *
 * `PAST_DUE` is in here on purpose: the customer paid for the current period,
 * so a failed *renewal* must not retroactively remove the period they already
 * bought. Access stops at `currentPeriodEnd` either way.
 */
export const ACCESS_GRANTING_STATUSES: readonly SubscriptionStatus[] = [
  'ACTIVE',
  'PAST_DUE',
] as const

export const SUBSCRIPTION_EVENT_TYPES = [
  'CREATED',
  'ACTIVATED',
  'RENEWED',
  'PAYMENT_FAILED',
  'PAYMENT_RECOVERED',
  'CANCELLATION_SCHEDULED',
  'CANCELLATION_REVOKED',
  'CANCELED',
  'EXPIRED',
  'PLAN_CHANGED',
  'PROVIDER_SYNC',
] as const
export type SubscriptionEventType = (typeof SUBSCRIPTION_EVENT_TYPES)[number]

/* -------------------------------------------------------------------------- */
/* Entitlements                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Everything a plan or a manual grant can unlock.
 *
 * Entitlement is always derived from our own database — never read back from
 * the payment provider. The provider tells us money moved; what that buys is
 * our decision and lives here.
 */
export const FEATURE_KEYS = [
  'TIPS_REALTIME',
  'TIPS_ALL_SPORTS',
  'FULL_RATIONALE',
  'VALUE_RATING',
  'PUSH_NOTIFICATIONS',
  'ARCHIVE_EXPORT',
  'API_ACCESS',
  'EARLY_ACCESS',
] as const
export type FeatureKey = (typeof FEATURE_KEYS)[number]

/* -------------------------------------------------------------------------- */
/* Providers                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * External billing providers.
 *
 * Declared as an enum with a single member so that swapping or adding a
 * provider is a data change rather than a schema redesign. Nothing in the
 * domain model reaches for Stripe by name.
 */
export const BILLING_PROVIDERS = ['STRIPE'] as const
export type BillingProvider = (typeof BILLING_PROVIDERS)[number]

/* -------------------------------------------------------------------------- */
/* Invoicing                                                                  */
/* -------------------------------------------------------------------------- */

export const INVOICE_STATUSES = ['ISSUED', 'CREDITED'] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

/**
 * How a document was taxed.
 *
 * `NONE_NOT_VAT_REGISTERED` is the only one in use: the operator is a Czech
 * sole trader who is not VAT registered, so no VAT is charged and none is
 * shown. The rest are declared now so that registering for VAT, crossing the
 * EU distance-selling threshold, or selling B2B cross-border later does not
 * require an enum migration before the first such document can be issued.
 */
export const TAX_TREATMENTS = [
  /** Operator is not VAT registered. taxMinor is 0, taxRatePercent is 0. */
  'NONE_NOT_VAT_REGISTERED',
  /** Czech VAT at the domestic rate. */
  'CZ_VAT_STANDARD',
  /** Czech VAT at a reduced domestic rate. */
  'CZ_VAT_REDUCED',
  /** B2C in another EU member state, declared through One Stop Shop. */
  'EU_OSS_B2C',
  /** B2B in another EU member state; VAT accounted for by the customer. */
  'EU_REVERSE_CHARGE_B2B',
  /** Customer outside the EU. */
  'OUTSIDE_EU_NOT_SUBJECT',
] as const
export type TaxTreatment = (typeof TAX_TREATMENTS)[number]

/**
 * Independent document numbering series.
 *
 * Invoices and credit notes each run their own strictly sequential, per-year
 * series. They must never share a counter: a gap in either series is a
 * bookkeeping defect.
 */
export const DOCUMENT_SERIES = ['INVOICE', 'CREDIT_NOTE'] as const
export type DocumentSeries = (typeof DOCUMENT_SERIES)[number]

/* -------------------------------------------------------------------------- */
/* Consent                                                                    */
/* -------------------------------------------------------------------------- */

export const CONSENT_TYPES = [
  'TERMS',
  'PRIVACY',
  /**
   * Czech-law waiver of the 14-day right of withdrawal for digital content
   * supplied before that period elapses. The exact wording shown to the
   * customer is stored with the record, not referenced.
   */
  'DIGITAL_CONTENT_WAIVER',
  'MARKETING',
] as const
export type ConsentType = (typeof CONSENT_TYPES)[number]

/* -------------------------------------------------------------------------- */
/* Helpers for Payload `select` fields                                        */
/* -------------------------------------------------------------------------- */

/**
 * Turn a readonly tuple of codes into Payload select options.
 *
 * Keeping the label equal to the value is deliberate: these are machine codes
 * that appear in invoices and audit logs, and a translated label in the admin
 * panel would make them harder to correlate with provider data.
 */
export const toOptions = <T extends readonly string[]>(
  values: T,
): { label: string; value: T[number] }[] =>
  values.map((value) => ({ label: value, value }))
