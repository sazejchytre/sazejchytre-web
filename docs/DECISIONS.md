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

## D-004 · 2026-11-27 · Accepted (owner)

**Production runs on the existing VPS, conditional on verifying its
capacity.** The server is small and already carries another workload, so the
capacity check is part of the decision, not an afterthought: SC-009 has to
measure real memory headroom under load and record it before production
traffic is pointed at it. Images are built in CI and pulled, never built on
the server. If the measurement shows the application cannot run there with
room to spare, that comes back to the owner as a new decision with numbers,
not as an assumption.

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

## D-008 · 2026-11-27 · Accepted (owner, confirmed by D-012)

Launch in two phases: Phase A public site without payments on 2026-11-30 if
its checklist passes, and with the real track record (D-012); Phase B paid
service after Stripe written approval and SC-008/SC-010/SC-014 are done. Reason: checkout, paid zone and cancellation
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

## D-012 · 2026-11-27 · Accepted (owner)

**Target: public launch on Monday 2026-11-30, including the real track
record.** The date is a target, not permission to bypass a blocker. If the
A1 conditions in `docs/TASKS.md` are not met by then, **the site stays
private** and the launch moves; it does not go public with an open blocker.

Consequences for the plan: SC-023 and SC-024 move into the A1 critical path,
because publishing the record requires them. SC-017 therefore also has to
provide a mode that keeps the whole site private, so the fallback is an
enforced state and not an intention.

## D-013 · 2026-11-27 · Accepted (owner)

**Both routes to a second factor for the administration area stay on the
table, and SC-019 produces the comparison.** Application-side and identity
gateway are each acceptable to evaluate; the owner picks the technology once
the comparison exists, which is recorded as D-015. SC-026 implements the
chosen route and carries its own acceptance criteria.

## D-014 · 2026-11-27 · Proposed

Sprint 2 assigns database and invariant work (SC-022, SC-023, SC-025) to
Codex and application, routing and interface work to Claude Code, with the
other agent reviewing. This inverts the default reviewer role for those three
packages, because the reviewer that produced the findings already holds the
context, and it keeps two tracks running without shared files.

## D-015 · 2026-11-28 · Accepted (owner)

**The administrator second factor is application-native, with an
authenticator-app code (TOTP).** This is the route named under D-013. SC-026
implements it. The owner approved these requirements:

- TOTP is mandatory for every administrator.
- A vetted, maintained cryptographic library implements it. No hand-written
  primitives.
- Backup codes are single-use and stored hashed.
- The TOTP secret is stored encrypted.
- A code that was accepted once cannot be accepted again (replay protection).
- Verification is rate limited and protected against brute force.
- Activating or resetting the factor invalidates every existing session of
  that administrator.
- Access recovery is a documented procedure that needs shell access to the
  server. It never turns the factor off.
- No full administration session is issued before both factors have been
  verified.
- Every authentication path the framework exposes is verified, including
  password recovery and session refresh.
- A gateway-level control (Cloudflare Access) is kept as a possible second
  layer later. It is not part of SC-026 and is not bought now.

SC-026 stays a condition for the public launch (D-012, launch checklist).
Reason: the administration area exposes every customer and accounting record,
and a password alone is not an acceptable barrier. An application-native
factor works the same on every environment, costs nothing, and covers the
framework's own API routes as well as the panel.
