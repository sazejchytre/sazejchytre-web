/**
 * The public route inventory. ONE list, three consumers.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY A LIST AND NOT THREE
 *
 * `sitemap.xml`, `robots.txt` and `llms.txt` all need to know which pages
 * exist and which must stay out of an index. Written separately, they drift:
 * a new page gets added to the sitemap and not to `llms.txt`, or a `noindex`
 * stub gets listed in the sitemap, which is a direct contradiction — telling
 * a crawler "index this" and "do not index this" about the same URL.
 *
 * So the inventory is declared once, each entry says whether it is indexable,
 * and the three generated files are derived from it.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE TIP PAGES ARE NOT IN HERE
 *
 * They are dynamic and come from the database, so the sitemap adds them from
 * a query. This list is the STATIC skeleton; mixing the two would mean the
 * route table had to be loaded from Postgres to answer `robots.txt`.
 */

export type PublicRoute = {
  path: string
  /** May a crawler index it? `false` also keeps it out of the sitemap. */
  indexable: boolean
  /**
   * Sitemap priority. A hint, widely ignored, and kept anyway because it
   * costs nothing and the one thing it does reliably communicate is which
   * page we think is the most important — which here is the track record,
   * not the home page.
   */
  priority: number
  changeFrequency:
    'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never'
  /** One line for `llms.txt`, describing what is actually on the page. */
  summary: string
}

export const PUBLIC_ROUTES: readonly PublicRoute[] = [
  {
    path: '/',
    indexable: true,
    priority: 0.9,
    changeFrequency: 'daily',
    summary:
      'Úvodní stránka: veřejná historie výsledků, včerejší tip zdarma, jak služba funguje, ceník a časté dotazy.',
  },
  {
    // Higher than the home page on purpose. It is the evidence, and it is the
    // page we would most like a crawler or an assistant to read.
    path: '/historie',
    indexable: true,
    priority: 1,
    changeFrequency: 'daily',
    summary:
      'Kompletní historie všech vyhodnocených tipů včetně prohraných, s kumulativním ziskem, propady a popsanou metodikou výpočtu ROI.',
  },
  {
    path: '/cenik',
    indexable: true,
    priority: 0.8,
    changeFrequency: 'monthly',
    summary:
      'Tři varianty předplatného, měsíčně nebo ročně, s přepočtem roční ceny na měsíc.',
  },
  {
    path: '/kontakt',
    indexable: true,
    priority: 0.5,
    changeFrequency: 'yearly',
    summary:
      'Kontaktní formulář, e-mailová adresa a identifikace provozovatele.',
  },
  {
    path: '/metodika',
    indexable: true,
    priority: 0.7,
    changeFrequency: 'monthly',
    summary:
      'Jak se počítá zisk a ROI, v jakých jednotkách, a proč zrušené tipy do ROI nevstupují.',
  },
  {
    path: '/obchodni-podminky',
    indexable: true,
    priority: 0.3,
    changeFrequency: 'yearly',
    summary: 'Obchodní podmínky, s číslem verze a datem účinnosti.',
  },
  {
    path: '/ochrana-osobnich-udaju',
    indexable: true,
    priority: 0.3,
    changeFrequency: 'yearly',
    summary: 'Zásady ochrany osobních údajů, s číslem verze a datem účinnosti.',
  },
  {
    path: '/cookies',
    indexable: true,
    priority: 0.3,
    changeFrequency: 'yearly',
    summary: 'Jaké cookies web používá a k čemu.',
  },
  {
    // The checkout stub. Listed so it cannot be forgotten, and NOT indexable.
    path: '/predplatne',
    indexable: false,
    priority: 0,
    changeFrequency: 'never',
    summary: '',
  },
]

/** Everything a crawler may index. */
export const indexableRoutes = (): readonly PublicRoute[] =>
  PUBLIC_ROUTES.filter((route) => route.indexable)

/**
 * Paths that must never be crawled, for `robots.txt`.
 *
 * The admin panel, the API, the auth endpoints and the account area. None of
 * them would be useful in an index and all of them are reachable by URL.
 *
 * NOTE: `Disallow` is not access control. It is a request, honoured by the
 * crawlers that choose to, and an invitation to everybody else to look at
 * exactly these paths. Each one is protected by its own authentication; this
 * list exists so a well-behaved crawler does not waste its budget and so the
 * admin login does not turn up in a search result.
 */
export const DISALLOWED_PREFIXES: readonly string[] = [
  '/admin',
  '/api/',
  '/auth/',
  '/ucet',
  '/prihlaseni',
  '/registrace',
  '/obnova-hesla',
  '/zapomenute-heslo',
  '/overeni-emailu',
  '/predplatne',
]
