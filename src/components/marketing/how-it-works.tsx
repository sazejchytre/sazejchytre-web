import { useTranslations } from 'next-intl'
import { UserPlus, CreditCard, Zap } from 'lucide-react'

const icons = [UserPlus, CreditCard, Zap]

export function HowItWorksSection() {
  const t = useTranslations('howItWorks')
  const steps = t.raw('steps') as Array<{ title: string; description: string }>

  return (
    <section className="py-24 border-t border-border/50">
      <div className="container">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold mb-4">{t('title')}</h2>
          <p className="text-lg text-muted-foreground">{t('subtitle')}</p>
        </div>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-3 relative">
          {/* Connector Line */}
          <div className="absolute top-12 left-1/4 right-1/4 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent hidden md:block" />

          {steps.map((step, i) => {
            const Icon = icons[i]
            return (
              <div key={i} className="flex flex-col items-center text-center">
                <div className="relative mb-6">
                  <div className="flex h-24 w-24 items-center justify-center rounded-2xl gradient-brand shadow-lg shadow-primary/25">
                    <Icon className="h-10 w-10 text-white" />
                  </div>
                  <div className="absolute -top-2 -right-2 flex h-7 w-7 items-center justify-center rounded-full bg-card border border-border text-xs font-bold text-primary">
                    {i + 1}
                  </div>
                </div>
                <h3 className="text-xl font-semibold mb-3">{step.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{step.description}</p>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
