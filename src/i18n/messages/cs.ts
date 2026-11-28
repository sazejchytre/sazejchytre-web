/* ===========================================================================
   THE COPY RULES. READ BEFORE CHANGING ANY STRING IN THIS FILE.
   ---------------------------------------------------------------------------
   These are LEGAL CONSTRAINTS, not style preferences. Stripe has put them to
   us in writing, and breaking one risks the payment account the whole
   business runs on. Every one of them is also the kind of thing that reads
   like an improvement to somebody writing marketing copy, which is why they
   are written down here rather than remembered.

   1. NEVER AN IMPERATIVE TO PLACE A BET.
      No "VSADIT", no "SÁZEJ", no "HRAJ", on any button, heading or link. The
      product takes no bets and never touches a stake. A button says what the
      CONTROL does:
          Zobrazit tip · Celá analýza · Odemknout tipy · Získat přístup
      The brand name contains "Sázej", and that is a name, not an instruction.

   2. NEVER PROMISE WINNINGS, PROFIT OR A RESULT.
      Not "vyděláte", not "zaručený zisk", not "ziskové tipy", not a past
      return presented as a future one. The tagline is exactly:
          Méně tipů, víc analýzy
      Historical figures may be stated as history, on a page that shows the
      losses too.

   3. NEVER COMPARE BOOKMAKERS BY NAME OR LOGO.
      No odds table with Tipsport or Fortuna in it, no "best price at…". A
      recommended MINIMUM odds figure is all that may appear, because that is
      a property of the analysis rather than an advertisement for a bookmaker.

   4. CZECH WITH CORRECT DIACRITICS, AND ACTIONS IN SENTENCE CASE.
      "Získat přístup", never "Ziskat pristup". Buttons, links and headings
      are written in sentence case (DESIGN.md rule 70): a capital on the
      first word only, no ALL CAPS. Case is never changed with CSS
      `text-transform` anywhere in this codebase — the text on screen is
      the text in this file, diacritics included, so nothing a stylesheet
      does can drop a háček. Abbreviations (ROI, IČO, DPH) keep their
      capitals.

   5. EVERY PAGE CARRIES THREE THINGS.
      An 18+ marker, a one-line statement that this is an informational and
      analytical service, and the problem-gambling help line
      (Národní linka pro odvykání, 800 350 000). They are permanent
      furniture — quiet, always present, never a dismissible banner. A
      warning the reader can close is a warning the reader closes.

   If a string here starts to feel like it is selling an outcome, it is
   breaking rule 2 and the fix is to describe the analysis instead.
   =========================================================================== */

/**
 * The Czech catalogue.
 *
 * A TypeScript module rather than JSON so the rules above can sit next to the
 * strings they govern. JSON cannot hold a comment, and a rules file nobody
 * opens is a rules file nobody follows.
 *
 * Structure mirrors the routes, with `common` for anything that appears on
 * more than one page. Entity data — tips, results, prices — never appears
 * here; it comes from the database.
 */
export const cs = {
  common: {
    brand: 'Sázej chytře',
    /** RULE 2: the tagline, exactly. No outcome in it. */
    tagline: 'Méně tipů, víc analýzy',
    /** RULE 5: the one-line service statement. */
    serviceStatement:
      'Informační a analytická služba o sportu. Nepřijímáme sázky a neprovozujeme hazardní hru.',
    ageMarker: '18+',
    ageMarkerLong: 'Obsah je určen osobám od 18 let.',
    helpline: {
      name: 'Národní linka pro odvykání',
      phone: '800 350 000',
      /** RULE 5: calm, factual, permanent. */
      lead: 'Máte problém s hazardem?',
      href: 'tel:800350000',
    },
    skipToContent: 'Přejít na obsah',
    loading: 'Načítání…',
    /** Shown where a mascot illustration will go. Not a character. */
    mascotPlaceholder: 'Zde bude ilustrace. Maskot se připravuje.',
    nav: {
      home: 'Úvod',
      history: 'Historie',
      pricing: 'Ceník',
      contact: 'Kontakt',
      signIn: 'Přihlásit se',
      account: 'Můj účet',
      /**
       * The landmark label, not a button label.
       *
       * There is no menu button: four links wrap onto a second row on a
       * narrow screen rather than hiding behind a hamburger. So the strings
       * this used to hold — "Otevřít navigaci" / "Zavřít navigaci" — were
       * removed rather than left for a control that does not exist.
       */
      label: 'Hlavní navigace',
    },
    footer: {
      operatorHeading: 'Provozovatel',
      legalHeading: 'Dokumenty',
      contactHeading: 'Kontakt',
      responsibleHeading: 'Odpovědná hra',
      terms: 'Obchodní podmínky',
      privacy: 'Ochrana osobních údajů',
      cookies: 'Cookies',
      methodology: 'Metodika',
      /** Rendered only outside production while operator.ts is placeholders. */
      operatorPlaceholderWarning:
        'POZOR: identita provozovatele je zástupná. V produkci se web odmítne spustit, dokud nebude doplněna.',
      ico: 'IČO',
      registry: 'Zapsáno',
      vatNote: 'Nejsme plátci DPH.',
      newsletterHeading: 'Novinky',
    },
    result: {
      won: 'Vyhráno',
      lost: 'Prohráno',
      void: 'Zrušeno',
      pending: 'Čeká na výsledek',
    },
    /** Column and figure labels. Reused by the table and the cards. */
    metrics: {
      roi: 'ROI',
      roiLong: 'Návratnost (ROI)',
      profit: 'Zisk',
      staked: 'Vsazeno',
      /**
       * The caveat travels with the figure.
       *
       * The staked total is the ROI denominator, which excludes void tips —
       * so it is smaller than the sum of the stake column in the table. A
       * reader doing the arithmetic by hand needs to meet this sentence
       * before they conclude the ROI is wrong.
       */
      stakedNote: 'Bez zrušených tipů — sázka se u nich vrátila.',
      settled: 'Vyhodnocených tipů',
      won: 'Vyhraných',
      lost: 'Prohraných',
      void: 'Zrušených',
      averageOdds: 'Průměrný kurz',
      sampleSize: 'Velikost vzorku',
      units: 'jednotek',
      unitsShort: 'j.',
    },
  },

  home: {
    metaTitle: 'Analýzy sportovních zápasů',
    metaDescription:
      'Méně tipů, víc analýzy. Sledujte veřejnou historii všech vyhodnocených tipů včetně proher.',
    hero: {
      /** RULE 2: describes the work, not a result. */
      heading: 'Méně tipů, víc analýzy',
      body: 'Každý tip má napsaný rozbor: proč zápas, proč tento kurz a proč tato velikost sázky. Žádné desítky tipů denně.',
      /** RULE 1: what the control does. */
      primaryCta: 'Zobrazit historii',
      secondaryCta: 'Získat přístup',
    },
    record: {
      heading: 'Veřejná historie',
      /** The loss count is shown as prominently as the ROI. Deliberate. */
      body: 'Všechny vyhodnocené tipy, včetně proher. Nic nemažeme a nic neskrýváme.',
      cta: 'Celá historie',
      empty:
        'Zatím nemáme vyhodnocený ani jeden tip. Až budeme mít, najdete tu všechny — i ty prohrané.',
    },
    freeTip: {
      heading: 'Včerejší tip zdarma',
      /** Honest about the delay. The tip is real, just late. */
      delayNotice:
        'Tento tip zveřejňujeme se zpožděním 24 hodin. Předplatitelé ho měli před výkopem.',
      none: 'Včera jsme žádný tip nezveřejnili.',
      cta: 'Celá analýza',
    },
    howItWorks: {
      heading: 'Jak to funguje',
      steps: [
        {
          title: 'Vybereme zápas',
          body: 'Projdeme program a vybereme jen zápasy, kde máme k čemu se vyjádřit. Většinu dní to znamená jeden tip, někdy žádný.',
        },
        {
          title: 'Napíšeme rozbor',
          body: 'Forma, sestavy, kontext zápasu a doporučený minimální kurz. Vždy i to, co může rozbor vyvrátit.',
        },
        {
          title: 'Vyhodnotíme veřejně',
          body: 'Výsledek se zapíše do historie a už se nemění. Prohry zůstávají vidět stejně jako výhry.',
        },
      ],
    },
    tiers: {
      heading: 'Předplatné',
      body: 'Zrušíte kdykoli. Platba kartou.',
      cta: 'Získat přístup',
      recommended: 'Doporučujeme',
    },
    faq: {
      heading: 'Časté dotazy',
    },
  },

  history: {
    metaTitle: 'Historie tipů',
    metaDescription:
      'Všechny vyhodnocené tipy včetně proher, s kumulativním ziskem a propady. Metodika výpočtu ROI je popsaná na stránce.',
    heading: 'Historie tipů',
    figuresHeading: 'Čísla za celou historii',
    lead: 'Každý vyhodnocený tip, jak byl zveřejněn. Řazení a filtry nic neskrývají — prohry z výběru vypadnout nemohou.',
    sampleSize: 'Vzorek: {count} vyhodnocených tipů',
    asOf: 'Stav k {date}',
    chart: {
      heading: 'Kumulativní zisk',
      /** No smoothing, no cropping: the drawdowns are the point. */
      body: 'Bez vyhlazení a bez zkracování osy. Propady jsou vidět tak, jak nastaly.',
      drawdownLabel: 'Největší propad',
      emptyLabel: 'Graf se zobrazí, až bude vyhodnocený alespoň jeden tip.',
      axisProfit: 'Zisk (jednotky)',
      axisTip: 'Tip č.',
    },
    table: {
      heading: 'Všechny tipy',
      caption:
        'Vyhodnocené tipy od nejnovějšího. Kliknutím na hlavičku změníte řazení.',
      columns: {
        date: 'Datum',
        sport: 'Sport',
        event: 'Zápas',
        selection: 'Tip',
        odds: 'Kurz',
        stake: 'Sázka',
        result: 'Výsledek',
        profit: 'Zisk',
        cumulative: 'Kumulativně',
      },
      sortAscending: 'Řadit vzestupně',
      sortDescending: 'Řadit sestupně',
      empty: 'Pro zvolený filtr nejsou žádné tipy.',
      /** Shown when a filter is active, so the full sample is never hidden. */
      filteredNotice:
        'Zobrazujete {shown} z {total} tipů. Filtr mění jen výběr, ne čísla u jednotlivých tipů.',
    },
    filters: {
      heading: 'Filtr',
      sport: 'Sport',
      allSports: 'Všechny sporty',
      from: 'Od',
      to: 'Do',
      apply: 'Použít filtr',
      reset: 'Zrušit filtr',
      /** There is deliberately no "result" filter. See the page component. */
      noResultFilterNote:
        'Filtrovat podle výsledku nejde záměrně: historie, ze které lze odfiltrovat prohry, nedokazuje nic.',
    },
    methodology: {
      heading: 'Jak počítáme ROI',
      body: 'ROI = zisk ÷ vsazeno. Zisk i sázky vedeme v jednotkách, ne v korunách, aby čísla nezávisela na velikosti vašeho banku.',
      /** TASK 0: the void rule, stated in plain words. */
      voidRule:
        'Zrušené tipy (void) do ROI nevstupují vůbec — ani do zisku, ani do vsazené částky. Sázka se u nich vrací, takže nebyla v riziku. V historii zůstávají vidět a mají vlastní počet.',
      voidLegNote:
        'Zrušená část složeného tipu je něco jiného: takový tip se vyhodnotil, peníze v riziku byly, a do ROI se počítá celý.',
      rounding:
        'Zaokrouhlujeme jednou, na konci, od nuly. Mezivýsledky vedeme v celých číslech, aby se stejná historie vždy spočítala stejně.',
      cta: 'Celá metodika',
    },
  },

  tip: {
    metaDescriptionDelayed:
      'Archivní analýza zápasu, zveřejněná se zpožděním 24 hodin.',
    delayedBanner:
      'Archivní tip. Zveřejněno se zpožděním 24 hodin po výkopu — předplatitelé ho měli včas.',
    lockedBanner: 'Tento tip je pro předplatitele.',
    publishedAt: 'Zveřejněno',
    kickoff: 'Výkop',
    minimumOdds: 'Doporučený minimální kurz',
    stake: 'Doporučená sázka',
    /** RULE 3: a minimum figure only, no bookmaker named. */
    minimumOddsNote:
      'Doporučený minimální kurz. Nedoporučujeme konkrétní sázkovou kancelář a nesrovnáváme kurzy.',
    analysisHeading: 'Rozbor',
    resultHeading: 'Výsledek',
    /** A settled tip's result is public in EVERY state, losses included. */
    resultAlwaysPublic:
      'Výsledek zveřejňujeme u každého vyhodnoceného tipu, bez ohledu na to, jak vyšel.',
    locked: {
      heading: 'Co je za předplatným',
      /** Structure shown, decisive values withheld. Never blurred text. */
      body: 'Níže je skutečná struktura tipu. Chybí jen hodnoty, které rozhodují.',
      items: [
        'Vybraný tip a doporučený minimální kurz',
        'Doporučená velikost sázky',
        'Celý rozbor včetně toho, co ho může vyvrátit',
        'Zveřejnění před výkopem, ne po něm',
      ],
      withheld: 'Pro předplatitele',
      cta: 'Odemknout tipy',
    },
    notFound: {
      heading: 'Tip jsme nenašli',
      body: 'Odkaz může být starý, nebo tip nikdy nebyl zveřejněný.',
      cta: 'Zobrazit historii',
    },
    selectionsHeading: 'Co je v tipu',
    eventHeading: 'Zápas',
    selectionColumn: 'Tip',
    /** Named with its moment: the record is computed from this figure. */
    oddsColumn: 'Kurz při zveřejnění',
    minOddsColumn: 'Min. kurz',
    stakeColumn: 'Sázka',
    backToHistory: 'Zpět do historie',
    legs: 'Počet částí',
    combinedOdds: 'Celkový kurz',
  },

  pricing: {
    metaTitle: 'Ceník',
    metaDescription:
      'Tři varianty předplatného. Měsíčně nebo ročně, zrušíte kdykoli.',
    heading: 'Ceník',
    lead: 'Zrušíte kdykoli. Bez automatického navyšování ceny.',
    monthly: 'Měsíčně',
    yearly: 'Ročně',
    /** The yearly saving, stated honestly as a computed figure. */
    yearlySaving: 'Ušetříte {amount} za rok',
    yearlyEquivalent: 'Odpovídá {amount} měsíčně',
    perMonth: '/ měsíc',
    perYear: '/ rok',
    recommended: 'Doporučujeme',
    /** RULE 1: what the control does, not an instruction to bet. */
    cta: 'Získat přístup',
    featuresHeading: 'Co je v předplatném',
    empty: 'Ceník se připravuje.',
    unavailable: 'Cenu pro tuhle variantu zrovna nemáme nastavenou.',
    vatNote: 'Ceny jsou konečné. Nejsme plátci DPH.',
    /**
     * One label per feature key in `src/lib/billing/constants.ts`.
     *
     * Czech words for machine codes, kept here rather than in the database so
     * the copy-rule test can see them: a feature called "Ziskové tipy" would
     * be rule 2 broken by a dropdown in an admin panel.
     */
    features: {
      TIPS_REALTIME: 'Tipy hned při zveřejnění, ne se zpožděním',
      TIPS_ALL_SPORTS: 'Všechny sporty, které pokrýváme',
      FULL_RATIONALE: 'Celý rozbor včetně protiargumentů',
      VALUE_RATING: 'Hodnocení kurzu proti našemu modelu',
      PUSH_NOTIFICATIONS: 'Upozornění na nový tip',
      ARCHIVE_EXPORT: 'Export celé historie do CSV',
      API_ACCESS: 'Přístup k API',
      EARLY_ACCESS: 'Novinky dřív než ostatní',
    },
    /** The stub route step 7 replaces with the real checkout. */
    checkoutStub: {
      metaTitle: 'Předplatné',
      heading: 'Platbu ještě nemáme zapnutou',
      body: 'Objednávání předplatného připravujeme. Napište nám a dáme vám vědět, až to půjde.',
      cta: 'Na kontakt',
    },
  },

  contact: {
    metaTitle: 'Kontakt',
    metaDescription: 'Napište nám. Odpovídáme obvykle do dvou pracovních dnů.',
    heading: 'Kontakt',
    lead: 'Odpovídáme obvykle do dvou pracovních dnů.',
    form: {
      name: 'Jméno',
      email: 'E-mail',
      subject: 'Předmět',
      message: 'Zpráva',
      submit: 'Odeslat zprávu',
      sending: 'Odesílám…',
      success:
        'Zprávu máme. Odpovíme na uvedený e-mail, obvykle do dvou pracovních dnů.',
      /** Shown with the direct address, so a failure is never a dead end. */
      failure:
        'Zprávu se nepodařilo odeslat. Napište nám prosím přímo na {email}.',
      rateLimited:
        'Zpráv je z vašeho připojení za krátkou dobu příliš mnoho. Zkuste to prosím později, nebo napište přímo na {email}.',
      turnstileFailed:
        'Nepodařilo se ověřit, že nejste robot. Zkuste prosím stránku znovu načíst.',
      required: 'Toto pole je povinné.',
      invalidEmail: 'Zadejte prosím platný e-mail.',
      tooLong: 'Zpráva je příliš dlouhá.',
      tooShort: 'Napište prosím aspoň jednu větu, ať víme, o co jde.',
    },
    directEmailHeading: 'Nebo přímo e-mailem',
  },

  newsletter: {
    heading: 'Novinky e-mailem',
    body: 'Jeden e-mail, když je co říct. Žádné tipy v e-mailu.',
    email: 'E-mail',
    submit: 'Přihlásit k novinkám',
    sending: 'Přihlašuji…',
    /** A separate, unticked consent. Its wording is recorded verbatim. */
    consent:
      'Souhlasím se zasíláním novinek na uvedený e-mail. Souhlas můžu kdykoli odvolat odkazem v každém e-mailu.',
    consentRequired: 'Bez souhlasu vás nemůžeme přihlásit.',
    required: 'Zadejte prosím e-mail.',
    invalidEmail: 'Zadejte prosím platný e-mail.',
    tooLong: 'Tahle adresa je příliš dlouhá.',
    tooShort: 'Zadejte prosím celý e-mail.',
    success: 'Hotovo. Potvrzení jsme poslali na váš e-mail.',
    failure: 'Přihlášení se nepodařilo. Zkuste to prosím později.',
    rateLimited: 'Příliš mnoho pokusů. Zkuste to prosím později.',
    turnstileFailed:
      'Nepodařilo se ověřit, že nejste robot. Zkuste prosím stránku znovu načíst.',
  },

  legal: {
    effectiveFrom: 'Účinné od {date}',
    version: 'Verze {version}',
    lastUpdated: 'Aktualizováno {date}',
    missing: {
      heading: 'Dokument se připravuje',
      body: 'Tento dokument ještě nebyl zveřejněn. Napište nám a pošleme vám ho e-mailem.',
    },
  },

  errors: {
    notFound: {
      metaTitle: 'Stránka nenalezena',
      heading: 'Tuhle stránku nemáme',
      body: 'Odkaz může být starý nebo překlepnutý. Zkuste historii tipů nebo úvodní stránku.',
      homeCta: 'Na úvod',
      historyCta: 'Zobrazit historii',
    },
    serverError: {
      metaTitle: 'Chyba serveru',
      heading: 'Něco se u nás pokazilo',
      body: 'Chybu jsme si zapsali a podíváme se na ni. Zkuste to prosím za chvíli znovu.',
      retryCta: 'Zkusit znovu',
      homeCta: 'Na úvod',
    },
    generic: {
      heading: 'Data se nepodařilo načíst',
      body: 'Zkuste to prosím za chvíli znovu.',
      retryCta: 'Zkusit znovu',
    },
  },
} as const

export type Messages = typeof cs
