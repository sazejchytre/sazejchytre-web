<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project instructions for all coding agents

This file is the single source of rules for every agent working in this
repository (Claude Code, OpenAI Codex, anything else). Tool-specific notes live
in `CLAUDE.md`; they may add to these rules, never contradict them.

## What this product is

sazejchytre.cz is a Czech subscription service that publishes 1 to 3 written
sports analyses per day. It does not accept, broker or advertise bets. Its
main promise is a public, complete, unfiltered track record: losses are as
visible as wins. Details: `docs/SPEC.md`.

## Read before you change anything

| You are touching                      | Read first                                             |
| ------------------------------------- | ------------------------------------------------------ |
| Anything                              | the GitHub issue, `docs/STATUS.md`, `docs/WORKFLOW.md` |
| UI, copy, pages                       | `docs/DESIGN.md`                                       |
| Module boundaries, new code locations | `docs/ARCHITECTURE.md`                                 |
| Collections, migrations, triggers     | `docs/DATABASE.md`                                     |
| Auth, access, payments, webhooks, IPs | `docs/SECURITY.md`                                     |
| Tests, CI                             | `docs/TESTING.md`                                      |
| Docker, VPS, cron, env vars           | `docs/DEPLOYMENT.md`                                   |
| Invoicing / Fakturoid                 | `docs/accounting-integration.md`                       |

## Hard rules

1. **Never change `main`.** Work on a branch cut from `rebuild/v2`, open a PR
   into `rebuild/v2`. Never merge your own PR. Never force-push. Never delete
   branches.
2. **One issue per branch, one concern per PR.** Branch name:
   `<type>/sc-<nnn>-<short-slug>`, e.g. `fix/sc-003-ci-env`.
3. **Report real command output.** Run `pnpm typecheck`, `pnpm lint`,
   `pnpm test`, `pnpm build` and `pnpm audit` and paste the summary lines. If
   you could not run something, say so. Never write "should pass".
4. **Never weaken a check to make it pass.** No `@ts-ignore`, no
   `eslint-disable` without a written reason on the same line, no `|| true`
   in CI, no lowering `--audit-level`, no deleting or skipping tests, no
   `ignoreBuildErrors`.
5. **No secrets in the repository.** CI placeholders must be structurally
   valid and non-functional (see the comments in `.github/workflows/ci.yml`).
6. **No new dependency without a one-paragraph justification in the PR.**
7. **Migrations.** Never edit a committed migration. New migrations only when
   the issue says so, created with `pnpm migrate:create`, reviewed by Codex,
   and never run against production by an agent.
8. **Tests never reach real providers.** `ACCOUNTING_PROVIDER` stays `FAKE`
   outside production. Stripe only with `sk_test_` keys. Never point a test at
   a database that holds real data.
9. **Server-side authorization only.** Paid content must not reach the client
   through HTML, RSC payload, API responses, metadata, OG images, sitemap,
   `llms.txt` or cache. Every new collection declares every access rule.
10. **Published tips are immutable.** The database triggers in
    `src/migrations/20261015_201500_tip_immutability_triggers.ts` are the
    guarantee. Do not bypass, disable or "temporarily drop" them.
11. **Honest content only.** No invented statistics, testimonials, sample
    results presented as real, profit guarantees or false urgency. With no
    data, render an honest empty state.
12. **Operator identity** is read from `src/lib/legal/operator.ts`. Never type
    an IČO, name or address anywhere else, and never invent one.
13. **GitHub Issues are the source of truth** for task state. Report
    progress and results on the issue and PR. Do not edit `docs/STATUS.md`,
    `docs/TASKS.md` or `docs/DECISIONS.md`; Cowork maintains them. Propose a
    decision in your PR description instead.
14. **Security disclosure.** The repository is public. Never write details of
    an unfixed vulnerability in an issue, PR, commit, comment or doc; give
    them to the product owner privately (`docs/SECURITY.md`, "Disclosure").
15. **Customer-facing text is Czech**, in `src/i18n/messages/cs.ts`. Code,
    comments, commits, PRs and docs are English.

## Conventions already in the codebase (keep them)

- `src/proxy.ts`, never `src/middleware.ts` (Next 16).
- Payload owns `/api/*` (REST only; GraphQL is disabled). Health check is
  `/healthz`. Stripe webhook is
  `/webhooks/stripe`. Cron routes are `/api/cron/*`, bearer-authorised.
- Env vars are validated at boot in `src/lib/env.ts` (server) and
  `src/lib/env.public.ts` (client). A missing variable fails the boot. Adding
  a required variable means updating `.env.example`, `ci.yml` and
  `docs/DEPLOYMENT.md` in the same PR.
- Billing and accounting go through ports (`src/lib/billing/port.ts`,
  `src/lib/accounting/port.ts`). Provider SDKs are imported only inside their
  adapter folders.
- Unit tests: `*.test.ts` (no DB, run in CI). DB tests: `*.db-test.ts`.
  Live-provider tests: `*.stripe-test.ts`, `*.fakturoid-test.ts`.

## Definition of done for any PR

- [ ] Scope matches the issue; anything extra is listed as out of scope.
- [ ] typecheck, lint, test, build, audit run locally, real output pasted.
- [ ] DB tests run when DB-touching code changed (`docs/TESTING.md`).
- [ ] Docs updated when behaviour, env vars or structure changed.
- [ ] PR description lists the files this branch owns and links the issue.
- [ ] Results posted on the GitHub issue (not in `docs/STATUS.md`).
- [ ] PR targets `rebuild/v2`, is not merged by the author.
