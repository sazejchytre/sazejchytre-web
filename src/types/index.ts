export * from './database'

export type Locale = 'cs' | 'en' | 'sk'

export const LOCALES: Locale[] = ['cs', 'en', 'sk']
export const DEFAULT_LOCALE: Locale = 'cs'

export const PLAN_HIERARCHY: Record<string, number> = {
  start: 1,
  smart: 2,
  elite: 3,
}

export function canAccessPlan(userPlan: string | null, requiredPlan: string): boolean {
  if (!userPlan) return false
  return (PLAN_HIERARCHY[userPlan] ?? 0) >= (PLAN_HIERARCHY[requiredPlan] ?? 0)
}

export interface ApiResponse<T = unknown> {
  data?: T
  error?: string
}
