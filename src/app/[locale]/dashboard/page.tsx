import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getProfile } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { DashboardContent } from '@/components/dashboard/dashboard-content'
import type { Subscription, UserEntitlement, Tip, TipTranslation } from '@/types/database'

function getRawAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

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

  const { data: subscriptionRaw } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', profile.id)
    .single()
  const subscription = (subscriptionRaw ?? null) as Subscription | null

  const { data: entitlementRaw } = await supabase
    .from('user_entitlements')
    .select('*')
    .eq('user_id', profile.id)
    .single()
  const entitlement = (entitlementRaw ?? null) as UserEntitlement | null

  const isAdmin = profile.role === 'admin' || profile.role === 'super_admin'
  const hasActivePlan = entitlement?.active === true

  // For users with a paid plan (or admin), fetch tips via normal RLS-filtered client
  let tips: Array<Tip & { translations: TipTranslation[] }> = []
  let freeTip: (Tip & { translations: TipTranslation[] }) | null = null

  if (isAdmin || hasActivePlan) {
    const { data } = await supabase
      .from('tips')
      .select('*, translations:tip_translations(*)')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(20)
    tips = (data ?? []) as Array<Tip & { translations: TipTranslation[] }>
  } else if (!profile.free_tip_used) {
    // New user: serve exactly 1 free tip using admin client (bypasses RLS)
    const adminDb = getRawAdminClient()
    const { data } = await adminDb
      .from('tips')
      .select('*, translations:tip_translations(*)')
      .eq('status', 'published')
      .eq('required_plan', 'start')
      .order('published_at', { ascending: false })
      .limit(1)
      .single()

    if (data) {
      freeTip = data as Tip & { translations: TipTranslation[] }
      // Mark as used so the user never gets another free tip
      await adminDb
        .from('profiles')
        .update({ free_tip_used: true })
        .eq('id', profile.id)
    }
  }

  return (
    <DashboardContent
      profile={profile}
      subscription={subscription}
      entitlement={entitlement}
      tips={tips}
      freeTip={freeTip}
      locale={locale}
    />
  )
}
