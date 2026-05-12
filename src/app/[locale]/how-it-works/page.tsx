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
        <div className="container py-16 text-center">
          <h1 className="text-4xl font-bold mb-4">Jak to funguje</h1>
        </div>
        <HowItWorksSection />
      </main>
      <Footer />
    </>
  )
}
