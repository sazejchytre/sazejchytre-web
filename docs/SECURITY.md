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
  selections are `isAdmin` for read, so `/api/tips` and GraphQL return
  nothing to the public. Public pages read through loaders with
  `overrideAccess` and then pass data through `tipDisclosure`.
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

| Gap                                                                                                                                                                                                                                                                                                                                                                                                                                    | Before  | Issue           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------- |
| Client IP taken from first `X-Forwarded-For` entry in 5 files. Behind nginx with `proxy_add_x_forwarded_for` the first entry is whatever the client sent, so rate limits and lockouts can be bypassed or aimed at another user's IP. Fix: one `clientIp(headers)` helper that trusts only the header the VPS proxy overwrites (`X-Real-IP` set by our proxy, or the right-most `X-Forwarded-For` entry), configured by env, with tests | Phase A | SC-004          |
| `seed:tips` / `seed:tips:purge` have no guard against a production database                                                                                                                                                                                                                                                                                                                                                            | Phase A | SC-004          |
| No Content-Security-Policy. Needed before the Stripe Payment Element ships                                                                                                                                                                                                                                                                                                                                                             | Phase B | SC-012          |
| Paid-content leak paths not yet tested end to end (HTML, RSC payload, `generateMetadata`, OG, sitemap, `llms.txt`, caches) because FULL is not rendered yet. Must be tested in the same PR that adds FULL                                                                                                                                                                                                                              | Phase B | SC-008 + SC-011 |
| Payload admin exposed at `/admin` on the public domain. Consider IP allowlist or at least 2FA for admin users                                                                                                                                                                                                                                                                                                                          | Phase B | SC-012          |

## Rules for agents

- Never log secrets, tokens, full card data, passwords, session ids or full
  webhook payloads. Use `src/lib/billing/redact.ts`.
- Authorization on the server only. A hidden button is not access control.
- No new public route without stating who may call it and how that is
  enforced.
- Any change in `src/lib/billing`, `src/lib/invoicing`, `src/lib/auth`,
  `src/lib/tips/visibility.ts`, `src/app/webhooks`, migrations or access
  rules requires a Codex review before merge.
