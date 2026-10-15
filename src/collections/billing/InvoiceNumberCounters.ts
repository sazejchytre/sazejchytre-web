import type { CollectionConfig } from 'payload'

import { canAccessAdminPanel, denyAll, isAdmin } from '@/lib/access'
import { DOCUMENT_SERIES, toOptions } from '@/lib/billing/constants'

/**
 * One row per (series, year), holding the last number handed out.
 *
 * Modelled as a Payload collection purely so the table ships in the generated
 * migration and the schema stays single-source. Nothing reads or writes it
 * through Payload's document API in normal operation: `allocateDocumentNumber`
 * advances it with a single atomic
 * `INSERT … ON CONFLICT DO UPDATE … RETURNING` statement, because that is the
 * only way to hand out consecutive numbers without a read-modify-write race.
 *
 * The compound UNIQUE index on (series, year) is load-bearing, not an
 * optimisation: it is the conflict target that statement relies on. Remove it
 * and the upsert silently becomes an unconditional insert, producing one
 * counter row per allocation and duplicate document numbers.
 *
 * Deletes are denied. Resetting a counter would re-issue numbers that are
 * already on documents in a customer's and an accountant's hands.
 */
export const InvoiceNumberCounters: CollectionConfig = {
  slug: 'invoice-number-counters',
  admin: {
    useAsTitle: 'series',
    defaultColumns: ['series', 'year', 'lastNumber', 'updatedAt'],
    group: 'Billing',
    description:
      'Internal numbering state. Advanced atomically by allocateDocumentNumber — do not edit by hand.',
  },
  access: {
    // Created implicitly by the allocator's upsert; an admin may also seed a
    // series deliberately (for example to continue a series from a previous
    // system at a given offset).
    create: isAdmin,
    read: isAdmin,
    update: isAdmin,
    // Never: a reset re-issues numbers that already exist on real documents.
    delete: denyAll,
    admin: canAccessAdminPanel,
  },
  indexes: [{ fields: ['series', 'year'], unique: true }],
  fields: [
    {
      name: 'series',
      type: 'select',
      options: toOptions(DOCUMENT_SERIES),
      required: true,
    },
    {
      name: 'year',
      type: 'number',
      required: true,
      admin: { description: 'Calendar year. Each year restarts at 1.' },
      validate: (value: unknown) =>
        Number.isInteger(value) && (value as number) >= 2000
          ? true
          : 'year must be an integer >= 2000.',
    },
    {
      name: 'lastNumber',
      type: 'number',
      required: true,
      defaultValue: 0,
      admin: {
        description:
          'Highest sequence issued for this series and year. The next document takes lastNumber + 1.',
      },
      validate: (value: unknown) =>
        Number.isInteger(value) && (value as number) >= 0
          ? true
          : 'lastNumber must be a non-negative integer.',
    },
  ],
  labels: {
    singular: 'Invoice number counter',
    plural: 'Invoice number counters',
  },
  timestamps: true,
}
