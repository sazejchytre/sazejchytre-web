import type { CollectionBeforeValidateHook, CollectionConfig } from 'payload'
import { APIError } from 'payload'

import { canAccessAdminPanel, isAdmin } from '@/lib/access'
import { CACHE_TAGS } from '@/lib/cache/keys'
import {
  revalidateOnChange,
  revalidateOnDelete,
} from '@/lib/content/revalidate'

/**
 * The legal documents: terms, privacy, cookies, methodology.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THE VERSION STRING IS NOT DECORATION
 *
 * A `ConsentRecord` stores the version of the document the customer agreed
 * to — `documentVersion` on that collection, added in step 2. That reference
 * is what makes a consent defensible years later: "they agreed to terms
 * v2026-01" means something only while v2026-01 can still be produced.
 *
 * So the version is REQUIRED, and a published document's version plus slug
 * must be unique. Editing the text of a version somebody has already
 * consented to silently rewrites what they agreed to, which is why a change
 * of substance is a NEW version rather than an edit — `publishedAt` and the
 * version index make that visible rather than enforcing it, because a typo
 * fix genuinely should not mint a version.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ACCESS
 *
 * Public read of PUBLISHED documents only; everything else is admin. The read
 * predicate is a query constraint rather than a boolean, so an unpublished
 * draft is invisible to the public API as well as to the page — a draft
 * privacy policy leaking through `/api/legal-pages` would be worse than the
 * page simply not existing yet.
 */

export const LEGAL_PAGE_SLUGS = [
  'obchodni-podminky',
  'ochrana-osobnich-udaju',
  'cookies',
  'metodika',
] as const

export type LegalPageSlug = (typeof LEGAL_PAGE_SLUGS)[number]

/**
 * An effective date in the future is a document that is not in force yet.
 *
 * Allowed — scheduling a terms change is legitimate and common — but it must
 * not be served as current, so the loader filters on it. Checked here only
 * for the one case that is certainly a mistake: published, with no date at
 * all.
 */
const requireEffectiveDate: CollectionBeforeValidateHook = ({
  data,
  operation,
  originalDoc,
}) => {
  if (operation !== 'create' && operation !== 'update') {
    return data
  }

  const merged = { ...originalDoc, ...data } as Record<string, unknown>

  if (merged.published === true && !merged.effectiveFrom) {
    throw new APIError(
      'A published legal document needs an effective date: a consent record ' +
        'that points at a version with no date cannot be defended.',
      400,
    )
  }

  return data
}

export const LegalPages: CollectionConfig = {
  slug: 'legal-pages',
  admin: {
    useAsTitle: 'title',
    defaultColumns: [
      'title',
      'pageSlug',
      'version',
      'effectiveFrom',
      'published',
    ],
    group: 'Obsah',
    description:
      'Právní dokumenty. Změna obsahu, ke kterému už někdo udělil souhlas, patří do nové verze.',
  },
  access: {
    create: isAdmin,
    read: ({ req }) => {
      // An admin sees everything, including drafts.
      if (req.user?.collection === 'users') return true

      // Everyone else sees published documents only. A CONSTRAINT, not false:
      // this is what keeps a draft privacy policy out of the public REST API
      // as well as off the page.
      return { published: { equals: true } }
    },
    update: isAdmin,
    delete: isAdmin,
    admin: canAccessAdminPanel,
  },
  defaultSort: 'pageSlug',
  indexes: [
    // One version per document, so re-publishing the same version by mistake
    // is refused rather than producing two documents the loader has to choose
    // between.
    { fields: ['pageSlug', 'version'], unique: true },
    { fields: ['pageSlug', 'published'], unique: false },
  ],
  fields: [
    {
      name: 'pageSlug',
      type: 'select',
      required: true,
      index: true,
      options: LEGAL_PAGE_SLUGS.map((value) => ({ label: value, value })),
      admin: {
        description:
          'Který dokument to je. URL se podle toho neurčuje dynamicky — každá stránka má vlastní route.',
      },
    },
    {
      name: 'title',
      type: 'text',
      required: true,
      admin: { description: 'Nadpis stránky, zobrazí se jako h1.' },
    },
    {
      name: 'version',
      type: 'text',
      required: true,
      admin: {
        description:
          'Např. 2026-01. Na tuto hodnotu odkazuje záznam o souhlasu, takže se u zveřejněné verze nemění.',
      },
    },
    {
      name: 'effectiveFrom',
      type: 'date',
      required: false,
      index: true,
      admin: {
        description:
          'Od kdy je dokument účinný. Budoucí datum je v pořádku — do té doby se neservíruje jako aktuální.',
        date: { pickerAppearance: 'dayOnly' },
      },
    },
    {
      name: 'published',
      type: 'checkbox',
      required: true,
      defaultValue: false,
      index: true,
      admin: {
        description:
          'Nezveřejněný dokument není vidět nikde — ani na stránce, ani v API.',
      },
    },
    {
      name: 'summary',
      type: 'textarea',
      required: false,
      admin: {
        description:
          'Jedna až dvě věty pro meta description. Bez toho se použije začátek textu.',
      },
    },
    {
      name: 'body',
      type: 'richText',
      required: true,
      admin: { description: 'Text dokumentu.' },
    },
  ],
  hooks: {
    beforeValidate: [requireEffectiveDate],
    /**
     * Clear the cached read as soon as the document is saved.
     *
     * Without this the five-minute clock in `content/loaders.ts` would be the
     * only thing that ever expired a legal page — so the operator would edit
     * the terms, reload, see the old text and conclude the save failed.
     */
    afterChange: [revalidateOnChange(CACHE_TAGS.legalPages)],
    afterDelete: [revalidateOnDelete(CACHE_TAGS.legalPages)],
  },
  labels: { singular: 'Právní dokument', plural: 'Právní dokumenty' },
  timestamps: true,
}
