'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

interface PricingSectionProps {
  locale: string
}

const PLAN_PRICES: Record<string, { price: string; period: string }> = {
  free:  { price: 'Zdarma', period: '' },
  start: { price: '749 Kč', period: '/ měsíc' },
  smart: { price: '1 290 Kč', period: '/ měsíc' },
  elite: { price: '1 990 Kč', period: '/ měsíc' },
}

export function PricingSection({ locale }: PricingSectionProps) {
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
      if (data.url) window.location.href = data.url
    } finally {
      setLoading(null)
    }
  }

  const plans = ['free', 'start', 'smart', 'elite'] as const

  return (
    <section className="py-24 bg-card/30">
      <div className="container">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold mb-4">{t('title')}</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">{t('subtitle')}</p>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4 max-w-6xl mx-auto">
          {plans.map((plan) => {
            const isSmart = plan === 'smart'
            const features = t.raw(`${plan}.features`) as string[]
            const { price, period } = PLAN_PRICES[plan]

            return (
              <div
                key={plan}
                className={cn(
                  'relative rounded-2xl border p-6 flex flex-col',
                  isSmart
                    ? 'border-primary bg-gradient-to-b from-primary/10 to-transparent shadow-xl shadow-primary/10 lg:scale-105'
                    : 'border-border bg-card'
                )}
              >
                {isSmart && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                    <Badge className="bg-primary text-primary-foreground px-4 py-1">
                      {t('popular')}
                    </Badge>
                  </div>
                )}

                <div className="mb-5">
                  <div
                    className={cn(
                      'inline-flex items-center rounded-lg px-3 py-1 text-xs font-bold mb-3',
                      plan === 'free'  && 'bg-muted text-muted-foreground',
                      plan === 'start' && 'bg-brand-600/20 text-brand-300',
                      plan === 'smart' && 'bg-purple-600/20 text-purple-300',
                      plan === 'elite' && 'bg-gold-600/20 text-gold-400'
                    )}
                  >
                    {t(`${plan}.name`)}
                  </div>
                  <div className="text-3xl font-bold mb-0.5">{price}</div>
                  {period && <div className="text-sm text-muted-foreground">{period}</div>}
                  <p className="text-sm text-muted-foreground mt-3">{t(`${plan}.description`)}</p>
                </div>

                <ul className="flex-1 space-y-2.5 mb-6">
                  {features.map((feature: string) => (
                    <li key={feature} className="flex items-start gap-2.5 text-sm">
                      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 mt-0.5">
                        <Check className="h-3 w-3 text-primary" />
                      </div>
                      <span className="text-muted-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>

                {plan === 'free' ? (
                  <Link href="/register">
                    <Button className="w-full" variant="outline" size="lg">
                      {t('ctaFree')}
                    </Button>
                  </Link>
                ) : (
                  <Button
                    className="w-full"
                    variant={isSmart ? 'default' : plan === 'elite' ? 'premium' : 'outline'}
                    size="lg"
                    loading={loading === plan}
                    onClick={() => handleCheckout(plan)}
                  >
                    {t('cta')}
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
