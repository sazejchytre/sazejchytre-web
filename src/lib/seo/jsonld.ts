/**
 * JSON-LD builders. Data in, plain objects out.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY STRUCTURED DATA IS WORTH THE TROUBLE HERE
 *
 * The product's entire claim is "here is our record, check it". Structured
 * data is what makes that claim machine-readable — a `Dataset` with described
 * variables, a sample size and a period can be cited by a search engine or an
 * assistant without anybody having to trust prose.
 *
 * It is also the thing most often shipped wrong, in two specific ways:
 *
 *   1. MARKUP THAT DISAGREES WITH THE PAGE. Google treats that as spam, and
 *      it is right to. So `FAQPage` is built from the same rows the page
 *      renders, and the `Dataset` figures come from the same
 *      `PublicTrackRecord` the headline numbers do. There is no second
 *      source for either.
 *
 *   2. A FABRICATED PUBLISHER. `Organization` with an invented address or
 *      IČO is worse than no `Organization` at all. Identity therefore
 *      arrives as an argument from `operatorForDisplay()`, which refuses in
 *      production while the register data is missing.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * @id AND WHY THE NODES ARE LINKED
 *
 * `Organization`, `WebSite` and `Dataset` are separate nodes that refer to
 * each other by `@id`. Repeating the publisher's details inside every node
 * would mean three copies to keep in step; a reference means one.
 */
import type { TrackRecordDataset } from '../tips/presentation.ts'
import { HTML_LANG } from '../../i18n/config.ts'
import type { OperatorDisplay } from '../legal/operator-display.ts'
import { absoluteUrl } from './base.ts'
import { SITE_NAME } from './metadata.ts'

export type JsonLdNode = Record<string, unknown>

/* -------------------------------------------------------------------------- */
/* Stable node identifiers                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Fragment ids on the home page, which is the convention for site-wide
 * nodes. They must stay stable: a consumer that cached `#organization`
 * resolves it again on the next crawl.
 */
export const organisationId = (): string => absoluteUrl('/#organization')
export const webSiteId = (): string => absoluteUrl('/#website')
export const trackRecordDatasetId = (): string =>
  absoluteUrl('/historie#dataset')

/* -------------------------------------------------------------------------- */
/* Organization                                                              */
/* -------------------------------------------------------------------------- */

export type OrganisationArgs = {
  /** From `operatorForDisplay()` — the function that refuses in production. */
  operator: OperatorDisplay
  /** Public contact address, from site settings. */
  contactEmail: string
  /** Profiles that genuinely exist. An empty list emits no `sameAs`. */
  sameAs?: readonly string[]
}

/**
 * The operator as an organisation.
 *
 * `vatID` is omitted rather than emitted empty when the operator is not VAT
 * registered: an empty `vatID` reads as "we lost it" rather than "there is
 * none".
 */
export const organisationJsonLd = ({
  operator,
  contactEmail,
  sameAs = [],
}: OrganisationArgs): JsonLdNode => {
  const { operator: identity, addressLine } = operator

  return {
    '@type': 'Organization',
    '@id': organisationId(),
    name: identity.name,
    url: absoluteUrl('/'),
    email: contactEmail,
    // `taxID` carries the IČO. Czech sole traders have one whether or not
    // they are VAT registered, which `vatID` would wrongly imply.
    taxID: identity.ico,
    ...(identity.vatPayer ? { vatID: `CZ${identity.ico}` } : {}),
    address: {
      '@type': 'PostalAddress',
      streetAddress: identity.street,
      postalCode: identity.postalCode,
      addressLocality: identity.city,
      addressCountry: identity.countryCode,
    },
    // Kept as well as the structured address because several consumers read
    // only one of the two, and they must agree.
    description: `${identity.name}, ${addressLine}`,
    ...(sameAs.length > 0 ? { sameAs: [...sameAs] } : {}),
  }
}

/* -------------------------------------------------------------------------- */
/* WebSite                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The site itself.
 *
 * No `SearchAction`: there is no site search, and advertising one that does
 * not exist is a broken promise a crawler will test.
 */
export const webSiteJsonLd = (): JsonLdNode => ({
  '@type': 'WebSite',
  '@id': webSiteId(),
  name: SITE_NAME,
  url: absoluteUrl('/'),
  inLanguage: HTML_LANG.cs,
  publisher: { '@id': organisationId() },
})

/* -------------------------------------------------------------------------- */
/* FAQPage                                                                   */
/* -------------------------------------------------------------------------- */

export type FaqItem = { question: string; answer: string }

/**
 * The FAQ, from the rows the page renders.
 *
 * Returns null for an empty list. An FAQPage with no questions is invalid
 * structured data, and emitting one because the database happened to be
 * empty is exactly the kind of thing that gets a site a manual action.
 */
export const faqPageJsonLd = (
  entries: readonly FaqItem[],
  pagePath = '/',
): JsonLdNode | null => {
  if (entries.length === 0) {
    return null
  }

  return {
    '@type': 'FAQPage',
    '@id': `${absoluteUrl(pagePath)}#faq`,
    inLanguage: HTML_LANG.cs,
    mainEntity: entries.map((entry) => ({
      '@type': 'Question',
      name: entry.question,
      acceptedAnswer: {
        '@type': 'Answer',
        // Plain text, matching the page exactly. This is why the collection
        // stores a textarea rather than rich text.
        text: entry.answer,
      },
    })),
  }
}

/* -------------------------------------------------------------------------- */
/* Dataset                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The track record as a `Dataset`.
 *
 * THE DIVISION HAPPENS HERE, ONCE. `presentation.ts` deliberately keeps the
 * scaled integers — 3833 basis points, not 0.3833 — because that is how the
 * domain stores them and a float in the middle of the pipeline is a rounding
 * bug waiting for a reader. A `PropertyValue` is read by a machine that
 * expects a natural number with a unit, so this is the edge where the scale
 * is applied, and `description` still names the stored integer so the two
 * can be reconciled.
 */
export const datasetJsonLd = (
  dataset: TrackRecordDataset,
  operator: OperatorDisplay,
): JsonLdNode => ({
  '@type': 'Dataset',
  '@id': trackRecordDatasetId(),
  name: dataset.name,
  description: dataset.description,
  measurementTechnique: dataset.measurementTechnique,
  ...(dataset.temporalCoverage
    ? { temporalCoverage: dataset.temporalCoverage }
    : {}),
  dateModified: dataset.dateModified,
  inLanguage: HTML_LANG.cs,
  isAccessibleForFree: dataset.isAccessibleForFree,
  license: absoluteUrl('/metodika'),
  url: dataset.url ?? absoluteUrl('/historie'),
  creator: { '@id': organisationId() },
  publisher: { '@id': organisationId() },
  // Not part of schema.org's vocabulary as such, but `variableMeasured`
  // accepts `PropertyValue`, and the sample size belongs with the figures
  // rather than in prose — a return quoted without one is unfalsifiable.
  variableMeasured: [
    {
      '@type': 'PropertyValue',
      name: 'sampleSize',
      description: 'Počet vyhodnocených tipů, ze kterých jsou figury spočítané',
      value: dataset.sampleSize,
      unitText: 'tipů',
    },
    ...dataset.variableMeasured.map((variable) => ({
      '@type': 'PropertyValue',
      name: variable.name,
      alternateName: variable.label,
      value: variable.value / variable.scale,
      unitText: variable.unitText,
      description:
        variable.scale === 1
          ? variable.label
          : `${variable.label} — uloženo jako celé číslo ${variable.value} v měřítku 1/${variable.scale}`,
    })),
  ],
  // Operator identity is echoed in the node the `@id`s point at; this field
  // exists so a consumer reading only the Dataset still knows who published
  // it without having to resolve a reference.
  sourceOrganization: {
    '@type': 'Organization',
    name: operator.operator.name,
    taxID: operator.operator.ico,
  },
})

/* -------------------------------------------------------------------------- */
/* Graph assembly                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Wrap nodes into one `@graph` document.
 *
 * One `<script>` per page rather than four. Separate scripts are legal but
 * they cannot share `@id` references reliably across consumers, and a single
 * graph is what every validator shows you by default.
 *
 * Nulls are dropped, so a caller can pass `faqPageJsonLd(entries)` straight
 * through without checking whether the FAQ was empty.
 */
export const jsonLdGraph = (
  nodes: readonly (JsonLdNode | null)[],
): JsonLdNode => ({
  '@context': 'https://schema.org',
  '@graph': nodes.filter((node): node is JsonLdNode => node !== null),
})

/* -------------------------------------------------------------------------- */
/* Serialisation                                                              */
/* -------------------------------------------------------------------------- */

/**
 * A graph as the text of a `<script type="application/ld+json">`.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY `<` IS ESCAPED, AND WHY THIS LIVES IN THE LIBRARY
 *
 * `JSON.stringify` does not escape `<`. These nodes are built partly from
 * database fields — an FAQ answer, a legal page title, a site setting — so an
 * answer containing `</script>` would close the element early and everything
 * after it would be parsed as HTML. That is a stored XSS, reachable by
 * anybody who can write to those tables.
 *
 * `<` is valid JSON, invisible to a consumer, and impossible to break
 * out of. `&` is escaped too, so the JSON cannot be entity-decoded by a
 * parser that treats script content as HTML.
 *
 * It is here rather than in the component so that it has a test. The
 * component is the one place `dangerouslySetInnerHTML` is unavoidable — a
 * JSON-LD block has to be raw text — and this function is what makes that
 * safe, which is exactly the kind of thing that should not be a one-liner
 * nobody checks.
 */
export const serialiseJsonLd = (node: JsonLdNode): string =>
  JSON.stringify(node)
    // Double-backslashed on purpose: the REPLACEMENT has to be the six
    // characters \\u003c, not the character they denote. A single
    // backslash here makes the whole function a no-op that looks correct,
    // which is why it has a test.
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
