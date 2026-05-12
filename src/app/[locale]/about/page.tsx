import { Navbar } from '@/components/layout/navbar'
import { Footer } from '@/components/layout/footer'
import { Shield, TrendingUp, Users } from 'lucide-react'

export const metadata = { title: 'O nás' }

export default async function AboutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  return (
    <>
      <Navbar locale={locale} />
      <main className="container py-16 max-w-4xl">
        <h1 className="text-4xl font-bold mb-6">O nás</h1>
        <p className="text-lg text-muted-foreground leading-relaxed mb-12">
          SázejChytře je analytická platforma pro zodpovědné sázení. Naším cílem je poskytovat transparentní,
          datově podložené analýzy, které pomohou sázkařům činit informovaná rozhodnutí.
        </p>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
          <div className="space-y-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl gradient-brand">
              <TrendingUp className="h-6 w-6 text-white" />
            </div>
            <h2 className="text-xl font-semibold">Data-driven přístup</h2>
            <p className="text-muted-foreground">Každý tip je podložen hloubkovou analýzou statistik a historických dat.</p>
          </div>
          <div className="space-y-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl gradient-brand">
              <Shield className="h-6 w-6 text-white" />
            </div>
            <h2 className="text-xl font-semibold">Transparentnost</h2>
            <p className="text-muted-foreground">Zveřejňujeme veškeré výsledky včetně proher. Žádné cherry-picking.</p>
          </div>
          <div className="space-y-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl gradient-brand">
              <Users className="h-6 w-6 text-white" />
            </div>
            <h2 className="text-xl font-semibold">Zodpovědné sázení</h2>
            <p className="text-muted-foreground">Aktivně propagujeme zodpovědné sázení a upozorňujeme na rizika.</p>
          </div>
        </div>

        <div className="mt-12 rounded-xl border border-yellow-700/30 bg-yellow-900/10 p-6">
          <p className="text-sm text-yellow-200/80">
            <strong>Upozornění:</strong> SázejChytře neposkytuje záruku výher. Sázení je riziková aktivita.
            Sázejte pouze částky, které jste ochotni ztratit. Pokud máte problémy s patologickým hráčstvím,
            kontaktujte prosím odbornou pomoc.
          </p>
        </div>
      </main>
      <Footer />
    </>
  )
}
