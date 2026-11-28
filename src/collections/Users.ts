import type { CollectionConfig } from 'payload'

import { canAccessAdminPanel, isAdmin } from '@/lib/access'
import {
  refuseLastAdministratorRemoval,
  refuseUnauthorisedAdministratorCreation,
} from '@/lib/admin-presence/hooks'

/**
 * Admin users. This is the only auth-enabled collection, and every user in
 * it is a full administrator.
 *
 * Every access rule is written out explicitly — Payload's defaults grant public
 * read to non-auth collections, and inheriting a default is how a collection
 * ends up world-readable by accident.
 *
 * HOW ADMINISTRATORS COME INTO EXISTENCE
 *
 * Outside development, only two ways:
 *   - a signed-in administrator creates another one (REST or the panel);
 *   - the private initialization command (`src/scripts/admin-init.ts`,
 *     procedure in `docs/DEPLOYMENT.md`) creates the first one, and only
 *     while no verified administrator exists.
 *
 * The rule lives in the `beforeOperation` hook, which runs on every create
 * regardless of access overrides. Under `next dev` Payload's default setup
 * flow is left as it is, so a fresh local database is usable without extra
 * steps.
 *
 * The last verified administrator cannot be removed through Payload
 * (`beforeDelete`). Removal by any other route — SQL, a restore, a different
 * database — is caught by the running server's presence check, which stops
 * the server (`src/lib/admin-presence/runtime.ts`).
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
    // Every user is created by an administrator. The initialization command
    // is the one exception, enforced in `beforeOperation` below.
    create: isAdmin,
    read: isAdmin,
    update: isAdmin,
    delete: isAdmin,
    admin: canAccessAdminPanel,
    unlock: isAdmin,
  },
  hooks: {
    beforeOperation: [refuseUnauthorisedAdministratorCreation],
    beforeDelete: [refuseLastAdministratorRemoval],
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
