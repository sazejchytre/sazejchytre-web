import NextLink from 'next/link'
import { requireAdmin } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { AdminTipsList } from '@/components/admin/tips-list'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'

export const metadata = { title: 'Tipy | Admin' }

export default async function AdminTipsPage() {
  const profile = await requireAdmin()
  const adminClient = createAdminClient()

  const { data: tips } = await adminClient
    .from('tips')
    .select(`
      *,
      translations:tip_translations(*)
    `)
    .order('created_at', { ascending: false })
    .limit(100)

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Tipy</h1>
          <p className="text-muted-foreground text-sm">Správa sázkových tipů</p>
        </div>
        <NextLink href="new">
          <Button>
            <Plus className="h-4 w-4" />
            Nový tip
          </Button>
        </NextLink>
      </div>
      <AdminTipsList tips={tips ?? []} actorId={profile.id} />
    </div>
  )
}
