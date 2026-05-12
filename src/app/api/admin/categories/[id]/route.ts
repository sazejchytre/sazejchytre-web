import { type NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeAuditLog } from '@/lib/utils/audit'

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let profile: Awaited<ReturnType<typeof requireAdmin>>
  try {
    profile = await requireAdmin()
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const adminClient = createAdminClient()
  const { error } = await adminClient.from('categories').delete().eq('id', id)

  if (error) {
    return NextResponse.json({ error: 'Failed to delete category' }, { status: 500 })
  }

  await writeAuditLog({
    actor_id: profile.id,
    action: 'category.delete',
    entity_type: 'category',
    entity_id: id,
  })

  return NextResponse.json({ success: true })
}
