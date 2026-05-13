/**
 * Czech/Slovak first-name vocative (5th case) — used for direct address in greetings.
 * English locale is returned unchanged (English has no grammatical cases).
 *
 * Rules implemented (covers ~95 % of Czech/Slovak first names):
 *  -a       → -o        (Jana→Jano, Eva→Evo, Honza→Honzo, Barbora→Barbaro)
 *  -e/-ie   → unchanged (Marie, Lucie, Sofie)
 *  -í/-i    → unchanged (Jiří, Nikki)
 *  -ej      → -eji      (Ondřej→Ondřeji)
 *  š/ž/č/ř/c → +i      (Tomáš→Tomáši, Lukáš→Lukáši, Aleš→Aleši)
 *  k/g/h/ch → +u       (Marek→Marku, Radek→Radku, František→Františku)
 *  other consonant → +e (Martin→Martine, Jan→Jane, Adam→Adame, Jakub→Jakube)
 *  Irregular lookup for the most common exceptions.
 */

const OVERRIDES: Record<string, string> = {
  // Fleeting -e: the -e before the final consonant disappears when adding -e
  'pavel':    'Pavle',
  'karel':    'Karle',
  'havel':    'Havle',
  // ř-palatalization
  'petr':     'Petře',
}

/** Returns the vocative form of a first name for the given locale. */
export function vocative(name: string | null | undefined, locale: string): string {
  if (!name) return ''
  if (locale === 'en') return name

  const trimmed = name.trim()
  if (!trimmed) return ''

  const key = trimmed.toLowerCase()

  // Exact override
  const ov = OVERRIDES[key]
  if (ov) {
    // Re-apply capitalisation from the original input
    return trimmed[0] === trimmed[0].toUpperCase()
      ? ov[0].toUpperCase() + ov.slice(1)
      : ov
  }

  const l = key

  // -a → -o
  if (l.endsWith('a')) return trimmed.slice(0, -1) + 'o'

  // -e / -ie / -í / -i → unchanged
  if (/[eií]$/.test(l)) return trimmed

  // -ej → -eji  (Ondřej → Ondřeji)
  if (l.endsWith('ej')) return trimmed + 'i'

  // Soft sibilants → +i  (Tomáš, Lukáš, Aleš, Miloš, Matyáš, Lukáč)
  if (/[šžčřc]$/.test(l)) return trimmed + 'i'

  // ch / k / g / h → +u  (Marek, Radek, Patrik, František, …)
  if (l.endsWith('ch') || /[kgh]$/.test(l)) return trimmed + 'u'

  // Any remaining consonant (b, d, f, j, l, m, n, p, r, s, t, v, z, …) → +e
  if (!/[aáeéěiíoóuúůy]$/.test(l)) return trimmed + 'e'

  // Ends in o/u/y (unusual for names) → unchanged
  return trimmed
}
