'use client'

import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Star } from 'lucide-react'
import { gsap, prefersReducedMotion } from '@/lib/gsap'

export function TestimonialsSection() {
  const t = useTranslations('testimonials')
  const items = t.raw('items') as Array<{ name: string; plan: string; text: string }>
  const sectionRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (prefersReducedMotion()) return
    const ctx = gsap.context(() => {
      gsap.fromTo('.tmn-header', { opacity: 0, y: 28 }, {
        opacity: 1, y: 0, duration: 0.7, ease: 'power3.out',
        scrollTrigger: { trigger: '.tmn-header', start: 'top 85%', once: true },
      })
      gsap.fromTo('.tmn-card', { opacity: 0, y: 40, scale: 0.97 }, {
        opacity: 1, y: 0, scale: 1, duration: 0.6, ease: 'power3.out', stagger: 0.12,
        scrollTrigger: { trigger: '.tmn-card', start: 'top 80%', once: true },
      })
    }, sectionRef)
    return () => ctx.revert()
  }, [])

  return (
    <section ref={sectionRef} className="py-24 bg-white border-t border-border">
      <div className="container max-w-[1280px]">
        <div className="tmn-header text-center mb-16">
          <div className="inline-flex items-center gap-2 rounded-full bg-yellow-400/12 border border-yellow-400/30 px-4 py-1.5 text-sm font-medium text-forest mb-4">
            <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
            Recenze členů
          </div>
          <h2 className="text-4xl font-black text-forest">{t('title')}</h2>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3 max-w-5xl mx-auto">
          {items.map((item, i) => (
            <div
              key={i}
              className="tmn-card bg-white rounded-2xl p-6 card-shadow border border-border hover:border-primary/25 hover:card-shadow-md transition-all duration-300"
            >
              <div className="flex items-center gap-0.5 mb-4">
                {Array.from({ length: 5 }).map((_, j) => (
                  <Star key={j} className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                ))}
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed mb-5">&ldquo;{item.text}&rdquo;</p>
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full gradient-brand text-white text-xs font-bold shrink-0">
                  {item.name.charAt(0)}
                </div>
                <div>
                  <div className="font-semibold text-sm text-forest">{item.name}</div>
                  <div className="text-xs font-medium text-primary">{item.plan}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
