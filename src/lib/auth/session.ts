import { createClient } from '@/lib/supabase/server'
import type { Profile, UserRole } from '@/types/database'

export async function getSession() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) return null
  return user
}

export async function getProfile(): Promise<Profile | null> {
  const user = await getSession()
  if (!user) return null

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (error) return null
  return data
}

export async function requireAuth() {
  const user = await getSession()
  if (!user) {
    throw new Error('UNAUTHORIZED')
  }
  return user
}

export async function requireRole(requiredRole: UserRole) {
  const profile = await getProfile()

  if (!profile) throw new Error('UNAUTHORIZED')

  const roleHierarchy: Record<UserRole, number> = {
    user: 0,
    admin: 1,
    super_admin: 2,
  }

  if ((roleHierarchy[profile.role] ?? -1) < (roleHierarchy[requiredRole] ?? 0)) {
    throw new Error('FORBIDDEN')
  }

  return profile
}

export async function requireAdmin() {
  return requireRole('admin')
}

export async function requireSuperAdmin() {
  return requireRole('super_admin')
}
