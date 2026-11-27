/**
 * Strings the homepage PROTOTYPE needs that the catalogue does not have yet.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT IN `src/i18n/messages/cs.ts`
 *
 * Customer-facing Czech lives in `cs.ts` (AGENTS.md rule 15). This page is
 * not customer-facing — it answers 404 outside a development server — and
 * `cs.ts` is outside the SC-005 branch's file ownership. So the prototype
 * reads every string it can from the catalogue and keeps only two kinds
 * here:
 *
 *   1. SENTENCE-CASE versions of existing button labels. DESIGN.md rule 70
 *      replaces the catalogue's ALL CAPS buttons; `cs.ts` and its test still
 *      pin the uppercase forms, so the change is proposed in the PR as an
 *      exact diff rather than made here. The prototype shows the proposal.
 *   2. A few prototype-only sentences (the preview notice, the table
 *      caption, the small-sample warning).
 *
 * When SC-006 adopts the design, these move into `cs.ts` and this file goes.
 *
 * `copy.test.ts` applies the catalogue's copy rules to every string here:
 * no imperative to bet, no promised outcome, no bookmaker, DESIGN.md rule 68's
 * banned words, correct diacritics, no ALL CAPS.
 */
export const previewCopy = {
  meta: {
    title: 'Náhled: úvodní stránka',
  },

  /** The strip at the top of the page. For the reviewer, not for a visitor. */
  notice:
    'Náhled návrhu vzhledu ke schválení (rozhodnutí D-005). Mimo vývojový server tato adresa vrací 404. Všechna čísla jsou živá z databáze; kde data chybí, stránka to přizná.',

  /** Sentence-case forms of existing catalogue labels (rule 70). */
  cta: {
    /** cs.home.hero.primaryCta, `ZOBRAZIT HISTORII`. */
    showHistory: 'Zobrazit historii',
    /** cs.home.record.cta, `CELÁ HISTORIE`. */
    fullHistory: 'Celá historie',
    /** cs.home.freeTip.cta, `CELÁ ANALÝZA`. */
    fullAnalysis: 'Celá analýza',
    /** cs.history.methodology.cta, `CELÁ METODIKA`. */
    fullMethodology: 'Celá metodika',
    /** cs.pricing.cta, `ZÍSKAT PŘÍSTUP`. */
    getAccess: 'Získat přístup',
  },

  record: {
    /** DESIGN.md's own sentence: the one the design has to prove. */
    heading: 'Výsledky neschováváme. Ani ty špatné.',
    summaryHeading: 'Stav veřejné historie',
    /** Rule 51: under ~30 settled tips, say the sample is too small. */
    smallSample:
      'Vzorek je zatím malý. Z takového počtu tipů se o kvalitě analýz nedá nic spolehlivě říct.',
    /** Shown in place of a rate that does not exist yet (nothing settled). */
    noValue: '—',
    noValueLabel: 'zatím bez hodnoty',
  },

  table: {
    caption:
      'Nejnovější vyhodnocené tipy, od nejnovějšího. Prohry jsou v seznamu stejně jako výhry; celý záznam je v historii.',
    /** Rule 35: the time zone, stated once on the page. */
    timeZone: 'Data jsou v pražském čase.',
  },
} as const

export type PreviewCopy = typeof previewCopy
