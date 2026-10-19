import type { CollectionBeforeValidateHook, CollectionConfig } from 'payload'
import { APIError } from 'payload'

import { canAccessAdminPanel, isAdmin } from '@/lib/access'
import { CURRENCIES, toOptions } from '@/lib/billing/constants'
import { InvalidCountryCodeError } from '@/lib/billing/errors'
import { normaliseCountryCode } from '@/lib/billing/countries'

/**
 * A billing counterparty.
 *
 * Deliberately NOT an auth collection. Step 3 introduces better-auth and will
 * populate `authUserId`; keeping identity and billing in separate tables means
 * a customer can exist before anyone signs in (a consent record or an invoice
 * can precede an account) and an auth provider can be swapped without touching
 * billing history.
 *
 * `currency` is the customer's locked settlement currency. It is null until
 * their first subscription and fixed afterwards — see the currency-lock hook on
 * Subscriptions for the reasoning and the enforcement.
 */

const normaliseBillingCountry: CollectionBeforeValidateHook = ({ data }) => {
  if (data?.billingCountry === undefined || data.billingCountry === null) {
    return data
  }

  try {
    // Store the canonical upper-case form so queries and comparisons against
    // ISO codes elsewhere never have to care about input casing.
    return {
      ...data,
      billingCountry: normaliseCountryCode(data.billingCountry),
    }
  } catch (error) {
    if (error instanceof InvalidCountryCodeError) {
      throw new APIError(error.message, 400)
    }

    throw error
  }
}

const normaliseEmail: CollectionBeforeValidateHook = ({ data }) => {
  if (typeof data?.email !== 'string') {
    return data
  }

  // Lower-cased so the unique index actually prevents duplicate humans.
  return { ...data, email: data.email.trim().toLowerCase() }
}

export const Customers: CollectionConfig = {
  slug: 'customers',
  admin: {
    useAsTitle: 'email',
    defaultColumns: [
      'email',
      'name',
      'billingCountry',
      'currency',
      'createdAt',
    ],
    group: 'Billing',
  },
  access: {
    create: isAdmin,
    read: isAdmin,
    update: isAdmin,
    delete: isAdmin,
    admin: canAccessAdminPanel,
  },
  fields: [
    {
      name: 'email',
      type: 'email',
      required: true,
      unique: true,
      index: true,
      admin: {
        description:
          'Billing email. Normalised to lower case so the unique index is meaningful.',
      },
    },
    {
      name: 'name',
      type: 'text',
      required: true,
      admin: { description: 'Name as it should appear on an invoice.' },
    },
    {
      name: 'billingCountry',
      type: 'text',
      required: true,
      maxLength: 2,
      minLength: 2,
      index: true,
      admin: {
        description:
          'ISO 3166-1 alpha-2, upper case. Free text rather than an enum so adding a market needs no migration.',
      },
    },
    {
      name: 'preferredLocale',
      type: 'select',
      options: toOptions(['cs', 'sk', 'en'] as const),
      required: true,
      defaultValue: 'cs',
      admin: { description: 'Language for invoices and transactional email.' },
    },
    {
      name: 'currency',
      type: 'select',
      options: toOptions(CURRENCIES),
      admin: {
        description:
          'Settlement currency, locked on the first subscription. Null before that. Never edit by hand: a live subscription cannot change currency.',
      },
    },
    {
      name: 'authUserId',
      type: 'text',
      unique: true,
      index: true,
      admin: {
        description:
          'Populated by step 3 from better-auth. Null for customers who have no account yet.',
      },
    },
    {
      name: 'fakturoidSubjectId',
      type: 'text',
      unique: true,
      index: true,
      admin: {
        description:
          'This customer as a Fakturoid subject. Cached so issuing does not look it up every time; null until their first document.',
      },
    },
  ],
  hooks: {
    beforeValidate: [normaliseEmail, normaliseBillingCountry],
  },
  labels: { singular: 'Customer', plural: 'Customers' },
  timestamps: true,
}
