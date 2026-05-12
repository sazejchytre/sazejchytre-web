import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { getProfile } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { DashboardContent } from '@/components/dashboard/dashboard-content'
import type { Tip, TipTranslation } from '@/types/database'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'dashboard' })
  return { title: t('title') }
}

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const profile = await getProfile()

  if (!profile) return null

  const supabase = await createClient()

  // Get subscription data
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', profile.id)
    .single()

  // Get user entitlement
  const { data: entitlement } = await supabase
    .from('user_entitlements')
    .select('*')
    .eq('user_id', profile.id)
    .single()

  // Get latest published tips (server-side paywall via RLS)
  const { data: tips } = await supabase
    .from('tips')
    .select(`
      *,
      translations:tip_translations(*)
    `)
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(20)

  return (
    <DashboardContent
      profile={profile}
      subscription={subscription}
      entitlement={entitlement}
      tips={(tips ?? []) as Array<Tip & { translations: TipTranslation[] }>}
      locale={locale}
    />
  )
}
