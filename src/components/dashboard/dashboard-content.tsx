'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { TipCard } from '@/components/dashboard/tip-card'
import {
  CreditCard,
  Calendar,
  TrendingUp,
  Lock,
  CheckCircle,
  XCircle,
  Clock,
  ArrowRight,
  Gift,
} from 'lucide-react'
import type { Profile, Subscription, UserEntitlement, Tip, TipTranslation } from '@/types/database'
import { canAccessPlan } from '@/types'
import { vocative } from '@/lib/utils/vocative'

interface DashboardContentProps {
  profile: Profile
  subscription: Subscription | null
  entitlement: UserEntitlement | null
  tips: Array<Tip & { translations: TipTranslation[] }>
  freeTip: (Tip & { translations: TipTranslation[] }) | null
  locale: string
}

export function DashboardContent({
  profile,
  subscription,
  entitlement,
  tips,
  freeTip,
  locale,
}: DashboardContentProps) {
  const t = useTranslations('dashboard')
  const [billingLoading, setBillingLoading] = useState(false)

  const activePlan = entitlement?.active ? entitlement.plan : null
  const isAdmin = profile.role === 'admin' || profile.role === 'super_admin'

  const allTips = freeTip ? [freeTip, ...tips] : tips
  const won = allTips.filter((tip) => tip.result === 'won').length
  const lost = allTips.filter((tip) => tip.result === 'lost').length
  const pending = allTips.filter((tip) => tip.result === 'pending').length
  const voidCount = allTips.filter((tip) => tip.result === 'void').length

  async function handleBillingPortal() {
    setBillingLoading(true)
    try {
      const response = await fetch('/api/stripe/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale }),
      })
      const data = await response.json()
      if (data.url) window.location.href = data.url
    } finally {
      setBillingLoading(false)
    }
  }

  const planBadgeVariant =
    isAdmin ? 'elite' :
    activePlan === 'elite' ? 'elite' :
    activePlan === 'smart' ? 'pro' : 'basic'

  return (
    <div className="container py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">
          {t('welcome')},{' '}
          {profile.full_name
            ? vocative(profile.full_name.split(' ')[0], locale)
            : profile.email.split('@')[0]}
        </h1>
        <p className="text-muted-foreground mt-1">{t('title')}</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left Column */}
        <div className="lg:col-span-1 space-y-6">
          {/* Subscription Card */}
          <div className="rounded-xl border border-border bg-card p-6">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-primary" />
              {t('subscription')}
            </h2>

            {activePlan || isAdmin ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{t('plan')}</span>
                  <Badge variant={planBadgeVariant}>
                    {isAdmin ? 'ADMIN' : activePlan?.toUpperCase()}
                  </Badge>
                </div>
                {subscription?.current_period_end && !isAdmin && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">{t('validUntil')}</span>
                    <span className="text-sm font-medium flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {new Date(subscription.current_period_end).toLocaleDateString(
                        locale === 'en' ? 'en-US' : `${locale}-CZ`
                      )}
                    </span>
                  </div>
                )}
                {subscription?.cancel_at_period_end && (
                  <div className="text-xs text-yellow-400 bg-yellow-900/20 rounded-lg px-3 py-2">
                    Předplatné se neobnoví po skončení aktuálního období.
                  </div>
                )}
                {!isAdmin && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full mt-2"
                    onClick={handleBillingPortal}
                    loading={billingLoading}
                  >
                    {t('manageBilling')}
                  </Button>
                )}
              </div>
            ) : freeTip ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <Gift className="h-4 w-4 text-primary" />
                  <span className="font-medium">{t('freeTip')}</span>
                </div>
                <p className="text-xs text-muted-foreground">{t('freeTipDesc')}</p>
                <Link href="/pricing">
                  <Button size="sm" className="w-full mt-1">
                    {t('choosePlan')}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              </div>
            ) : profile.free_tip_used ? (
              <div className="text-center py-4">
                <Lock className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm font-medium mb-1">{t('freeTipUsed')}</p>
                <p className="text-xs text-muted-foreground mb-4">{t('freeTipUsedDesc')}</p>
                <Link href="/pricing">
                  <Button size="sm" className="w-full">
                    {t('choosePlan')}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="text-center py-4">
                <Lock className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm font-medium mb-1">{t('noPlan')}</p>
                <p className="text-xs text-muted-foreground mb-4">{t('noPlanDesc')}</p>
                <Link href="/pricing">
                  <Button size="sm" className="w-full">
                    {t('choosePlan')}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              </div>
            )}
          </div>

          {/* Results Overview */}
          <div className="rounded-xl border border-border bg-card p-6">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              {t('results')}
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-green-900/20 border border-green-700/30 p-3 text-center">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                </div>
                <div className="text-2xl font-bold text-green-400">{won}</div>
                <div className="text-xs text-muted-foreground">{t('won')}</div>
              </div>
              <div className="rounded-lg bg-red-900/20 border border-red-700/30 p-3 text-center">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <XCircle className="h-4 w-4 text-red-500" />
                </div>
                <div className="text-2xl font-bold text-red-400">{lost}</div>
                <div className="text-xs text-muted-foreground">{t('lost')}</div>
              </div>
              <div className="rounded-lg bg-yellow-900/20 border border-yellow-700/30 p-3 text-center">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <Clock className="h-4 w-4 text-yellow-500" />
                </div>
                <div className="text-2xl font-bold text-yellow-400">{pending}</div>
                <div className="text-xs text-muted-foreground">{t('pending')}</div>
              </div>
              <div className="rounded-lg bg-gray-800/50 border border-gray-700/30 p-3 text-center">
                <div className="text-2xl font-bold text-gray-400">{voidCount}</div>
                <div className="text-xs text-muted-foreground">{t('void')}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column - Tips */}
        <div className="lg:col-span-2">
          <h2 className="font-semibold text-lg mb-4">{t('latestTips')}</h2>

          {freeTip && (
            <div className="mb-4 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary flex items-center gap-2">
              <Gift className="h-4 w-4 shrink-0" />
              {t('freeTipBanner')}
            </div>
          )}

          {allTips.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-12 text-center text-muted-foreground">
              {profile.free_tip_used && !activePlan && !isAdmin
                ? t('freeTipUsedDesc')
                : t('noTips')}
            </div>
          ) : (
            <div className="space-y-4">
              {allTips.map((tip) => {
                const hasAccess = isAdmin || canAccessPlan(activePlan, tip.required_plan) || tip.id === freeTip?.id
                const translation =
                  tip.translations.find((tr) => tr.locale === locale) ??
                  tip.translations.find((tr) => tr.locale === 'cs') ??
                  tip.translations[0]

                return (
                  <TipCard
                    key={tip.id}
                    tip={tip}
                    translation={translation ?? null}
                    hasAccess={hasAccess}
                    locale={locale}
                  />
                )
              })}
            </div>
          )}

          {profile.free_tip_used && !activePlan && !isAdmin && allTips.length > 0 && (
            <div className="mt-6 rounded-xl border border-border bg-card p-6 text-center">
              <Lock className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
              <p className="font-medium mb-1">{t('freeTipUsed')}</p>
              <p className="text-sm text-muted-foreground mb-4">{t('freeTipUsedDesc')}</p>
              <Link href="/pricing">
                <Button>
                  {t('choosePlan')}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
