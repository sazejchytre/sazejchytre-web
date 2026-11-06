/**
 * Seeds the editable content the public site needs in order to be itself:
 * the four FAQ entries and the site settings global.
 *
 * Run with:  pnpm seed:content
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS — AND WHY IT IS A SEED RATHER THAN A CONSTANT
 *
 * The homepage must answer four specific questions: how ROI is calculated,
 * what happens to void bets, whether this is gambling, and what a subscriber
 * actually gets. Those are not decoration — the first two are the methodology
 * the whole track record rests on, and the third is the one a regulator would
 * look for.
 *
 * They live in the database so the operator can reword them without a deploy,
 * which is the point of `faq-entries` existing at all. But "editable" is not
 * the same as "absent": until this ran, the section rendered empty and the
 * `FAQPage` structured data was null. Hard-coding them would have made the
 * collection pointless; seeding them makes the page correct on day one and
 * still editable on day two.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE ANSWERS REPEAT WHAT THE CODE DOES, NOT WHAT WE WISH IT DID
 *
 * The ROI answer and the void answer state the rule enforced in
 * `src/lib/tips/settlement.ts` and asserted in its tests. If one changes, the
 * other is wrong — so each answer here says the same thing as
 * `cs.history.methodology`, in a reader's words rather than a footnote's.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT IS DELIBERATELY NOT SEEDED
 *
 * The four legal documents. Their text has to be written and reviewed by a
 * person; a plausible-looking seeded "Obchodní podmínky" is worse than none,
 * because it would be published, consented to and recorded in a
 * `ConsentRecord` as the version the customer agreed to. The pages already
 * render a "document is being prepared" state with a link to contact us,
 * which is the honest answer until the real text exists.
 *
 * IDEMPOTENT: upserts by question text for the FAQ and updates the global in
 * place, so running it twice changes nothing.
 */
import { getPayload } from 'payload'

import config from '@/payload.config'

type FaqSeed = {
  question: string
  answer: string
  sortOrder: number
}

/**
 * The four the brief requires, in the order a reader asks them.
 *
 * Plain text, no markup: these answers go into `FAQPage` structured data,
 * where Google requires the text to match what the page shows. That is also
 * why the collection stores a textarea rather than rich text.
 */
const FAQ: FaqSeed[] = [
  {
    question: 'Jak počítáte ROI?',
    answer:
      'ROI je zisk dělený vsazenou částkou. Obojí vedeme v jednotkách, ne v korunách, ' +
      'aby čísla nezávisela na velikosti vašeho banku — jedna jednotka je u každého ' +
      'tipu stejně velká sázka. Zisk počítáme z kurzu v okamžiku zveřejnění a z ' +
      'doporučené výše sázky, celočíselně, a zaokrouhlujeme jednou na konci. Do ' +
      'výpočtu vstupují všechny vyhodnocené tipy včetně prohraných; žádný nevynecháváme.',
    sortOrder: 0,
  },
  {
    question: 'Co se stane se zrušeným tipem (void)?',
    answer:
      'Zrušený tip do ROI nevstupuje vůbec — ani do zisku, ani do vsazené částky. ' +
      'Sázka se u něj vrací, takže nebyla v riziku, a počítat ji jako vsazenou by ' +
      'návratnost umělě snižovalo. V historii zrušené tipy zůstávají vidět a mají ' +
      'vlastní počet, takže si můžete ověřit, kolik jich bylo. Pozor na rozdíl: ' +
      'zrušená část složeného tipu je něco jiného — takový tip se vyhodnotil, peníze ' +
      'v riziku byly, a do ROI se počítá celý.',
    sortOrder: 1,
  },
  {
    question: 'Je to hazard?',
    answer:
      'Ne. Poskytujeme informační a analytickou službu o sportu: píšeme rozbory ' +
      'zápasů. Nepřijímáme sázky, nejsme sázková kancelář a neprovozujeme ani ' +
      'nezprostředkováváme hazardní hru. Co s naší analýzou uděláte, je vaše ' +
      'rozhodnutí a vaše odpovědnost. Obsah je určen osobám od 18 let. Pokud máte ' +
      's hazardem problém, obraťte se na Národní linku pro odvykání, 800 350 000.',
    sortOrder: 2,
  },
  {
    question: 'Co dostanu jako předplatitel?',
    answer:
      'Tipy v okamžiku zveřejnění, ne se zpožděním — tedy před výkopem, ne po něm. ' +
      'K tomu celý rozbor: proč zápas, proč tento kurz, jaká je doporučená velikost ' +
      'sázky a co rozbor může vyvrátit. Doporučujeme minimální kurz, pod kterým už ' +
      'tip podle nás nemá smysl; konkrétní sázkovou kancelář nedoporučujeme a kurzy ' +
      'nesrovnáváme. Nezaručujeme žádný výsledek — historie na této stránce je ' +
      'historie, ne předpověď. Předplatné zrušíte kdykoli.',
    sortOrder: 3,
  },
]

const seedContent = async (): Promise<void> => {
  const payload = await getPayload({ config })

  payload.logger.info('Seeding FAQ entries…')

  for (const entry of FAQ) {
    const existing = await payload.find({
      collection: 'faq-entries',
      where: { question: { equals: entry.question } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })

    const data = { ...entry, published: true }

    if (existing.docs[0]) {
      await payload.update({
        collection: 'faq-entries',
        id: existing.docs[0].id,
        data,
        depth: 0,
        overrideAccess: true,
      })
      payload.logger.info(`  updated: ${entry.question}`)
    } else {
      await payload.create({
        collection: 'faq-entries',
        data,
        depth: 0,
        overrideAccess: true,
      })
      payload.logger.info(`  created: ${entry.question}`)
    }
  }

  /**
   * Site settings.
   *
   * The loader has a fallback for every field, so the site works without this
   * row — that fallback exists so a database outage cannot take the
   * help-line number off every page. Seeding it anyway means the operator
   * opens the admin panel and finds the real values to edit rather than an
   * empty form, and it exercises the cached read and the revalidation hook.
   *
   * No social links: only profiles that actually exist belong there, because
   * they are emitted as `sameAs` in the Organization structured data.
   */
  payload.logger.info('Seeding site settings…')

  await payload.updateGlobal({
    slug: 'site-settings',
    data: {
      contactEmail: 'podpora@sazejchytre.cz',
      helpline: {
        name: 'Národní linka pro odvykání',
        phone: '800 350 000',
        url: 'https://www.narodnilinka.cz/',
      },
    },
    depth: 0,
    overrideAccess: true,
  })

  payload.logger.info('Content seed complete.')
  payload.logger.info(
    'NOT seeded: the four legal documents. Their text needs a person — see ' +
      'the header of this file.',
  )
}

await seedContent()
process.exit(0)
