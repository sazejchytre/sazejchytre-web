import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { Navbar } from '@/components/layout/navbar'
import { Footer } from '@/components/layout/footer'
import { Shield, TrendingUp, Users, AlertTriangle } from 'lucide-react'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'about' })
  return { title: t('title') }
}

export default async function AboutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'about' })

  const values = [
    { icon: TrendingUp, title: t('values.data.title'), desc: t('values.data.desc') },
    { icon: Shield, title: t('values.transparency.title'), desc: t('values.transparency.desc') },
    { icon: Users, title: t('values.responsible.title'), desc: t('values.responsible.desc') },
  ]

  return (
    <>
      <Navbar locale={locale} />
      <main className="container max-w-4xl py-20">
        <h1 className="text-4xl font-black text-forest mb-4">{t('title')}</h1>
        <p className="text-lg text-muted-foreground leading-relaxed mb-14 max-w-2xl">
          {t('subtitle')}
        </p>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-3 mb-14">
          {values.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="space-y-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl gradient-brand shadow-sm">
                <Icon className="h-6 w-6 text-white" />
              </div>
              <h2 className="text-lg font-bold text-forest">{title}</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-yellow-400/30 bg-yellow-400/6 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-yellow-500 shrink-0 mt-0.5" />
            <p className="text-sm text-muted-foreground leading-relaxed">
              <strong className="text-forest font-semibold">Upozornění: </strong>
              {t('warning')}
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </>
  )
}
