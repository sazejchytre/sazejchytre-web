import { useTranslations } from 'next-intl'
import { AlertTriangle } from 'lucide-react'

export function RiskBanner() {
  const t = useTranslations('riskWarning')

  return (
    <section className="py-10 border-t border-yellow-400/20 bg-yellow-400/6">
      <div className="container max-w-3xl text-center">
        <div className="flex items-center justify-center gap-2 mb-3">
          <AlertTriangle className="h-4.5 w-4.5 text-yellow-500" />
          <h3 className="font-semibold text-sm text-forest">{t('title')}</h3>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">{t('text')}</p>
        <p className="text-xs text-muted-foreground/50 mt-3">
          <span className="inline-flex items-center justify-center h-5 w-7 rounded border border-yellow-400/40 font-bold text-yellow-600 text-[10px] mr-1.5">18+</span>
          Sázení je určeno pouze pro dospělé
        </p>
      </div>
    </section>
  )
}
