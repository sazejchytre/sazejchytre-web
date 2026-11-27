# Database

Postgres (Neon in production). Two schemas with two owners. Verified on
2026-11-27 by running every migration against an empty Postgres 16.

## Schemas and owners

| Schema   | Owner       | Migrated by         | Tables                                                    |
| -------- | ----------- | ------------------- | --------------------------------------------------------- |
| `public` | Payload     | `pnpm migrate`      | see below                                                 |
| `auth`   | better-auth | `pnpm auth:migrate` | `user`, `session`, `account`, `verification`, `twoFactor` |

Order on an empty database: `pnpm migrate`, then `pnpm auth:migrate`, then
`pnpm seed` (plans and prices). The reasoning is in README, "Database
ownership".

## `public` tables by domain

- **Admin/CMS:** `users`, `users_sessions`, `media`, `site_settings`,
  `site_settings_social_links`, `legal_pages`, `faq_entries`,
  `contact_submissions`, `payload_*` internals.
- **Auth support:** `auth_lockouts`.
- **Billing:** `customers`, `billing_provider_refs`, `plans`,
  `plans_features`, `prices`, `subscriptions`, `subscription_events`,
  `entitlement_grants`, `webhook_events`, `disputes`, `consent_records`.
- **Accounting:** `invoices`, `credit_notes`.
- **Tips:** `sports`, `competitions`, `sporting_events`, `tips`,
  `tip_selections`, `tip_audit_events`.

## Invariants enforced by the database

These are the guarantees. Code mirrors them; the database is what holds.

| Kind                   | Name                                                                                   | Guarantees                                                                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| trigger                | `tips_immutable_after_publication`                                                     | published tip content cannot be updated                                                                                                                   |
| trigger                | `tips_no_delete_after_publication`                                                     | published tips cannot be deleted                                                                                                                          |
| trigger                | `tip_selections_immutable_after_publication`, `..._no_insert_...`, `..._no_delete_...` | selections frozen once the tip is published                                                                                                               |
| trigger                | `tip_audit_events_no_update`, `tip_audit_events_no_delete`                             | audit log is append-only                                                                                                                                  |
| trigger                | `credit_notes_total_within_invoice`                                                    | credits never exceed the invoice                                                                                                                          |
| check                  | `invoices_totals_add_up`                                                               | total = parts                                                                                                                                             |
| check                  | `invoices_no_vat_when_not_registered`                                                  | no VAT while operator is not a VAT payer                                                                                                                  |
| check                  | `entitlement_grants_exactly_one_target`, `entitlement_grants_window_ordered`           | grant shape and time window                                                                                                                               |
| check                  | `subscriptions_period_ordered`                                                         | period start before end                                                                                                                                   |
| check                  | `consent_records_withdrawal_ordered`                                                   | withdrawal after consent                                                                                                                                  |
| unique/partial indexes | see migrations                                                                         | one active price per plan + currency + interval; one webhook claim per event; one invoice per confirmed payment; refund idempotency on provider refund id |

All of the above are exercised by `pnpm test:db` (121 tests, all passing on
2026-11-27 against local Postgres).

## Rules for changes

1. Never edit a committed migration. Add a new one with
   `pnpm migrate:create <name>`.
2. A migration that touches a table with a trigger above needs Codex review
   and a DB test proving the trigger still fires.
3. Never drop or disable an immutability trigger, not even temporarily. The
   legitimate workarounds are in README, "Working around them legitimately".
4. Production migrations run only after explicit product-owner approval, from
   the deploy procedure in `docs/DEPLOYMENT.md`, after a fresh backup.
5. `pnpm seed:tips` writes fixture tips. Never run it against production
   (a guard is SC-004 scope).

## Backups

Neon provides point-in-time restore within its plan's history window. In
addition, a nightly `pg_dump` to a private R2 bucket is planned (SC-009) so a
restore does not depend on a single provider. A restore must be tested before
launch (`docs/LAUNCH-CHECKLIST.md`).
