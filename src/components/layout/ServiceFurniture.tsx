/**
 * The three things copy rule 5 requires on every page.
 *
 *   1. an 18+ marker,
 *   2. a one-line statement that this is an informational and analytical
 *      service which takes no bets,
 *   3. the problem-gambling help line.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * PERMANENT FURNITURE, NOT A WARNING BANNER
 *
 * This is the design decision the brief is most specific about, and it is
 * worth writing down why. A dismissible banner is worse than useless: a
 * warning the reader can close is a warning the reader closes, and the one
 * person who most needs to see a help-line number is the one most likely to
 * dismiss it. A high-contrast alert strip is no better — it gets read as
 * decoration within two visits, and it makes the whole page feel like a
 * disclaimer.
 *
 * So it is quiet, it is always there, it is in normal body colours on the
 * raised surface, and it cannot be closed. It reads as part of the site
 * rather than as something bolted on to satisfy a rule.
 *
 * The help-line text is deliberately calm: no exclamation mark, no POZOR, no
 * VAROVÁNÍ. The copy test asserts that, because the instinct when writing
 * this sort of block is to shout.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE NUMBER IS A `tel:` LINK
 *
 * Because it is read on a phone, and a number that cannot be tapped is a
 * number that has to be copied by hand by somebody who is not having a good
 * day.
 */
import { getTranslations } from 'next-intl/server'

import type { SiteSettingsView } from '@/lib/content/loaders'

export const ServiceFurniture = async ({
  settings,
}: {
  settings: SiteSettingsView
}) => {
  const t = await getTranslations('common')

  // The number as a dialable string: no spaces, no formatting. The visible
  // form keeps the spaces, because that is how a Czech number is read.
  const dialable = `tel:${settings.helpline.phone.replace(/\s+/g, '')}`

  return (
    <section
      aria-label={t('helpline.lead')}
      className="flex flex-col gap-3 border-t border-border-subtle pt-6 text-body-sm text-ink-muted"
    >
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="inline-flex items-center rounded-pill border border-border-strong px-2 py-0.5 text-label text-ink">
          {t('ageMarker')}
        </span>
        <span>{t('ageMarkerLong')}</span>
      </p>

      {/* Rule 5's service statement. One line, always the same line. */}
      <p className="max-w-prose">{t('serviceStatement')}</p>

      <p className="max-w-prose">
        {t('helpline.lead')}{' '}
        <a
          href={dialable}
          className="font-semibold text-brand-text underline underline-offset-4"
        >
          {settings.helpline.name}, {settings.helpline.phone}
        </a>
        {settings.helpline.url ? (
          <>
            {' · '}
            <a
              href={settings.helpline.url}
              className="text-brand-text underline underline-offset-4"
              // An external link, so `noopener` — and `nofollow` because we
              // are not passing ranking signal to a help line, we are
              // pointing at it.
              rel="noopener noreferrer nofollow"
              target="_blank"
            >
              narodnilinka.cz
            </a>
          </>
        ) : null}
      </p>
    </section>
  )
}
