import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

const plans = ['basic', 'pro', 'elite'] as const

interface PricingSectionProps {
  locale: string
}

export function PricingSection({ locale: _locale }: PricingSectionProps) {
  const t = useTranslations('plans')

  return (
    <section className="py-24 bg-card/30">
      <div className="container">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold mb-4">{t('title')}</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">{t('subtitle')}</p>
        </div>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-3 max-w-5xl mx-auto">
          {plans.map((plan) => {
            const isPro = plan === 'pro'
            const features = t.raw(`${plan}.features`) as string[]

            return (
              <div
                key={plan}
                className={cn(
                  'relative rounded-2xl border p-8 flex flex-col',
                  isPro
                    ? 'border-primary bg-gradient-to-b from-primary/10 to-transparent shadow-xl shadow-primary/10 scale-105'
                    : 'border-border bg-card'
                )}
              >
                {isPro && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                    <Badge className="bg-primary text-primary-foreground px-4 py-1">
                      {t('popular')}
                    </Badge>
                  </div>
                )}

                <div className="mb-6">
                  <div
                    className={cn(
                      'inline-flex items-center rounded-lg px-3 py-1 text-xs font-bold mb-4',
                      plan === 'basic' && 'bg-brand-600/20 text-brand-300',
                      plan === 'pro' && 'bg-purple-600/20 text-purple-300',
                      plan === 'elite' && 'bg-gold-600/20 text-gold-400'
                    )}
                  >
                    {t(`${plan}.name`)}
                  </div>
                  <div className="text-3xl font-bold mb-1">{t('price')}</div>
                  <div className="text-sm text-muted-foreground">{t('perWeek')}</div>
                  <p className="text-sm text-muted-foreground mt-3">{t(`${plan}.description`)}</p>
                </div>

                <ul className="flex-1 space-y-3 mb-8">
                  {features.map((feature: string, _i: number) => (
                    <li key={feature} className="flex items-center gap-3 text-sm">
                      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10">
                        <Check className="h-3 w-3 text-primary" />
                      </div>
                      <span className="text-muted-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>

                <Link href="/register">
                  <Button
                    className="w-full"
                    variant={isPro ? 'default' : plan === 'elite' ? 'premium' : 'outline'}
                    size="lg"
                  >
                    {t('cta')}
                  </Button>
                </Link>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
