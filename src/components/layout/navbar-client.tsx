'use client'

import { useState } from 'react'
import { Menu, X, TrendingUp, ChevronDown } from 'lucide-react'
import { Link, usePathname } from '@/i18n/navigation'
import NextLink from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils/cn'

interface NavTranslations {
  home: string
  pricing: string
  howItWorks: string
  about: string
  contact: string
  login: string
  register: string
  dashboard: string
  admin: string
  logout: string
}

interface NavbarClientProps {
  locale: string
  user: { id: string; email: string } | null
  profile: { role: string; full_name: string | null } | null
  translations: NavTranslations
}

const LOCALES = [
  { code: 'cs', label: 'CS' },
  { code: 'en', label: 'EN' },
  { code: 'sk', label: 'SK' },
]

export function NavbarClient({ locale, user, profile, translations: t }: NavbarClientProps) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [langOpen, setLangOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin'

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push(`/${locale}`)
    router.refresh()
  }

  const navLinks = [
    { href: '/pricing' as const, label: t.pricing },
    { href: '/how-it-works' as const, label: t.howItWorks },
    { href: '/about' as const, label: t.about },
    { href: '/contact' as const, label: t.contact },
  ]

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-xl">
      <div className="container flex h-16 items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 font-bold text-lg">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-brand">
            <TrendingUp className="h-5 w-5 text-white" />
          </div>
          <span className="text-gradient">SázejChytře</span>
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden items-center gap-1 md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                'px-3 py-2 text-sm rounded-lg transition-colors',
                pathname === link.href
                  ? 'text-foreground bg-secondary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Desktop Actions */}
        <div className="hidden items-center gap-2 md:flex">
          {/* Language Switcher */}
          <div className="relative">
            <button
              onClick={() => setLangOpen(!langOpen)}
              className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              {locale.toUpperCase()}
              <ChevronDown className="h-3 w-3" />
            </button>
            {langOpen && (
              <div className="absolute right-0 top-full mt-1 rounded-lg border border-border bg-card shadow-xl z-50">
                {LOCALES.map((l) => (
                  <Link
                    key={l.code}
                    href={pathname}
                    locale={l.code as 'cs' | 'en' | 'sk'}
                    onClick={() => setLangOpen(false)}
                    className={cn(
                      'block px-4 py-2 text-xs hover:bg-secondary transition-colors first:rounded-t-lg last:rounded-b-lg',
                      l.code === locale ? 'text-primary font-semibold' : 'text-muted-foreground'
                    )}
                  >
                    {l.label}
                  </Link>
                ))}
              </div>
            )}
          </div>

          {user ? (
            <>
              {isAdmin && (
                <NextLink href="/admin">
                  <Button variant="outline" size="sm">
                    {t.admin}
                  </Button>
                </NextLink>
              )}
              <Link href="/dashboard">
                <Button variant="secondary" size="sm">
                  {t.dashboard}
                </Button>
              </Link>
              <Button variant="ghost" size="sm" onClick={handleLogout}>
                {t.logout}
              </Button>
            </>
          ) : (
            <>
              <Link href="/login">
                <Button variant="ghost" size="sm">
                  {t.login}
                </Button>
              </Link>
              <Link href="/register">
                <Button size="sm">{t.register}</Button>
              </Link>
            </>
          )}
        </div>

        {/* Mobile Toggle */}
        <button
          className="md:hidden"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {/* Mobile Menu */}
      {mobileOpen && (
        <div className="border-t border-border bg-background md:hidden">
          <div className="container py-4 flex flex-col gap-2">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="px-3 py-2 text-sm rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary"
              >
                {link.label}
              </Link>
            ))}
            <div className="my-2 h-px bg-border" />
            <div className="flex gap-2">
              {LOCALES.map((l) => (
                <Link
                  key={l.code}
                  href={pathname}
                  locale={l.code as 'cs' | 'en' | 'sk'}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    'px-3 py-1.5 text-xs rounded-lg transition-colors',
                    l.code === locale
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-muted-foreground'
                  )}
                >
                  {l.label}
                </Link>
              ))}
            </div>
            {user ? (
              <>
                {isAdmin && (
                  <NextLink href="/admin" onClick={() => setMobileOpen(false)}>
                    <Button variant="outline" size="sm" className="w-full">
                      {t.admin}
                    </Button>
                  </NextLink>
                )}
                <Link href="/dashboard" onClick={() => setMobileOpen(false)}>
                  <Button variant="secondary" size="sm" className="w-full">
                    {t.dashboard}
                  </Button>
                </Link>
                <Button variant="ghost" size="sm" className="w-full" onClick={handleLogout}>
                  {t.logout}
                </Button>
              </>
            ) : (
              <div className="flex gap-2">
                <Link href="/login" className="flex-1" onClick={() => setMobileOpen(false)}>
                  <Button variant="outline" size="sm" className="w-full">
                    {t.login}
                  </Button>
                </Link>
                <Link href="/register" className="flex-1" onClick={() => setMobileOpen(false)}>
                  <Button size="sm" className="w-full">
                    {t.register}
                  </Button>
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  )
}
