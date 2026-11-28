/**
 * The route table the launch gate enforces. One list, every path the
 * application serves.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * AN ALLOWLIST, NOT A BLOCKLIST
 *
 * A path that matches no rule here is UNKNOWN, and outside FULL mode an
 * unknown path is refused. That is the property the gate rests on:
 *
 *   - a route added later is closed until somebody classifies it, and
 *     `routes.test.ts` fails CI until they do, because it walks `src/app`
 *     and requires every route file to resolve to the area it expects;
 *   - a spelling of a closed path that the framework might still resolve to
 *     the same page (percent-encoding, a stray slash, a dot segment) matches
 *     no rule and is refused, instead of slipping past a list of things to
 *     block.
 *
 * Patterns are matched against the raw, still-encoded pathname, anchored at
 * both ends. Query strings never take part: no parameter, header or cookie
 * changes how a path is classified.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * AREAS
 *
 *   public          informational pages and public machine-readable outputs
 *   accounts        customer registration, sign-in, password flows, account
 *                   area, and the authentication library's HTTP endpoints
 *   payments        checkout and payment-provider callbacks
 *   operations      the health probe and the bearer-authorised cron routes;
 *                   open in every mode
 *   administration  the Payload admin panel and REST API; open in every mode,
 *                   protected by Payload's own authentication. In PRIVATE mode
 *                   the REST API additionally refuses anonymous reads, see
 *                   `payload-api.ts`
 *   framework       Next.js build output and runtime endpoints under `/_next`
 *   development     the dev server's own endpoints, open only under `next dev`
 *
 * This module is dependency-free: the proxy, the verification script and the
 * tests all import it.
 */

export const ROUTE_AREAS = [
  'public',
  'accounts',
  'payments',
  'operations',
  'administration',
  'framework',
  'development',
] as const
export type RouteArea = (typeof ROUTE_AREAS)[number]

export const HTTP_METHODS = [
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
] as const
export type HttpMethod = (typeof HTTP_METHODS)[number]

export type RouteRule = {
  /** Stable name, used in test output and in the verification script. */
  readonly name: string
  readonly area: RouteArea
  readonly pattern: RegExp
  /**
   * Methods the route accepts while its area is open. `ANY` hands the
   * decision to the route itself (Payload, the auth library, route handlers
   * with their own method exports).
   */
  readonly methods: 'ANY' | readonly HttpMethod[]
}

/**
 * Pages accept POST because that is how a Server Function reaches them: a
 * form's action is a POST to the page that renders the form. Nothing else
 * posts to a page.
 */
const PAGE_METHODS: readonly HttpMethod[] = ['GET', 'HEAD', 'POST']
const READ_METHODS: readonly HttpMethod[] = ['GET', 'HEAD']

/**
 * One path segment as a tip slug may legitimately spell it.
 *
 * RFC 3986 `pchar`, minus the two escapes that could be read as a separator
 * (`%2F`, `%5C`) and minus dot segments, plain or encoded. Slugs are free
 * text in the admin, so this is deliberately wider than the
 * lowercase-and-hyphen form the seed uses; what it must never admit is
 * something a router might resolve as more than one segment, or as a step up.
 */
const SLUG_SEGMENT =
  "(?!(?:\\.|%2[Ee]){1,2}$)(?:[A-Za-z0-9._~!$&'()*+,;=:@-]|%(?!2[Ff]|5[Cc])[0-9A-Fa-f]{2})+"

const exact = (path: string): RegExp =>
  new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)

/** The path itself and everything below it. */
const subtree = (path: string): RegExp =>
  new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:/.*)?$`)

const rule = (
  name: string,
  area: RouteArea,
  pattern: RegExp,
  methods: RouteRule['methods'],
): RouteRule => Object.freeze({ name, area, pattern, methods })

/**
 * Order matters only where patterns overlap: `/api/cron/*` before `/api/*`,
 * `/_next/image` before `/_next/*`. First match wins.
 */
export const ROUTE_RULES: readonly RouteRule[] = Object.freeze([
  /* --- public: informational pages ------------------------------------- */
  rule('home', 'public', exact('/'), PAGE_METHODS),
  rule('history', 'public', exact('/historie'), PAGE_METHODS),
  rule('methodology', 'public', exact('/metodika'), PAGE_METHODS),
  rule('pricing', 'public', exact('/cenik'), PAGE_METHODS),
  rule('contact', 'public', exact('/kontakt'), PAGE_METHODS),
  rule('terms', 'public', exact('/obchodni-podminky'), PAGE_METHODS),
  rule('privacy', 'public', exact('/ochrana-osobnich-udaju'), PAGE_METHODS),
  rule('cookies', 'public', exact('/cookies'), PAGE_METHODS),
  rule(
    'analysis',
    'public',
    new RegExp(`^/tipy/${SLUG_SEGMENT}$`),
    PAGE_METHODS,
  ),

  /* --- public: machine-readable outputs and image optimisation ----------- */
  rule('robots', 'public', exact('/robots.txt'), READ_METHODS),
  rule('sitemap', 'public', exact('/sitemap.xml'), READ_METHODS),
  rule('llms', 'public', exact('/llms.txt'), READ_METHODS),
  rule('image-optimizer', 'public', exact('/_next/image'), READ_METHODS),

  /* --- accounts ----------------------------------------------------------- */
  rule('sign-in', 'accounts', subtree('/prihlaseni'), 'ANY'),
  rule('registration', 'accounts', subtree('/registrace'), 'ANY'),
  rule('forgotten-password', 'accounts', subtree('/zapomenute-heslo'), 'ANY'),
  rule('password-reset', 'accounts', subtree('/obnova-hesla'), 'ANY'),
  rule('email-verification', 'accounts', subtree('/overeni-emailu'), 'ANY'),
  rule('account', 'accounts', subtree('/ucet'), 'ANY'),
  rule('auth-endpoints', 'accounts', subtree('/auth'), 'ANY'),

  /* --- payments ----------------------------------------------------------- */
  rule('checkout', 'payments', subtree('/predplatne'), 'ANY'),
  rule('payment-webhooks', 'payments', subtree('/webhooks'), 'ANY'),

  /* --- operations --------------------------------------------------------- */
  rule('health', 'operations', exact('/healthz'), READ_METHODS),
  rule('cron', 'operations', /^\/api\/cron\/[A-Za-z0-9-]+$/, 'ANY'),

  /* --- administration ----------------------------------------------------- */
  rule('admin-panel', 'administration', subtree('/admin'), 'ANY'),
  rule('payload-api', 'administration', subtree('/api'), 'ANY'),

  /* --- framework ---------------------------------------------------------- */
  rule('next-internals', 'framework', /^\/_next\/.+$/, 'ANY'),
  rule(
    'next-dev-endpoints',
    'development',
    /^\/__nextjs[^/]*(?:\/.*)?$/,
    'ANY',
  ),
])

/** The rule a pathname falls under, or `undefined` if it is unknown. */
export const classifyPath = (pathname: string): RouteRule | undefined =>
  ROUTE_RULES.find((candidate) => candidate.pattern.test(pathname))

export const isHttpMethod = (value: string): value is HttpMethod =>
  (HTTP_METHODS as readonly string[]).includes(value)
