import type { CollectionConfig } from 'payload'

import { canAccessAdminPanel, denyAll, isAdmin } from '@/lib/access'
import { blockDeletes } from '@/lib/billing/append-only'

/**
 * A record of every temporary account lockout, for support.
 *
 * WHY THIS EXISTS ALONGSIDE REDIS
 *
 * The lock itself lives in Redis, because that is where the check has to be:
 * it must be fast and it must expire on its own. But a Redis key with a TTL is
 * invisible the moment it lapses, so "why could I not sign in yesterday?" has
 * no answer — exactly the question support gets.
 *
 * So the lock is written twice, for two different jobs:
 *
 *   - Redis  — the enforcement. Authoritative, expires by itself.
 *   - here   — the history. Durable, visible in /admin, survives the lock.
 *
 * This collection never gates anything. If a write here fails, sign-in is
 * unaffected: losing a support note must not lock anyone out, and must not let
 * anyone in either.
 *
 * PRIVACY: the attempted address is stored in readable form so support can
 * search for it, which is the entire point. That means this table accumulates
 * addresses that people merely *tried*, including ones with no account. It is
 * admin-only on every operation, append-only, and is the reason the retention
 * note below exists.
 *
 * RETENTION: nothing prunes this yet. It should be swept on a schedule once
 * there is a job runner — a lockout from two years ago answers no support
 * question and is only a liability. Flagged in the step report.
 */
export const AuthLockouts: CollectionConfig = {
  slug: 'auth-lockouts',
  admin: {
    useAsTitle: 'identifier',
    defaultColumns: ['identifier', 'failures', 'lockedUntil', 'createdAt'],
    group: 'Zabezpečení',
    description:
      'Historie dočasných uzamčení účtu. Vynucení běží v Redisu; tohle je jen záznam pro podporu.',
  },
  access: {
    // Written by the sign-in path with overrideAccess, never by a request.
    create: isAdmin,
    read: isAdmin,
    // A historical record that can be edited is not a record.
    update: denyAll,
    delete: denyAll,
    admin: canAccessAdminPanel,
  },
  indexes: [{ fields: ['identifier', 'lockedUntil'], unique: false }],
  fields: [
    {
      name: 'identifier',
      type: 'text',
      required: true,
      index: true,
      admin: {
        description:
          'Adresa, na kterou se útočník nebo uživatel pokoušel přihlásit. Může jít i o adresu bez účtu.',
      },
    },
    {
      name: 'failures',
      type: 'number',
      required: true,
      admin: {
        description: 'Počet neúspěšných pokusů v řadě, který uzamčení spustil.',
      },
      validate: (value: unknown) =>
        Number.isInteger(value) && (value as number) >= 0
          ? true
          : 'failures must be a non-negative integer.',
    },
    {
      name: 'lockSeconds',
      type: 'number',
      required: true,
      admin: { description: 'Délka uzamčení v sekundách.' },
      validate: (value: unknown) =>
        Number.isInteger(value) && (value as number) >= 0
          ? true
          : 'lockSeconds must be a non-negative integer.',
    },
    {
      name: 'lockedUntil',
      type: 'date',
      required: true,
      index: true,
      admin: { description: 'Do kdy uzamčení platilo.' },
    },
    {
      name: 'ipCountry',
      type: 'text',
      maxLength: 2,
      admin: {
        description:
          'Země pokusu podle edge. Celou IP adresu neukládáme ani tady.',
      },
    },
    {
      name: 'reason',
      type: 'select',
      options: [
        { label: 'SIGN_IN_FAILURES', value: 'SIGN_IN_FAILURES' },
        { label: 'TOTP_FAILURES', value: 'TOTP_FAILURES' },
      ],
      required: true,
      defaultValue: 'SIGN_IN_FAILURES',
    },
  ],
  hooks: {
    beforeDelete: [blockDeletes('A lockout record')],
  },
  labels: { singular: 'Uzamčení účtu', plural: 'Uzamčení účtu' },
  timestamps: true,
}
