# Launch checklist

Tick only with evidence (command output, screenshot, link). "Should work" is
not a tick.

## Phase A: public site, no payments

### Code

- [ ] SC-003 merged: CI green on `rebuild/v2` (typecheck, lint, test, build, audit)
- [ ] SC-015 merged: operator identity filled from the register, `OPERATOR_DETAILS_CONFIRMED = true`, footer renders in a production build
- [ ] SC-004 Phase A items closed (details in the private tracker)
- [ ] Pricing page has no buy button and says when subscriptions open; `/predplatne` stub reachable only by direct URL or removed from navigation
- [ ] Homepage and history show an honest empty state if no tip is settled yet
- [ ] Legal pages (VOP, GDPR, cookies) reviewed by the operator; responsible-gambling notice wording approved

### Infrastructure (SC-009, SC-016)

- [ ] D-004 decided (which server)
- [ ] Neon production branch created, migrations applied with owner approval, billing seed applied
- [ ] R2 media bucket and private documents bucket exist, no public access on documents
- [ ] Resend domain verified (SPF, DKIM); test email received
- [ ] Turnstile widget for the production domain; Ecomail list id set
- [ ] Stripe **test** keys in Phase A; `ACCOUNTING_PROVIDER=FAKE`
- [ ] Image built in CI, pulled on server, `/healthz` 200 on staging and production
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
- [ ] Product owner approved enabling payments
