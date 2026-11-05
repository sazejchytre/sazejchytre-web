/**
 * The footer: operator identity, documents, contact, and the furniture.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE OPERATOR BLOCK IS THE INTERESTING PART
 *
 * `operatorForDisplay()` is called here, and it is the one place in the
 * application that resolves operator identity for rendering. In production it
 * THROWS while any field is still a `TODO:` placeholder, which takes every
 * page down — deliberately. A live commercial site showing
 * "TODO: 8-digit IČO" is a compliance problem, and one showing a
 * plausible-looking invented IČO is a worse one. A loud failure is the only
 * version of this that cannot be ignored.
 *
 * Outside production the placeholders render, with a visible note saying what
 * they are. A developer who sees `TODO: city` in the footer knows exactly
 * what is missing; a footer that silently hid the block would hide the
 * missing work too.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THERE IS NO NEWSLETTER FORM DOWN HERE
 *
 * It would be the conventional place for one. It would also put the Turnstile
 * widget — a third-party script from challenges.cloudflare.com — on every
 * page of the site, including the history page, which is the heaviest page we
 * have and the one whose Core Web Vitals matter most. So the form lives on
 * the home page and on the contact page, and the footer links to it.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * `IČO` IS NOT `VAT ID`
 *
 * Every Czech business has an IČO. VAT registration is separate, and the
 * operator is not registered — so the footer says so in words rather than
 * printing an empty DIČ, which reads as a missing field rather than as an
 * absent obligation.
 */
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

import type { SiteSettingsView } from '@/lib/content/loaders'
import { operatorForDisplay } from '@/lib/legal/operator-display'

import { ServiceFurniture } from './ServiceFurniture'

const LEGAL_LINKS = [
  { href: '/obchodni-podminky', key: 'terms' },
  { href: '/ochrana-osobnich-udaju', key: 'privacy' },
  { href: '/cookies', key: 'cookies' },
  { href: '/metodika', key: 'methodology' },
] as const

export const Footer = async ({ settings }: { settings: SiteSettingsView }) => {
  const t = await getTranslations('common')
  // THROWS in production while operator.ts holds placeholders. See header.
  const operator = operatorForDisplay()
  const { operator: identity } = operator

  return (
    <footer className="mt-16 border-t border-border-subtle bg-surface-raised">
      <div className="page-shell page-gutter flex flex-col gap-8 py-12">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {/* --- Operator ------------------------------------------------ */}
          <section className="flex flex-col gap-2">
            <h2 className="text-label text-ink">
              {t('footer.operatorHeading')}
            </h2>

            {operator.configured ? null : (
              // Development only: in production the call above has already
              // thrown rather than reaching this branch.
              <p className="rounded-input border border-result-loss px-2 py-1 text-body-sm text-result-loss">
                {t('footer.operatorPlaceholderWarning')}
              </p>
            )}

            <address className="not-italic text-body-sm text-ink-muted">
              <span className="block text-ink">{identity.name}</span>
              <span className="block">{identity.street}</span>
              <span className="block">
                {identity.postalCode} {identity.city}
              </span>
            </address>

            <p className="text-body-sm text-ink-muted">
              {t('footer.ico')}:{' '}
              <span className="text-data-sm">{identity.ico}</span>
            </p>
            <p className="text-body-sm text-ink-muted">
              {t('footer.registry')}: {identity.registryNote}
            </p>
            {identity.vatPayer ? null : (
              <p className="text-body-sm text-ink-muted">
                {t('footer.vatNote')}
              </p>
            )}
          </section>

          {/* --- Documents ----------------------------------------------- */}
          <nav
            className="flex flex-col gap-2"
            aria-label={t('footer.legalHeading')}
          >
            <h2 className="text-label text-ink">{t('footer.legalHeading')}</h2>
            <ul className="flex flex-col gap-1">
              {LEGAL_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="inline-flex min-h-11 items-center text-body-sm text-ink-muted underline underline-offset-4 hover:text-brand-text"
                  >
                    {t(`footer.${link.key}`)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* --- Contact ------------------------------------------------- */}
          <section className="flex flex-col gap-2">
            <h2 className="text-label text-ink">
              {t('footer.contactHeading')}
            </h2>
            <ul className="flex flex-col gap-1">
              <li>
                <Link
                  href="/kontakt"
                  className="inline-flex min-h-11 items-center text-body-sm text-ink-muted underline underline-offset-4 hover:text-brand-text"
                >
                  {t('nav.contact')}
                </Link>
              </li>
              <li>
                <a
                  href={`mailto:${settings.contactEmail}`}
                  className="inline-flex min-h-11 items-center text-body-sm text-ink-muted underline underline-offset-4 hover:text-brand-text"
                >
                  {settings.contactEmail}
                </a>
              </li>
              <li>
                {/* The newsletter lives on the home page — see the header. */}
                <Link
                  href="/#novinky"
                  className="inline-flex min-h-11 items-center text-body-sm text-ink-muted underline underline-offset-4 hover:text-brand-text"
                >
                  {t('footer.newsletterHeading')}
                </Link>
              </li>
            </ul>
          </section>

          {/* --- Social, only if any exist ------------------------------- */}
          <section className="flex flex-col gap-2">
            <h2 className="text-label text-ink">
              {t('footer.responsibleHeading')}
            </h2>
            <p className="text-body-sm text-ink-muted">
              {t('serviceStatement')}
            </p>
            {settings.socialLinks.length > 0 ? (
              <ul className="flex flex-wrap gap-3">
                {settings.socialLinks.map((url) => (
                  <li key={url}>
                    <a
                      href={url}
                      rel="noopener noreferrer me"
                      className="inline-flex min-h-11 items-center text-body-sm text-ink-muted underline underline-offset-4 hover:text-brand-text"
                    >
                      {new URL(url).hostname.replace(/^www\./, '')}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </div>

        <ServiceFurniture settings={settings} />
      </div>
    </footer>
  )
}
