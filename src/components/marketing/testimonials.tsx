import { useTranslations } from 'next-intl'
import { Star } from 'lucide-react'

export function TestimonialsSection() {
  const t = useTranslations('testimonials')
  const items = t.raw('items') as Array<{ name: string; plan: string; text: string }>

  return (
    <section className="py-24 border-t border-border/50">
      <div className="container">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold mb-4">{t('title')}</h2>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3 max-w-5xl mx-auto">
          {items.map((item, i) => (
            <div key={i} className="glass-card rounded-xl p-6">
              <div className="flex items-center gap-1 mb-4">
                {Array.from({ length: 5 }).map((_, j) => (
                  <Star key={j} className="h-4 w-4 fill-gold-400 text-gold-400" />
                ))}
              </div>
              <p className="text-muted-foreground text-sm leading-relaxed mb-4">&ldquo;{item.text}&rdquo;</p>
              <div>
                <div className="font-semibold text-sm">{item.name}</div>
                <div className="text-xs text-primary">{item.plan}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
