import type { Metadata } from 'next'
import { requireAdmin } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { FileText, Users, TrendingUp, CheckCircle } from 'lucide-react'

export const metadata: Metadata = { title: 'Admin Panel' }

export default async function AdminPage() {
  await requireAdmin()

  const adminClient = createAdminClient()

  const [tipsResult, usersResult, activeSubsResult] = await Promise.all([
    adminClient.from('tips').select('id', { count: 'exact', head: true }),
    adminClient.from('profiles').select('id', { count: 'exact', head: true }),
    adminClient
      .from('subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active'),
  ])

  const stats = [
    { label: 'Celkem tipů', value: tipsResult.count ?? 0, icon: FileText, color: 'text-primary' },
    { label: 'Registrovaných uživatelů', value: usersResult.count ?? 0, icon: Users, color: 'text-green-400' },
    {
      label: 'Aktivních předplatných',
      value: activeSubsResult.count ?? 0,
      icon: TrendingUp,
      color: 'text-purple-400',
    },
    {
      label: 'Publikovaných tipů',
      value: tipsResult.count ?? 0,
      icon: CheckCircle,
      color: 'text-gold-400',
    },
  ]

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-2">Admin Panel</h1>
      <p className="text-muted-foreground mb-8">Přehled platformy SázejChytře</p>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <div key={stat.label} className="rounded-xl border border-border bg-card p-6">
              <div className="flex items-center gap-3 mb-3">
                <Icon className={`h-5 w-5 ${stat.color}`} />
                <span className="text-sm text-muted-foreground">{stat.label}</span>
              </div>
              <div className="text-3xl font-bold">{stat.value}</div>
            </div>
          )
        })}
      </div>

      <div className="rounded-xl border border-border bg-card p-6">
        <h2 className="font-semibold mb-4">Rychlé akce</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <a
            href="./admin/tips/new"
            className="flex items-center gap-3 rounded-lg border border-border p-4 hover:bg-secondary transition-colors"
          >
            <FileText className="h-5 w-5 text-primary" />
            <span className="text-sm font-medium">Nový tip</span>
          </a>
          <a
            href="./admin/categories"
            className="flex items-center gap-3 rounded-lg border border-border p-4 hover:bg-secondary transition-colors"
          >
            <FileText className="h-5 w-5 text-green-400" />
            <span className="text-sm font-medium">Správa kategorií</span>
          </a>
          <a
            href="./admin/users"
            className="flex items-center gap-3 rounded-lg border border-border p-4 hover:bg-secondary transition-colors"
          >
            <Users className="h-5 w-5 text-purple-400" />
            <span className="text-sm font-medium">Seznam uživatelů</span>
          </a>
        </div>
      </div>
    </div>
  )
}
