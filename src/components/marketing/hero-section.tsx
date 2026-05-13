'use client'

import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { TrendingUp, Shield, Users, ArrowRight, AlertTriangle } from 'lucide-react'
import { gsap, prefersReducedMotion } from '@/lib/gsap'

export function HeroSection() {
  const t = useTranslations('hero')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (prefersReducedMotion()) return
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })

      tl.fromTo('.hero-badge',   { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.6 })
        .fromTo('.hero-h1',      { opacity: 0, y: 36 }, { opacity: 1, y: 0, duration: 0.7 }, '-=0.3')
        .fromTo('.hero-sub',     { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.6 }, '-=0.4')
        .fromTo('.hero-cta',     { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.1 }, '-=0.3')
        .fromTo('.hero-disclaimer',{ opacity: 0 },       { opacity: 1, duration: 0.4 }, '-=0.2')
        .fromTo('.hero-stat',    { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.12 }, '-=0.2')
        .fromTo('.hero-card',    { opacity: 0, y: 32, scale: 0.97 }, { opacity: 1, y: 0, scale: 1, duration: 0.6, stagger: 0.1 }, '-=0.3')
    }, containerRef)

    return () => ctx.revert()
  }, [])

  return (
    <section ref={containerRef} className="relative overflow-hidden gradient-section">
      {/* Decorative blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none select-none">
        <div className="absolute -top-32 -right-32 h-[500px] w-[500px] rounded-full bg-primary/8 blur-3xl" />
        <div className="absolute top-1/2 -left-24 h-[350px] w-[350px] rounded-full bg-mint/40 blur-3xl" />
        <div className="absolute bottom-0 right-1/4 h-[250px] w-[250px] rounded-full bg-yellow-400/6 blur-3xl" />
      </div>

      <div className="container relative max-w-[1280px] py-24 lg:py-32">
        <div className="mx-auto max-w-4xl text-center">

          {/* Badge */}
          <div className="hero-badge inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/8 px-4 py-1.5 text-sm font-medium text-primary mb-8">
            <TrendingUp className="h-3.5 w-3.5" />
            <span>{t('badge')}</span>
          </div>

          {/* Headline */}
          <h1 className="hero-h1 text-5xl font-black tracking-tight lg:text-7xl mb-6 text-forest leading-[1.05]">
            {t('title').split('\n')[0]}
            <br />
            <span className="text-gradient">{t('title').split('\n')[1]}</span>
          </h1>

          <p className="hero-sub text-lg text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
            {t('subtitle')}
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-10">
            <Link href="/register" className="hero-cta">
              <Button variant="cta" size="xl" className="group gap-2">
                {t('cta')}
                <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
            <Link href="/how-it-works" className="hero-cta">
              <Button variant="outline" size="xl">
                {t('ctaSecondary')}
              </Button>
            </Link>
          </div>

          {/* Disclaimer */}
          <div className="hero-disclaimer flex items-center justify-center gap-1.5 text-xs text-muted-foreground/60">
            <AlertTriangle className="h-3 w-3 text-yellow-400" />
            <span>{t('disclaimer')}</span>
          </div>

          {/* Stats */}
          <div className="mt-16 grid grid-cols-3 gap-6 border-t border-border pt-12">
            {[
              { value: '73%', label: t('stats.accuracy') },
              { value: '150+', label: t('stats.tips') },
              { value: '2 400+', label: t('stats.members') },
            ].map((stat) => (
              <div key={stat.label} className="hero-stat text-center">
                <div className="text-3xl font-black text-gradient mb-1">{stat.value}</div>
                <div className="text-sm text-muted-foreground">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Feature cards */}
        <div className="mt-20 grid grid-cols-1 gap-4 md:grid-cols-3">
          {[
            {
              icon: TrendingUp,
              title: 'Datové analýzy',
              desc: 'Každý tip podložen hloubkovou analýzou dat a statistik.',
            },
            {
              icon: Shield,
              title: 'Transparentní výsledky',
              desc: 'Kompletní historie tipů a výsledků. Žádné skrývání proher.',
            },
            {
              icon: Users,
              title: 'Expertní tým',
              desc: 'Analytici s letitými zkušenostmi z profesionálního sázení.',
            },
          ].map(({ icon: Icon, title, desc }) => (
            <div
              key={title}
              className="hero-card bg-white rounded-2xl p-6 card-shadow border border-border/60 hover:border-primary/30 hover:card-shadow-md transition-all duration-300 group"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl gradient-brand mb-4 shadow-sm group-hover:scale-110 transition-transform duration-300">
                <Icon className="h-5 w-5 text-white" />
              </div>
              <h3 className="font-bold mb-2 text-forest">{title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
