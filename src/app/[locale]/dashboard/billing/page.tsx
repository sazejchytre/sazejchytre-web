import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { getProfile } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { BillingContent } from '@/components/dashboard/billing-content'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'dashboard' })
  return { title: t('manageBilling') }
}

export default async function BillingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const profile = await getProfile()
  if (!profile) return null

  const supabase = await createClient()
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', profile.id)
    .single()

  return <BillingContent subscription={subscription} locale={locale} />
}
