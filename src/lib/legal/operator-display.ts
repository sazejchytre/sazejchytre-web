/**
 * Operator identity, resolved for RENDERING.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE ONE PLACE THAT DECIDES WHAT A VISITOR SEES
 *
 * `operator.ts` holds the data and the assertion. This holds the policy:
 *
 *   - in PRODUCTION, placeholder identity is a hard failure.
 *     `assertOperatorConfigured()` throws, the page 500s, and the operator
 *     finds out immediately. A commercial site that publishes
 *     "TODO: 8-digit IČO" in its footer is a compliance problem, and one
 *     that publishes a *plausible-looking* invented IČO is a worse one.
 *
 *   - OUTSIDE production, the placeholders render, marked as placeholders.
 *     The footer has to be buildable and reviewable before the register data
 *     arrives, and a developer who sees "TODO: city" in the footer knows
 *     exactly what is missing. Silently hiding the block would hide the
 *     missing work as well.
 *
 * Nothing else in the app may read `OPERATOR` for display. That is what keeps
 * the production refusal in one place rather than in every component that
 * happens to show an address.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY IT READS `process.env.NODE_ENV` AND NOT `env.ts`
 *
 * So that it is testable. Importing `../env.ts` pulls in a schema that
 * demands twenty real secrets at module load, which a unit test has no
 * business supplying. `NODE_ENV` is not a secret and Next sets it itself.
 *
 * The argument is exposed so a test can assert BOTH branches, which is the
 * only way to prove the production refusal actually refuses.
 */
import {
  OPERATOR,
  OPERATOR_DETAILS_CONFIRMED,
  type OperatorIdentity,
  assertOperatorConfigured,
  formatOperatorAddress,
  unresolvedOperatorFields,
} from './operator.ts'

export type OperatorDisplay = {
  /** True once every field is real and the confirmation flag is set. */
  readonly configured: boolean
  /** Field names still holding a `TODO:` value. Empty when configured. */
  readonly unresolved: readonly string[]
  /** The identity, placeholders and all. Never invented. */
  readonly operator: OperatorIdentity
  /** `street, postcode city` — one line, for the footer and JSON-LD. */
  readonly addressLine: string
}

/**
 * Identity for public rendering.
 *
 * @throws in production while any field is a placeholder. That is the point.
 */
export const operatorForDisplay = (
  production: boolean = process.env.NODE_ENV === 'production',
): OperatorDisplay => {
  const unresolved = unresolvedOperatorFields()
  const configured = unresolved.length === 0 && OPERATOR_DETAILS_CONFIRMED

  if (!configured && production) {
    // Throws with the list of missing fields. Deliberately not caught
    // anywhere: a 500 on the footer is the loudest available signal, and the
    // alternative is a live site with invented or missing statutory details.
    assertOperatorConfigured()
  }

  return {
    configured,
    unresolved,
    operator: OPERATOR,
    addressLine: formatOperatorAddress(),
  }
}
