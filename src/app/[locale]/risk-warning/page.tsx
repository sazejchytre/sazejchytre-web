import { Navbar } from '@/components/layout/navbar'
import { Footer } from '@/components/layout/footer'
import { LegalPage } from '@/components/layout/legal-page'
import { AlertTriangle } from 'lucide-react'

export const metadata = { title: 'Upozornění na rizika sázení' }

export default async function RiskWarningPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  return (
    <>
      <Navbar locale={locale} />
      <main>
        <LegalPage title="Upozornění na rizika sázení">
          <div className="rounded-xl border-2 border-red-800/50 bg-red-900/10 p-6 mb-8 flex gap-4">
            <AlertTriangle className="h-6 w-6 text-red-500 shrink-0 mt-0.5" />
            <p className="text-red-200/90 text-sm font-medium">
              VAROVÁNÍ: Sázení může způsobit finanční ztráty. Minulé výsledky nejsou zárukou budoucích výsledků.
              Žádná analytická platforma nemůže garantovat výhry.
            </p>
          </div>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Finanční rizika</h2>
            <p>
              Sázení je spekulativní aktivita. Existuje reálná možnost, že přijdete o veškeré
              vsazené prostředky. Nikdy nesázejte peníze, které potřebujete pro základní životní potřeby,
              splácení dluhů nebo jiné závazky.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Povaha našich tipů</h2>
            <p>
              Tipy a analýzy na SázejChytře jsou pouze poradního charakteru. Jde o statisticky podložené
              hypotézy, které se mohou lišit od skutečných výsledků. Žádný tip nepředstavuje jistou výhru.
              Historická úspěšnost analytika není zárukou budoucí úspěšnosti.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Regulace a zákonnost</h2>
            <p>
              Ověřte si zákonnost online sázení ve vaší zemi nebo jurisdikci. Je vaší povinností
              dodržovat místní legislativu týkající se hazardních her.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Omezení odpovědnosti</h2>
            <p>
              SázejChytře nenese odpovědnost za finanční ztráty vzniklé na základě použití informací
              z naší platformy. Veškeré sázkové rozhodnutí je výhradně vaší volbou a odpovědností.
            </p>
          </section>
        </LegalPage>
      </main>
      <Footer />
    </>
  )
}
