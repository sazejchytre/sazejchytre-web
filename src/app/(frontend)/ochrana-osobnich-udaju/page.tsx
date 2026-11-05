import type { Metadata } from 'next'

import {
  LegalPageView,
  legalPageMetadata,
} from '@/components/legal/LegalPageView'

/**
 * Zásady ochrany osobních údajů.
 *
 * One of four thin routes over `LegalPageView`. Each document has its OWN
 * URL rather than sharing a `/[slug]` route, deliberately: these four paths
 * are referenced from the footer of every page, from transactional email, and
 * from the payment provider's own configuration. A dynamic segment would make
 * the set of valid URLs a database question, and a typo in a slug would turn
 * a legally required link into a 404.
 */
export async function generateMetadata(): Promise<Metadata> {
  return legalPageMetadata('ochrana-osobnich-udaju')
}

export default async function Page() {
  return <LegalPageView slug="ochrana-osobnich-udaju" />
}
