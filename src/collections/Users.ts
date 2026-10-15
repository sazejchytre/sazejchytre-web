import type { CollectionConfig } from 'payload'

import { canAccessAdminPanel, isAdmin } from '@/lib/access'

/**
 * Admin users. This is the only auth-enabled collection.
 *
 * Every access rule is written out explicitly — Payload's defaults grant public
 * read to non-auth collections, and inheriting a default is how a collection
 * ends up world-readable by accident.
 */
export const Users: CollectionConfig = {
  slug: 'users',
  auth: {
    // Brute-force protection: 5 failures locks the account for 10 minutes.
    maxLoginAttempts: 5,
    lockTime: 10 * 60 * 1000,
    tokenExpiration: 2 * 60 * 60, // seconds
    depth: 0,
    useAPIKey: false,
  },
  admin: {
    useAsTitle: 'email',
    defaultColumns: ['email', 'name', 'updatedAt'],
    // Only signed-in users of this collection may open /admin at all.
    hidden: false,
  },
  access: {
    /**
     * NOTE ON `create`: Payload exempts the very first user from this rule via
     * its dedicated first-register flow, so /admin/create-first-user still
     * works on an empty database. Every subsequent user must be created by an
     * already-authenticated admin.
     */
    create: isAdmin,
    read: isAdmin,
    update: isAdmin,
    delete: isAdmin,
    admin: canAccessAdminPanel,
    unlock: isAdmin,
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      admin: { description: 'Display name shown in the admin panel.' },
    },
  ],
  timestamps: true,
}
