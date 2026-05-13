'use client'

import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { UserPlus, CreditCard, Zap } from 'lucide-react'
import { gsap, prefersReducedMotion } from '@/lib/gsap'

const icons = [UserPlus, CreditCard, Zap]

export function HowItWorksSection() {
  const t = useTranslations('howItWorks')
  const steps = t.raw('steps') as Array<{ title: string; description: string }>
  const sectionRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (prefersReducedMotion()) return
    const ctx = gsap.context(() => {
      gsap.fromTo('.hiw-header', { opacity: 0, y: 32 }, {
        opacity: 1, y: 0, duration: 0.7, ease: 'power3.out',
        scrollTrigger: { trigger: '.hiw-header', start: 'top 85%', once: true },
      })
      gsap.fromTo('.hiw-step', { opacity: 0, y: 40 }, {
        opacity: 1, y: 0, duration: 0.6, ease: 'power3.out', stagger: 0.15,
        scrollTrigger: { trigger: '.hiw-step', start: 'top 80%', once: true },
      })
    }, sectionRef)
    return () => ctx.revert()
  }, [])

  return (
    <section ref={sectionRef} className="py-24 bg-white border-t border-border">
      <div className="container max-w-[1280px]">
        <div className="hiw-header text-center mb-16">
          <div className="inline-flex items-center gap-2 rounded-full bg-primary/8 border border-primary/20 px-4 py-1.5 text-sm font-medium text-primary mb-4">
            Jak to funguje
          </div>
          <h2 className="text-4xl font-black text-forest mb-4">{t('title')}</h2>
          <p className="text-lg text-muted-foreground">{t('subtitle')}</p>
        </div>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-3 relative">
          {/* Connector */}
          <div className="absolute top-14 left-[calc(16.66%+32px)] right-[calc(16.66%+32px)] h-px bg-gradient-to-r from-primary/20 via-primary/40 to-primary/20 hidden md:block" />

          {steps.map((step, i) => {
            const Icon = icons[i]
            return (
              <div key={i} className="hiw-step flex flex-col items-center text-center group">
                <div className="relative mb-6">
                  <div className="flex h-24 w-24 items-center justify-center rounded-2xl gradient-brand shadow-md shadow-brand-300/25 group-hover:scale-105 transition-transform duration-300">
                    <Icon className="h-10 w-10 text-white" />
                  </div>
                  <div className="absolute -top-2.5 -right-2.5 flex h-7 w-7 items-center justify-center rounded-full bg-white border-2 border-primary text-xs font-black text-primary card-shadow">
                    {i + 1}
                  </div>
                </div>
                <h3 className="text-xl font-bold mb-3 text-forest">{step.title}</h3>
                <p className="text-muted-foreground leading-relaxed text-sm max-w-xs">{step.description}</p>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
