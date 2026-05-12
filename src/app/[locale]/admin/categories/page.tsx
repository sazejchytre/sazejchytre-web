import { requireAdmin } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { CategoriesManager } from '@/components/admin/categories-manager'

export const metadata = { title: 'Kategorie | Admin' }

export default async function AdminCategoriesPage() {
  const profile = await requireAdmin()
  const adminClient = createAdminClient()

  const { data: categories } = await adminClient
    .from('categories')
    .select('*, translations:category_translations(*)')
    .order('slug')

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">Správa kategorií</h1>
      <CategoriesManager categories={categories ?? []} actorId={profile.id} />
    </div>
  )
}
