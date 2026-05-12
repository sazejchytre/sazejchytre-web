'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { CreditCard, ArrowLeft } from 'lucide-react'
import type { Subscription } from '@/types/database'

interface BillingContentProps {
  subscription: Subscription | null
  locale: string
}

export function BillingContent({ subscription, locale }: BillingContentProps) {
  const t = useTranslations('dashboard')
  const [loading, setLoading] = useState(false)

  async function handlePortal() {
    setLoading(true)
    try {
      const response = await fetch('/api/stripe/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale }),
      })
      const data = await response.json()
      if (data.url) window.location.href = data.url
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container max-w-2xl py-10">
      <Link href="/dashboard" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6">
        <ArrowLeft className="h-4 w-4" />
        {t('title')}
      </Link>

      <h1 className="text-2xl font-bold mb-6">{t('manageBilling')}</h1>

      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <div className="flex items-center gap-3">
          <CreditCard className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">{t('subscription')}</h2>
        </div>

        {subscription ? (
          <div className="space-y-3">
            <div className="flex justify-between items-center py-2 border-b border-border">
              <span className="text-sm text-muted-foreground">{t('plan')}</span>
              <Badge variant={subscription.plan === 'elite' ? 'elite' : subscription.plan === 'pro' ? 'pro' : 'basic'}>
                {subscription.plan?.toUpperCase() ?? 'N/A'}
              </Badge>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border">
              <span className="text-sm text-muted-foreground">Status</span>
              <Badge variant={subscription.status === 'active' ? 'published' : 'draft'}>
                {subscription.status}
              </Badge>
            </div>
            {subscription.current_period_end && (
              <div className="flex justify-between items-center py-2 border-b border-border">
                <span className="text-sm text-muted-foreground">{t('validUntil')}</span>
                <span className="text-sm font-medium">
                  {new Date(subscription.current_period_end).toLocaleDateString()}
                </span>
              </div>
            )}
            <Button onClick={handlePortal} loading={loading} className="w-full mt-4">
              {t('manageBilling')}
            </Button>
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-muted-foreground mb-4">{t('noPlan')}</p>
            <Link href="/pricing">
              <Button>{t('choosePlan')}</Button>
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
