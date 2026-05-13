import { Navbar } from '@/components/layout/navbar'
import { Footer } from '@/components/layout/footer'
import { HowItWorksSection } from '@/components/marketing/how-it-works'

export const metadata = { title: 'Jak to funguje' }

export default async function HowItWorksPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  return (
    <>
      <Navbar locale={locale} />
      <main>
        <HowItWorksSection />
      </main>
      <Footer />
    </>
  )
}
