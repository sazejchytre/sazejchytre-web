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
| SC-019 | First administrator and administration access control                    | P0   | A     | Claude Code                          | SC-003                 |
| SC-026 | Administrator second factor                                              | P1   | A     | Claude Code                          | SC-019                 |
| SC-020 | Public form resilience and consent evidence                              | P2   | A     | Claude Code                          | SC-018                 |
| SC-021 | Customer authentication hardening                                        | P0   | A     | Claude Code                          | SC-017, SC-018         |
| SC-022 | Fixture and test-data isolation                                          | P1   | A     | Codex                                | SC-003                 |
| SC-023 | Complete the published-record invariants                                 | P1   | A     | Codex                                | SC-022                 |
| SC-024 | One public projection for analyses                                       | P1   | A     | Claude Code                          | SC-023                 |
| SC-025 | Billing and accounting integrity                                         | P1   | B     | Codex                                | SC-010                 |

## Order of work

**A1, required before a public launch**

SC-003 landed in `rebuild/v2` on 2026-11-27 (PR #18), so every package below
starts from a green CI baseline.

```
owner: operator identity (SC-015) ─┐
owner: services (SC-016) ──────────┤
owner: server decision (D-004) ────┼─ SC-009 deployment ─┐
                                   │                     ├─ SC-012 go/no-go ─ SC-013 launch
SC-005 design ─────────────────────┤                     │
SC-017 gate ─ SC-018 client address┤                     │
SC-019 administrator ─ SC-026 MFA ─┤                     │
SC-022 fixtures ───────────────────┘                     │
                                                         │
(if the record is published) SC-023 ─ SC-024 ────────────┘
```

SC-017 comes before SC-018 because both add a setting to the same module, and
the gate is what makes a launch without accounts provable.

**A2, before accounts and the published record are opened**

```
SC-018 ─ SC-021 authentication (3 PRs)                 accounts
SC-022 ─ SC-023 record invariants ─ SC-024 projection ─ SC-007 history redesign
SC-018 ─ SC-020 forms
SC-005 (approved in D-005) ─ SC-006 homepage
```

**B, paid service**

```
Stripe written approval ─ D-006 plans ─ SC-008 paid zone ─ SC-014 checkout ─ SC-010 provider verification ─ SC-025 billing integrity ─ SC-011 leak tests ─ SC-012 (B) ─ owner enables payments
```

## What can run in parallel

Parallel work is limited by shared files, not by topic. The hotspot table in
`docs/STATUS.md` is the authority. Safe concurrent sets:

| Set | Packages               | Why they do not collide                                                                         |
| --- | ---------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | SC-005, SC-017, SC-022 | the design system, the routing gate and the fixture scripts touch three disjoint file sets      |
| 2   | SC-005, SC-018, SC-019 | the client-address contract, the administration collection and the design system do not overlap |
| 3   | SC-005, SC-020, SC-023 | forms, database invariants and design, once SC-018 has landed                                   |
| 4   | SC-021, SC-024         | the authentication module and the public projections share no file                              |
| 5   | SC-024, SC-025         | public projections and the payment path share no file                                           |

Never concurrent:

- **SC-017 with SC-018**, and either with SC-005's preview gate: all three
  would add a setting to `src/lib/env.ts`. Order: SC-017, then SC-018.
  SC-005's preview route must therefore gate itself on the existing
  `NODE_ENV` and add no setting of its own.
- SC-018 with SC-021, and SC-018 with SC-020: shared authentication
  configuration and shared form modules.
- SC-019 with SC-026: SC-026 implements what SC-019's decision settles.
- SC-023 with SC-024: shared loader and settlement modules.
- SC-024 with SC-007: shared history components.
- SC-022 with SC-024: shared fixture module.
- Anything with SC-025 inside the payment path.

Design work (SC-005) is parallel to everything in this plan as long as it
stays inside the design system, the shared primitives and its own preview
route, and does not touch the history or analysis pages. Those are SC-007 and
SC-024.

## Launch scope options for Monday 2026-11-30 (decision D-012)

| Option                                                           | Contents                                                                                                                                    | What has to land first                                                 | Assessment                                                                                                                         |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **1. Informational launch, honest empty state**                  | A1 without the published record: the promise, the methodology, pricing as information, legal pages, contact and newsletter                  | SC-015, SC-016, SC-009, SC-017, SC-018, SC-019, SC-022, SC-012         | Achievable only if the owner's three items land first. The weakest marketing moment, because the record is the product's argument. |
| **2. Informational launch with the published record**            | Option 1 plus the real track record                                                                                                         | Option 1 plus SC-023 and SC-024                                        | The honest version of the product, and the tight one. Two further packages with migrations and new tests in the same window.       |
| **3. Staging on Monday, public launch between 3 and 7 December** | Monday 2026-11-30 is the internal staging go-live and the owner's acceptance date; the public launch follows once the A1 conditions are met | SC-015, SC-016, SC-009 for Monday; the full A1 set for the public date | The only option that does not trade the record or the review against the date.                                                     |

**Proposed, awaiting owner confirmation:** option 3. Internal staging on
2026-11-30, public launch between 3 and 7 December once every A1 condition in
"Order of work" is met. Option 2 is then what goes public on that date.

## Deferred, unchanged

PWA, mobile app, community chat, Discord, gamification, personalization,
other languages, decorative animation, and anything else not required for the
first release.
