import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { TrendingUp, Shield, Users, ArrowRight, AlertTriangle } from 'lucide-react'

export function HeroSection() {
  const t = useTranslations('hero')

  return (
    <section className="relative overflow-hidden gradient-hero">
      {/* Background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 h-[600px] w-[600px] rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute top-20 right-0 h-[400px] w-[400px] rounded-full bg-brand-800/20 blur-3xl" />
      </div>

      <div className="container relative py-24 lg:py-32">
        <div className="mx-auto max-w-4xl text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-sm text-primary mb-8">
            <TrendingUp className="h-4 w-4" />
            <span>{t('badge')}</span>
          </div>

          {/* Headline */}
          <h1 className="text-5xl font-bold tracking-tight lg:text-7xl mb-6">
            <span className="text-foreground">{t('title').split('\n')[0]}</span>
            <br />
            <span className="text-gradient">{t('title').split('\n')[1]}</span>
          </h1>

          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
            {t('subtitle')}
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
            <Link href="/register">
              <Button size="xl" className="group">
                {t('cta')}
                <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
            <Link href="/how-it-works">
              <Button size="xl" variant="outline">
                {t('ctaSecondary')}
              </Button>
            </Link>
          </div>

          {/* Risk Disclaimer */}
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground/70">
            <AlertTriangle className="h-3 w-3 text-yellow-500" />
            <span>{t('disclaimer')}</span>
          </div>

          {/* Stats */}
          <div className="mt-16 grid grid-cols-3 gap-8 border-t border-border/50 pt-12">
            <div className="text-center">
              <div className="text-3xl font-bold text-gradient mb-1">73%</div>
              <div className="text-sm text-muted-foreground">{t('stats.accuracy')}</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-gradient mb-1">150+</div>
              <div className="text-sm text-muted-foreground">{t('stats.tips')}</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-gradient mb-1">2 400+</div>
              <div className="text-sm text-muted-foreground">{t('stats.members')}</div>
            </div>
          </div>
        </div>

        {/* Features Preview */}
        <div className="mt-20 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="glass-card rounded-xl p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 mb-4">
              <TrendingUp className="h-5 w-5 text-primary" />
            </div>
            <h3 className="font-semibold mb-2">Datové analýzy</h3>
            <p className="text-sm text-muted-foreground">Každý tip podložen hloubkovou analýzou dat a statistik.</p>
          </div>
          <div className="glass-card rounded-xl p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 mb-4">
              <Shield className="h-5 w-5 text-primary" />
            </div>
            <h3 className="font-semibold mb-2">Transparentní výsledky</h3>
            <p className="text-sm text-muted-foreground">Kompletní historie tipů a výsledků. Žádné skrývání proher.</p>
          </div>
          <div className="glass-card rounded-xl p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 mb-4">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <h3 className="font-semibold mb-2">Expertní tým</h3>
            <p className="text-sm text-muted-foreground">Analytici s letitými zkušenostmi z profesionálního sázení.</p>
          </div>
        </div>
      </div>
    </section>
  )
}
