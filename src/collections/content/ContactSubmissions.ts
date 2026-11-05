import type { CollectionConfig } from 'payload'

import { canAccessAdminPanel, denyAll, isAdmin } from '@/lib/access'

/**
 * Contact form submissions.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE ROW IS WRITTEN BEFORE THE EMAIL IS SENT
 *
 * A Resend failure must not lose the message. So the submission is stored
 * first, unconditionally, and the notification is attempted afterwards —
 * `notifiedAt` records whether it got out.
 *
 * The same shape as the invoicing flow, and for the same reason: the thing we
 * must not lose goes in the database, the third-party call goes after it, and
 * a separate field says how far the third party got. A customer who writes in
 * about a billing problem and gets silence because an email provider had a
 * bad minute is the exact failure this prevents.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * NOBODY READS THESE THROUGH THE API
 *
 * `read` is admin only — not a published-content constraint like the other
 * content collections. These are other people's messages, often containing
 * an email address and sometimes a billing complaint. `create` is denied to
 * everyone INCLUDING admins through the API, because the only legitimate
 * writer is the server action, which uses `overrideAccess`.
 *
 * That is stricter than it needs to be for an admin, and deliberately so: an
 * API that can forge a contact submission is an API that can be used to send
 * a notification email from our domain.
 */
export const ContactSubmissions: CollectionConfig = {
  slug: 'contact-submissions',
  admin: {
    useAsTitle: 'subject',
    defaultColumns: ['subject', 'email', 'createdAt', 'notifiedAt'],
    group: 'Obsah',
    description:
      'Zprávy z kontaktního formuláře. Zapisují se před odesláním notifikace, takže se neztratí ani když e-mail nevyjde.',
  },
  access: {
    // Only the server action writes here, with overrideAccess. See above.
    create: denyAll,
    read: isAdmin,
    // Permitted so the notification outcome can be recorded after the fact.
    update: isAdmin,
    delete: isAdmin,
    admin: canAccessAdminPanel,
  },
  defaultSort: '-createdAt',
  indexes: [{ fields: ['notifiedAt'], unique: false }],
  fields: [
    { name: 'name', type: 'text', required: true },
    { name: 'email', type: 'text', required: true, index: true },
    { name: 'subject', type: 'text', required: true },
    { name: 'message', type: 'textarea', required: true },
    {
      name: 'notifiedAt',
      type: 'date',
      required: false,
      admin: {
        description:
          'Kdy odešla notifikace. Prázdné znamená, že zpráva přišla, ale e-mail nevyšel — podívejte se na notifyError.',
      },
    },
    {
      name: 'notifyError',
      type: 'text',
      required: false,
      admin: {
        description:
          'Proč notifikace nevyšla. Nikdy neobsahuje text zprávy ani tajemství.',
      },
    },
    /**
     * Evidence, kept deliberately coarse.
     *
     * The IP is stored as a truncated prefix via the step 3 helper, never in
     * full: enough to recognise a flood from one network, not enough to
     * identify a person. A full address in a contact form table is personal
     * data we have no use for.
     */
    {
      name: 'ipPrefix',
      type: 'text',
      required: false,
      admin: {
        description:
          'Zkrácený prefix IP, ne celá adresa. Slouží jen k rozpoznání záplavy z jedné sítě.',
      },
    },
    /**
     * Was the bot check actually performed?
     *
     * Turnstile FAILS OPEN: if Cloudflare cannot be reached, the submission
     * is allowed through rather than lost, because a person locked out of
     * their account must still be able to write to support. That decision is
     * only defensible if the degradation is visible afterwards — otherwise
     * "where did this spam come from" has no answer, and a prolonged
     * Cloudflare outage looks identical to a working bot defence.
     *
     * The notification email says so too, so the operator reads the message
     * knowing the check did not run.
     */
    {
      name: 'turnstileDegraded',
      type: 'checkbox',
      required: false,
      defaultValue: false,
      index: true,
      admin: {
        description:
          'Zaškrtnuto znamená, že ověření proti robotům se nepodařilo provést (Cloudflare neodpověděl) a zpráva prošla jen na základě limitu a honeypotu.',
      },
    },
  ],
  labels: { singular: 'Zpráva z formuláře', plural: 'Zprávy z formuláře' },
  timestamps: true,
}
