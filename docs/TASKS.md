# Tasks

Milestone: **Launch MVP**. GitHub Issues are the source of truth once
created; this index and `.github/issue-seed/` are the seed they were created
from. Full issue bodies: `.github/issue-seed/SC-*.md`.

Specifics of findings that are not fixed and deployed yet are never in this
file; see `docs/SECURITY.md`, "Disclosure".

## Launch phases

| Phase  | Contents                                                                                                                                                                                                                      |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A1** | Public informational site: home, public history, methodology, pricing as information, legal pages, contact and newsletter, administration for publishing, deployment, backups, monitoring. No customer accounts, no payments. |
| **A2** | Customer accounts and the published track record.                                                                                                                                                                             |
| **B**  | Paid service: paid zone, checkout, cancellation, live payments and invoicing.                                                                                                                                                 |

The `Phase` column below uses A for anything in A1 or A2 and B for the paid
service; the split is in "Order of work".

| ID     | Title                                                                    | Prio | Phase | Agent                                | Depends on             |
| ------ | ------------------------------------------------------------------------ | ---- | ----- | ------------------------------------ | ---------------------- |
| SC-001 | Repository audit and backup                                              | P0   | A     | Cowork (PM) + owner                  | -                      |
| SC-002 | Project documentation and agent instructions                             | P1   | A     | Cowork (PM)                          | SC-001                 |
| SC-003 | Fix CI build and dependency audit                                        | P0   | A     | Claude Code                          | SC-001                 |
| SC-004 | Backend security and authorization audit                                 | P0   | A     | Codex                                | SC-001                 |
| SC-005 | Establish visual design system and homepage prototype                    | P1   | A     | Claude Code                          | SC-003                 |
| SC-006 | Redesign homepage                                                        | P1   | A     | Claude Code                          | SC-005                 |
| SC-007 | Redesign public track record                                             | P2   | A     | Claude Code                          | SC-005                 |
| SC-008 | Paid zone: analysis detail and subscriber area                           | P1   | B     | Claude Code                          | SC-005, SC-004         |
| SC-009 | VPS deployment configuration                                             | P0   | A     | Claude Code (build) + Codex (review) | SC-003                 |
| SC-010 | Payment and invoicing verification (Stripe test mode, Fakturoid sandbox) | P1   | B     | Codex + owner                        | SC-014                 |
| SC-011 | Database integration tests in CI and Playwright end-to-end suite         | P1   | A     | Codex                                | SC-003                 |
| SC-012 | Production readiness review                                              | P1   | A     | Codex                                | SC-004, SC-009, SC-011 |
| SC-013 | Launch approval and deployment                                           | P1   | A     | Owner (with PM)                      | SC-012, SC-015, SC-016 |
| SC-014 | Checkout, cancellation and payment-method UI                             | P1   | B     | Claude Code                          | SC-008                 |
| SC-015 | Operator identity and legal data                                         | P0   | A     | Owner + Claude Code                  | -                      |
| SC-016 | Production services provisioning                                         | P0   | A     | Owner (PM prepares runbook)          | -                      |
| SC-017 | Phase A surface gate: serve only what the launch scope includes          | P0   | A     | Claude Code                          | SC-003                 |
| SC-018 | One contract for client address and country                              | P0   | A     | Claude Code                          | SC-003                 |
| SC-019 | Administrator account security                                           | P1   | A     | Claude Code                          | SC-003                 |
| SC-020 | Public form resilience and consent evidence                              | P2   | A     | Claude Code                          | SC-018                 |
| SC-021 | Customer authentication hardening                                        | P0   | A     | Claude Code                          | SC-017, SC-018         |
| SC-022 | Fixture and test-data isolation                                          | P1   | A     | Codex                                | SC-003                 |
| SC-023 | Complete the published-record invariants                                 | P1   | A     | Codex                                | SC-022                 |
| SC-024 | One public projection for analyses                                       | P1   | A     | Claude Code                          | SC-023                 |
| SC-025 | Billing and accounting integrity                                         | P1   | B     | Codex                                | SC-010                 |

## Order of work

**A1, required before a public launch**

```
owner: operator identity (SC-015) ─┐
owner: services (SC-016) ──────────┤
owner: server decision (D-004) ────┼─ SC-009 deployment ─┐
SC-003 CI (PR #18) ─┬─ SC-017 gate ┘                     ├─ SC-012 go/no-go ─ SC-013 launch
                    ├─ SC-018 client address             │
                    ├─ SC-019 administrator ─────────────┤
                    └─ SC-022 fixtures ──────────────────┘
```

**A2, before accounts and the published record are opened**

```
SC-018 ─ SC-021 authentication (3 PRs)        accounts
SC-022 ─ SC-023 record invariants ─ SC-024 projection ─ SC-007 history redesign
SC-018 ─ SC-020 forms
```

**B, paid service**

```
Stripe written approval ─ D-006 plans ─ SC-008 paid zone ─ SC-014 checkout ─ SC-010 provider verification ─ SC-025 billing integrity ─ SC-011 leak tests ─ SC-012 (B) ─ owner enables payments
```

## What can run in parallel

Parallel work is limited by shared files, not by topic. The hotspot table in
`docs/STATUS.md` is the authority. Safe concurrent sets:

| Set | Packages                       | Why they do not collide                                                                                      |
| --- | ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| 1   | SC-017, SC-019, SC-022, SC-005 | routing flag, administration collection, fixture scripts and the design system touch four disjoint file sets |
| 2   | SC-018, SC-019, SC-022, SC-005 | same, with the client-address contract in place of the gate                                                  |
| 3   | SC-021, SC-020, SC-023, SC-005 | authentication, forms, database invariants and design, once SC-018 has landed                                |
| 4   | SC-024, SC-025                 | public projections and the payment path share no file                                                        |

Never concurrent: SC-018 with SC-021 (shared authentication configuration),
SC-018 with SC-020 (shared form modules), SC-023 with SC-024 (shared loader
and settlement modules), SC-024 with SC-007 (shared history components),
SC-022 with SC-024 (shared fixture module), anything with SC-025 inside the
payment path.

Design work (SC-005) is parallel to everything in this plan as long as it
stays inside the design system, the shared primitives and its own preview
route, and does not touch the history or analysis pages. Those are SC-007 and
SC-024.

## Launch scope options for Monday 2026-11-30 (decision D-012)

| Option                                                        | Contents                                                                                                                   | What has to land first                                         | Assessment                                                                                                                         |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **1. Informational launch, honest empty state**               | A1 without the published record: the promise, the methodology, pricing as information, legal pages, contact and newsletter | SC-015, SC-016, SC-009, SC-017, SC-018, SC-019, SC-022, SC-012 | Achievable only if the owner's three items land first. The weakest marketing moment, because the record is the product's argument. |
| **2. Informational launch with the published record**         | Option 1 plus the real track record                                                                                        | Option 1 plus SC-023 and SC-024                                | The honest version of the product, and the tight one. Two further packages with migrations and new tests in the same window.       |
| **3. Staging on Monday, public launch in the following week** | Monday is the staging go-live and the owner's acceptance date                                                              | SC-015, SC-016, SC-009                                         | The only option that does not trade the record or the review against the date.                                                     |

This agent recommends option 3, with option 2 as the public launch a few days
later. Option 1 spends the launch moment on the version of the site that
cannot yet make its own case.

## Deferred, unchanged

PWA, mobile app, community chat, Discord, gamification, personalization,
other languages, decorative animation, and anything else not required for the
first release.
