# Security

## Threat model in short

What matters most, in order:

1. Paid analysis content reaching someone who has not paid.
2. Published history being changed or deleted without trace.
3. Money and accounting errors: double invoices, wrong refunds, forged
   webhooks.
4. Account takeover (credential stuffing, weak 2FA, lockout bypass).
5. Secrets or personal data leaking (logs, repo, error pages).

## Controls that exist (keep them)

- **Access:** every Payload collection declares every access rule. Tips and
  selections are `isAdmin` for read: an anonymous `GET /api/tips`,
  `/api/tip-selections` and `/api/invoices` each answer 403 (verified
  2026-11-27 against a production build), and GraphQL is disabled.
- **Disclosure:** the tip detail and the home page read through loaders with
  `overrideAccess` and then pass data through `tipDisclosure`. Other public
  outputs (history, archive, sitemap, page metadata, `llms.txt`) derive their
  data by their own paths and do not all share that one control today.
  **One projection per viewer and point in time, driving detail, history,
  archive, metadata and machine-readable outputs alike, is a condition of the
  paid launch** (SC-024, then SC-008).
- **Immutability:** Postgres triggers (see `docs/DATABASE.md`).
- **Webhooks:** Stripe signature verified on the raw body; 400 on failure;
  claim table plus per-handler idempotency; concurrent replay tested.
- **Cron:** bearer `CRON_SECRET`, constant-time compare, unknown callers get 404.
- **Auth:** better-auth with TOTP 2FA, lockouts, rate-limit policy, common
  password list, session policy.
- **Forms:** Turnstile verified server-side, honeypot, consent written before
  calling Ecomail.
- **Uploads:** validated by bytes; SVG rejected.
- **Documents:** invoices in a separate private R2 bucket, isolation asserted
  in code.
- **Headers:** HSTS, nosniff, frame DENY, referrer policy, permissions policy.
- **Env:** validated at boot; secrets have no defaults.

## Known gaps (must be closed before the phase noted)

| Gap                                                                                                                                                                                                       | Before  | Issue           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------- |
| Client identity handling must be hardened for the VPS reverse-proxy setup (details tracked privately)                                                                                                     | Phase A | SC-004          |
| Operational safeguards for fixture scripts (details tracked privately)                                                                                                                                    | Phase A | SC-004          |
| No Content-Security-Policy. Needed before the Stripe Payment Element ships                                                                                                                                | Phase B | SC-012          |
| Paid-content leak paths not yet tested end to end (HTML, RSC payload, `generateMetadata`, OG, sitemap, `llms.txt`, caches) because FULL is not rendered yet. Must be tested in the same PR that adds FULL | Phase B | SC-008 + SC-011 |
| Admin surface hardening review                                                                                                                                                                            | Phase B | SC-012          |

## Disclosure

This repository is public. Until a vulnerability is fixed and deployed:

- Its specifics (affected files, mechanism, exploit steps, proof of concept)
  are never written in issues, PR titles or descriptions, commit messages,
  code comments or docs. Public text uses neutral wording such as "harden
  client identity handling".
- Details live in the product owner's private tracker (a private repository
  or GitHub private security advisories). Agents hand findings to the owner
  directly, not through the public repo.
- After the fix is deployed, the owner decides what, if anything, is
  published.
- Removing text does not remove it from git history, issue edit history,
  PR diffs or CI logs. Treat anything once pushed as public.

## Rules for agents

- Never log secrets, tokens, full card data, passwords, session ids or full
  webhook payloads. Use `src/lib/billing/redact.ts`.
- Authorization on the server only. A hidden button is not access control.
- No new public route without stating who may call it and how that is
  enforced.
- Any change in `src/lib/billing`, `src/lib/invoicing`, `src/lib/auth`,
  `src/lib/tips/visibility.ts`, `src/app/webhooks`, migrations or access
  rules requires a Codex review before merge.
