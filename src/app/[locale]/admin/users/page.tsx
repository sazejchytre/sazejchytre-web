import { requireAdmin } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { Badge } from '@/components/ui/badge'
import { UserActions } from '@/components/admin/user-actions'
import type { Profile, PlanType } from '@/types/database'

export const metadata = { title: 'Uživatelé | Admin' }

type SubData = {
  user_id: string
  plan: string | null
  status: string
  current_period_end: string | null
}

type EntitlementData = {
  user_id: string
  plan: PlanType
  active: boolean
}

type UserWithSub = Profile & {
  subscription: SubData[] | null
  entitlement: EntitlementData | null
}

export default async function AdminUsersPage() {
  const currentUser = await requireAdmin()
  const adminClient = createAdminClient()

  const [{ data: rawUsers }, { data: subscriptionsRaw }, { data: entitlementsRaw }] = await Promise.all([
    adminClient
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100),
    adminClient
      .from('subscriptions')
      .select('user_id, plan, status, current_period_end'),
    adminClient
      .from('user_entitlements')
      .select('user_id, plan, active')
      .eq('active', true),
  ])

  const subscriptions = (subscriptionsRaw ?? []) as SubData[]
  const entitlements = (entitlementsRaw ?? []) as EntitlementData[]

  const subMap = new Map(subscriptions.map((s) => [s.user_id, s]))
  const entitlementMap = new Map(entitlements.map((e) => [e.user_id, e]))

  const users: UserWithSub[] = (rawUsers ?? []).map((u) => {
    const profile = u as Profile
    const sub = subMap.get(profile.id)
    const ent = entitlementMap.get(profile.id)
    return {
      ...profile,
      subscription: sub ? [sub] : null,
      entitlement: ent ?? null,
    }
  })

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Uživatelé</h1>
        <p className="text-muted-foreground text-sm">Přehled registrovaných uživatelů</p>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Email</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Jméno</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Role</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Plán</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status sub.</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Entitlement</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Registrace</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Akce</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const sub = user.subscription?.[0] ?? null
                const ent = user.entitlement
                return (
                  <tr key={user.id} className="border-b border-border/50 hover:bg-secondary/20">
                    <td className="px-4 py-3 font-medium">{user.email}</td>
                    <td className="px-4 py-3 text-muted-foreground">{user.full_name ?? '—'}</td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={
                          user.role === 'super_admin'
                            ? 'elite'
                            : user.role === 'admin'
                            ? 'pro'
                            : 'secondary'
                        }
                      >
                        {user.role}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      {sub?.plan ? (
                        <Badge variant={sub.plan as 'basic' | 'pro' | 'elite'}>
                          {sub.plan.toUpperCase()}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">Žádný</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {sub?.status ? (
                        <Badge variant={sub.status === 'active' ? 'published' : 'draft'}>
                          {sub.status}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {ent ? (
                        <Badge variant={ent.plan as 'basic' | 'pro' | 'elite'}>
                          {ent.plan.toUpperCase()}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {new Date(user.created_at).toLocaleDateString('cs-CZ')}
                    </td>
                    <td className="px-4 py-3">
                      <UserActions
                        userId={user.id}
                        currentUserId={currentUser.id}
                        userRole={user.role}
                        hasActiveEntitlement={!!ent}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
