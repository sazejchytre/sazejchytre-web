import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { Navbar } from '@/components/layout/navbar'
import { Footer } from '@/components/layout/footer'
import { HeroSection } from '@/components/marketing/hero-section'
import { HowItWorksSection } from '@/components/marketing/how-it-works'
import { PricingSection } from '@/components/marketing/pricing-section'
import { TestimonialsSection } from '@/components/marketing/testimonials'
import { FaqSection } from '@/components/marketing/faq-section'
import { RiskBanner } from '@/components/marketing/risk-banner'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'hero' })

  return {
    title: 'SázejChytře - Prémiové sázkové analýzy',
    description: t('subtitle'),
  }
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params

  return (
    <>
      <Navbar locale={locale} />
      <main>
        <HeroSection />
        <HowItWorksSection />
        <PricingSection locale={locale} />
        <TestimonialsSection />
        <FaqSection />
        <RiskBanner />
      </main>
      <Footer />
    </>
  )
}
