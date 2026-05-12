'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Link } from '@/i18n/navigation'

const plans = ['basic', 'pro', 'elite'] as const

export function CheckoutButtons({ locale }: { locale: string }) {
  const t = useTranslations('plans')
  const router = useRouter()
  const [loading, setLoading] = useState<string | null>(null)

  async function handleCheckout(plan: string) {
    setLoading(plan)
    try {
      const response = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, locale }),
      })

      if (response.status === 401) {
        router.push(`/${locale}/prihlaseni?redirect=/${locale}/pricing`)
        return
      }

      const data = await response.json()
      if (data.url) {
        window.location.href = data.url
      }
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="py-8 text-center">
      <p className="text-sm text-muted-foreground mb-6">
        Pro přístup k prémiové verzi je nutné se{' '}
        <Link href="/register" className="text-primary hover:underline">
          zaregistrovat
        </Link>
      </p>
      <div className="flex flex-col sm:flex-row justify-center gap-3">
        {plans.map((plan) => (
          <Button
            key={plan}
            variant={plan === 'pro' ? 'default' : plan === 'elite' ? 'premium' : 'outline'}
            onClick={() => handleCheckout(plan)}
            loading={loading === plan}
          >
            {t(`${plan}.name`)} – {t('cta')}
          </Button>
        ))}
      </div>
    </div>
  )
}
