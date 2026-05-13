'use client'

import { useState, useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { Check, Zap, Star } from 'lucide-react'
import { gsap, prefersReducedMotion } from '@/lib/gsap'
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

const PLAN_BADGE: Record<string, { bg: string; text: string }> = {
  free:  { bg: 'bg-secondary', text: 'text-muted-foreground' },
  start: { bg: 'bg-primary/10', text: 'text-primary' },
  smart: { bg: 'gradient-brand text-white', text: '' },
  elite: { bg: 'bg-yellow-400/15', text: 'text-yellow-600' },
}

export function PricingSection({ locale }: PricingSectionProps) {
  const t = useTranslations('plans')
  const router = useRouter()
  const [loading, setLoading] = useState<string | null>(null)
  const sectionRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (prefersReducedMotion()) return
    const ctx = gsap.context(() => {
      gsap.fromTo('.pricing-header', { opacity: 0, y: 32 }, {
        opacity: 1, y: 0, duration: 0.7, ease: 'power3.out',
        scrollTrigger: { trigger: '.pricing-header', start: 'top 85%', once: true },
      })
      gsap.fromTo('.pricing-card', { opacity: 0, y: 40, scale: 0.97 }, {
        opacity: 1, y: 0, scale: 1, duration: 0.6, ease: 'power3.out', stagger: 0.1,
        scrollTrigger: { trigger: '.pricing-card', start: 'top 80%', once: true },
      })
    }, sectionRef)
    return () => ctx.revert()
  }, [])

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
    <section ref={sectionRef} className="py-24 bg-background border-t border-border">
      <div className="container max-w-[1280px]">
        <div className="pricing-header text-center mb-16">
          <div className="inline-flex items-center gap-2 rounded-full bg-primary/8 border border-primary/20 px-4 py-1.5 text-sm font-medium text-primary mb-4">
            <Zap className="h-3.5 w-3.5" />
            Transparentní ceny
          </div>
          <h2 className="text-4xl font-black text-forest mb-4">{t('title')}</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">{t('subtitle')}</p>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4 max-w-6xl mx-auto items-start">
          {plans.map((plan) => {
            const isSmart = plan === 'smart'
            const features = t.raw(`${plan}.features`) as string[]
            const { price, period } = PLAN_PRICES[plan]
            const badge = PLAN_BADGE[plan]

            return (
              <div
                key={plan}
                className={cn(
                  'pricing-card relative rounded-2xl border flex flex-col transition-all duration-300',
                  isSmart
                    ? 'border-primary/50 bg-white card-shadow-lg lg:scale-[1.03] ring-2 ring-primary/20'
                    : 'border-border bg-white card-shadow hover:border-primary/25 hover:card-shadow-md'
                )}
              >
                {isSmart && (
                  <div className="absolute -top-4 inset-x-0 flex justify-center">
                    <div className="inline-flex items-center gap-1.5 rounded-full gradient-brand text-white text-xs font-bold px-4 py-1.5 shadow-md shadow-brand-300/30">
                      <Star className="h-3 w-3 fill-white" />
                      {t('popular')}
                    </div>
                  </div>
                )}

                <div className={cn('p-6', isSmart && 'pt-8')}>
                  {/* Plan badge */}
                  <div className={cn(
                    'inline-flex items-center rounded-lg px-3 py-1 text-xs font-bold mb-4',
                    isSmart ? 'gradient-brand text-white shadow-sm' : `${badge.bg} ${badge.text}`
                  )}>
                    {t(`${plan}.name`)}
                  </div>

                  {/* Price */}
                  <div className="mb-4">
                    <div className="text-3xl font-black text-forest mb-0.5">{price}</div>
                    {period && <div className="text-sm text-muted-foreground">{period}</div>}
                  </div>

                  <p className="text-sm text-muted-foreground leading-relaxed mb-6">{t(`${plan}.description`)}</p>

                  {/* Features */}
                  <ul className="space-y-2.5 mb-6">
                    {features.map((feature: string) => (
                      <li key={feature} className="flex items-start gap-2.5 text-sm">
                        <div className={cn(
                          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full mt-0.5',
                          isSmart ? 'bg-primary/15' : 'bg-primary/10'
                        )}>
                          <Check className="h-3 w-3 text-primary" />
                        </div>
                        <span className="text-muted-foreground">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="px-6 pb-6 mt-auto">
                  {plan === 'free' ? (
                    <Link href="/register">
                      <Button className="w-full" variant="outline" size="lg">
                        {t('ctaFree')}
                      </Button>
                    </Link>
                  ) : (
                    <Button
                      className="w-full"
                      variant={isSmart ? 'cta' : plan === 'elite' ? 'default' : 'outline'}
                      size="lg"
                      loading={loading === plan}
                      onClick={() => handleCheckout(plan)}
                    >
                      {t('cta')}
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
