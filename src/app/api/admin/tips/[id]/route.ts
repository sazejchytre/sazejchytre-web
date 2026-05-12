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

const updateSchema = z.object({
  sport: z.string().min(1).max(100).optional(),
  category_id: z.string().uuid().nullable().optional(),
  required_plan: z.enum(['basic', 'pro', 'elite']).optional(),
  odds: z.number().min(1).max(1000).nullable().optional(),
  confidence: z.number().int().min(1).max(5).nullable().optional(),
  match_date: z.string().datetime().nullable().optional(),
  status: z.enum(['draft', 'published', 'won', 'lost', 'void']).optional(),
  result: z.enum(['pending', 'won', 'lost', 'void', 'half_won', 'half_lost']).optional(),
  translations: z
    .record(
      z.enum(['cs', 'en', 'sk']),
      z.object({
        title: z.string().max(500),
        summary: z.string().max(2000).optional(),
        analysis: z.string().max(10000).optional(),
        prediction: z.string().max(500),
      })
    )
    .optional(),
})

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let profile: Awaited<ReturnType<typeof requireAdmin>>
  try {
    profile = await requireAdmin()
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }

  const { translations, ...tipData } = parsed.data
  const db = getRawAdminClient()

  // Add published_at when first publishing
  const updatePayload: Record<string, unknown> = { ...tipData }
  if (tipData.status === 'published') {
    const { data: existing } = await db.from('tips').select('published_at').eq('id', id).single()
    const existingTip = existing as { published_at: string | null } | null
    if (!existingTip?.published_at) {
      updatePayload.published_at = new Date().toISOString()
    }
  }

  const { data: tip, error: tipError } = await db
    .from('tips')
    .update(updatePayload)
    .eq('id', id)
    .select()
    .single()

  if (tipError || !tip) {
    return NextResponse.json({ error: 'Failed to update tip' }, { status: 500 })
  }

  if (translations) {
    for (const [locale, t] of Object.entries(translations)) {
      if (!t.title) continue
      await db.from('tip_translations').upsert({
        tip_id: id,
        locale: locale as 'cs' | 'en' | 'sk',
        title: t.title,
        summary: t.summary ?? null,
        analysis: t.analysis ?? null,
        prediction: t.prediction,
      })
    }
  }

  await writeAuditLog({
    actor_id: profile.id,
    action: 'tip.update',
    entity_type: 'tip',
    entity_id: id,
    metadata: { changes: Object.keys(tipData) },
  })

  return NextResponse.json({ data: tip })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let profile: Awaited<ReturnType<typeof requireAdmin>>
  try {
    profile = await requireAdmin()
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const patchSchema = z.object({
    status: z.enum(['draft', 'published', 'won', 'lost', 'void']).optional(),
    result: z.enum(['pending', 'won', 'lost', 'void', 'half_won', 'half_lost']).optional(),
  })

  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed' }, { status: 400 })
  }

  const db = getRawAdminClient()
  const updatePayload: Record<string, unknown> = { ...parsed.data }

  if (parsed.data.status === 'published') {
    const { data: existing } = await db.from('tips').select('published_at').eq('id', id).single()
    const existingTip = existing as { published_at: string | null } | null
    if (!existingTip?.published_at) {
      updatePayload.published_at = new Date().toISOString()
    }
  }

  const { data: tip, error } = await db
    .from('tips')
    .update(updatePayload)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: 'Failed to update tip' }, { status: 500 })
  }

  await writeAuditLog({
    actor_id: profile.id,
    action: 'tip.patch',
    entity_type: 'tip',
    entity_id: id,
    metadata: parsed.data,
  })

  return NextResponse.json({ data: tip })
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let profile: Awaited<ReturnType<typeof requireAdmin>>
  try {
    profile = await requireAdmin()
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const db = getRawAdminClient()
  const { error } = await db.from('tips').delete().eq('id', id)

  if (error) {
    return NextResponse.json({ error: 'Failed to delete tip' }, { status: 500 })
  }

  await writeAuditLog({
    actor_id: profile.id,
    action: 'tip.delete',
    entity_type: 'tip',
    entity_id: id,
  })

  return NextResponse.json({ success: true })
}
