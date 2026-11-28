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
  `tip_selections`, `tip_audit_events`, `tip_corrections`.

## Invariants enforced by the database

These are the guarantees. Code mirrors them; the database is what holds.

| Kind                   | Name                                                                                                                                                      | Guarantees                                                                                                                                                                                                                                                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| trigger                | `tips_immutable_after_publication`                                                                                                                        | a published tip is compared as a whole row: only `status` (DRAFT → PUBLISHED → SETTLED or VOIDED, terminal) and `settled_at` (once, with the final status) may change. Publication needs `published_at`, at least one selection and READ COMMITTED; it locks the tip's events, competitions and sport. SETTLED needs every leg decided |
| trigger                | `tips_insert_as_draft`                                                                                                                                    | a tip is inserted as DRAFT; publication is always the checked transition above                                                                                                                                                                                                                                                         |
| trigger                | `tips_no_delete_after_publication`                                                                                                                        | published tips cannot be deleted                                                                                                                                                                                                                                                                                                       |
| trigger                | `tip_selections_immutable_after_publication`, `..._no_insert_...`, `..._no_delete_...`                                                                    | the legs of a published tip cannot be added, removed, moved in or out (both parents are checked) or changed. The result moves one way while the tip is PUBLISHED (outcome from PENDING, closing price and `settled_at` from empty); any other result change must match a correction recorded in the same transaction                   |
| trigger                | `sporting_events_locked_after_publication`, `competitions_locked_after_publication`, `sports_locked_after_publication`, `..._no_delete_after_publication` | once a published tip depends on a row (`record_locked_at` set), its identifying fields are frozen and it cannot be deleted. Still mutable: event `status`, `final_score`, `external_refs`; competition `external_refs`; sport `active`, `sort_order`                                                                                   |
| trigger                | `tip_corrections_prepare`, `tip_corrections_apply`, `tip_corrections_no_update`, `tip_corrections_no_delete`                                              | inserting a correction records the true previous value, author, reason, database role, transaction and time, and applies the change in the same statement. Corrections are append-only                                                                                                                                                 |
| trigger                | `tip_audit_events_no_update`, `tip_audit_events_no_delete`                                                                                                | audit log is append-only                                                                                                                                                                                                                                                                                                               |
| trigger                | `tips_no_truncate`, `tip_selections_no_truncate`, `tip_audit_events_no_truncate`, `tip_corrections_no_truncate`                                           | the record cannot be truncated, also through `TRUNCATE ... CASCADE`                                                                                                                                                                                                                                                                    |
| trigger                | `credit_notes_total_within_invoice`                                                                                                                       | credits never exceed the invoice                                                                                                                                                                                                                                                                                                       |
| check                  | `invoices_totals_add_up`                                                                                                                                  | total = parts                                                                                                                                                                                                                                                                                                                          |
| check                  | `invoices_no_vat_when_not_registered`                                                                                                                     | no VAT while operator is not a VAT payer                                                                                                                                                                                                                                                                                               |
| check                  | `entitlement_grants_exactly_one_target`, `entitlement_grants_window_ordered`                                                                              | grant shape and time window                                                                                                                                                                                                                                                                                                            |
| check                  | `subscriptions_period_ordered`                                                                                                                            | period start before end                                                                                                                                                                                                                                                                                                                |
| check                  | `consent_records_withdrawal_ordered`                                                                                                                      | withdrawal after consent                                                                                                                                                                                                                                                                                                               |
| unique/partial indexes | see migrations                                                                                                                                            | one active price per plan + currency + interval; one webhook claim per event; one invoice per confirmed payment; refund idempotency on provider refund id                                                                                                                                                                              |

All of the above are exercised by `pnpm test:db` (158 tests, all passing on
2026-11-28 against a fresh local PostgreSQL 16 fixture database).

## The published record

What holds once a tip leaves DRAFT, whoever writes: Payload with or without
access control, a script, a migration or a `psql` session as the application
role. Triggers: `20261015_201500_tip_immutability_triggers` (original) and
`20261128_192000_sc_023_record_invariant_triggers` (replaces its functions under
the same names and adds the rest). Tests: `src/lib/tips/immutability.db-test.ts`
and `src/lib/tips/record-invariants.db-test.ts`.

**What is frozen.** The tip row, every leg of it (the set of legs too), and the
identifying fields of the event, competition and sport it refers to. The public
pages read the fixture, kick-off, competition and sport from those rows, so they
are locked in place rather than copied into a snapshot: a copy nobody reads
would leave the displayed record editable. Frozen rows are compared as whole
rows minus a short list of columns that may change, so a column added later is
frozen by default.

**What may still change.** The tip's status along DRAFT → PUBLISHED →
SETTLED or VOIDED, with `settled_at` written once, together with the final
status. A leg's result while the tip is PUBLISHED: the outcome from PENDING to a
decided value, the closing price and `settled_at` from empty to a value. The
event's `status`, `final_score` and `external_refs`, a competition's
`external_refs`, a sport's `active` and `sort_order`. Nothing about the result
moves once the tip is SETTLED or VOIDED, except by a correction.

**Corrections.** A recorded result is changed only by inserting a row into
`tip_corrections` (admin collection "Opravy výsledků", or SQL). The insert
locks the leg and its tip, copies the current outcome and closing price as the
previous value, stamps the author, reason, `recorded_at`, `database_role` and
`transaction_id`, and applies the new value in the same statement. The leg
trigger accepts a rewritten result only when it matches the latest correction
for that leg in the current transaction, so a correction cannot be replayed
and a rollback removes both. A correction never settles a pending leg, never
returns a decided one to PENDING (so a SETTLED tip keeps every leg decided) and
cannot clear a closing price. Corrections cannot be updated, deleted or
truncated. The tip's own status is terminal and has no correction path.

**Locking.** Every writer of a leg (insert, update, delete, correction) takes
the parent tip row `FOR NO KEY UPDATE`, the lock the publishing `UPDATE`
holds, and for a move it takes both parents in id order. Publication then locks
the referenced rows in one global order: events, competitions, sports, each by
id. A leg write and a publication of the same tip therefore never interleave,
and concurrent publications sharing rows queue instead of deadlocking. Leg
writes of one tip are serialised, so the writer of the last leg sees the others
and settles the tip. Publication is refused outside READ COMMITTED, because the
lock protocol relies on each statement seeing what committed before its lock
was granted. An editor of a locked row under REPEATABLE READ or SERIALIZABLE
whose snapshot predates the lock gets a serialisation failure.

**Existing data.** The migration stamps `record_locked_at` on rows that already
published tips depend on with the time the migration runs. That is when the
lock started, not when the tip was published: values those rows held at
publication were never recorded and are not reconstructed. The migration logs
three counts it cannot vouch for: published tips without a selection, SETTLED
tips with a pending leg, and events whose `updated_at` is later than the
publication of a tip that depends on them. A non-zero count needs a human
decision; the migration changes no row to make it fit.

## Rules for changes

1. Never edit a committed migration. Add a new one with
   `pnpm migrate:create <name>`.
2. A migration that touches a table with a trigger above needs Codex review
   and a DB test proving the trigger still fires.
3. Keep immutability triggers active throughout development and testing.
   Retire local fixture databases using the workflow in [TESTING.md](TESTING.md#checking-and-retiring-a-fixture-database).
4. Production migrations run only after explicit product-owner approval, from
   the deploy procedure in `docs/DEPLOYMENT.md`, after a fresh backup.
5. Use a local fixture database for sample tips and DB tests.

## Local fixture database

Create a fresh database from `template0` in the verified local cluster for
each test lifecycle. Pick an unused name starting with `sc_fixture_`, followed
by 1–40 lowercase letters, digits or underscores. The example uses
`sc_fixture_example`. Stop on the first SQL error (`psql -v ON_ERROR_STOP=1`).
Only label a database you just created for this purpose.

```sql
CREATE DATABASE sc_fixture_example TEMPLATE template0;
COMMENT ON DATABASE sc_fixture_example IS 'sazejchytre:disposable:v1:sc_fixture_example';
REVOKE ALL ON DATABASE sc_fixture_example FROM PUBLIC;
```

The creating login owns the database, runs both migration commands and
retires the database. Use a separate local application login with a password
set interactively using psql. Create the role once per local test cluster,
then grant it CONNECT for each new fixture database:

```sql
CREATE ROLE sc_fixture_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
\password sc_fixture_app
GRANT CONNECT ON DATABASE sc_fixture_example TO sc_fixture_app;
```

As the owner, point `DATABASE_URL` at the new database, run `pnpm migrate`
and `pnpm auth:migrate`, then connect to **that database** and grant the
application access to its migrated objects:

```sql
GRANT USAGE ON SCHEMA public, auth TO sc_fixture_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public, auth TO sc_fixture_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public, auth TO sc_fixture_app;
```

Use the application login for billing seed, tip fixtures and tests. Give it
no role memberships, object ownership, schema creation or table truncation
rights. The local URL must include credentials, `127.0.0.1`, an explicit
port and the database name. The optional query string is `?sslmode=disable`.
The PostgreSQL database comment is the owner's positive designation of this
database. The test process reads it from the live catalog.
See [TESTING.md](TESTING.md#running-db-tests-locally) for execution and retirement.

## Backups

Neon provides point-in-time restore within its plan's history window. In
addition, a nightly `pg_dump` to a private R2 bucket is planned (SC-009) so a
restore does not depend on a single provider. A restore must be tested before
launch (`docs/LAUNCH-CHECKLIST.md`).
