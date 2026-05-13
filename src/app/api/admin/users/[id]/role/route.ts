import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/auth/session'
import { writeAuditLog } from '@/lib/utils/audit'

function getRawAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

const schema = z.object({ role: z.enum(['user', 'admin']) })

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: targetUserId } = await params
  let profile: Awaited<ReturnType<typeof requireAdmin>>
  try { profile = await requireAdmin() } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Prevent self-demotion
  if (targetUserId === profile.id) {
    return NextResponse.json({ error: 'Cannot change your own role' }, { status: 400 })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid role' }, { status: 400 })

  const db = getRawAdminClient()
  const { error } = await db
    .from('profiles')
    .update({ role: parsed.data.role })
    .eq('id', targetUserId)

  if (error) return NextResponse.json({ error: 'Failed to update role' }, { status: 500 })

  await writeAuditLog({
    actor_id: profile.id,
    action: 'user.change_role',
    entity_type: 'user',
    entity_id: targetUserId,
    metadata: { new_role: parsed.data.role },
  })

  return NextResponse.json({ success: true })
}
