import { Navbar } from '@/components/layout/navbar'
import { Footer } from '@/components/layout/footer'
import { LegalPage } from '@/components/layout/legal-page'

export const metadata = { title: 'Cookies' }

export default async function CookiesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  return (
    <>
      <Navbar locale={locale} />
      <main>
        <LegalPage title="Zásady cookies" lastUpdated="[DATUM – K DOPLNĚNÍ]">
          <div className="rounded-lg border border-border bg-card p-4 text-sm mb-8">
            <strong>PLACEHOLDER:</strong> Zásady cookies k doplnění před ostrým provozem.
          </div>
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Co jsou cookies</h2>
            <p>[PLACEHOLDER – Vysvětlení cookies]</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Jaké cookies používáme</h2>
            <p>[PLACEHOLDER – Nezbytné (session, auth), analytické, marketingové]</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Správa cookies</h2>
            <p>[PLACEHOLDER – Jak odmítnout nebo smazat cookies v prohlížeči]</p>
          </section>
        </LegalPage>
      </main>
      <Footer />
    </>
  )
}
