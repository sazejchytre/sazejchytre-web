import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { AlertTriangle } from 'lucide-react'

export function Footer() {
  const t = useTranslations('footer')
  const nav = useTranslations('nav')
  const year = new Date().getFullYear()

  return (
    <footer className="bg-forest text-white">
      <div className="container max-w-[1280px] py-16">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-4">
          {/* Brand */}
          <div className="md:col-span-2">
            <Link href="/" className="flex items-center gap-2.5 font-bold text-lg mb-5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-brand shadow-sm">
                <span className="text-white font-black text-xs tracking-tight">SCH</span>
              </div>
              <span className="font-black tracking-tight">
                Sázej<span className="text-primary">Chytře</span>
              </span>
            </Link>
            <p className="text-sm text-white/50 max-w-sm leading-relaxed">{t('disclaimer')}</p>
            <div className="mt-6 flex items-center gap-2 text-xs text-white/40">
              <span className="inline-flex items-center justify-center h-5 w-7 rounded border border-white/20 font-bold text-white/60 text-[10px]">18+</span>
              <span>Sázení je určeno pouze pro dospělé osoby</span>
            </div>
          </div>

          {/* Navigation */}
          <div>
            <h3 className="font-semibold text-sm mb-5 text-white/90 uppercase tracking-wider">Platforma</h3>
            <ul className="space-y-3">
              {[
                { href: '/pricing', label: nav('pricing') },
                { href: '/how-it-works', label: nav('howItWorks') },
                { href: '/about', label: nav('about') },
                { href: '/contact', label: nav('contact') },
              ].map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href as '/pricing'}
                    className="text-sm text-white/50 hover:text-primary transition-colors"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h3 className="font-semibold text-sm mb-5 text-white/90 uppercase tracking-wider">Právní</h3>
            <ul className="space-y-3">
              {[
                { href: '/terms', label: t('links.terms') },
                { href: '/privacy', label: t('links.privacy') },
                { href: '/cookies', label: t('links.cookies') },
                { href: '/responsible-gambling', label: t('links.responsible') },
                { href: '/risk-warning', label: t('links.risk') },
              ].map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href as '/terms'}
                    className="text-sm text-white/50 hover:text-primary transition-colors"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-white/10 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <p className="text-xs text-white/30">© {year} SázejChytře. {t('rights')}.</p>
          <div className="flex items-center gap-2 text-xs text-white/30">
            <AlertTriangle className="h-3 w-3 text-yellow-400/60" />
            <span>Sázení s sebou nese riziko finanční ztráty</span>
          </div>
        </div>
      </div>
    </footer>
  )
}
