import { redirect } from 'next/navigation'
import { requireAdmin } from '@/lib/auth/session'
import { AdminSidebar } from '@/components/admin/admin-sidebar'

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  try {
    await requireAdmin()
  } catch {
    redirect(`/${locale}/dashboard`)
  }

  return (
    <div className="flex min-h-screen">
      <AdminSidebar locale={locale} />
      <main className="flex-1 overflow-auto bg-background">{children}</main>
    </div>
  )
}
