import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

import { Wordmark } from '@/components/brand/Marks'
import { ServiceFurniture } from '@/components/layout/ServiceFurniture'
import type { SiteSettingsView } from '@/lib/content/loaders'
import { operatorForDisplay } from '@/lib/legal/operator-display'

/**
 * The site footer, as PROPOSED for D-005. Preview-only.
 *
 * `src/components/layout/Footer.tsx` belongs to SC-017 and is unchanged.
 * This shows the simpler arrangement proposed for it: the wordmark and the
 * service statement, two short link lists, the operator's identity (rule
 * 62, from `operatorForDisplay()` and nowhere else), and the permanent
 * furniture — 18+, the service statement, the help line — reused unchanged
 * from `ServiceFurniture`.
 *
 * Links do not prefetch: a footer full of prefetching links was most of the
 * JavaScript the first prototype downloaded after load.
 */

const LINK =
  'inline-flex min-h-11 items-center text-body-sm text-ink-muted hover:text-brand-text hover:underline underline-offset-4'

export const PreviewFooter = async ({
  settings,
}: {
  settings: SiteSettingsView
}) => {
  const t = await getTranslations('common')
  const display = operatorForDisplay()
  const { operator } = display

  const site = [
    { href: '/historie', label: t('nav.history') },
    { href: '/metodika', label: t('footer.methodology') },
    { href: '/cenik', label: t('nav.pricing') },
    { href: '/kontakt', label: t('nav.contact') },
  ]
  const documents = [
    { href: '/obchodni-podminky', label: t('footer.terms') },
    { href: '/ochrana-osobnich-udaju', label: t('footer.privacy') },
    { href: '/cookies', label: t('footer.cookies') },
  ]

  return (
    <footer className="border-t border-border-subtle bg-surface-page">
      <div className="page-shell page-gutter flex flex-col gap-10 py-12">
        <div className="grid gap-10 md:grid-cols-12">
          <div className="flex flex-col gap-3 md:col-span-4">
            <Wordmark
              label={t('brand')}
              className="h-6 w-auto self-start text-ink"
            />
            <p className="max-w-prose text-body-sm text-ink-muted">
              {t('tagline')}
            </p>
          </div>

          <div className="md:col-span-2">
            <ul className="flex flex-col">
              {site.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} prefetch={false} className={LINK}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <nav aria-label={t('footer.legalHeading')} className="md:col-span-3">
            <ul className="flex flex-col">
              {documents.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} prefetch={false} className={LINK}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <section
            aria-label={t('footer.operatorHeading')}
            className="flex flex-col gap-1 text-body-sm text-ink-muted md:col-span-3"
          >
            {display.configured ? null : (
              <p className="mb-2 rounded-input border border-result-loss px-2 py-1 text-result-loss">
                {t('footer.operatorPlaceholderWarning')}
              </p>
            )}
            <p className="text-ink">{operator.name}</p>
            <p>
              {operator.street}, {operator.postalCode} {operator.city}
            </p>
            <p>
              {t('footer.ico')}: {operator.ico}
            </p>
            {operator.vatPayer ? null : <p>{t('footer.vatNote')}</p>}
            <p>
              <a
                href={`mailto:${settings.contactEmail}`}
                className="inline-flex min-h-11 items-center text-brand-text underline underline-offset-4"
              >
                {settings.contactEmail}
              </a>
            </p>
          </section>
        </div>

        <ServiceFurniture settings={settings} />
      </div>
    </footer>
  )
}
