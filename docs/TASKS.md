# Tasks

Milestone: **Launch MVP**. GitHub Issues are the source of truth once
created; this index and `.github/issue-seed/` are the seed they were created
from. Full issue bodies: `.github/issue-seed/SC-*.md`.

Phase A = public site without payments. Phase B = paid service.

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

## Critical path for Phase A

```
SC-001 ─┬─ SC-003 ─┬─ SC-009 ──┐
        │          ├─ SC-011 ──┤
        │          └─ SC-005 ─ SC-006 (only if D-005 approved in time)
        ├─ SC-004 (IP + seed fixes) ─┤
SC-015 (owner data) ─────────────────┤
SC-016 (owner services) ─────────────┼─ SC-012 ─ SC-013
D-004 (server decision) ─────────────┘
```

## Phase B order

Stripe written approval and D-006 → SC-008 → SC-014 → SC-010 → SC-011 leak
tests → SC-012 (Phase B) → owner enables payments.
