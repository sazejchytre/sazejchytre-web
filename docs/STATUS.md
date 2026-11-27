# Project status

Last updated: 2026-11-27 by the project-management agent (Claude).
Baseline commit: `main` @ `466c542` (2026-11-06, "perf(fonts): outlined marks,
variable Inter, and a smaller preload set").

Every result below was produced by running the command on 2026-11-27 in a
clean clone, Node 22.23, pnpm 11.1.1. Nothing here is copied from an older CI
run.

## Check results on `main`

| Check                                                                               | Result   | Notes                                                                                                                                            |
| ----------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile`                                                    | pass     |                                                                                                                                                  |
| `pnpm typecheck`                                                                    | pass     |                                                                                                                                                  |
| `pnpm lint`                                                                         | pass     |                                                                                                                                                  |
| `pnpm test`                                                                         | pass     | 898 tests, 894 pass, 0 fail, 4 skipped (live-provider-only cases)                                                                                |
| `pnpm build` with CI env                                                            | **fail** | `Invalid server environment variables`: `ECOMAIL_API_KEY`, `ECOMAIL_LIST_ID`, `TURNSTILE_SECRET_KEY`, `TURNSTILE_SITE_KEY` missing from `ci.yml` |
| `pnpm build` with those 4 added as placeholders                                     | pass     | sitemap prerender logs `ECONNREFUSED 127.0.0.1:5432` and continues (expected, no DB at build)                                                    |
| `pnpm audit --audit-level high`                                                     | **fail** | 6 high: `undici` <7.30.1 (4 advisories, via payload), `happy-dom` <=21.0.3 (2 advisories, via `@lexical/headless`)                               |
| audit with overrides `undici: ^7.30.1`, `happy-dom: ^21.0.4`                        | pass     | verified in a scratch copy: typecheck, 894/894 tests and build still pass                                                                        |
| `pnpm test:db` on a fresh local Postgres 16 after `migrate`, `auth:migrate`, `seed` | pass     | 121/121. Not part of CI today                                                                                                                    |
| All 14 Payload migrations + better-auth migrations on an empty DB                   | pass     |                                                                                                                                                  |

Note: the build in the agent sandbox needed a local stub for `next/font/google`
because the sandbox cannot reach Google Fonts. In CI and on a normal machine
the fonts download at build time. This is a build-time network dependency
worth removing (see SC-005).

## What exists and is worth keeping

- **Auth** (better-auth in its own `auth` schema): sign-up, sign-in, email
  verification, password reset, TOTP 2FA, lockouts with retention sweep,
  rate-limit policy, common-password check.
- **Billing domain**: plans, prices, subscriptions, append-only subscription
  events, entitlement grants, disputes, refunds, webhook event claim table.
  Provider-agnostic `BillingPort` with Stripe and fake adapters.
- **Stripe webhook** `/webhooks/stripe`: signature verified on raw body,
  claim-based idempotency plus per-handler idempotency, concurrency covered by
  DB tests.
- **Invoicing**: Fakturoid as system of record, credit notes, over-credit
  refusal (trigger + code), private documents bucket, delivery retry cron.
- **Tips**: sports, competitions, events, tips, selections, audit events.
  Immutability after publication enforced by Postgres triggers. Settlement,
  series, archive, public track record. Result is public in every state.
- **Payload admin** with admin-only access on all business collections.
- **Public site**: home, history, methodology, pricing, contact, legal pages,
  account, invoices, security settings, newsletter (Ecomail, double opt-in,
  consent stored first), Turnstile + honeypot.
- **CI**: one job (typecheck, lint, test, build, audit) on every push.

## What is missing or broken (launch-relevant)

| #   | Finding                                                                                                                                                                                                                                                                                                   | Severity         | Issue            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ---------------- |
| 1   | CI build fails: 4 env vars missing in `ci.yml`                                                                                                                                                                                                                                                            | P0               | SC-003           |
| 2   | CI audit fails: 6 high advisories                                                                                                                                                                                                                                                                         | P0               | SC-003           |
| 3   | **Operator identity is placeholder.** `src/lib/legal/operator.ts` holds `TODO:` values and `OPERATOR_DETAILS_CONFIRMED = false`. In production the footer throws, so **every public page returns an error** until this is filled                                                                          | P0               | SC-015           |
| 4   | **Client IP is read from the first `X-Forwarded-For` entry** (5 places: `auth/config.ts`, `auth/actions.ts`, `auth/two-factor-actions.ts`, `forms/newsletter.ts`, `forms/contact.ts`). Correct on Vercel, spoofable behind a typical nginx on a VPS: rate limits and lockouts can be bypassed or poisoned | P0 for VPS       | SC-004           |
| 5   | **No paid zone.** `tipy/[slug]` always calls `tipDisclosure(tip, [], now)`; no page ever renders FULL (pick, odds, stake, rationale) for a subscriber                                                                                                                                                     | P1 (paid launch) | SC-008           |
| 6   | **No checkout UI.** `/predplatne` is an explicit stub. No subscribe, cancel, change-plan or payment-method UI exists, although the port and adapter support them                                                                                                                                          | P1 (paid launch) | SC-014           |
| 7   | Stripe adapter, price sync and invoice issuing have **never run against Stripe** (README, Known gaps)                                                                                                                                                                                                     | P1 (paid launch) | SC-010           |
| 8   | No Dockerfile, no compose, no VPS deploy; `vercel.json` holds the two cron schedules                                                                                                                                                                                                                      | P0               | SC-009           |
| 9   | DB integration tests are not in CI and are documented as running "against Neon"                                                                                                                                                                                                                           | P1               | SC-011           |
| 10  | `pnpm seed:tips` has no production guard; it would insert 15 fixture tips into the public record                                                                                                                                                                                                          | P1               | SC-004           |
| 11  | No Content-Security-Policy (README, Known gaps)                                                                                                                                                                                                                                                           | P2               | SC-012           |
| 12  | README describes "step 1, foundation only" and "Vercel Pro"                                                                                                                                                                                                                                               | P2               | SC-002 (this PR) |
| 13  | `env.ts` comment says the Turnstile site key lives in `env.public.ts`; `env.public.ts` says it deliberately does not                                                                                                                                                                                      | P3               | SC-002 follow-up |
| 14  | `R2_DOCUMENTS_BUCKET` documented as not created yet; unverified                                                                                                                                                                                                                                           | P1 (paid launch) | SC-016           |
| 15  | Fonts are Inter + Barlow via `next/font/google`; target design uses Geist                                                                                                                                                                                                                                 | P2               | SC-005           |

## Infrastructure observed (read-only, 2026-11-27)

The candidate VPS is small (4 GB RAM) and already mostly used by another
workload, so images must be built in CI, not on the server. Server
identifiers are deliberately not recorded in this public repository. Nothing
was changed on the server. See `docs/DEPLOYMENT.md` and D-004.

## Branches

| Branch                                                | Purpose                               |
| ----------------------------------------------------- | ------------------------------------- |
| `main`                                                | untouched baseline                    |
| `archive/pre-rebuild`                                 | frozen copy of `main` @ `466c542`     |
| `rebuild/v2`                                          | integration branch, all PRs target it |
| `docs/sc-002-project-docs`                            | this documentation PR                 |
| older `feat/*`, `fix/*`, `chore/*`, `legacy-supabase` | kept, not deleted                     |

## Work in progress (update on every PR)

| Issue  | Branch                      | Agent       | Owned files                                                                         | State  |
| ------ | --------------------------- | ----------- | ----------------------------------------------------------------------------------- | ------ |
| SC-002 | `docs/sc-002-project-docs`  | Cowork      | `AGENTS.md`, `CLAUDE.md`, `README.md`, `docs/*`                                     | Review |
| SC-003 | `fix/sc-003-ci-build-audit` | Claude Code | `.github/workflows/ci.yml`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.env.example` | Ready  |
| SC-004 | `audit/sc-004-security`     | Codex       | `docs/audits/SC-004-security.md` only                                               | Ready  |
