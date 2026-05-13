import type { Metadata } from 'next'
import { Navbar } from '@/components/layout/navbar'
import { Footer } from '@/components/layout/footer'
import { LegalPage } from '@/components/layout/legal-page'
import { AlertTriangle } from 'lucide-react'

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Obchodní podmínky | SázejChytře',
    description:
      'Obchodní podmínky platformy SázejChytře pro předplatné sázkových analýz a tipů.',
  }
}

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  return (
    <>
      <Navbar locale={locale} />
      <main>
        <LegalPage title="Obchodní podmínky" lastUpdated="13. 5. 2025">
          {/* Lawyer review disclaimer */}
          <div className="rounded-lg border border-yellow-400/30 bg-yellow-400/8 p-4 text-sm mb-8 text-forest flex gap-3">
            <AlertTriangle className="h-4 w-4 text-yellow-400 shrink-0 mt-0.5" />
            <p>
              <strong className="text-yellow-400">Upozornění:</strong> Tento dokument je šablonou
              připravenou pro účely platformy SázejChytře. Před ostrým provozem doporučujeme
              nechat dokument přezkoumat kvalifikovaným právníkem, zejména s ohledem na aktuální
              českou a evropskou legislativu.
            </p>
          </div>

          {/* 1. Identifikace provozovatele */}
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              1. Identifikace provozovatele
            </h2>
            <p>
              Provozovatelem platformy SázejChytře dostupné na adrese{' '}
              <strong>sazejchytre.cz</strong> je:
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
                <strong>E-mail:</strong>{' '}
                <a href="mailto:it@sazejchytre.cz" className="underline">
                  it@sazejchytre.cz
                </a>
              </li>
            </ul>
            <p className="mt-3">
              (dále jen <strong>&bdquo;Provozovatel&ldquo;</strong>)
            </p>
            <p className="mt-3">
              Tyto obchodní podmínky (dále jen <strong>&bdquo;OP&ldquo;</strong>) upravují práva a povinnosti
              mezi Provozovatelem a fyzickými osobami využívajícími platformu SázejChytře (dále jen{' '}
              <strong>&bdquo;Uživatel&ldquo;</strong>). Právní vztah se řídí právním řádem České republiky,
              zejména zákonem č. 89/2012 Sb., občanský zákoník, ve znění pozdějších předpisů.
            </p>
          </section>

          {/* 2. Předmět smlouvy */}
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">2. Předmět smlouvy</h2>
            <p>
              Platforma SázejChytře poskytuje statistické analýzy, doporučení a tipy v oblasti
              sportovního sázení (dále jen <strong>&bdquo;Tipy&ldquo;</strong>). Veškerý obsah platformy má
              výhradně{' '}
              <strong>poradní a informační charakter</strong> a nepředstavuje nabídku ani zprostředkování
              sázkových příležitostí, hazardní hru ve smyslu zákona č. 186/2016 Sb., o hazardních
              hrách, ani žádnou formu investičního poradenství.
            </p>
            <p className="mt-3">
              Provozovatel <strong>není</strong> licencovaným provozovatelem hazardních her,
              sázkovou kanceláří ani zprostředkovatelem sázek. Provozovatel{' '}
              <strong>nezaručuje</strong> správnost jednotlivých tipů ani výnos z jejich využití.
              Výsledky minulých tipů nejsou zárukou výsledků budoucích.
            </p>
            <p className="mt-3">
              Předmětem smlouvy uzavřené mezi Provozovatelem a Uživatelem je přístup k digitálnímu
              obsahu platformy dle zvoleného předplatného.
            </p>
          </section>

          {/* 3. Registrace a podmínky */}
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              3. Registrace a podmínky přístupu
            </h2>
            <p>
              Využívání placených funkcí platformy vyžaduje registraci a vytvoření uživatelského
              účtu. Registrací Uživatel prohlašuje a zaručuje, že:
            </p>
            <ul className="mt-3 space-y-2 list-disc pl-5">
              <li>
                je fyzickou osobou starší <strong>18 let</strong>; přístup osobám mladším 18 let je
                přísně zakázán,
              </li>
              <li>
                veškeré údaje uvedené při registraci jsou pravdivé, úplné a aktuální; Uživatel je
                povinen tyto údaje neprodleně aktualizovat v případě změny,
              </li>
              <li>
                není osobou, které byl na území České republiky nebo jiné jurisdikce zakázán přístup
                k hazardním hrám nebo příbuzným službám,
              </li>
              <li>
                bere na vědomí, že sázení je rizikovou aktivitou, a využívá platformu výhradně na
                vlastní odpovědnost.
              </li>
            </ul>
            <p className="mt-3">
              Uživatel je povinen chránit své přihlašovací údaje před zneužitím. Za veškeré
              aktivity provedené prostřednictvím jeho účtu nese odpovědnost Uživatel.
              Provozovatel si vyhrazuje právo zrušit účet, u nějž existuje důvodné podezření z
              porušení těchto OP nebo aplikovatelných právních předpisů.
            </p>
          </section>

          {/* 4. Předplatné a platby */}
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              4. Předplatné a platby
            </h2>
            <p>
              Platforma nabízí následující předplatné plány:
            </p>
            <ul className="mt-3 space-y-2 list-disc pl-5">
              <li>
                <strong>FREE</strong> – bezplatný přístup k základnímu obsahu, bez poplatku.
              </li>
              <li>
                <strong>START</strong> – 749 Kč / měsíc.
              </li>
              <li>
                <strong>SMART</strong> – 1 290 Kč / měsíc.
              </li>
              <li>
                <strong>ELITE</strong> – 1 990 Kč / měsíc.
              </li>
            </ul>
            <p className="mt-3">
              Všechny ceny jsou uvedeny včetně příslušné daně z přidané hodnoty (DPH), je-li
              aplikovatelná.
            </p>
            <p className="mt-3">
              Předplatné se automaticky obnovuje vždy po uplynutí fakturačního období (jeden měsíc),
              pokud Uživatel předplatné včas nezruší. Platba za následující období je strhována k
              datu výročí přihlášení k odběru. Platby jsou zpracovávány prostřednictvím platební
              brány <strong>Stripe</strong> (Stripe Payments Europe, Limited, sídlem v Irsku).
              Provozovatel neukládá čísla platebních karet; veškeré platební údaje zpracovává
              výhradně Stripe v souladu se standardem PCI DSS.
            </p>
            <p className="mt-3">
              V případě neúspěšné platby bude Provozovatel Uživatele kontaktovat na e-mailovou
              adresu uvedenou při registraci. Nepodaří-li se platbu realizovat ani po opakovaných
              pokusech, může být přístup k placeným funkcím pozastaven.
            </p>
          </section>

          {/* 5. Právo na odstoupení */}
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              5. Právo na odstoupení od smlouvy
            </h2>
            <p>
              Uživatel má právo odstoupit od smlouvy uzavřené prostřednictvím platformy bez
              udání důvodu ve lhůtě <strong>14 dní</strong> ode dne uzavření smlouvy (tj. od
              aktivace předplatného), a to v souladu s § 1829 a násl. občanského zákoníku.
            </p>
            <p className="mt-3">
              Upozornění: Uživatel, který výslovně souhlasil s tím, aby bylo plnění zahájeno
              před uplynutím lhůty pro odstoupení od smlouvy,{' '}
              <strong>
                právo na odstoupení ztrácí okamžikem, kdy bylo digitální plnění plně poskytnuto
              </strong>{' '}
              (§ 1837 písm. l) OZ). Registrací a aktivací předplatného Uživatel bere na vědomí, že
              mu bude přístup k digitálnímu obsahu zpřístupněn ihned, a výslovně souhlasí s
              okamžitým zahájením plnění.
            </p>
            <p className="mt-3">
              Odstoupení od smlouvy je třeba zaslat písemně na adresu{' '}
              <a href="mailto:it@sazejchytre.cz" className="underline">
                it@sazejchytre.cz
              </a>{' '}
              s uvedením jména, e-mailu registrovaného účtu a prohlášení o odstoupení.
            </p>
          </section>

          {/* 6. Omezení odpovědnosti */}
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              6. Omezení odpovědnosti
            </h2>
            <p>
              Tipy a analýzy zveřejněné na platformě SázejChytře jsou výhradně poradního
              charakteru a nepředstavují záruky výher. Provozovatel zejména:
            </p>
            <ul className="mt-3 space-y-2 list-disc pl-5">
              <li>
                <strong>nenese odpovědnost za finanční ztráty</strong> vzniklé Uživateli v důsledku
                uzavření sázkových příležitostí na základě Tipů zveřejněných na platformě,
              </li>
              <li>
                negarantuje dostupnost, přesnost ani aktuálnost obsahu platformy,
              </li>
              <li>
                nenese odpovědnost za výpadky služby způsobené třetími stranami (poskytovateli
                hostingu, platebních bran apod.),
              </li>
              <li>
                nenese odpovědnost za přímé ani nepřímé škody vzniklé v důsledku využití nebo
                nevyužití informací z platformy.
              </li>
            </ul>
            <p className="mt-3">
              Celková maximální odpovědnost Provozovatele vůči Uživateli je omezena na výši
              předplatného zaplaceného Uživatelem za posledních 3 měsíce před vznikem škody. Toto
              omezení se neuplatní v případech, kdy odpovědnost nelze vyloučit nebo omezit ze
              zákona.
            </p>
          </section>

          {/* 7. Duševní vlastnictví */}
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              7. Duševní vlastnictví
            </h2>
            <p>
              Veškerý obsah platformy SázejChytře, včetně textů, analýz, tipů, grafiky, log,
              softwarového kódu a designu, je majetkem Provozovatele nebo mu byl řádně licencován a
              je chráněn autorským zákonem (zákon č. 121/2000 Sb.) a dalšími právními předpisy o
              duševním vlastnictví.
            </p>
            <p className="mt-3">
              Uživateli je udělena osobní, nepřenosná, nevýhradní licence k přístupu k obsahu
              platformy výhradně pro vlastní nekomerční potřebu. Jakékoli jiné užití obsahu bez
              předchozího písemného souhlasu Provozovatele je zakázáno.
            </p>
          </section>

          {/* 8. Zákaz šíření tipů */}
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              8. Zákaz sdílení a dalšího šíření obsahu
            </h2>
            <p>
              Uživatel není oprávněn obsah platformy, včetně jednotlivých tipů a analýz:
            </p>
            <ul className="mt-3 space-y-2 list-disc pl-5">
              <li>
                jakýmkoli způsobem dále šířit, reprodukovat, publikovat, zveřejňovat na sociálních
                sítích, fórech ani jiných veřejných kanálech,
              </li>
              <li>
                prodávat, pronajímat, sublicencovat ani jinak komerčně využívat,
              </li>
              <li>
                sdílet přihlašovací údaje ke svému účtu s třetími osobami za účelem umožnění
                přístupu k placeným funkcím.
              </li>
            </ul>
            <p className="mt-3">
              Porušení tohoto zákazu je podstatným porušením smlouvy a opravňuje Provozovatele
              okamžitě zrušit uživatelský účet bez nároku na náhradu uhrazeného předplatného.
              Provozovatel si vyhrazuje právo uplatnit vůči Uživateli náhradu škody v plné výši.
            </p>
          </section>

          {/* 9. Ukončení a zrušení předplatného */}
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              9. Ukončení předplatného a zrušení účtu
            </h2>
            <p>
              Uživatel může své předplatné kdykoli zrušit prostřednictvím zákaznického portálu
              (Billing Portal), přístupného ze svého uživatelského účtu. Zrušení nabývá účinnosti
              ke konci aktuálního fakturačního období; přístup k placeným funkcím zůstává aktivní
              do konce již uhrazeného období.
            </p>
            <p className="mt-3">
              Provozovatel je oprávněn zrušit uživatelský účet a ukončit smlouvu:
            </p>
            <ul className="mt-3 space-y-2 list-disc pl-5">
              <li>
                v případě závažného nebo opakovaného porušení těchto OP Uživatelem,
              </li>
              <li>
                při důvodném podezření z podvodného jednání nebo zneužití platformy,
              </li>
              <li>
                při ukončení provozu platformy (v takovém případě budou Uživatelé informováni
                nejméně 30 dní předem).
              </li>
            </ul>
            <p className="mt-3">
              Žádost o zrušení účtu lze rovněž zaslat na e-mail{' '}
              <a href="mailto:it@sazejchytre.cz" className="underline">
                it@sazejchytre.cz
              </a>
              .
            </p>
          </section>

          {/* 10. Závěrečná ustanovení */}
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              10. Závěrečná ustanovení
            </h2>
            <p>
              Tyto OP a veškeré smluvní vztahy mezi Provozovatelem a Uživatelem se řídí právním
              řádem České republiky. K rozhodování sporů jsou příslušné soudy České republiky,
              přičemž místně příslušným soudem je soud v místě sídla Provozovatele (Praha).
            </p>
            <p className="mt-3">
              Provozovatel si vyhrazuje právo tyto OP kdykoli změnit. O podstatných změnách bude
              Uživatel informován e-mailem nebo prostřednictvím platformy nejméně 14 dní před
              nabytím účinnosti změn. Pokračováním v užívání platformy po nabytí účinnosti změn
              Uživatel vyjadřuje souhlas s novým zněním OP.
            </p>
            <p className="mt-3">
              Tyto obchodní podmínky jsou platné a účinné od <strong>13. 5. 2025</strong>.
            </p>
            <p className="mt-3">
              V případě dotazů kontaktujte Provozovatele na{' '}
              <a href="mailto:it@sazejchytre.cz" className="underline">
                it@sazejchytre.cz
              </a>
              .
            </p>
          </section>
        </LegalPage>
      </main>
      <Footer />
    </>
  )
}
