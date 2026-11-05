import type { CollectionConfig } from 'payload'

import { canAccessAdminPanel, isAdmin } from '@/lib/access'
import { CACHE_TAGS } from '@/lib/cache/keys'
import {
  revalidateOnChange,
  revalidateOnDelete,
} from '@/lib/content/revalidate'

/**
 * FAQ entries, editable without a deploy.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THESE FEED JSON-LD AS WELL AS THE PAGE
 *
 * The homepage emits `FAQPage` structured data built from exactly these rows,
 * which is the whole reason the answers live in the database rather than in
 * the message catalogue: the operator will want to edit the answer about how
 * ROI is calculated, and a deploy for a sentence is a deploy that does not
 * happen.
 *
 * It also means an answer must be plain prose. Google requires the answer
 * text in `FAQPage` to match what the page shows, so a rich-text answer with
 * a table in it would either be stripped into nonsense for the structured
 * data or make the two disagree. Hence `textarea`, not `richText`.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE FOUR QUESTIONS THE BRIEF REQUIRES
 *
 * How ROI is calculated, what happens to void bets, whether this is
 * gambling, and what a subscriber actually gets. They are seeded rather than
 * hard-coded so the operator can reword them — but `required` on the
 * homepage means the page renders whatever is published, and an empty FAQ is
 * an empty section rather than a crash.
 */
export const FaqEntries: CollectionConfig = {
  slug: 'faq-entries',
  admin: {
    useAsTitle: 'question',
    defaultColumns: ['question', 'sortOrder', 'published'],
    group: 'Obsah',
    description:
      'Otázky a odpovědi na úvodní stránce. Odpovědi jdou i do strukturovaných dat, takže musí být čistý text.',
  },
  access: {
    create: isAdmin,
    read: ({ req }) => {
      if (req.user?.collection === 'users') return true

      return { published: { equals: true } }
    },
    update: isAdmin,
    delete: isAdmin,
    admin: canAccessAdminPanel,
  },
  defaultSort: 'sortOrder',
  indexes: [{ fields: ['published', 'sortOrder'], unique: false }],
  fields: [
    {
      name: 'question',
      type: 'text',
      required: true,
      admin: {
        description: 'Otázka tak, jak by ji napsal čtenář. Ne nadpis — otázka.',
      },
    },
    {
      name: 'answer',
      type: 'textarea',
      required: true,
      admin: {
        description:
          'Čistý text. Jde do strukturovaných dat, kde musí odpovídat tomu, co je na stránce.',
      },
    },
    {
      name: 'sortOrder',
      type: 'number',
      required: true,
      defaultValue: 0,
      admin: {
        description:
          'Menší číslo je výš. Integer — viz src/lib/billing/schema.ts.',
      },
      validate: (value: unknown) =>
        Number.isInteger(value) ? true : 'sortOrder must be an integer.',
    },
    {
      name: 'published',
      type: 'checkbox',
      required: true,
      defaultValue: true,
      index: true,
    },
  ],
  hooks: {
    /**
     * These answers also feed the homepage's `FAQPage` structured data, which
     * Google requires to match what the page shows. A cached answer that has
     * since been edited would make the markup and the page disagree — which
     * is treated as spam, and correctly so.
     */
    afterChange: [revalidateOnChange(CACHE_TAGS.faqEntries)],
    afterDelete: [revalidateOnDelete(CACHE_TAGS.faqEntries)],
  },
  labels: { singular: 'Otázka a odpověď', plural: 'Otázky a odpovědi' },
  timestamps: true,
}
