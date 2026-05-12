import { Navbar } from '@/components/layout/navbar'
import { Footer } from '@/components/layout/footer'
import { LegalPage } from '@/components/layout/legal-page'

export const metadata = { title: 'Obchodní podmínky' }

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  return (
    <>
      <Navbar locale={locale} />
      <main>
        <LegalPage title="Obchodní podmínky" lastUpdated="[DATUM – K DOPLNĚNÍ]">
          <div className="rounded-lg border border-border bg-card p-4 text-sm mb-8">
            <strong>PLACEHOLDER:</strong> Tento text je šablonou a musí být před ostrým provozem
            nahrazen finálními obchodními podmínkami schválenými právníkem.
          </div>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">1. Úvodní ustanovení</h2>
            <p>[PLACEHOLDER – Identifikace provozovatele, předmět podmínek]</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">2. Registrace a účet</h2>
            <p>[PLACEHOLDER – Podmínky registrace, věková hranice 18+, odpovědnost uživatele]</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">3. Předplatné a platby</h2>
            <p>[PLACEHOLDER – Ceny, fakturační cyklus, automatické obnovení, způsoby platby]</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">4. Obsah a omezení odpovědnosti</h2>
            <p>[PLACEHOLDER – Povaha tipů jako doporučení, ne záruky; omezení odpovědnosti za ztráty ze sázení]</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">5. Zásady zodpovědného hraní</h2>
            <p>[PLACEHOLDER – Odkaz na zodpovědné hraní, kontakty na pomoc]</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">6. Ukončení smlouvy</h2>
            <p>[PLACEHOLDER – Způsoby zrušení, podmínky vrácení platby]</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">7. Závěrečná ustanovení</h2>
            <p>[PLACEHOLDER – Rozhodné právo, řešení sporů, kontaktní údaje]</p>
          </section>
        </LegalPage>
      </main>
      <Footer />
    </>
  )
}
