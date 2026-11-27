# Launch checklist

Tick only with evidence (command output, screenshot, link). "Should work" is
not a tick.

## Phase A: public site with the track record, no payments

Target 2026-11-30 (D-012). If any box below is unticked on the day, the site
stays private (`LAUNCH_MODE=PRIVATE`, SC-017) and the launch moves.

`LAUNCH_MODE` per environment (details: `docs/DEPLOYMENT.md`, "Launch gate"):
production `PRIVATE` until every box in this Phase A section is ticked, then
`INFORMATIONAL`; staging `PRIVATE`, or `INFORMATIONAL` behind the
reverse-proxy access restriction; local development `FULL`. `FULL` in
production only after the Phase B sign-off below.

### Code

- [ ] SC-003 merged: CI green on `rebuild/v2` (typecheck, lint, test, build, audit)
- [ ] SC-015 merged: operator identity filled from the register, `OPERATOR_DETAILS_CONFIRMED = true`, footer renders in a production build
- [ ] SC-004 Phase A items closed (details in the private tracker)
- [ ] SC-017 merged: the launch-scope gate and the private mode both proven by tests (every route file, every method, every mode)
- [ ] SC-019 merged: no production traffic without a verified administrator, at boot and at request time
- [ ] SC-026 merged: the administration area requires a second factor (route named in D-015)
- [ ] SC-022 merged: fixture and test data cannot reach the production record
- [ ] SC-023 merged: the published-record invariants hold at the database level
- [ ] SC-024 merged: one projection drives every public output, and the public history is complete
- [ ] Pricing page has no buy button and says when subscriptions open. SC-017: `/predplatne` answers 404 in `INFORMATIONAL` and the buy buttons on `/` and `/cenik` (`src/components/pricing/TierCards.tsx`) are not rendered outside `FULL`. Still open: the copy saying when subscriptions open, and the payment wording on `/` ("Platba kartou." in `home.tiers.body`), both in `src/i18n/messages/cs.ts`
- [ ] Homepage and history show an honest empty state if no tip is settled yet
- [ ] Legal pages (VOP, GDPR, cookies) reviewed by the operator; responsible-gambling notice wording approved

### Infrastructure (SC-009, SC-016)

- [ ] D-004 capacity verified on the chosen server: container memory at rest and under load, host free memory with both workloads, behaviour at the memory limit, and whether a deploy fits. Numbers recorded here: - container at rest: ____ MB, under load: ____ MB - host free memory with both workloads: ____ MB - deploy overlap fits: yes / no - conclusion: ____
- [ ] Neon production branch created, migrations applied with owner approval, billing seed applied
- [ ] R2 media bucket and private documents bucket exist, no public access on documents
- [ ] Resend domain verified (SPF, DKIM); test email received
- [ ] Turnstile widget for the production domain; Ecomail list id set
- [ ] Stripe **test** keys in Phase A; `ACCOUNTING_PROVIDER=FAKE`
- [ ] Image built in CI, pulled on server, `/healthz` 200 on staging and production
- [ ] Launch gate verified on the server (SC-009, `docs/DEPLOYMENT.md` "Launch gate"): proxy forwards every path, no cache or cache purged after a mode change, access restriction in front of staging; `/admin` and `/api` restricted at the proxy and the first administrator created before the host is reachable; `verify-launch-gate.ts` summary with 0 mismatches for staging and production (with `--expect-admin-restricted` from outside the allowlist, and `--check-links` in `INFORMATIONAL`): ____
- [ ] Production switched from `PRIVATE` to `INFORMATIONAL` only after every other Phase A box is ticked; verification re-run after the switch: ____
- [ ] TLS valid, HTTP redirects to HTTPS, HSTS header present
- [ ] Client-address handling behind the proxy verified on staging (SC-004 test procedure)
- [ ] Cron jobs replaced on the server and one run of each logged
- [ ] Uptime monitor alerting to a real phone/email
- [ ] Nightly DB dump job ran once; **restore drill done** (date, duration: ____ )
- [ ] Rollback to previous image tested on staging
- [ ] DNS switched; old Vercel deployment disabled after verification

### Content

- [ ] Admin account for the operator with 2FA
- [ ] Methodology page complete
- [ ] No placeholder, lorem ipsum or invented number anywhere (manual pass)

### Sign-off

- [ ] Product owner approved production deploy (date, name)

## Phase B: payments

- [ ] Stripe written confirmation that the business model is supported
- [ ] D-006 decided: plans sell only existing features
- [ ] SC-008 paid zone merged, leak tests green (HTML, RSC payload, metadata, OG, sitemap, llms.txt, cache)
- [ ] SC-014 checkout, cancel, change plan, payment method UI merged
- [ ] SC-010 test-mode run recorded: checkout, renewal, failed payment, recovery, cancel at period end, immediate cancel, refund, dispute, webhook replay, out-of-order events
- [ ] Fakturoid: one test document flow verified against credentials of a separate test account (the command has no sandbox safeguard, see `docs/TESTING.md`), never the real numbering series; then one real low-value purchase by the operator, invoice checked by the accountant
- [ ] Access removed on expiry verified with a real subscription
- [ ] CSP in place (SC-012)
- [ ] Support email monitored, response process agreed
- [ ] SC-012 readiness review by Codex: no open P0/P1
- [ ] Live keys installed by the owner; `ACCOUNTING_PROVIDER=FAKTUROID`
- [ ] `LAUNCH_MODE=FULL` set in production and the launch-gate verification re-run
- [ ] Product owner approved enabling payments
