'use client'

import NextLink from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { TrendingUp, FileText, Tag, Users, LayoutDashboard, LogOut } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { createClient } from '@/lib/supabase/client'

interface AdminSidebarProps {
  locale: string
}

export function AdminSidebar({ locale }: AdminSidebarProps) {
  const pathname = usePathname()
  const router = useRouter()

  const links = [
    { href: '/admin', label: 'Přehled', icon: LayoutDashboard, exact: true },
    { href: '/admin/tips', label: 'Tipy', icon: FileText, exact: false },
    { href: '/admin/categories', label: 'Kategorie', icon: Tag, exact: false },
    { href: '/admin/users', label: 'Uživatelé', icon: Users, exact: false },
  ]

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push(`/${locale}`)
    router.refresh()
  }

  return (
    <aside className="w-64 border-r border-border bg-card flex flex-col shrink-0">
      <div className="p-6 border-b border-border">
        <NextLink href={`/${locale}`} className="flex items-center gap-2 font-bold">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg gradient-brand">
            <TrendingUp className="h-4 w-4 text-white" />
          </div>
          <span className="text-sm text-gradient">SázejChytře</span>
        </NextLink>
        <p className="text-xs text-muted-foreground mt-1">Admin Panel</p>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        {links.map((link) => {
          const isActive = link.exact ? pathname === link.href : pathname.startsWith(link.href)
          const Icon = link.icon

          return (
            <NextLink
              key={link.href}
              href={link.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              )}
            >
              <Icon className="h-4 w-4" />
              {link.label}
            </NextLink>
          )
        })}
      </nav>

      <div className="p-4 border-t border-border space-y-2">
        <NextLink
          href={`/${locale}/dashboard`}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <LayoutDashboard className="h-4 w-4" />
          Dashboard
        </NextLink>
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Odhlásit se
        </button>
      </div>
    </aside>
  )
}
