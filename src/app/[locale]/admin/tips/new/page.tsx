import { requireAdmin } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { TipForm } from '@/components/admin/tip-form'

export const metadata = { title: 'Nový tip | Admin' }

export default async function NewTipPage() {
  const profile = await requireAdmin()
  const adminClient = createAdminClient()

  const { data: categories } = await adminClient
    .from('categories')
    .select('*, translations:category_translations(*)')
    .order('slug')

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-2xl font-bold mb-6">Nový tip</h1>
      <TipForm tip={null} categories={categories ?? []} actorId={profile.id} />
    </div>
  )
}
