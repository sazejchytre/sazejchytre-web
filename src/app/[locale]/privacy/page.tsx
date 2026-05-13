import type { Metadata } from 'next'
import { Navbar } from '@/components/layout/navbar'
import { Footer } from '@/components/layout/footer'
import { LegalPage } from '@/components/layout/legal-page'
import { AlertTriangle } from 'lucide-react'

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Ochrana osobních údajů (GDPR) | SázejChytře',
    description:
      'Zásady ochrany osobních údajů platformy SázejChytře v souladu s GDPR.',
  }
}

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  return (
    <>
      <Navbar locale={locale} />
      <main>
        <LegalPage title="Zásady ochrany osobních údajů" lastUpdated="13. 5. 2025">
          {/* Lawyer review disclaimer */}
          <div className="rounded-lg border border-yellow-400/30 bg-yellow-400/8 p-4 text-sm mb-8 text-forest flex gap-3">
            <AlertTriangle className="h-4 w-4 text-yellow-400 shrink-0 mt-0.5" />
            <p>
              <strong className="text-yellow-400">Upozornění:</strong> Tento dokument je šablonou
              připravenou pro účely platformy SázejChytře. Před ostrým provozem doporučujeme
              nechat dokument přezkoumat kvalifikovaným právníkem nebo pověřencem pro ochranu
              osobních údajů (DPO), zejména s ohledem na nařízení GDPR a zákon č. 110/2019 Sb.
            </p>
          </div>

          {/* 1. Správce osobních údajů */}
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              1. Správce osobních údajů
            </h2>
            <p>
              Správcem osobních údajů ve smyslu čl. 4 odst. 7 nařízení Evropského parlamentu a
              Rady (EU) 2016/679 (dále jen <strong>„GDPR"</strong>) je:
            </p>
            <ul className="mt-3 space-y-1 list-none pl-0">
              <li>
                <strong>Obchodní firma:</strong> [NÁZEV SPOLEČNOSTI]
              </li>
              <li>
                <strong>IČO:</strong> [IČO]
              </li>
              <li>
                <strong>Sídlo:</strong> [ADRESA]
              </li>
              <li>
                <strong>E-mail správce / DPO kontakt:</strong>{' '}
                <a href="mailto:it@sazejchytre.cz" className="underline">
                  it@sazejchytre.cz
                </a>
              </li>
            </ul>
            <p className="mt-3">
              (dále jen <strong>„Správce"</strong>)
            </p>
          </section>

          {/* 2. Jaké údaje zpracováváme */}
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              2. Kategorie zpracovávaných osobních údajů
            </h2>
            <p>V závislosti na způsobu využívání platformy zpracováváme tyto kategorie údajů:</p>
            <ul className="mt-3 space-y-2 list-disc pl-5">
              <li>
                <strong>Identifikační a kontaktní údaje:</strong> e-mailová adresa, jméno a
                příjmení (pokud je poskytnuto).
              </li>
              <li>
                <strong>Autentizační údaje:</strong> hashed heslo nebo token třetí strany (OAuth),
                datum a čas posledního přihlášení, bezpečnostní tokeny.
              </li>
              <li>
                <strong>Platební metadata:</strong> identifikátor zákazníka a předplatného v
                systému Stripe, stav předplatného, datum obnovy. Čísla platebních karet{' '}
                <strong>nejsou</strong> Správcem ukládána; zpracovává je výhradně Stripe.
              </li>
              <li>
                <strong>Technické a provozní údaje:</strong> IP adresa, typ a verze prohlížeče,
                operační systém, referrer URL, datum a čas přístupu ke službě (logy).
              </li>
              <li>
                <strong>Údaje o využívání služby:</strong> přehled zobrazených tipů, nastavení
                účtu, preference notifikací.
              </li>
              <li>
                <strong>Cookies a obdobné technologie:</strong> viz samostatné{' '}
                <a href="/cs/cookies" className="underline">
                  Zásady cookies
                </a>
                .
              </li>
            </ul>
            <p className="mt-3">
              Správce nezpracovává zvláštní kategorie osobních údajů ve smyslu čl. 9 GDPR (např.
              zdravotní údaje, biometrické údaje, údaje o rasovém nebo etnickém původu).
            </p>
          </section>

          {/* 3. Právní základ zpracování */}
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              3. Právní základ zpracování
            </h2>
            <ul className="space-y-3 list-none pl-0">
              <li>
                <strong>Plnění smlouvy (čl. 6 odst. 1 písm. b) GDPR):</strong> zpracování
                nezbytné pro registraci, správu účtu, poskytování předplaceného obsahu a
                fakturaci.
              </li>
              <li>
                <strong>Oprávněný zájem (čl. 6 odst. 1 písm. f) GDPR):</strong> zajištění
                bezpečnosti platformy, prevence podvodů, vedení provozních logů a analytika za
                účelem zlepšování služeb. Správce provedl test proporcionality a konstatuje, že
                oprávněné zájmy nepřevažují nad právy subjektů údajů.
              </li>
              <li>
                <strong>Plnění právní povinnosti (čl. 6 odst. 1 písm. c) GDPR):</strong>{' '}
                uchování fakturačních a účetních dokladů v rozsahu a po dobu stanovenou zákonem č.
                563/1991 Sb., o účetnictví.
              </li>
              <li>
                <strong>Souhlas (čl. 6 odst. 1 písm. a) GDPR):</strong> zasílání obchodních
                sdělení a marketingových e-mailů; souhlas je dobrovolný a lze jej kdykoli odvolat.
              </li>
            </ul>
          </section>

          {/* 4. Účely zpracování */}
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">4. Účely zpracování</h2>
            <ul className="space-y-2 list-disc pl-5">
              <li>Registrace a správa uživatelského účtu.</li>
              <li>Poskytování placeného digitálního obsahu (tipů a analýz).</li>
              <li>Zpracování plateb a správa předplatného.</li>
              <li>
                Zasílání transakčních e-mailů (potvrzení registrace, faktury, upozornění na
                platbu).
              </li>
              <li>Zajištění bezpečnosti platformy a prevence podvodného jednání.</li>
              <li>Plnění zákonných povinností (účetnictví, daňové záznamy).</li>
              <li>
                Analytika a zlepšování uživatelského zážitku (na základě oprávněného zájmu nebo
                souhlasu).
              </li>
              <li>
                Zasílání obchodních sdělení a novinek (pouze se souhlasem subjektu údajů).
              </li>
            </ul>
          </section>

          {/* 5. Příjemci údajů */}
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              5. Příjemci a zpracovatelé osobních údajů
            </h2>
            <p>
              Za účelem provozu platformy mohou být osobní údaje předány těmto zpracovatelům:
            </p>
            <div className="mt-4 space-y-4">
              <div className="rounded-md border border-border p-4">
                <p className="font-semibold text-foreground mb-1">
                  Supabase, Inc. (PostgreSQL databáze &amp; autentizace)
                </p>
                <p>
                  Sídlo: USA; data hostována na serverech v regionu EU (eu-central-1 / Evropská
                  unie). Zpracovávané údaje: uživatelské profily, autentizační tokeny, data o
                  předplatném. Právní základ přenosu: standardní smluvní doložky (SCC) dle čl. 46
                  GDPR.
                </p>
              </div>
              <div className="rounded-md border border-border p-4">
                <p className="font-semibold text-foreground mb-1">
                  Stripe Payments Europe, Limited (platební brána)
                </p>
                <p>
                  Sídlo: Irsko (EU). Zpracovávané údaje: platební metadata, identifikátor
                  zákazníka, stav předplatného. Stripe je certifikován dle PCI DSS Level 1.
                  Přenos v rámci EU/EHP.
                </p>
              </div>
              <div className="rounded-md border border-border p-4">
                <p className="font-semibold text-foreground mb-1">
                  Vercel, Inc. (hosting &amp; CDN)
                </p>
                <p>
                  Sídlo: USA; data hostována na serverech v regionu EU. Zpracovávané údaje:
                  provozní logy, IP adresy v rámci standardního HTTP provozu. Právní základ
                  přenosu: SCC dle čl. 46 GDPR, serverless funkce v EU regionu.
                </p>
              </div>
              <div className="rounded-md border border-border p-4">
                <p className="font-semibold text-foreground mb-1">
                  Google Analytics (analytika) – volitelné
                </p>
                <p>
                  Je-li aktivováno, jsou anonymizované údaje o návštěvnosti předávány společnosti
                  Google LLC (USA). Přenos je pokryt SCC a rozhodnutím o přiměřenosti. Shromažďování
                  analytických dat probíhá pouze se souhlasem uděleným v cookie banneru.
                </p>
              </div>
            </div>
            <p className="mt-4">
              Správce uzavřel se všemi zpracovateli smlouvy o zpracování osobních údajů (DPA) v
              souladu s čl. 28 GDPR. Osobní údaje nejsou prodávány třetím stranám.
            </p>
          </section>

          {/* 6. Doba uchovávání */}
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              6. Doba uchovávání osobních údajů
            </h2>
            <ul className="space-y-2 list-disc pl-5">
              <li>
                <strong>Fakturační a účetní doklady:</strong> 10 let od konce zdaňovacího období
                (v souladu se zákonem o účetnictví a zákonem o DPH).
              </li>
              <li>
                <strong>Uživatelský profil a data předplatného:</strong> po dobu trvání smluvního
                vztahu; po zrušení účtu jsou data uchována ještě po dobu 3 let pro případ
                uplatnění právních nároků, poté jsou bezpečně smazána.
              </li>
              <li>
                <strong>Provozní logy (IP adresy, přístupy):</strong> maximálně 12 měsíců.
              </li>
              <li>
                <strong>Marketingové souhlasy:</strong> do odvolání souhlasu; záznamy o souhlasech
                jsou uchovávány ještě 3 roky po jejich odvolání jako důkaz zákonného zpracování.
              </li>
            </ul>
          </section>

          {/* 7. Práva subjektů */}
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              7. Vaše práva jako subjektu údajů
            </h2>
            <p>V souladu s GDPR máte právo:</p>
            <ul className="mt-3 space-y-2 list-disc pl-5">
              <li>
                <strong>Právo na přístup (čl. 15):</strong> získat potvrzení o tom, zda jsou vaše
                osobní údaje zpracovávány, a přístup k těmto údajům.
              </li>
              <li>
                <strong>Právo na opravu (čl. 16):</strong> požadovat opravu nepřesných nebo
                doplnění neúplných osobních údajů.
              </li>
              <li>
                <strong>Právo na výmaz – „právo být zapomenut" (čl. 17):</strong> požadovat
                smazání osobních údajů, splňuje-li žádost zákonné podmínky.
              </li>
              <li>
                <strong>Právo na omezení zpracování (čl. 18):</strong> požadovat dočasné omezení
                zpracování v zákonem stanovených případech.
              </li>
              <li>
                <strong>Právo na přenositelnost (čl. 20):</strong> obdržet osobní údaje v
                strukturovaném, strojově čitelném formátu a předat je jinému správci.
              </li>
              <li>
                <strong>Právo vznést námitku (čl. 21):</strong> vznést námitku proti zpracování
                prováděnému na základě oprávněného zájmu nebo pro účely přímého marketingu.
              </li>
              <li>
                <strong>Právo odvolat souhlas:</strong> kdykoli odvolat souhlas se zpracováním
                (zasílání marketingových e-mailů), aniž by tím byla dotčena zákonnost dřívějšího
                zpracování.
              </li>
              <li>
                <strong>Právo podat stížnost:</strong> podat stížnost u dozorového úřadu, jímž
                je Úřad pro ochranu osobních údajů (ÚOOÚ), Pplk. Sochora 27, 170 00 Praha 7,{' '}
                <a href="https://www.uoou.cz" className="underline" target="_blank" rel="noopener noreferrer">
                  www.uoou.cz
                </a>
                .
              </li>
            </ul>
            <p className="mt-3">
              Svá práva uplatňujte prostřednictvím e-mailu{' '}
              <a href="mailto:it@sazejchytre.cz" className="underline">
                it@sazejchytre.cz
              </a>
              . Na vaši žádost odpovíme bez zbytečného odkladu, nejpozději do 30 dnů.
            </p>
          </section>

          {/* 8. Přenosy mimo EU */}
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              8. Předávání osobních údajů do třetích zemí
            </h2>
            <p>
              Osobní údaje mohou být předávány do Spojených států amerických v případě využití
              služeb Supabase, Inc. a Vercel, Inc. V obou případech jsou data hostována na
              serverech umístěných v Evropské unii a přenos probíhá na základě{' '}
              <strong>standardních smluvních doložek (SCC)</strong> schválených Evropskou komisí
              v souladu s čl. 46 odst. 2 písm. c) GDPR.
            </p>
            <p className="mt-3">
              Stripe Payments Europe, Limited je společnost se sídlem v Irsku, přenos dat v rámci
              EU/EHP tudíž nepodléhá zvláštním pravidlům pro předávání do třetích zemí.
            </p>
          </section>

          {/* 9. Zabezpečení */}
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              9. Zabezpečení osobních údajů
            </h2>
            <p>
              Správce přijal technická a organizační opatření k ochraně osobních údajů před
              neoprávněným přístupem, ztrátou nebo zničením, zejména:
            </p>
            <ul className="mt-3 space-y-2 list-disc pl-5">
              <li>
                šifrování přenosu dat prostřednictvím protokolu TLS (HTTPS) na všech endpointech,
              </li>
              <li>
                šifrování databáze v klidu (encryption at rest) ze strany Supabase,
              </li>
              <li>
                hashing hesel pomocí odolných algoritmů (bcrypt / Argon2) prostřednictvím
                Supabase Auth,
              </li>
              <li>
                přísná kontrola přístupu (RBAC) – k osobním údajům mají přístup pouze oprávněné
                osoby s prokazatelnou potřebou (need-to-know),
              </li>
              <li>
                pravidelné zálohy dat a monitorování bezpečnostních incidentů.
              </li>
            </ul>
            <p className="mt-3">
              V případě bezpečnostního incidentu zahrnujícího osobní údaje Správce splní svou
              ohlašovací povinnost vůči ÚOOÚ dle čl. 33 GDPR (do 72 hodin) a v případě vysokého
              rizika pro subjekty údajů i informuje dotčené osoby dle čl. 34 GDPR.
            </p>
          </section>

          {/* 10. Kontakt */}
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              10. Kontakt na správce a DPO
            </h2>
            <p>
              V případě dotazů nebo žádostí v oblasti ochrany osobních údajů nás kontaktujte:
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
              Tyto zásady jsou platné a účinné od <strong>13. 5. 2025</strong>. Správce si
              vyhrazuje právo je kdykoli aktualizovat; v případě podstatných změn budou subjekty
              údajů informovány e-mailem.
            </p>
          </section>
        </LegalPage>
      </main>
      <Footer />
    </>
  )
}
