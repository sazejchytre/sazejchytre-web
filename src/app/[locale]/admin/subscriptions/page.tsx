import type { Metadata } from 'next'
import { requireAdmin } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { Badge } from '@/components/ui/badge'

export const metadata: Metadata = { title: 'Předplatná | Admin' }

type SubscriptionRow = {
  id: string
  user_id: string
  plan: string | null
  status: string
  current_period_end: string | null
  created_at: string
  profiles: { email: string } | null
}

export default async function AdminSubscriptionsPage() {
  await requireAdmin()
  const adminClient = createAdminClient()

  const { data } = await adminClient
    .from('subscriptions')
    .select('id, user_id, plan, status, current_period_end, created_at, profiles(email)')
    .order('created_at', { ascending: false })
    .limit(200)

  const subscriptions = (data ?? []) as SubscriptionRow[]

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Předplatná</h1>
        <p className="text-muted-foreground text-sm">Přehled všech předplatných</p>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Email</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Plán</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Konec období</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Vytvořeno</th>
              </tr>
            </thead>
            <tbody>
              {subscriptions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    Žádná předplatná
                  </td>
                </tr>
              ) : (
                subscriptions.map((sub) => (
                  <tr key={sub.id} className="border-b border-border/50 hover:bg-secondary/20">
                    <td className="px-4 py-3 font-medium">
                      {sub.profiles?.email ?? (
                        <span className="text-muted-foreground text-xs">{sub.user_id.slice(0, 8)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {sub.plan ? (
                        <Badge variant={sub.plan as 'basic' | 'pro' | 'elite'}>
                          {sub.plan.toUpperCase()}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={sub.status === 'active' ? 'published' : 'draft'}>
                        {sub.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {sub.current_period_end
                        ? new Date(sub.current_period_end).toLocaleDateString('cs-CZ')
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {new Date(sub.created_at).toLocaleDateString('cs-CZ')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
