import type { Metadata } from 'next'
import Link from 'next/link'
import { Navbar } from '@/components/layout/navbar'
import { Footer } from '@/components/layout/footer'
import { LegalPage } from '@/components/layout/legal-page'
import { AlertTriangle } from 'lucide-react'

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Zásady cookies | SázejChytře',
    description:
      'Informace o používání cookies na platformě SázejChytře.',
  }
}

export default async function CookiesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  return (
    <>
      <Navbar locale={locale} />
      <main>
        <LegalPage title="Zásady cookies" lastUpdated="13. 5. 2025">
          {/* Lawyer review disclaimer */}
          <div className="rounded-lg border border-yellow-400/30 bg-yellow-400/8 p-4 text-sm mb-8 text-forest flex gap-3">
            <AlertTriangle className="h-4 w-4 text-yellow-400 shrink-0 mt-0.5" />
            <p>
              <strong className="text-yellow-400">Upozornění:</strong> Tento dokument je šablonou
              připravenou pro účely platformy SázejChytře. Před ostrým provozem doporučujeme
              nechat dokument přezkoumat kvalifikovaným právníkem, zejména s ohledem na zákon č.
              127/2005 Sb., o elektronických komunikacích, a GDPR.
            </p>
          </div>

          {/* 1. Co jsou cookies */}
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">1. Co jsou cookies</h2>
            <p>
              Cookies jsou malé textové soubory, které webové stránky ukládají do vašeho zařízení
              (počítač, tablet, mobilní telefon) prostřednictvím prohlížeče při návštěvě webu.
              Cookies umožňují webu zapamatovat si vaše akce a nastavení (např. přihlašovací
              stav, jazykové předvolby) po určitou dobu, takže je nemusíte znovu zadávat při
              každé návštěvě nebo při přechodu mezi stránkami.
            </p>
            <p className="mt-3">
              Cookies samy o sobě neobsahují žádné osobní identifikátory (jako je jméno nebo
              e-mail), nicméně mohou být v kombinaci s dalšími informacemi použity k identifikaci
              osoby. Podrobnosti o zpracování osobních údajů naleznete v našich{' '}
              <Link href={`/${locale}/privacy`} className="underline">
                Zásadách ochrany osobních údajů
              </Link>
              .
            </p>
          </section>

          {/* 2. Typy cookies */}
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">2. Typy cookies</h2>
            <p>
              Cookies rozdělujeme do tří kategorií dle jejich účelu:
            </p>

            <div className="mt-4 space-y-4">
              <div className="rounded-md border border-border p-4">
                <h3 className="font-semibold text-foreground mb-2">
                  Nezbytné cookies (vždy aktivní)
                </h3>
                <p className="text-sm">
                  Tyto cookies jsou nezbytné pro základní fungování platformy a nelze je
                  vypnout. Nevyžadují váš souhlas. Jsou nastavovány výhradně jako reakce na
                  vaše akce (přihlášení, změna nastavení) a neumožňují sledování pro
                  marketingové účely.
                </p>
              </div>

              <div className="rounded-md border border-border p-4">
                <h3 className="font-semibold text-foreground mb-2">
                  Analytické cookies (volitelné)
                </h3>
                <p className="text-sm">
                  Pomáhají nám pochopit, jak návštěvníci platformu využívají, které stránky jsou
                  nejnavštěvovanější a jak uživatelé přicházejí na web. Data jsou zpravidla
                  anonymizovaná. Tyto cookies nastavujeme pouze s vaším souhlasem.
                </p>
              </div>

              <div className="rounded-md border border-border p-4">
                <h3 className="font-semibold text-foreground mb-2">
                  Marketingové cookies (volitelné)
                </h3>
                <p className="text-sm">
                  Slouží k zobrazování relevantní reklamy a sledování její účinnosti. V současné
                  době tyto cookies aktivně nevyužíváme. Pokud by byly zavedeny, budeme vás o
                  tom informovat a vyžádáme si váš souhlas.
                </p>
              </div>
            </div>
          </section>

          {/* 3. Konkrétní cookies */}
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              3. Přehled konkrétních cookies
            </h2>
            <p className="mb-4">
              Níže uvádíme přehled cookies, které platforma SázejChytře v současnosti používá:
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-4 font-semibold text-foreground whitespace-nowrap">
                      Název
                    </th>
                    <th className="text-left py-2 pr-4 font-semibold text-foreground">Typ</th>
                    <th className="text-left py-2 pr-4 font-semibold text-foreground">Účel</th>
                    <th className="text-left py-2 font-semibold text-foreground whitespace-nowrap">
                      Platnost
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <tr>
                    <td className="py-2 pr-4 font-mono text-xs whitespace-nowrap">
                      sb-access-token
                    </td>
                    <td className="py-2 pr-4">Nezbytné</td>
                    <td className="py-2 pr-4">
                      Autentizační JWT token pro přihlášeného uživatele (Supabase Auth).
                    </td>
                    <td className="py-2 whitespace-nowrap">1 hodina</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4 font-mono text-xs whitespace-nowrap">
                      sb-refresh-token
                    </td>
                    <td className="py-2 pr-4">Nezbytné</td>
                    <td className="py-2 pr-4">
                      Refresh token pro obnovení přihlašovací session bez nutnosti opětovného
                      přihlášení.
                    </td>
                    <td className="py-2 whitespace-nowrap">60 dní</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4 font-mono text-xs whitespace-nowrap">
                      __stripe_mid
                    </td>
                    <td className="py-2 pr-4">Nezbytné</td>
                    <td className="py-2 pr-4">
                      Stripe machine identifier – identifikuje zařízení pro účely prevence
                      podvodů při zpracování platby.
                    </td>
                    <td className="py-2 whitespace-nowrap">1 rok</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4 font-mono text-xs whitespace-nowrap">
                      __stripe_sid
                    </td>
                    <td className="py-2 pr-4">Nezbytné</td>
                    <td className="py-2 pr-4">
                      Stripe session identifier – identifikuje session pro platební transakci.
                    </td>
                    <td className="py-2 whitespace-nowrap">Session</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4 font-mono text-xs whitespace-nowrap">
                      _ga / _ga_*
                    </td>
                    <td className="py-2 pr-4">Analytické</td>
                    <td className="py-2 pr-4">
                      Google Analytics – anonymizované sledování návštěvnosti a chování uživatelů.
                      Nastavováno pouze se souhlasem.
                    </td>
                    <td className="py-2 whitespace-nowrap">2 roky</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              Výše uvedený seznam nemusí být vyčerpávající; prohlížeč třetích stran (Stripe,
              Google) může nastavit i další technické cookies nezbytné pro fungování jejich
              služeb. Jejich aktuální seznam naleznete v dokumentaci příslušných poskytovatelů.
            </p>
          </section>

          {/* 4. Správa cookies */}
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              4. Jak spravovat a odmítnout cookies
            </h2>
            <p>
              Souhlas s nebytnými cookies nelze odepřít, neboť jsou nezbytné pro fungování
              platformy. Analytické a marketingové cookies lze spravovat:
            </p>
            <ul className="mt-3 space-y-2 list-disc pl-5">
              <li>
                <strong>Prostřednictvím cookie banneru</strong> – při první návštěvě platformy
                vám zobrazíme lištu, kde můžete volitelné cookies přijmout nebo odmítnout.
                Svůj souhlas lze kdykoli změnit.
              </li>
              <li>
                <strong>V nastavení prohlížeče</strong> – většina prohlížečů umožňuje zobrazit,
                spravovat a smazat uložené cookies. Níže naleznete přímé odkazy na nápovědu
                nejrozšířenějších prohlížečů:
              </li>
            </ul>
            <ul className="mt-3 space-y-1 list-none pl-5">
              <li>
                <a
                  href="https://support.google.com/chrome/answer/95647"
                  className="underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Google Chrome
                </a>
              </li>
              <li>
                <a
                  href="https://support.mozilla.org/cs/kb/povoleni-zakazani-cookies"
                  className="underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Mozilla Firefox
                </a>
              </li>
              <li>
                <a
                  href="https://support.apple.com/cs-cz/guide/safari/sfri11471/mac"
                  className="underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Apple Safari
                </a>
              </li>
              <li>
                <a
                  href="https://support.microsoft.com/cs-cz/microsoft-edge/cookies-v-microsoft-edge"
                  className="underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Microsoft Edge
                </a>
              </li>
            </ul>
            <p className="mt-3">
              Upozorňujeme, že odmítnutí nebo smazání nezbytných cookies může způsobit, že
              některé funkce platformy (zejména přihlášení a platby) přestanou správně fungovat.
            </p>
          </section>

          {/* 5. Doba platnosti */}
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">5. Doba platnosti cookies</h2>
            <p>
              Cookies dělíme dle doby platnosti na dvě skupiny:
            </p>
            <ul className="mt-3 space-y-2 list-disc pl-5">
              <li>
                <strong>Session cookies (relační):</strong> jsou platné pouze po dobu trvání
                relace prohlížeče; jsou automaticky smazány při zavření prohlížeče.
              </li>
              <li>
                <strong>Persistentní cookies:</strong> zůstávají v zařízení po pevně stanovenou
                dobu (viz tabulka výše), i po zavření prohlížeče, dokud nevyprší jejich platnost
                nebo dokud je ručně nesmaže uživatel.
              </li>
            </ul>
          </section>

          {/* 6. Kontakt */}
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">6. Kontakt</h2>
            <p>
              V případě dotazů k těmto zásadám cookies nebo k zpracování osobních údajů nás
              kontaktujte:
            </p>
            <ul className="mt-3 space-y-1 list-none pl-0">
              <li>
                <strong>E-mail:</strong>{' '}
                <a href="mailto:it@sazejchytre.cz" className="underline">
                  it@sazejchytre.cz
                </a>
              </li>
              <li>
                <strong>Poštovní adresa:</strong> [NÁZEV SPOLEČNOSTI], [ADRESA]
              </li>
            </ul>
            <p className="mt-3">
              Tyto zásady jsou platné a účinné od <strong>13. 5. 2025</strong>.
            </p>
          </section>
        </LegalPage>
      </main>
      <Footer />
    </>
  )
}
