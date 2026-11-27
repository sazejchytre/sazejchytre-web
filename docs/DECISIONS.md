# Decisions

Format: ID, date, status (Accepted / Proposed / Needs owner), decision,
reason. Agents add Proposed entries; only the product owner moves an entry to
Accepted when it is in the approval list of `docs/WORKFLOW.md`.

## D-001 · 2026-11-27 · Accepted (brief)

Incremental rebuild of the existing app, no rewrite. Keep backend,
migrations, auth, billing/invoicing architecture, security mechanisms and
tests; redesign the frontend.
Reason: the audit confirmed a working, well-tested backend (894 unit tests,
121 DB tests passing).

## D-002 · 2026-11-27 · Accepted (brief)

Modular monolith on the existing stack. No new infrastructure layers, no
stack changes for novelty.

## D-003 · 2026-11-27 · Accepted (brief)

Hosting moves from Vercel to a Váš Hosting VPS. Docker image built in CI,
Compose on the server, existing VPS Centrum reverse proxy and TLS. Coolify
not used (conflicts with VPS Centrum and the existing workload on the server).

## D-004 · 2026-11-27 · Needs owner

Which server runs production. The only candidate today is a small shared VPS
(4 GB RAM, mostly in use by another workload, not contracted by the operator).
Details are in the operator's private notes, not in this public repository.
Options: (a) separate VPS contracted by the operator (recommended),
(b) upgrade the existing server's RAM and host both, (c) existing server for
staging only. Paid service, needs owner approval.

## D-005 · 2026-11-27 · Needs owner

Visual direction in `docs/DESIGN.md` (tokens, Geist, rules). Approve after
seeing the homepage prototype from SC-005.

## D-006 · 2026-11-27 · Needs owner

Plan features. Seeded plans list PUSH_NOTIFICATIONS, ARCHIVE_EXPORT,
API_ACCESS, EARLY_ACCESS which do not exist. Recommendation: sell only what
exists at Phase B launch (likely one or two plans), add the rest later.

## D-007 · 2026-11-27 · Proposed

Monitoring with free tiers first (external uptime check on `/healthz`,
container logs with rotation). Paid error tracking only if needed.

## D-008 · 2026-11-27 · Proposed

Launch in two phases: Phase A public site without payments on 2026-11-30 if
its checklist passes; Phase B paid service after Stripe written approval and
SC-008/SC-010/SC-014 are done. Reason: checkout, paid zone and cancellation
UI do not exist; Stripe's restricted list names sports forecasting with a
prize, so acceptance must be confirmed in writing rather than assumed.

## D-009 · 2026-11-27 · Proposed

Git workflow: `main` frozen, `rebuild/v2` integration branch, one branch and
PR per issue, Codex reviews, owner merges. Replaces the earlier
"commit straight to main" practice for this repository.
