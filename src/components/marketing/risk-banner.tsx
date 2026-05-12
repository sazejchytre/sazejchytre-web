import { useTranslations } from 'next-intl'
import { AlertTriangle } from 'lucide-react'

export function RiskBanner() {
  const t = useTranslations('riskWarning')

  return (
    <section className="py-12 border-t border-yellow-700/20 bg-yellow-900/10">
      <div className="container max-w-3xl text-center">
        <div className="flex items-center justify-center gap-2 mb-3">
          <AlertTriangle className="h-5 w-5 text-yellow-500" />
          <h3 className="font-semibold text-yellow-300">{t('title')}</h3>
        </div>
        <p className="text-sm text-yellow-200/70 leading-relaxed">{t('text')}</p>
        <p className="text-xs text-muted-foreground/50 mt-3">18+ | Sázení je určeno pouze pro dospělé</p>
      </div>
    </section>
  )
}
