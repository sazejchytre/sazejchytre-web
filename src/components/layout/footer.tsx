import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { TrendingUp, AlertTriangle } from 'lucide-react'

export function Footer() {
  const t = useTranslations('footer')
  const nav = useTranslations('nav')
  const year = new Date().getFullYear()

  return (
    <footer className="border-t border-border bg-card/50">
      {/* Risk Warning Banner */}
      <div className="bg-yellow-900/20 border-b border-yellow-700/30">
        <div className="container py-3 flex items-start gap-3 text-sm text-yellow-200/80">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-yellow-500" />
          <p>{t('disclaimer')}</p>
        </div>
      </div>

      <div className="container py-12">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-4">
          {/* Brand */}
          <div className="md:col-span-2">
            <Link href="/" className="flex items-center gap-2 font-bold text-lg mb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-brand">
                <TrendingUp className="h-5 w-5 text-white" />
              </div>
              <span className="text-gradient">SázejChytře</span>
            </Link>
            <p className="text-sm text-muted-foreground max-w-sm">{t('disclaimer')}</p>
          </div>

          {/* Navigation */}
          <div>
            <h3 className="font-semibold text-sm mb-4 text-foreground">Platforma</h3>
            <ul className="space-y-2">
              <li>
                <Link href="/pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                  {nav('pricing')}
                </Link>
              </li>
              <li>
                <Link href="/how-it-works" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                  {nav('howItWorks')}
                </Link>
              </li>
              <li>
                <Link href="/about" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                  {nav('about')}
                </Link>
              </li>
              <li>
                <Link href="/contact" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                  {nav('contact')}
                </Link>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h3 className="font-semibold text-sm mb-4 text-foreground">Právní</h3>
            <ul className="space-y-2">
              <li>
                <Link href="/terms" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                  {t('links.terms')}
                </Link>
              </li>
              <li>
                <Link href="/privacy" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                  {t('links.privacy')}
                </Link>
              </li>
              <li>
                <Link href="/cookies" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                  {t('links.cookies')}
                </Link>
              </li>
              <li>
                <Link href="/responsible-gambling" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                  {t('links.responsible')}
                </Link>
              </li>
              <li>
                <Link href="/risk-warning" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                  {t('links.risk')}
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-8 pt-8 border-t border-border flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <p className="text-xs text-muted-foreground">
            © {year} SázejChytře. {t('rights')}.
          </p>
          <p className="text-xs text-muted-foreground">18+ | Sázejte zodpovědně</p>
        </div>
      </div>
    </footer>
  )
}
