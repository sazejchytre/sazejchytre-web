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

const grantSchema = z.object({
  plan: z.enum(['start', 'smart', 'elite']),
  valid_until: z.string().datetime().optional(),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: targetUserId } = await params
  let profile: Awaited<ReturnType<typeof requireAdmin>>
  try { profile = await requireAdmin() } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = grantSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed' }, { status: 400 })

  const { plan, valid_until } = parsed.data
  const db = getRawAdminClient()

  const validUntil = valid_until ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

  const { error } = await db.from('user_entitlements').upsert({
    user_id: targetUserId,
    plan,
    active: true,
    source: 'manual',
    valid_until: validUntil,
  }, { onConflict: 'user_id' })

  if (error) return NextResponse.json({ error: 'Failed to grant access' }, { status: 500 })

  await writeAuditLog({
    actor_id: profile.id,
    action: 'user.grant_entitlement',
    entity_type: 'user',
    entity_id: targetUserId,
    metadata: { plan, valid_until: validUntil },
  })

  return NextResponse.json({ success: true })
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: targetUserId } = await params
  let profile: Awaited<ReturnType<typeof requireAdmin>>
  try { profile = await requireAdmin() } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const db = getRawAdminClient()
  const { error } = await db
    .from('user_entitlements')
    .update({ active: false })
    .eq('user_id', targetUserId)

  if (error) return NextResponse.json({ error: 'Failed to revoke access' }, { status: 500 })

  await writeAuditLog({
    actor_id: profile.id,
    action: 'user.revoke_entitlement',
    entity_type: 'user',
    entity_id: targetUserId,
  })

  return NextResponse.json({ success: true })
}
