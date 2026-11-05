/**
 * Join class names.
 *
 * Twelve lines instead of `clsx` + `tailwind-merge`. The merge library exists
 * to resolve conflicting Tailwind utilities (`p-2 p-4` → `p-4`), and the
 * primitives in this directory are built so that conflict does not arise: a
 * variant owns its own properties and a caller's `className` is appended last,
 * where CSS source order already gives it precedence for equal specificity.
 *
 * If a future component genuinely needs conflict resolution, that is the
 * moment to add the dependency — not before.
 */
export type ClassValue =
  string | false | null | undefined | readonly ClassValue[]

export const cn = (...values: readonly ClassValue[]): string =>
  values
    .flat(Infinity as 1)
    .filter(
      (value): value is string => typeof value === 'string' && value !== '',
    )
    .join(' ')
