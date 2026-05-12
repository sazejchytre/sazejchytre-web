import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth/session'
import { createClient } from '@supabase/supabase-js'
import { writeAuditLog } from '@/lib/utils/audit'

function getRawAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

const createSchema = z.object({
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  nameCs: z.string().min(1).max(200),
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

  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed' }, { status: 400 })
  }

  const db = getRawAdminClient()

  const { data: category, error } = await db
    .from('categories')
    .insert({ slug: parsed.data.slug })
    .select()
    .single()

  if (error || !category) {
    return NextResponse.json({ error: 'Failed to create category' }, { status: 500 })
  }

  await db.from('category_translations').insert({
    category_id: (category as { id: string }).id,
    locale: 'cs',
    name: parsed.data.nameCs,
  })

  await writeAuditLog({
    actor_id: profile.id,
    action: 'category.create',
    entity_type: 'category',
    entity_id: (category as { id: string }).id,
    metadata: { slug: parsed.data.slug },
  })

  const { data: full } = await db
    .from('categories')
    .select('*, translations:category_translations(*)')
    .eq('id', (category as { id: string }).id)
    .single()

  return NextResponse.json({ data: full }, { status: 201 })
}
