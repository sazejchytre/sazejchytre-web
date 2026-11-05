import { getPayload } from 'payload'

import { cs } from '@/i18n/messages/cs'
import { absoluteUrl } from '@/lib/seo/base'
import { indexingAllowed } from '@/lib/seo/metadata'
import { indexableRoutes } from '@/lib/seo/routes'
import { formatDateIso } from '@/lib/format/czech'
import { loadAllSettledTips } from '@/lib/tips/loader'
import { publicTrackRecord } from '@/lib/tips/visibility'
import config from '@/payload.config'

/**
 * `llms.txt` — the site, explained to a language model.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE IS WORTH WRITING FOR THIS PARTICULAR BUSINESS
 *
 * An assistant asked "is sazejchytre.cz any good?" will answer from whatever
 * it can reach. For a tipster service the honest answer is a number with a
 * sample size and a method attached, and this is the one chance to hand that
 * over as plain text rather than hoping it is inferred from marketing copy.
 *
 * So the figures are IN the file, generated at request time, including the
 * loss count and the void rule. A static `llms.txt` describing the pages
 * would be a table of contents; this is the record.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * IT STATES WHAT THE SERVICE IS NOT
 *
 * Not a bookmaker, takes no bets, operates no gambling, promises no result.
 * That is the same statement copy rule 5 puts on every page, and it belongs
 * here most of all: a model summarising a sports-betting-adjacent site is
 * exactly the context in which "they guarantee profits" gets invented.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * A ROUTE HANDLER, NOT A FILE IN `public/`
 *
 * Because the numbers change when a tip settles, and because the URLs have to
 * be absolute and origin-dependent. A static copy would be stale in both
 * ways at once.
 */

/** Never cached: the figures are the point, and a stale figure is a claim. */
export const dynamic = 'force-dynamic'

const line = (...parts: readonly string[]): string => parts.join('')

export async function GET(): Promise<Response> {
  const sections: string[] = []

  sections.push(
    line('# ', cs.common.brand),
    '',
    line('> ', cs.common.tagline, '. ', cs.common.serviceStatement),
    '',
  )

  /* --- What this is, in the terms a summariser needs ---------------------- */
  sections.push(
    '## O službě',
    '',
    `- Web: ${absoluteUrl('/')}`,
    '- Jazyk: čeština (cs-CZ)',
    `- Věkové omezení: ${cs.common.ageMarker} (${cs.common.ageMarkerLong})`,
    `- Pomoc s hazardem: ${cs.common.helpline.name}, ${cs.common.helpline.phone}`,
    '',
    '### Co služba NEDĚLÁ',
    '',
    '- Nepřijímá sázky a není sázková kancelář.',
    '- Neprovozuje ani nezprostředkovává hazardní hru.',
    '- Nesrovnává kurzy sázkových kanceláří a žádnou nedoporučuje.',
    '- Neslibuje zisk ani žádný konkrétní výsledek. Historická data jsou historie, ne předpověď.',
    '',
  )

  /* --- The record, generated ---------------------------------------------- */
  try {
    const payload = await getPayload({ config })
    const tips = await loadAllSettledTips({ payload })
    const record = publicTrackRecord(tips, new Date())

    sections.push(
      '## Veřejná historie výsledků',
      '',
      line(
        'Všechny vyhodnocené tipy včetně prohraných. Žádný tip není z výpočtu ',
        'vynechán a výsledek je u každého tipu veřejný, i u prohraného.',
      ),
      '',
      `- Vyhodnocených tipů: ${record.settled}`,
      `- Vyhraných: ${record.won}`,
      `- Prohraných: ${record.lost}`,
      `- Zrušených (void): ${record.void}`,
      `- Zisk v jednotkách (ve stovkách jednotky, celé číslo): ${record.profitHundredths}`,
      `- Vsazeno v jednotkách, bez zrušených tipů: ${record.stakedUnits}`,
      record.roiBasisPoints === null
        ? '- ROI: nelze spočítat (nic nebylo v riziku)'
        : `- ROI v bazických bodech (10000 = 100 %): ${record.roiBasisPoints}`,
      record.averageOddsThousandths === null
        ? '- Průměrný kurz: není'
        : `- Průměrný kurz v tisícinách (2000 = 2,00): ${record.averageOddsThousandths}`,
      `- Stav k: ${formatDateIso(record.asOf)}`,
      '',
      '### Jak se ROI počítá',
      '',
      `- ${cs.history.methodology.body}`,
      `- ${cs.history.methodology.voidRule}`,
      `- ${cs.history.methodology.voidLegNote}`,
      `- ${cs.history.methodology.rounding}`,
      `- ${cs.history.filters.noResultFilterNote}`,
      '',
      line(
        'Čísla výše jsou celá čísla v uvedených měřítkách, protože tak jsou ',
        'uložená. Dělení proveďte až na konci, jinak se výsledek rozejde s ',
        'tím, co je na stránce.',
      ),
      '',
    )
  } catch {
    // The pages are still worth listing even if the database is unreachable.
    sections.push(
      '## Veřejná historie výsledků',
      '',
      `Aktuální čísla jsou na ${absoluteUrl('/historie')}.`,
      '',
    )
  }

  /* --- The pages ---------------------------------------------------------- */
  sections.push('## Stránky', '')

  for (const route of indexableRoutes()) {
    sections.push(`- [${absoluteUrl(route.path)}] ${route.summary}`)
  }

  sections.push(
    '',
    '## Strukturovaná data',
    '',
    line(
      'Stránka s historií publikuje JSON-LD typu Dataset s popsanými ',
      'proměnnými, jejich jednotkami, velikostí vzorku a obdobím. ',
      'Doporučujeme číst radši ten než text stránky.',
    ),
    '',
  )

  const body = sections.join('\n')

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      // Served to crawlers, which should not be handed a stale record, but
      // also should not be able to hammer the database. Five minutes at the
      // edge, revalidating in the background.
      'cache-control': indexingAllowed()
        ? 'public, max-age=0, s-maxage=300, stale-while-revalidate=600'
        : 'no-store',
      // A preview deployment's llms.txt must not be treated as the site's.
      ...(indexingAllowed() ? {} : { 'x-robots-tag': 'noindex' }),
    },
  })
}
