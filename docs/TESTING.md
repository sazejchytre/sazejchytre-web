# Testing

## Suites

| Command                 | Files                 | Needs                                                                              | In CI today                           |
| ----------------------- | --------------------- | ---------------------------------------------------------------------------------- | ------------------------------------- |
| `pnpm test`             | `src/**/*.test.ts`    | nothing (Node native type stripping)                                               | yes                                   |
| Guarded DB runner below | `src/**/*.db-test.ts` | marked local PostgreSQL database with migrations and billing seed                  | **no** (SC-011)                       |
| `pnpm test:stripe`      | `*.stripe-test.ts`    | Stripe **test** keys                                                               | no, manual                            |
| `pnpm test:fakturoid`   | `*.fakturoid-test.ts` | `FAKTUROID_LIVE_TEST=1` plus whatever Fakturoid credentials are in the environment | no, manual. **See the warning below** |
| Playwright e2e          | none yet              | running app + test DB                                                              | no (SC-011)                           |

**`pnpm test:fakturoid` has no technical safeguard.** The flag is only an
opt-in; the command uses the credentials it finds in the environment and can
create real, permanently numbered accounting documents. Nothing in the code
verifies that the target is a sandbox. The separation is procedural: run it
only with credentials of an account created for testing, and keep
`ACCOUNTING_PROVIDER=FAKE` (the default) or an HTTP stub for ordinary QA.

## Running DB tests locally

Use a dedicated PostgreSQL 16 instance bound to loopback. Before provisioning,
check its container ID and published port with `docker inspect` and `docker port`.
Connect over that port and check `current_database()`, `current_user`,
`inet_server_addr()` and `inet_server_port()` against the expected instance.
Docker reports the published host port; SQL reports the container's internal port.
Provision a fresh fixture database and its two roles as described in [DATABASE.md](DATABASE.md#local-fixture-database).

Load the nonfunctional integration values from the CI workflow, use
`NODE_ENV=development` and `ACCOUNTING_PROVIDER=FAKE`. Set `DATABASE_URL` to
the **application** login on the fixture database. In a shell with those values:

```bash
pnpm seed                  # plans and prices required by the DB suites
node --import tsx src/scripts/test-disposable-database.ts
pnpm seed:tips             # optional, for a local sample history
```

The runner checks and holds the target before starting any test worker.
Use this runner for the complete suite. The existing `pnpm test:db` alias
starts Node directly. Sample tips keep their `seedMarker` for SC-024's
public projection work. Keep fixture databases and their dumps local.

### Checking and retiring a fixture database

Stop processes using this fixture database. For the owner-run lifecycle test,
keep the application URL in `DATABASE_URL`, set `DISPOSABLE_OWNER_URL` to the
migration owner's URL for the same database, `DISPOSABLE_DROP_DATABASE` to
its exact name, and `DISPOSABLE_MAINTENANCE_DATABASE` to a separate local
control database on the same server. Use an exclusively assigned fixture DB.

```bash
node --import tsx --test src/lib/testing/disposal.integration.ts
```

The check exercises an absent marker and kills a dedicated cleanup process
before commit, then reconnects and compares all trigger states. To discard
the entire database and all fixtures after testing, use the same confirmation
and control database in a one-command owner session:

```bash
DATABASE_URL="$DISPOSABLE_OWNER_URL" pnpm seed:tips:purge
```

Use the same retirement procedure to discard a partially seeded run.
Active connections prevent retirement. Close them and retry. An interruption
before the rename commits leaves the original name intact. After commit, a
surviving database has a unique `sc_retired_` name. The owner can locate it
in `pg_database` by its original, name-bound database comment, verify its
OID and owner, then drop that exact retired database. Start the next run
with a fresh fixture database.

## What must be added before the paid launch (SC-011)

1. CI job `db` with a `postgres:16` service running migrate, auth:migrate,
   seed, `test:db`.
2. Playwright smoke suite against a production build with a seeded test DB:
   - public history renders for an anonymous visitor, losses included;
   - pending tip as anonymous: no selection, odds, stake or rationale in
     HTML **or** in the RSC payload (`?_rsc` / flight data) **or** in
     metadata;
   - same tip as entitled subscriber: FULL rendered;
   - expired subscription: back to LOCKED;
   - sign-up, verify email (captured), sign-in, 2FA enrol, sign-out;
   - newsletter and contact forms with Turnstile test keys;
   - mobile viewport 375 px for the above.
3. Stripe test-mode checklist (SC-010) run by hand and recorded.

## Reporting

Paste the real summary lines (`# tests`, `# pass`, `# fail`, build route
table or error). A check that was not run is reported as "not run" with the
reason.
