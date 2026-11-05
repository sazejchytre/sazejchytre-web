import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'

import { ContactForm } from '@/components/forms/ContactForm'
import { Card, Section } from '@/components/ui/Card'
import { DEFAULT_LOCALE } from '@/i18n/config'
import { loadSiteSettings } from '@/lib/content/loaders'
import { turnstileSiteKey } from '@/lib/forms/site-key'
import { operatorForDisplay } from '@/lib/legal/operator-display'
import { pageMetadata } from '@/lib/seo/metadata'

/**
 * Contact.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE EMAIL ADDRESS IS ON THE PAGE, IN PLAIN TEXT, NEXT TO THE FORM
 *
 * Not as a fallback mentioned in an error message — visible from the start.
 * The form depends on a third-party script (Turnstile) and on our own server
 * action, and both can fail: a privacy extension blocks the widget, a
 * corporate proxy blocks the domain, Upstash has a bad minute. A contact page
 * whose only route to a human runs through four moving parts is a contact
 * page that silently stops working.
 *
 * It also matters for the customer who most needs it. Someone locked out of
 * their account cannot sign in to ask about being locked out, so the way to
 * reach support must not itself be gated. That argument is why the form's
 * rate limiter fails open and why this address is here.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE OPERATOR'S IDENTITY IS SHOWN HERE TOO
 *
 * Czech law expects a business to be identifiable to its customers, and a
 * contact page with no legal entity on it is the page where that is most
 * obviously missing. It comes from `operatorForDisplay()`, which refuses in
 * production while the register data is a placeholder.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('contact')

  return pageMetadata({
    path: '/kontakt',
    title: t('metaTitle'),
    description: t('metaDescription'),
  })
}

export default async function ContactPage() {
  const t = await getTranslations('contact')
  const common = await getTranslations('common')

  const settings = await loadSiteSettings(DEFAULT_LOCALE)
  const operator = operatorForDisplay()

  return (
    <div className="page-shell page-gutter grid gap-10 py-10 lg:grid-cols-[2fr_1fr] lg:items-start">
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-3">
          <h1 className="text-display-lg text-ink">{t('heading')}</h1>
          <p className="max-w-prose text-body text-ink-muted">{t('lead')}</p>
        </header>

        <Card>
          <ContactForm siteKey={turnstileSiteKey()} />
        </Card>
      </div>

      <aside className="flex flex-col gap-6">
        <Section title={t('directEmailHeading')} as="h2">
          <Card className="flex flex-col gap-2">
            <a
              href={`mailto:${settings.contactEmail}`}
              className="text-body font-semibold text-brand-text underline underline-offset-4"
            >
              {settings.contactEmail}
            </a>
            <p className="text-body-sm text-ink-muted">{t('lead')}</p>
          </Card>
        </Section>

        <Section title={common('footer.operatorHeading')} as="h2">
          <Card>
            {operator.configured ? null : (
              <p className="mb-2 rounded-input border border-result-loss px-2 py-1 text-body-sm text-result-loss">
                {common('footer.operatorPlaceholderWarning')}
              </p>
            )}

            <address className="not-italic text-body-sm text-ink-muted">
              <span className="block text-ink">{operator.operator.name}</span>
              <span className="block">{operator.operator.street}</span>
              <span className="block">
                {operator.operator.postalCode} {operator.operator.city}
              </span>
              <span className="mt-2 block">
                {common('footer.ico')}: {operator.operator.ico}
              </span>
              <span className="block">
                {common('footer.registry')}: {operator.operator.registryNote}
              </span>
            </address>
          </Card>
        </Section>
      </aside>
    </div>
  )
}
