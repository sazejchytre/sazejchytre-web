import { createClient } from '@supabase/supabase-js'
import { headers } from 'next/headers'

interface AuditLogEntry {
  actor_id: string | null
  action: string
  entity_type: string
  entity_id?: string | null
  metadata?: Record<string, unknown>
}

export async function writeAuditLog(entry: AuditLogEntry) {
  try {
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    const headerStore = await headers()
    const ip = headerStore.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
    const userAgent = headerStore.get('user-agent') ?? null

    await adminClient.from('audit_logs').insert({
      actor_id: entry.actor_id,
      action: entry.action,
      entity_type: entry.entity_type,
      entity_id: entry.entity_id ?? null,
      metadata: entry.metadata ?? null,
      ip_address: ip,
      user_agent: userAgent,
    })
  } catch (err) {
    console.error('Failed to write audit log:', err)
  }
}
