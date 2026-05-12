import { Navbar } from '@/components/layout/navbar'
import { Footer } from '@/components/layout/footer'
import { LegalPage } from '@/components/layout/legal-page'

export const metadata = { title: 'Ochrana osobních údajů' }

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  return (
    <>
      <Navbar locale={locale} />
      <main>
        <LegalPage title="Ochrana osobních údajů (GDPR)" lastUpdated="[DATUM – K DOPLNĚNÍ]">
          <div className="rounded-lg border border-border bg-card p-4 text-sm mb-8">
            <strong>PLACEHOLDER:</strong> Tento text je šablonou a musí být před ostrým provozem
            nahrazen finálními zásadami ochrany osobních údajů schválenými DPO/právníkem.
          </div>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">1. Správce osobních údajů</h2>
            <p>[PLACEHOLDER – Jméno, IČO, adresa, kontakt na DPO]</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">2. Jaké údaje zpracováváme</h2>
            <p>[PLACEHOLDER – Email, jméno, platební metadata, IP adresa, cookies]</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">3. Účely zpracování</h2>
            <p>[PLACEHOLDER – Poskytnutí služby, fakturace, bezpečnost, marketing se souhlasem]</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">4. Vaše práva</h2>
            <p>[PLACEHOLDER – Právo na přístup, opravu, výmaz, přenositelnost, námitku]</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">5. Zpracovatelé třetích stran</h2>
            <p>[PLACEHOLDER – Supabase, Stripe, Vercel, Google – jako zpracovatelé]</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">6. Cookies</h2>
            <p>[PLACEHOLDER – Odkaz na Cookies Policy]</p>
          </section>
        </LegalPage>
      </main>
      <Footer />
    </>
  )
}
