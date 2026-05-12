import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { NavbarClient } from './navbar-client'

export async function Navbar({ locale }: { locale: string }) {
  const t = await getTranslations('nav')
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  let profile = null
  if (user) {
    const { data } = await supabase.from('profiles').select('role, full_name').eq('id', user.id).single()
    profile = data
  }

  return (
    <NavbarClient
      locale={locale}
      user={user ? { id: user.id, email: user.email ?? '' } : null}
      profile={profile}
      translations={{
        home: t('home'),
        pricing: t('pricing'),
        howItWorks: t('howItWorks'),
        about: t('about'),
        contact: t('contact'),
        login: t('login'),
        register: t('register'),
        dashboard: t('dashboard'),
        admin: t('admin'),
        logout: t('logout'),
      }}
    />
  )
}
