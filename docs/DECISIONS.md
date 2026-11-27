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

## D-010 · 2026-11-27 · Accepted (owner)

GitHub Issues are the primary source of task state. `docs/STATUS.md`,
`docs/TASKS.md` and `docs/DECISIONS.md` are maintained by Cowork only, to
avoid merge conflicts between parallel agent branches.

## D-011 · 2026-11-27 · Accepted (owner)

Details of unfixed security vulnerabilities are kept out of the public
repository and its issues; they are tracked privately by the product owner.
Removing text after publication is not treated as removing it from history.

## D-012 · 2026-11-27 · Proposed, awaiting owner confirmation

**Internal staging on Monday 2026-11-30, public launch between 3 and 7
December**, once every A1 condition in `docs/TASKS.md` is met.
Scope of the Monday 2026-11-30 date. The independent review does not
recommend opening the current revision to the public before its three P0
items are closed or the surface they affect is disabled. The three options
and this agent's recommendation (option 3: staging on Monday, public launch a
few days later with the record) are in `docs/TASKS.md`, "Launch scope
options".

## D-013 · 2026-11-27 · Needs owner

How the administration area gets its second factor: inside the application,
or at an identity gateway in front of it. SC-019 delivers the comparison;
a gateway may be a paid service, which needs owner approval either way.

## D-014 · 2026-11-27 · Proposed

Sprint 2 assigns database and invariant work (SC-022, SC-023, SC-025) to
Codex and application, routing and interface work to Claude Code, with the
other agent reviewing. This inverts the default reviewer role for those three
packages, because the reviewer that produced the findings already holds the
context, and it keeps two tracks running without shared files.

## D-013 · update 2026-11-27

SC-019 delivers the comparison and the recommendation; **SC-026 implements
whatever this entry settles on** and carries its own acceptance criteria. Do
not start SC-026 until this entry says Accepted.
