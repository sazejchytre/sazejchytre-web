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

const tipSchema = z.object({
  sport: z.string().min(1).max(100),
  category_id: z.string().uuid().nullable().optional(),
  required_plan: z.enum(['start', 'smart', 'elite']),
  odds: z.number().min(1).max(1000).nullable().optional(),
  confidence: z.number().int().min(1).max(5).nullable().optional(),
  match_date: z.string().datetime().nullable().optional(),
  status: z.enum(['draft', 'published', 'won', 'lost', 'void']).default('draft'),
  result: z.enum(['pending', 'won', 'lost', 'void', 'half_won', 'half_lost']).default('pending'),
  translations: z.record(
    z.enum(['cs', 'en', 'sk']),
    z.object({
      title: z.string().max(500),
      summary: z.string().max(2000).optional(),
      analysis: z.string().max(10000).optional(),
      prediction: z.string().max(500),
    })
  ),
})

export async function POST(request: NextRequest) {
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

  const parsed = tipSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }

  const { translations, ...tipData } = parsed.data
  const db = getRawAdminClient()

  const { data: tip, error: tipError } = await db
    .from('tips')
    .insert({
      ...tipData,
      created_by: profile.id,
      published_at: tipData.status === 'published' ? new Date().toISOString() : null,
    })
    .select()
    .single()

  if (tipError || !tip) {
    console.error('Tip insert error:', tipError)
    return NextResponse.json({ error: 'Failed to create tip' }, { status: 500 })
  }

  const createdTip = tip as { id: string }

  const translationInserts = Object.entries(translations)
    .filter(([, t]) => t.title)
    .map(([locale, t]) => ({
      tip_id: createdTip.id,
      locale,
      title: t.title,
      summary: t.summary ?? null,
      analysis: t.analysis ?? null,
      prediction: t.prediction,
    }))

  if (translationInserts.length > 0) {
    await db.from('tip_translations').insert(translationInserts)
  }

  await writeAuditLog({
    actor_id: profile.id,
    action: 'tip.create',
    entity_type: 'tip',
    entity_id: createdTip.id,
    metadata: { sport: tipData.sport, plan: tipData.required_plan, status: tipData.status },
  })

  return NextResponse.json({ data: tip }, { status: 201 })
}
