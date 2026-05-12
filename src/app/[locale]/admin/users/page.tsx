import { requireAdmin } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { Badge } from '@/components/ui/badge'
import type { Profile } from '@/types/database'

export const metadata = { title: 'Uživatelé | Admin' }

type SubData = {
  user_id: string
  plan: string | null
  status: string
  current_period_end: string | null
}

type UserWithSub = Profile & {
  subscription: SubData[] | null
}

export default async function AdminUsersPage() {
  await requireAdmin()
  const adminClient = createAdminClient()

  const { data: rawUsers } = await adminClient
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)

  const { data: subscriptionsRaw } = await adminClient
    .from('subscriptions')
    .select('user_id, plan, status, current_period_end')

  const subscriptions = (subscriptionsRaw ?? []) as Array<{
    user_id: string
    plan: string | null
    status: string
    current_period_end: string | null
  }>

  const subMap = new Map(subscriptions.map((s) => [s.user_id, s]))

  const users: UserWithSub[] = (rawUsers ?? []).map((u) => {
    const profile = u as Profile
    return {
      ...profile,
      subscription: subMap.has(profile.id) ? [subMap.get(profile.id)!] : null,
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
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Registrace</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const sub = user.subscription?.[0] ?? null
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
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {new Date(user.created_at).toLocaleDateString('cs-CZ')}
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
