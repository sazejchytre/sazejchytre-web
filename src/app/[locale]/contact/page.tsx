import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { Navbar } from '@/components/layout/navbar'
import { Footer } from '@/components/layout/footer'
import { Mail } from 'lucide-react'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'contact' })
  return { title: t('title') }
}

export default async function ContactPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'contact' })

  return (
    <>
      <Navbar locale={locale} />
      <main className="container max-w-2xl py-20">
        <h1 className="text-4xl font-black text-forest mb-4">{t('title')}</h1>
        <p className="text-muted-foreground mb-10 leading-relaxed">{t('subtitle')}</p>

        <div className="rounded-xl border border-border bg-white card-shadow p-8 space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl gradient-brand shadow-sm shrink-0">
              <Mail className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="font-semibold text-forest text-sm">{t('emailLabel')}</div>
              <a href="mailto:info@sazejchytre.cz" className="text-primary hover:underline text-sm">
                info@sazejchytre.cz
              </a>
            </div>
          </div>
          <p className="text-xs text-muted-foreground pt-4 border-t border-border">
            {t('emailNote')}
          </p>
        </div>
      </main>
      <Footer />
    </>
  )
}
