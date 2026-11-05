import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'

import type * as BaseModule from './base.ts'
import type * as JsonLdModule from './jsonld.ts'
import type * as MetadataModule from './metadata.ts'
import type * as RoutesModule from './routes.ts'
import type { OperatorDisplay } from '../legal/operator-display.ts'
import type { TrackRecordDataset } from '../tips/presentation.ts'

/**
 * The SEO layer, tested through a dynamic import.
 *
 * `env.public.ts` validates `NEXT_PUBLIC_*` at module load and throws without
 * them, and these modules import it transitively. So the variables are set
 * first and the modules are imported after — which is also a check worth
 * having in itself: it proves nothing in this layer carries a hardcoded
 * domain, because every URL below is derived from the value set here.
 */

const ORIGIN = 'https://sazejchytre.cz'

type SeoModules = {
  base: typeof BaseModule
  metadata: typeof MetadataModule
  jsonld: typeof JsonLdModule
  routes: typeof RoutesModule
}

let seo: SeoModules

before(async () => {
  process.env.NEXT_PUBLIC_SERVER_URL = ORIGIN
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_0000000000'

  seo = {
    base: await import('./base.ts'),
    metadata: await import('./metadata.ts'),
    jsonld: await import('./jsonld.ts'),
    routes: await import('./routes.ts'),
  }
})

/* -------------------------------------------------------------------------- */

describe('absoluteUrl', () => {
  it('builds an absolute URL from the configured origin', () => {
    assert.equal(seo.base.absoluteUrl('/historie'), `${ORIGIN}/historie`)
  })

  it('accepts a path with or without the leading slash', () => {
    assert.equal(seo.base.absoluteUrl('historie'), `${ORIGIN}/historie`)
  })

  it('gives the root a single trailing slash', () => {
    assert.equal(seo.base.absoluteUrl('/'), `${ORIGIN}/`)
    assert.equal(seo.base.absoluteUrl(''), `${ORIGIN}/`)
  })
})

describe('isCanonicalHost', () => {
  it('accepts the production host and its www form', () => {
    assert.equal(seo.base.isCanonicalHost('https://sazejchytre.cz'), true)
    assert.equal(seo.base.isCanonicalHost('https://www.sazejchytre.cz'), true)
  })

  it('rejects a preview deployment', () => {
    // The decisive case. A preview build IS a production build, so NODE_ENV
    // says `production` there too — only the origin can tell them apart, and
    // getting this wrong is how every preview URL ends up in an index
    // competing with the real site.
    assert.equal(
      seo.base.isCanonicalHost('https://sazejchytre-git-abc123.vercel.app'),
      false,
    )
  })

  it('rejects a host that merely ends with the production domain', () => {
    assert.equal(seo.base.isCanonicalHost('https://evil-sazejchytre.cz'), false)
    assert.equal(
      seo.base.isCanonicalHost('https://sazejchytre.cz.attacker.example'),
      false,
    )
  })

  it('rejects an unparseable origin rather than throwing', () => {
    assert.equal(seo.base.isCanonicalHost('not a url'), false)
  })
})

/* -------------------------------------------------------------------------- */

describe('pageMetadata', () => {
  it('emits an absolute canonical', () => {
    const meta = seo.metadata.pageMetadata({
      path: '/historie',
      title: 'Historie tipů',
      description: 'Vše včetně proher.',
    })

    assert.equal(meta.alternates?.canonical, `${ORIGIN}/historie`)
  })

  it('makes the Open Graph url the same string as the canonical', () => {
    // Two calls to `absoluteUrl` would be two chances to differ, and a share
    // card advertising a different URL from the indexed one is a real bug.
    const meta = seo.metadata.pageMetadata({
      path: '/cenik',
      title: 'Ceník',
      description: 'Tři varianty.',
    })

    assert.equal(
      (meta.openGraph as { url?: string } | undefined)?.url,
      meta.alternates?.canonical,
    )
  })

  it('uses the underscore form of the locale for Open Graph', () => {
    const meta = seo.metadata.pageMetadata({
      path: '/',
      title: 'Úvod',
      description: 'Méně tipů, víc analýzy.',
    })

    assert.equal(
      (meta.openGraph as { locale?: string } | undefined)?.locale,
      'cs_CZ',
    )
  })

  it('declares a summary card, because there is no image', () => {
    const meta = seo.metadata.pageMetadata({
      path: '/',
      title: 'Úvod',
      description: 'x',
    })

    assert.equal(
      (meta.twitter as { card?: string } | undefined)?.card,
      'summary',
    )
  })

  it('indexes by default on the canonical host', () => {
    const meta = seo.metadata.pageMetadata({
      path: '/',
      title: 'Úvod',
      description: 'x',
    })

    assert.deepEqual(meta.robots, { index: true, follow: true })
  })

  it('honours the per-page noindex switch', () => {
    const meta = seo.metadata.pageMetadata({
      path: '/predplatne',
      title: 'Předplatné',
      description: 'x',
      noindex: true,
    })

    assert.equal((meta.robots as { index?: boolean }).index, false)
    assert.equal((meta.robots as { noarchive?: boolean }).noarchive, true)
  })

  it('emits no hreflang while there is one locale', () => {
    // Emitting it for locales that all serve the same Czech text is the most
    // reliable way to hand a search engine a duplicate-content problem.
    const meta = seo.metadata.pageMetadata({
      path: '/',
      title: 'Úvod',
      description: 'x',
    })

    assert.equal(meta.alternates?.languages, undefined)
    assert.equal(seo.metadata.hreflangAlternates('/'), undefined)
  })
})

/* -------------------------------------------------------------------------- */

const operator: OperatorDisplay = {
  configured: false,
  unresolved: ['name'],
  operator: {
    name: 'Zkušební Provozovatel',
    street: 'Ulice 1',
    city: 'Praha',
    postalCode: '110 00',
    countryCode: 'CZ',
    ico: '12345678',
    vatPayer: false,
    registryNote: 'Živnostenský úřad',
    email: 'info@example.cz',
    supportEmail: 'podpora@example.cz',
  },
  addressLine: 'Ulice 1, 110 00 Praha',
}

describe('organisationJsonLd', () => {
  it('carries the IČO as taxID, not as vatID', () => {
    // Every Czech business has an IČO; VAT registration is separate. `vatID`
    // would claim a registration the operator does not have.
    const node = seo.jsonld.organisationJsonLd({
      operator,
      contactEmail: 'podpora@example.cz',
    })

    assert.equal(node.taxID, '12345678')
    assert.equal(node.vatID, undefined)
  })

  it('adds vatID only for a VAT-registered operator', () => {
    const node = seo.jsonld.organisationJsonLd({
      operator: {
        ...operator,
        operator: { ...operator.operator, vatPayer: true },
      },
      contactEmail: 'podpora@example.cz',
    })

    assert.equal(node.vatID, 'CZ12345678')
  })

  it('omits sameAs when there are no profiles', () => {
    const node = seo.jsonld.organisationJsonLd({
      operator,
      contactEmail: 'podpora@example.cz',
    })

    assert.equal(node.sameAs, undefined)
  })
})

describe('faqPageJsonLd', () => {
  it('is null for an empty list rather than an empty FAQPage', () => {
    // An FAQPage with no questions is invalid structured data, and emitting
    // one because the database happened to be empty is how a site earns a
    // manual action.
    assert.equal(seo.jsonld.faqPageJsonLd([]), null)
  })

  it('uses the answer text verbatim', () => {
    const node = seo.jsonld.faqPageJsonLd([
      { question: 'Jak počítáte ROI?', answer: 'Zisk ÷ vsazeno.' },
    ])

    const entity = (
      node?.mainEntity as { acceptedAnswer: { text: string } }[]
    )[0]

    assert.equal(entity?.acceptedAnswer.text, 'Zisk ÷ vsazeno.')
  })
})

describe('datasetJsonLd', () => {
  const dataset: TrackRecordDataset = {
    name: 'Výsledky',
    description: 'Vše včetně proher.',
    measurementTechnique: 'Celočíselně.',
    temporalCoverage: '2026-03-01/2026-10-15',
    dateModified: '2026-11-05T10:00:00.000Z',
    sampleSize: 42,
    isAccessibleForFree: true,
    creator: { name: 'Zkušební', identifier: '12345678' },
    variableMeasured: [
      {
        name: 'returnOnInvestment',
        label: 'Návratnost (ROI)',
        value: 3833,
        scale: 10_000,
        unitText: 'podíl (1 = 100 %)',
      },
      {
        name: 'lostTips',
        label: 'Prohrané tipy',
        value: 17,
        scale: 1,
        unitText: 'tipů',
      },
    ],
    countedTipIds: [1, 2, 3],
  }

  it('divides each figure by its scale exactly once', () => {
    const node = seo.jsonld.datasetJsonLd(dataset, operator)
    const variables = node.variableMeasured as {
      name: string
      value: number
      description?: string
    }[]

    const roi = variables.find((v) => v.name === 'returnOnInvestment')

    assert.equal(roi?.value, 0.3833)
    // The stored integer stays visible, so the two can be reconciled.
    assert.match(roi?.description ?? '', /3833/)
  })

  it('leaves an unscaled count alone', () => {
    const node = seo.jsonld.datasetJsonLd(dataset, operator)
    const variables = node.variableMeasured as { name: string; value: number }[]

    assert.equal(variables.find((v) => v.name === 'lostTips')?.value, 17)
  })

  it('states the sample size as a figure of its own', () => {
    const node = seo.jsonld.datasetJsonLd(dataset, operator)
    const variables = node.variableMeasured as { name: string; value: number }[]

    assert.equal(variables.find((v) => v.name === 'sampleSize')?.value, 42)
  })
})

describe('jsonLdGraph', () => {
  it('drops nulls, so a caller can pass an empty FAQ straight through', () => {
    const graph = seo.jsonld.jsonLdGraph([
      { '@type': 'WebSite' },
      null,
      { '@type': 'Dataset' },
    ])

    assert.equal((graph['@graph'] as unknown[]).length, 2)
  })

  it('sets the schema.org context once, on the graph', () => {
    const graph = seo.jsonld.jsonLdGraph([{ '@type': 'WebSite' }])

    assert.equal(graph['@context'], 'https://schema.org')
  })
})

/* -------------------------------------------------------------------------- */

describe('serialiseJsonLd', () => {
  it('escapes a closing script tag hidden in a database field', () => {
    // THE TEST THAT MATTERS. An FAQ answer containing `</script>` would
    // otherwise close the element early and the rest would be parsed as HTML.
    const serialised = seo.jsonld.serialiseJsonLd({
      answer: '</script><img src=x onerror=alert(1)>',
    })

    assert.equal(serialised.includes('</script>'), false)
    assert.equal(serialised.includes('<'), false)
    assert.equal(serialised.includes('>'), false)
  })

  it('escapes the ampersand too', () => {
    const serialised = seo.jsonld.serialiseJsonLd({ q: 'kurz & sázka' })

    assert.equal(serialised.includes('&'), false)
  })

  it('emits the escape SEQUENCE, not the character it denotes', () => {
    // A single backslash in the replacement makes the function a no-op that
    // looks correct. This is what catches that.
    const serialised = seo.jsonld.serialiseJsonLd({ a: '<' })

    assert.match(serialised, /\\u003c/)
  })

  it('still parses as JSON, with the original value intact', () => {
    const value = '</script> & <b>'
    const parsed = JSON.parse(seo.jsonld.serialiseJsonLd({ value })) as {
      value: string
    }

    assert.equal(parsed.value, value)
  })
})

/* -------------------------------------------------------------------------- */

describe('the route inventory', () => {
  it('never lists a non-indexable route as indexable', () => {
    for (const route of seo.routes.indexableRoutes()) {
      assert.equal(route.indexable, true)
    }
  })

  it('keeps the checkout stub out of the sitemap', () => {
    // A sitemap entry plus a `noindex` tag is a direct contradiction: it
    // tells a crawler both to index and not to index the same URL.
    const paths = seo.routes.indexableRoutes().map((route) => route.path)

    assert.equal(paths.includes('/predplatne'), false)
  })

  it('ranks the track record above the home page', () => {
    const routes = seo.routes.PUBLIC_ROUTES
    const history = routes.find((route) => route.path === '/historie')
    const home = routes.find((route) => route.path === '/')

    assert.ok((history?.priority ?? 0) > (home?.priority ?? 0))
  })

  it('gives every indexable route a summary for llms.txt', () => {
    for (const route of seo.routes.indexableRoutes()) {
      assert.notEqual(route.summary, '', `${route.path} has no summary`)
    }
  })

  it('disallows the admin panel and the account area', () => {
    for (const prefix of ['/admin', '/ucet', '/api/']) {
      assert.ok(
        seo.routes.DISALLOWED_PREFIXES.includes(prefix),
        `${prefix} is missing from DISALLOWED_PREFIXES`,
      )
    }
  })
})
