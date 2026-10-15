/**
 * Rate-limit budgets and the lockout escalation curve.
 *
 * Split out from `rate-limit.ts` because that module imports the validated
 * environment, which throws at import time when the environment is absent —
 * so anything importing it cannot be unit tested. The numbers and the
 * escalation rule are the part worth testing, and nothing here touches
 * Redis, the clock or the environment.
 */

export type RateLimitRule = {
  /** Requests permitted per window. */
  limit: number
  /** Window length in seconds. */
  windowSeconds: number
}

/**
 * Per-endpoint budgets, by IP and by account.
 *
 * Chosen so that a real person never meets them: three password attempts and
 * one reset request is normal, ten is not. The TOTP budget is the tightest,
 * because a six-digit code is only ~20 bits and is the one secret where the
 * limit is doing the cryptographic work.
 */
export const RATE_LIMITS = {
  signIn: {
    ip: { limit: 10, windowSeconds: 15 * 60 },
    account: { limit: 5, windowSeconds: 15 * 60 },
  },
  signUp: {
    ip: { limit: 5, windowSeconds: 60 * 60 },
    account: { limit: 3, windowSeconds: 60 * 60 },
  },
  passwordResetRequest: {
    ip: { limit: 5, windowSeconds: 60 * 60 },
    account: { limit: 3, windowSeconds: 60 * 60 },
  },
  verificationResend: {
    ip: { limit: 5, windowSeconds: 60 * 60 },
    account: { limit: 3, windowSeconds: 60 * 60 },
  },
  totpVerify: {
    ip: { limit: 20, windowSeconds: 5 * 60 },
    account: { limit: 5, windowSeconds: 5 * 60 },
  },
  backupCodeVerify: {
    ip: { limit: 10, windowSeconds: 60 * 60 },
    account: { limit: 5, windowSeconds: 60 * 60 },
  },
} as const satisfies Record<
  string,
  { ip: RateLimitRule; account: RateLimitRule }
>

export type RateLimitedAction = keyof typeof RATE_LIMITS

/* -------------------------------------------------------------------------- */
/* Progressive lockout                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Consecutive failures before an account is temporarily locked, and for how
 * long. The delay grows so that a persistent attacker is slowed to a crawl
 * while a customer having a bad morning is barely inconvenienced.
 */
export const LOCKOUT_STEPS: readonly {
  afterFailures: number
  lockSeconds: number
}[] = [
  { afterFailures: 5, lockSeconds: 60 },
  { afterFailures: 8, lockSeconds: 5 * 60 },
  { afterFailures: 12, lockSeconds: 30 * 60 },
  { afterFailures: 20, lockSeconds: 4 * 60 * 60 },
]

/** How long a failure counter survives without further failures. */
export const FAILURE_WINDOW_SECONDS = 24 * 60 * 60

/**
 * Lock duration for a given consecutive-failure count.
 *
 * Pure, so the escalation curve is testable without Redis.
 */
export const lockSecondsForFailures = (failures: number): number => {
  let seconds = 0

  for (const step of LOCKOUT_STEPS) {
    if (failures >= step.afterFailures) {
      seconds = step.lockSeconds
    }
  }

  return seconds
}
