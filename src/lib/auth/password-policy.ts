/**
 * Password policy.
 *
 * THE RULES, AND WHY THESE AND NOT THE USUAL ONES
 *
 *  - Minimum 12 characters. Length is the only knob that reliably raises the
 *    cost of guessing.
 *  - NO composition requirements. No "must contain an uppercase, a digit and a
 *    symbol". Those rules do not measurably help — they push people towards
 *    `Password1!`, which is in every cracking dictionary — and they block
 *    genuinely strong passphrases. This follows NIST SP 800-63B, which
 *    explicitly recommends against composition rules.
 *  - NO rotation. Forced expiry makes people pick weaker, incrementable
 *    passwords (`Summer2026!` → `Autumn2026!`) and is also advised against.
 *  - Rejected if it appears in a list of the most common passwords, compared
 *    after normalisation. This is the check that actually stops the passwords
 *    attackers try first, which composition rules never did.
 *
 * The list is checked LOCALLY, not against an online breach API. A remote
 * lookup would put a third party in the registration path, leak a hash prefix
 * of every password our users choose, and fail in a way we would then have to
 * decide about. A bundled list has none of those properties and catches the
 * overwhelming majority of real guessing attempts.
 *
 * Pure and dependency-free, so the policy is exhaustively testable without a
 * database, a request or an environment.
 */
import { COMMON_PASSWORDS } from './common-passwords.ts'

/** Minimum length. Raising this later only affects new passwords. */
export const MIN_PASSWORD_LENGTH = 12

/**
 * Upper bound, to stop a megabyte of text reaching the hasher.
 *
 * Not a security rule — it is a denial-of-service guard. Argon2/scrypt cost
 * scales with input, so an unbounded password is an unbounded amount of work
 * per request.
 */
export const MAX_PASSWORD_LENGTH = 200

/** Machine-readable reasons, so callers need not match on message text. */
export const PASSWORD_REJECTIONS = [
  'TOO_SHORT',
  'TOO_LONG',
  'TOO_COMMON',
  'WHITESPACE_ONLY',
] as const
export type PasswordRejection = (typeof PASSWORD_REJECTIONS)[number]

export type PasswordCheck =
  { ok: true } | { ok: false; reason: PasswordRejection; message: string }

/**
 * Czech messages, shown directly to the customer.
 *
 * Deliberately specific: "too short" tells them what to fix. The one message
 * that stays vague is nothing here — password feedback is not an enumeration
 * risk, because the user already knows the password they just typed.
 */
const MESSAGES: Record<PasswordRejection, string> = {
  TOO_SHORT: `Heslo musí mít alespoň ${MIN_PASSWORD_LENGTH} znaků.`,
  TOO_LONG: `Heslo může mít nejvýše ${MAX_PASSWORD_LENGTH} znaků.`,
  TOO_COMMON:
    'Toto heslo je příliš často používané a útočníci ho zkoušejí jako první. Zvolte jiné.',
  WHITESPACE_ONLY: 'Heslo nemůže být složené jen z mezer.',
}

/**
 * Normalise a candidate for comparison against the common list.
 *
 * Lower-cased and trimmed so `Password123!` and `  password123! ` are both
 * recognised. Unicode is NFKC-folded so visually identical variants collapse
 * to the same string — without it, a full-width or decomposed spelling of a
 * common password would slip through.
 *
 * This is for COMPARISON ONLY. The password that gets hashed is always exactly
 * what the user typed; normalising before hashing would silently accept a
 * different password at sign-in than the one they set.
 */
export const normaliseForComparison = (password: string): string =>
  password.normalize('NFKC').trim().toLowerCase()

/** Is this one of the passwords attackers try first? */
export const isCommonPassword = (password: string): boolean =>
  COMMON_PASSWORDS.has(normaliseForComparison(password))

/**
 * Apply the policy.
 *
 * Order matters: length is checked before the common-password list, so a
 * three-character password is told it is short rather than told it is common.
 */
export const checkPassword = (password: string): PasswordCheck => {
  const reject = (reason: PasswordRejection): PasswordCheck => ({
    ok: false,
    reason,
    message: MESSAGES[reason],
  })

  if (typeof password !== 'string') {
    return reject('TOO_SHORT')
  }

  // Length is counted in code points, not UTF-16 units, so an emoji or an
  // accented character counts once rather than twice.
  const length = [...password].length

  if (length < MIN_PASSWORD_LENGTH) {
    return reject('TOO_SHORT')
  }

  if (length > MAX_PASSWORD_LENGTH) {
    return reject('TOO_LONG')
  }

  if (password.trim().length === 0) {
    return reject('WHITESPACE_ONLY')
  }

  if (isCommonPassword(password)) {
    return reject('TOO_COMMON')
  }

  return { ok: true }
}
