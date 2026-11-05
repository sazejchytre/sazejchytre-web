/**
 * The marketing consent, and the thing that stops its wording drifting.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY A FINGERPRINT
 *
 * A `ConsentRecord` stores `consentTextSnapshot` — the exact wording shown —
 * and a `documentVersion` for correlation. The snapshot is the authority; the
 * version is what makes a thousand snapshots groupable into "everyone who
 * agreed to the 2026-11 wording".
 *
 * The failure mode is quiet: somebody improves the sentence in the message
 * catalogue, does not touch the version, and from then on two different
 * texts are recorded under one version string. Nothing breaks, nothing is
 * logged, and the grouping silently stops meaning anything.
 *
 * So the wording is fingerprinted, and a test asserts the fingerprint still
 * matches the catalogue. Editing the sentence fails that test with an
 * instruction to bump the version — which turns an invisible mistake into a
 * two-line change somebody has to make on purpose.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THE CONSENT IS RECORDED EVEN IF ECOMAIL REFUSES
 *
 * Because the consent happened. The visitor read a sentence and ticked a box;
 * whether our newsletter provider was reachable thirty milliseconds later is
 * not part of that fact. Writing the record first also means a provider
 * outage never costs us the evidence for a subscription we did eventually
 * deliver.
 */
import { createHash } from 'node:crypto'

import { cs } from '../../i18n/messages/cs.ts'

/**
 * Version of the marketing consent wording.
 *
 * BUMP THIS WHENEVER `cs.newsletter.consent` CHANGES. The fingerprint test
 * below is what reminds you.
 */
export const MARKETING_CONSENT_VERSION = 'newsletter-cs-2026-11'

/** The wording, read from the catalogue so there is only ever one copy. */
export const marketingConsentText = (): string => cs.newsletter.consent

/**
 * SHA-256 of the wording above, as recorded when the version was set.
 *
 * Not a security measure — a change detector. See the module header.
 */
export const MARKETING_CONSENT_FINGERPRINT =
  'e6c1359e859f0d869780124a038554a0b3698426e414c957ef4b5a17900e9cfb'

export const fingerprintConsentText = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex')
