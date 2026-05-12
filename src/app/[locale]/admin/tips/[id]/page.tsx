import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { TipForm } from '@/components/admin/tip-form'

export const metadata = { title: 'Upravit tip | Admin' }

export default async function EditTipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const profile = await requireAdmin()
  const adminClient = createAdminClient()

  const [tipResult, categoriesResult] = await Promise.all([
    adminClient
      .from('tips')
      .select('*, translations:tip_translations(*)')
      .eq('id', id)
      .single(),
    adminClient
      .from('categories')
      .select('*, translations:category_translations(*)')
      .order('slug'),
  ])

  const tip = tipResult.data
  if (!tip) notFound()

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-2xl font-bold mb-6">Upravit tip</h1>
      <TipForm tip={tip} categories={categoriesResult.data ?? []} actorId={profile.id} />
    </div>
  )
}
