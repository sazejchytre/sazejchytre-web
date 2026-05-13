'use client'

import { useState, useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Plus, Minus } from 'lucide-react'
import { gsap, prefersReducedMotion } from '@/lib/gsap'
import { cn } from '@/lib/utils/cn'

export function FaqSection() {
  const t = useTranslations('faq')
  const items = t.raw('items') as Array<{ question: string; answer: string }>
  const [open, setOpen] = useState<number | null>(null)
  const sectionRef = useRef<HTMLElement>(null)
  const answerRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    if (prefersReducedMotion()) return
    const ctx = gsap.context(() => {
      gsap.fromTo('.faq-header', { opacity: 0, y: 28 }, {
        opacity: 1, y: 0, duration: 0.7, ease: 'power3.out',
        scrollTrigger: { trigger: '.faq-header', start: 'top 85%', once: true },
      })
      gsap.fromTo('.faq-item', { opacity: 0, y: 24 }, {
        opacity: 1, y: 0, duration: 0.5, ease: 'power3.out', stagger: 0.08,
        scrollTrigger: { trigger: '.faq-item', start: 'top 82%', once: true },
      })
    }, sectionRef)
    return () => ctx.revert()
  }, [])

  function toggle(i: number) {
    const isOpen = open === i
    const el = answerRefs.current[i]
    if (!el) { setOpen(isOpen ? null : i); return }

    if (prefersReducedMotion()) { setOpen(isOpen ? null : i); return }

    if (isOpen) {
      gsap.to(el, { height: 0, opacity: 0, duration: 0.3, ease: 'power2.inOut', onComplete: () => setOpen(null) })
    } else {
      setOpen(i)
      gsap.fromTo(el, { height: 0, opacity: 0 }, { height: 'auto', opacity: 1, duration: 0.35, ease: 'power2.out' })
    }
  }

  return (
    <section ref={sectionRef} className="py-24 bg-background border-t border-border">
      <div className="container max-w-[1280px]">
        <div className="faq-header text-center mb-14 max-w-2xl mx-auto">
          <h2 className="text-4xl font-black text-forest mb-4">{t('title')}</h2>
          <p className="text-muted-foreground">Máte otázky? Najděte odpovědi na nejčastější dotazy.</p>
        </div>

        <div className="max-w-3xl mx-auto space-y-3">
          {items.map((item, i) => (
            <div
              key={i}
              className={cn(
                'faq-item rounded-2xl border bg-white overflow-hidden transition-all duration-300',
                open === i ? 'border-primary/40 card-shadow' : 'border-border hover:border-primary/20'
              )}
            >
              <button
                onClick={() => toggle(i)}
                className="flex w-full items-center justify-between px-6 py-5 text-left group"
              >
                <span className={cn(
                  'font-semibold text-sm transition-colors',
                  open === i ? 'text-primary' : 'text-forest group-hover:text-primary'
                )}>
                  {item.question}
                </span>
                <div className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-all duration-300',
                  open === i ? 'bg-primary text-white' : 'bg-secondary text-muted-foreground'
                )}>
                  {open === i
                    ? <Minus className="h-3.5 w-3.5" />
                    : <Plus className="h-3.5 w-3.5" />
                  }
                </div>
              </button>
              {open === i && (
                <div
                  ref={(el) => { answerRefs.current[i] = el }}
                  className="px-6 pb-5 text-sm text-muted-foreground leading-relaxed border-t border-border/50 pt-4"
                >
                  {item.answer}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
