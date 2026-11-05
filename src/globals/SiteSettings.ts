import type { GlobalConfig } from 'payload'

import { isAdmin } from '@/lib/access'
import { CACHE_TAGS } from '@/lib/cache/keys'
import { revalidateOnChange } from '@/lib/content/revalidate'

/**
 * Site settings the operator can change without a deploy.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT BELONGS HERE AND WHAT DOES NOT
 *
 * Here: things that are true about the business and may change — the contact
 * address, social links, the help-line number.
 *
 * NOT here, and this is the important half:
 *
 *   - OPERATOR IDENTITY. Name, address, IČO live in
 *     `src/lib/legal/operator.ts` and on the Fakturoid account. Putting them
 *     in an editable global would mean an invoice's legally required issuer
 *     details could be changed by a typo in an admin panel, with no deploy,
 *     no review and no history. `assertOperatorConfigured()` refusing to boot
 *     is a feature.
 *
 *   - PRICES. They live in the `prices` table and are reconciled into Stripe
 *     by `pnpm sync:prices`. A price editable in two places is a price that
 *     disagrees with what the customer is actually charged.
 *
 *   - ANYTHING THE COPY RULES CONSTRAIN. The tagline and the button labels
 *     are in `src/i18n/messages/cs.ts`, where a test enforces that they do
 *     not promise winnings or tell anyone to place a bet. Moving them here
 *     would move them out from under that test, and "ziskové tipy" would be
 *     one admin edit away.
 *
 * The help-line number IS here, with a default, because it is a real number
 * that could change and because an operator must be able to correct it
 * immediately. The copy test pins the value in the catalogue as the fallback.
 */
export const SiteSettings: GlobalConfig = {
  slug: 'site-settings',
  admin: {
    group: 'Nastavení',
    description:
      'Kontakty a odkazy. Identita provozovatele ani ceny tu nejsou — viz komentář v src/globals/SiteSettings.ts.',
  },
  access: {
    // Public read: the footer needs the contact address on every page.
    read: () => true,
    update: isAdmin,
    // A global has no `admin` access key — Payload only accepts read,
    // readVersions and update here. Panel visibility is governed by the
    // collection-level `canAccessAdminPanel` on `users`.
  },
  fields: [
    {
      name: 'contactEmail',
      type: 'text',
      required: true,
      defaultValue: 'podpora@sazejchytre.cz',
      admin: {
        description:
          'Zobrazuje se v patičce a na kontaktu. Když formulář nevyjde, nabídne se tahle adresa jako náhrada.',
      },
      validate: (value: unknown) =>
        typeof value === 'string' &&
        /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim())
          ? true
          : 'Zadejte platnou e-mailovou adresu.',
    },
    {
      name: 'notificationEmail',
      type: 'text',
      required: false,
      admin: {
        description:
          'Kam chodí notifikace o nové zprávě z formuláře. Prázdné = stejná adresa jako contactEmail.',
      },
    },
    {
      type: 'group',
      name: 'helpline',
      label: 'Linka pomoci',
      admin: {
        description:
          'Povinná součást každé stránky. Číslo je předvyplněné na Národní linku pro odvykání.',
      },
      fields: [
        {
          name: 'name',
          type: 'text',
          required: true,
          defaultValue: 'Národní linka pro odvykání',
        },
        {
          name: 'phone',
          type: 'text',
          required: true,
          defaultValue: '800 350 000',
          admin: { description: 'Ve formátu, v jakém se má zobrazit.' },
        },
        {
          name: 'url',
          type: 'text',
          required: false,
          defaultValue: 'https://www.narodnilinka.cz/',
        },
      ],
    },
    {
      type: 'array',
      name: 'socialLinks',
      label: 'Sociální sítě',
      required: false,
      admin: {
        description:
          'Jdou i do strukturovaných dat jako sameAs, takže tu patří jen profily, které opravdu existují.',
      },
      fields: [
        {
          name: 'platform',
          type: 'select',
          required: true,
          options: [
            { label: 'X / Twitter', value: 'x' },
            { label: 'Facebook', value: 'facebook' },
            { label: 'Instagram', value: 'instagram' },
            { label: 'YouTube', value: 'youtube' },
            { label: 'Discord', value: 'discord' },
            { label: 'Telegram', value: 'telegram' },
          ],
        },
        {
          name: 'url',
          type: 'text',
          required: true,
          validate: (value: unknown) =>
            typeof value === 'string' && /^https:\/\/\S+$/.test(value.trim())
              ? true
              : 'Zadejte absolutní https:// odkaz.',
        },
      ],
    },
  ],
  hooks: {
    /**
     * Read on EVERY page, because the footer needs the contact address and
     * the help-line number. So it is the most cached thing on the site and
     * the one whose staleness is most visible — a corrected help-line number
     * has to appear at once, not in five minutes.
     *
     * No `afterDelete`: a global cannot be deleted.
     */
    afterChange: [revalidateOnChange(CACHE_TAGS.siteSettings)],
  },
  label: 'Nastavení webu',
}
