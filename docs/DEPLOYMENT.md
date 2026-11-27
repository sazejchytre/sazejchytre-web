# Deployment

Target: self-managed VPS at Váš Hosting. Vercel is no longer the target;
`vercel.json` stays until the VPS cron replacement is live, then it is
removed in the same PR that adds the replacement.

**Nothing in this document has been executed on any server.** No agent
installs software, runs migrations or deploys to production without explicit
product-owner approval.

## Candidate server

The concrete server (hostname, address, plan, other workloads) is kept out of
this public repository and recorded in the operator's private notes. What
matters for the design, observed read-only on 2026-11-27:

- **Small, shared VPS.** The candidate server has 4 GB RAM, most of it already
  in use by another workload, and is managed through the hosting provider's
  VPS Centrum panel.
- **Do not build images on the server.** `next build` for this app needs
  more memory than is free. Build in GitHub Actions, push to GHCR, pull on the
  server.
- **Memory is the bottleneck.** A Next 16 + Payload server process typically
  needs several hundred MB. Measure on staging before production; if free
  memory stays under ~500 MB, upgrade RAM or use a separate server
  (decision D-004).
- **Ownership:** production for the operator's business should preferably run
  on a server contracted by the operator (decision D-004).
- **Coolify is not recommended here.** It expects to own Docker, ports 80/443
  and its own proxy, which conflicts with VPS Centrum and the existing
  workload. Use Docker Compose bound to `127.0.0.1`, with VPS Centrum's web
  server as the public reverse proxy and TLS. Verify that this pattern works
  in VPS Centrum before relying on it (SC-009).

## Target layout

```
GitHub Actions ── build image (linux/amd64, node:24-slim, output standalone)
      │            tag: ghcr.io/sazejchytre/sazejchytre-web:<sha>
      ▼
VPS: /srv/sazejchytre/{staging,production}/
      compose.yml        app service, restart: unless-stopped, healthcheck /healthz,
                         127.0.0.1:<port>:3000, mem_limit, read-only fs where possible
      .env               chmod 600, owned by the deploy user, never in git
      deploy.sh          pull <sha>, run migrations (approved only), up -d, wait for /healthz,
                         keep previous tag for rollback
VPS Centrum: domain/subdomain → reverse proxy to 127.0.0.1:<port>, Let's Encrypt TLS
      staging.sazejchytre.cz  → staging port
      sazejchytre.cz          → production port
Database: Neon, one branch per environment (production, staging). Never share.
```

### Build-time vs run-time variables

`NEXT_PUBLIC_SERVER_URL` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` are inlined
at build time, so staging and production need separate image builds (build
args) or the same values. Everything in `src/lib/env.ts` is read at run time
from `.env`.

### Required variables (from `src/lib/env.ts`, `src/lib/env.public.ts`)

`DATABASE_URL`, `PAYLOAD_SECRET`, `NEXT_PUBLIC_SERVER_URL`,
`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`,
`R2_DOCUMENTS_BUCKET`, `R2_PUBLIC_BASE_URL`, `UPSTASH_REDIS_REST_URL`,
`UPSTASH_REDIS_REST_TOKEN`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
`RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `STRIPE_SECRET_KEY`,
`STRIPE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`,
`STRIPE_WEBHOOK_SECRET`, `CRON_SECRET`, `FAKTUROID_CLIENT_ID`,
`FAKTUROID_CLIENT_SECRET`, `FAKTUROID_SLUG`, `FAKTUROID_USER_AGENT`,
`TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `ECOMAIL_API_KEY`,
`ECOMAIL_LIST_ID`. Defaults exist for `NODE_ENV`, `BILLING_PROVIDER`
(STRIPE), `ACCOUNTING_PROVIDER` (FAKE), `SUPPORTED_BILLING_COUNTRIES` (CZ).

Phase A (no payments) still needs Stripe variables to boot: use `sk_test_` /
`pk_test_` keys and keep `ACCOUNTING_PROVIDER=FAKE` until Phase B.

## Cron replacement for `vercel.json`

| Route                               | Schedule (UTC) | Replacement                                                                                                                                         |
| ----------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/cron/sweep-lockouts`          | `17 3 * * *`   | VPS Centrum cron (or a tiny scheduler container) running `curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/sweep-lockouts` |
| `/api/cron/retry-document-delivery` | `23 * * * *`   | same pattern                                                                                                                                        |

Routes already authorise by bearer only, so no code change is required.
Cron output goes to a log file; a failed run must alert (see Monitoring).

## Reverse proxy and client IP

The proxy must pass the real client address in headers it **overwrites**
rather than appends (`X-Real-IP $remote_addr`, and `X-Forwarded-For
$remote_addr`). How the application consumes them is in scope of SC-004 and
must be verified on staging before production. If Cloudflare proxies the
domain, restrict origin access to Cloudflare's address ranges.

## Health, monitoring, restart

- Docker healthcheck on `/healthz` (returns 503 when the DB is unreachable).
- `restart: unless-stopped`.
- External uptime monitor on `/healthz` and `/` for production (free tier of
  any uptime service; choice is D-007 if paid).
- Alert on: health down for 2 minutes, cron failure, disk above 85 %, memory
  above 90 %.
- Application errors: stdout logs via `docker logs` with rotation
  (`max-size`, `max-file`). Error tracking service is optional, D-007.

## Migrations in production

1. Product owner approves the release.
2. Take a Neon restore point (or confirm PITR window) and run the nightly
   dump job once manually.
3. `pnpm migrate:status` against production, review the pending list.
4. Run `pnpm migrate` (then `pnpm auth:migrate` if better-auth changed) from
   the new image as a one-off container.
5. Start the new app container, wait for `/healthz` 200.

## Backups and restore

- Neon point-in-time restore (plan-dependent window).
- Nightly `pg_dump --format=custom` from a one-off container to a private R2
  bucket, 30 days retention.
- R2 documents bucket: enable object versioning or a daily copy.
- **Restore drill before launch:** restore last night's dump into a new Neon
  branch, point staging at it, open history and an invoice. Record the date
  and duration in `docs/LAUNCH-CHECKLIST.md`.

## Rollback

`deploy.sh rollback` starts the previous image tag. Migrations are
forward-only; a release with a migration that is not backwards compatible
must say so in its PR and needs a restore plan instead of a tag rollback.

## Secrets

Production secrets live only in the server's `.env` (mode 600) and in a
password manager. GitHub Actions gets only what it needs to push images and
deploy (GHCR token, SSH deploy key restricted to the deploy user). Rotate
anything that was ever pasted into a chat or a ticket.
