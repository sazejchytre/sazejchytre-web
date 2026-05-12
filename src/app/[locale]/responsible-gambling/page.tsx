import { Navbar } from '@/components/layout/navbar'
import { Footer } from '@/components/layout/footer'
import { LegalPage } from '@/components/layout/legal-page'
import { AlertTriangle } from 'lucide-react'

export const metadata = { title: 'Zodpovědné sázení' }

export default async function ResponsibleGamblingPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  return (
    <>
      <Navbar locale={locale} />
      <main>
        <LegalPage title="Zodpovědné sázení">
          <div className="rounded-xl border border-yellow-700/30 bg-yellow-900/20 p-6 mb-8 flex gap-4">
            <AlertTriangle className="h-6 w-6 text-yellow-500 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-yellow-300 mb-2">Důležité upozornění</h3>
              <p className="text-yellow-200/80 text-sm">
                Sázení by mělo být vždy zábavou, nikdy způsobem, jak řešit finanční problémy.
                Pokud máte pocit, že sázení přestává být pod kontrolou, vyhledejte odbornou pomoc.
              </p>
            </div>
          </div>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Principy zodpovědného sázení</h2>
            <ul className="space-y-2 list-disc list-inside">
              <li>Sázejte pouze částky, které jste schopni ztratit bez negativního dopadu na váš život</li>
              <li>Nastavte si denní, týdenní nebo měsíční limity</li>
              <li>Nikdy nesázejte pod vlivem alkoholu nebo emocí</li>
              <li>Sázení využívejte jako zábavu, ne jako způsob výdělku</li>
              <li>Nikdy nepůjčujte peníze za účelem sázení</li>
              <li>Dělejte si pravidelné přestávky</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Kde hledat pomoc</h2>
            <div className="space-y-3 text-sm">
              <div className="rounded-lg border border-border bg-card p-4">
                <strong className="text-foreground">Centrum pro léčbu závislostí na hazardním hraní</strong>
                <p>Tel.: [K DOPLNĚNÍ] | Web: [K DOPLNĚNÍ]</p>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <strong className="text-foreground">Linka pomoci hráčům</strong>
                <p>Bezplatná linka: 800 900 800 (dle aktuálních informací)</p>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <strong className="text-foreground">Gamblers Anonymous Czech Republic</strong>
                <p>Web: www.anonymni-hrace.cz [ověřte aktuálnost]</p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Věkové omezení</h2>
            <p>
              Naše služba je určena výhradně osobám starším 18 let.
              Přísně zakazujeme přístup nezletilým.
            </p>
          </section>
        </LegalPage>
      </main>
      <Footer />
    </>
  )
}
