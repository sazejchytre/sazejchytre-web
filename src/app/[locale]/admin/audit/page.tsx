import type { Metadata } from 'next'
import { requireAdmin } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import type { AuditLog } from '@/types/database'

export const metadata: Metadata = { title: 'Audit Log | Admin' }

export default async function AdminAuditPage() {
  await requireAdmin()
  const adminClient = createAdminClient()

  const { data } = await adminClient
    .from('audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)

  const logs = (data ?? []) as AuditLog[]

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Audit Log</h1>
        <p className="text-muted-foreground text-sm">Posledních 200 akcí</p>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Čas</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Aktér</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Akce</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Entita</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">ID entity</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Metadata</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    Žádné záznamy
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const metaStr = log.metadata
                    ? JSON.stringify(log.metadata).slice(0, 100)
                    : '—'
                  return (
                    <tr key={log.id} className="border-b border-border/50 hover:bg-secondary/20">
                      <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">
                        {new Date(log.created_at).toLocaleString('cs-CZ')}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {log.actor_id ? log.actor_id.slice(0, 8) : '—'}
                      </td>
                      <td className="px-4 py-3 font-medium">{log.action}</td>
                      <td className="px-4 py-3 text-muted-foreground">{log.entity_type}</td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {log.entity_id ? log.entity_id.slice(0, 8) : '—'}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs font-mono truncate max-w-xs">
                        {metaStr}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
