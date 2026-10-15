/**
 * What we record about the device behind a session, and what we refuse to.
 *
 * THE PRIVACY DECISION
 *
 * The account page has to show "which devices am I signed in on", which needs
 * *some* identifying detail. A full IP address is the obvious thing to store
 * and the wrong one: it is personal data under GDPR, it pins a person to a
 * household, and we would be keeping it for the life of the session for a
 * feature that only needs "was this me?".
 *
 * So each session stores:
 *
 *   - the COUNTRY CODE only, from the edge (`cf-ipcountry` or equivalent).
 *     Country is enough for "someone signed in from another country", which is
 *     the signal a customer actually acts on. City-level geolocation would add
 *     nothing they could use and a lot we would have to protect.
 *
 *   - a TRUNCATED, then HASHED address. The last octet of IPv4 (and the host
 *     half of IPv6) is dropped first, so even the hash cannot be reversed to a
 *     single machine — only to a /24 or /32 prefix. The hash is keyed with
 *     BETTER_AUTH_SECRET so the same prefix produces the same value for us and
 *     an unkeyed rainbow table is useless.
 *
 *     Truncating BEFORE hashing is the part that matters. Hashing a full IPv4
 *     address is not anonymisation: the space is only 2^32, so anyone with the
 *     hash and the key — or just the key and some patience — can enumerate it.
 *     Dropping the last octet first collapses 256 addresses into one value,
 *     which is what makes the stored value genuinely non-identifying.
 *
 *   - a coarse DEVICE LABEL parsed from the user agent: "Chrome na Windows".
 *     Not the raw UA string, which is a fingerprint in its own right.
 *
 * What is NOT stored anywhere: the full address, city, latitude/longitude, or
 * the raw user-agent header.
 *
 * Pure and dependency-free, so all of it is testable without a request.
 */
import { createHmac } from 'node:crypto'

/* -------------------------------------------------------------------------- */
/* IP handling                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Drop the identifying tail of an address.
 *
 * IPv4 keeps the first three octets (a /24). IPv6 keeps the first four groups
 * (a /64, which is the usual single-customer allocation, so we take the
 * network half and discard the host half).
 *
 * @returns the truncated prefix, or `null` if the input is not an address.
 */
export const truncateIpAddress = (
  ip: string | null | undefined,
): string | null => {
  if (typeof ip !== 'string') {
    return null
  }

  const value = ip.trim()

  if (value.length === 0) {
    return null
  }

  // IPv4-mapped IPv6 (::ffff:1.2.3.4) is handled as IPv4.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(value)
  const candidate = mapped?.[1] ?? value

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(candidate)) {
    const octets = candidate.split('.')

    if (octets.some((octet) => Number(octet) > 255)) {
      return null
    }

    return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`
  }

  if (value.includes(':')) {
    // Expand nothing; just take the leading groups that are present.
    const groups = value.split(':').filter((group) => group.length > 0)

    if (groups.length === 0) {
      return null
    }

    return `${groups.slice(0, 4).join(':')}::/64`
  }

  return null
}

/**
 * Keyed hash of a truncated prefix.
 *
 * HMAC rather than a plain digest so that the value cannot be recomputed
 * without our secret. Truncation has already removed the identifying detail;
 * this removes the ability to confirm a guess.
 */
export const hashIpPrefix = (
  prefix: string | null,
  secret: string,
): string | null => {
  if (!prefix) {
    return null
  }

  return createHmac('sha256', secret)
    .update(prefix)
    .digest('base64url')
    .slice(0, 32)
}

/** Truncate then hash, in the only order that is safe. */
export const fingerprintIpAddress = (
  ip: string | null | undefined,
  secret: string,
): string | null => hashIpPrefix(truncateIpAddress(ip), secret)

/* -------------------------------------------------------------------------- */
/* Country                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Normalise an edge-provided country code.
 *
 * Cloudflare sends `XX` for unknown and `T1` for Tor; both are treated as
 * absent rather than stored as if they meant a place.
 */
export const normaliseIpCountry = (
  value: string | null | undefined,
): string | null => {
  if (typeof value !== 'string') {
    return null
  }

  const code = value.trim().toUpperCase()

  if (!/^[A-Z]{2}$/.test(code) || code === 'XX' || code === 'T1') {
    return null
  }

  return code
}

/* -------------------------------------------------------------------------- */
/* Device label                                                               */
/* -------------------------------------------------------------------------- */

const BROWSERS: readonly [RegExp, string][] = [
  // Order matters: Edge and Opera both claim to be Chrome.
  [/edg(?:e|a|ios)?\//i, 'Edge'],
  [/opr\/|opera/i, 'Opera'],
  [/firefox\/|fxios\//i, 'Firefox'],
  [/chrome\/|crios\//i, 'Chrome'],
  [/safari\//i, 'Safari'],
]

const PLATFORMS: readonly [RegExp, string][] = [
  [/windows/i, 'Windows'],
  [/iphone|ipad|ipod/i, 'iOS'],
  [/android/i, 'Android'],
  [/mac os x|macintosh/i, 'macOS'],
  [/linux/i, 'Linux'],
]

/**
 * Coarse, human-readable device label in Czech.
 *
 * Deliberately low-resolution. "Chrome na Windows" is enough for a customer to
 * recognise their own session; a version number and build string would make
 * the stored value a fingerprint without making the feature more useful.
 */
export const describeDevice = (
  userAgent: string | null | undefined,
): string => {
  if (typeof userAgent !== 'string' || userAgent.trim().length === 0) {
    return 'Neznámé zařízení'
  }

  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1]
  const platform = PLATFORMS.find(([pattern]) => pattern.test(userAgent))?.[1]

  if (browser && platform) {
    return `${browser} na ${platform}`
  }

  if (browser) {
    return browser
  }

  if (platform) {
    return platform
  }

  return 'Neznámé zařízení'
}
