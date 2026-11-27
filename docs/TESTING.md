# Testing

## Suites

| Command               | Files                                      | Needs                                                    | In CI today                                |
| --------------------- | ------------------------------------------ | -------------------------------------------------------- | ------------------------------------------ |
| `pnpm test`           | `src/**/*.test.ts`                         | nothing (Node native type stripping)                     | yes                                        |
| `pnpm test:db`        | `src/**/*.db-test.ts` (6 files, 121 tests) | a Postgres with migrations + seed                        | **no** (SC-011)                            |
| `pnpm test:stripe`    | `*.stripe-test.ts`                         | Stripe **test** keys                                     | no, manual                                 |
| `pnpm test:fakturoid` | `*.fakturoid-test.ts`                      | a Fakturoid **sandbox** account, `FAKTUROID_LIVE_TEST=1` | no, manual, never against the real account |
| Playwright e2e        | none yet                                   | running app + test DB                                    | no (SC-011)                                |

## Running DB tests locally (verified 2026-11-27)

Use a throwaway database, never Neon production and never a shared dev
branch that holds anything you care about.

```bash
docker run -d --name sc-pg -e POSTGRES_USER=ci -e POSTGRES_PASSWORD=ci \
  -e POSTGRES_DB=ci -p 5432:5432 postgres:16
# load the CI placeholder env (see .github/workflows/ci.yml), then:
export NODE_ENV=development
export DATABASE_URL=postgresql://ci:ci@127.0.0.1:5432/ci?sslmode=disable
pnpm migrate && pnpm auth:migrate && pnpm seed
pnpm test:db      # expected: tests 121, pass 121
```

Without `pnpm seed` most DB tests fail with "seed must have run".

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
