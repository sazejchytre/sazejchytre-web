import type { Metadata } from 'next'
import { requireAdmin } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { FileText, Users, TrendingUp, CheckCircle, UserPlus, Activity } from 'lucide-react'

export const metadata: Metadata = { title: 'Admin Panel' }

export default async function AdminPage() {
  await requireAdmin()

  const adminClient = createAdminClient()

  const [tipsResult, publishedTipsResult, usersResult, activeSubsResult, recentUsersResult, recentAuditResult] =
    await Promise.all([
      adminClient.from('tips').select('id', { count: 'exact', head: true }),
      adminClient
        .from('tips')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'published'),
      adminClient.from('profiles').select('id', { count: 'exact', head: true }),
      adminClient
        .from('subscriptions')
        .select('id', { count: 'exact', head: true })
        .in('status', ['active', 'trialing']),
      adminClient
        .from('profiles')
        .select('email, created_at')
        .order('created_at', { ascending: false })
        .limit(5),
      adminClient
        .from('audit_logs')
        .select('action, created_at')
        .order('created_at', { ascending: false })
        .limit(5),
    ])

  const stats = [
    {
      label: 'Celkem tipů',
      value: tipsResult.count ?? 0,
      icon: FileText,
      color: 'text-primary',
      bg: 'bg-primary/10',
    },
    {
      label: 'Publikovaných tipů',
      value: publishedTipsResult.count ?? 0,
      icon: CheckCircle,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
    },
    {
      label: 'Registrovaných uživatelů',
      value: usersResult.count ?? 0,
      icon: Users,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      label: 'Aktivních předplatných',
      value: activeSubsResult.count ?? 0,
      icon: TrendingUp,
      color: 'text-purple-600',
      bg: 'bg-purple-50',
    },
  ]

  const recentUsers = (recentUsersResult.data ?? []) as Array<{ email: string; created_at: string }>
  const recentAudit = (recentAuditResult.data ?? []) as Array<{ action: string; created_at: string }>

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-2">Admin Panel</h1>
      <p className="text-muted-foreground mb-8">Přehled platformy SázejChytře</p>

      {/* Stats grid */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <div key={stat.label} className="rounded-xl bg-white card-shadow p-6">
              <div className="flex items-center gap-3 mb-3">
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${stat.bg}`}>
                  <Icon className={`h-5 w-5 ${stat.color}`} />
                </div>
                <span className="text-sm text-muted-foreground">{stat.label}</span>
              </div>
              <div className="text-3xl font-bold">{stat.value}</div>
            </div>
          )
        })}
      </div>

      {/* Recent registrations + audit */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 mb-8">
        {/* Poslední registrace */}
        <div className="rounded-xl bg-white card-shadow p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <UserPlus className="h-4 w-4 text-primary" />
            </div>
            <h2 className="font-semibold">Poslední registrace</h2>
          </div>
          {recentUsers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Žádní uživatelé.</p>
          ) : (
            <ul className="space-y-2">
              {recentUsers.map((u) => (
                <li key={u.email + u.created_at} className="flex items-center justify-between text-sm">
                  <span className="font-medium truncate max-w-[200px]">{u.email}</span>
                  <span className="text-muted-foreground text-xs ml-2 shrink-0">
                    {new Date(u.created_at).toLocaleDateString('cs-CZ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Poslední akce */}
        <div className="rounded-xl bg-white card-shadow p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <Activity className="h-4 w-4 text-primary" />
            </div>
            <h2 className="font-semibold">Poslední akce</h2>
          </div>
          {recentAudit.length === 0 ? (
            <p className="text-sm text-muted-foreground">Žádné záznamy.</p>
          ) : (
            <ul className="space-y-2">
              {recentAudit.map((log, i) => (
                <li key={i} className="flex items-center justify-between text-sm">
                  <span className="font-medium font-mono text-xs bg-secondary/50 rounded px-2 py-0.5">
                    {log.action}
                  </span>
                  <span className="text-muted-foreground text-xs ml-2 shrink-0">
                    {new Date(log.created_at).toLocaleString('cs-CZ', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Quick actions */}
      <div className="rounded-xl bg-white card-shadow p-6">
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
            <FileText className="h-5 w-5 text-emerald-600" />
            <span className="text-sm font-medium">Správa kategorií</span>
          </a>
          <a
            href="./admin/users"
            className="flex items-center gap-3 rounded-lg border border-border p-4 hover:bg-secondary transition-colors"
          >
            <Users className="h-5 w-5 text-blue-600" />
            <span className="text-sm font-medium">Seznam uživatelů</span>
          </a>
        </div>
      </div>
    </div>
  )
}
