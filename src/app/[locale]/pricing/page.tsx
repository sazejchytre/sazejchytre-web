import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { Navbar } from '@/components/layout/navbar'
import { Footer } from '@/components/layout/footer'
import { PricingSection } from '@/components/marketing/pricing-section'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'plans' })
  return { title: t('title') }
}

export default async function PricingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params

  return (
    <>
      <Navbar locale={locale} />
      <main>
        <div className="container py-16 text-center">
          <h1 className="text-4xl font-bold mb-4">Ceník</h1>
          <p className="text-muted-foreground text-lg">Transparentní ceny, žádné skryté poplatky</p>
        </div>
        <PricingSection locale={locale} />
      </main>
      <Footer />
    </>
  )
}
