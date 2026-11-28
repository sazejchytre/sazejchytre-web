# Deployment

Target: self-managed VPS at Váš Hosting. Vercel is no longer the target;
`vercel.json` stays until the VPS cron replacement is live, then it is
removed in the same PR that adds the replacement.

**Nothing in this document has been executed on any server.** No agent
installs software, runs migrations or deploys to production without explicit
product-owner approval.

## The server (chosen in D-004, capacity check pending)

Production runs on the existing VPS. The concrete server (hostname, address,
plan, other workloads) is kept out of this public repository and recorded in
the operator's private notes. What matters for the design, observed read-only
on 2026-11-27:

- **Small, shared VPS.** 4 GB RAM, most of it already in use by another
  workload, managed through the hosting provider's VPS Centrum panel.
- **Do not build images on the server.** `next build` for this application
  needs more memory than is free. Build in GitHub Actions, push to GHCR, pull
  on the server.
- **Memory is the bottleneck, and the capacity check is a launch condition.**
  D-004 accepted this server on the condition that SC-009 measures real
  headroom rather than assuming it. Required measurements, recorded in
  `docs/LAUNCH-CHECKLIST.md` with numbers: resident memory of the application
  container at rest and under a short load test of the history page; free
  memory on the host with both workloads running; what happens when the
  container hits its memory limit; and whether a deploy, which runs the old
  and the new container briefly together, fits. If headroom is thin, the
  options are a hard memory limit plus swap, fewer server workers, a RAM
  upgrade, or a separate server, and that choice goes back to the owner with
  the numbers.
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
5. Start the new app container, wait for `/healthz` 200. On a database without
   a verified administrator the container does not become healthy: it exits
   with code 78 and logs `[admin-presence] Refusing to start`. That is the
   intended state of a fresh install; follow "First administrator" below.

## First administrator (private initialization)

A production server runs only while at least one **verified administrator**
exists: a row in Payload's `users` collection with an email and a stored
password, the only kind of account that can sign in to `/admin`. Every user
in that collection is a full administrator.

### What the application enforces

| Situation                                                                                              | Result                                                                                                                               |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Server starts, no verified administrator (fresh install, empty restore, wrong database)                | `next start` exits with code **78** before serving any request. Log: `[admin-presence] Refusing to start: …`                         |
| Server running, last administrator removed outside Payload (SQL, restore, database swapped underneath) | The process exits with code 78 within **8 s** (check every 5 s, each bounded to 3 s). Log: `[admin-presence] Stopping the server: …` |
| Server running, database stops answering                                                               | Tolerated for 15 s after the last good check (cold start, network blip), then the process exits with code 78                         |
| Removing the last administrator in the panel or through the REST API                                   | Refused with 409, in every environment. Concurrent and bulk deletes are serialised under a database lock                             |
| Creating a user without being a signed-in administrator, outside development                           | Refused with 403, whichever route the request comes through                                                                          |
| `next dev` (`NODE_ENV=development`)                                                                    | Nothing above except the last-administrator rule. Payload's default setup flow works on a fresh local database                       |

Nothing is cached between checks; the window is the check interval plus its
timeout. With `restart: unless-stopped` a stopped container is restarted and
runs the boot check again, so it keeps refusing until an administrator
exists. The check opens one extra database connection
(`application_name = sazejchytre-admin-presence`) and queries every 5 s,
which also keeps a scale-to-zero database compute awake.

### Procedure

Run this **before the host is reachable from the internet** (on a fresh
install, before the reverse proxy forwards to the container), and again only
after a restore that left no administrator. It needs a terminal on the
server; it is not reachable over HTTP.

1. Confirm which database you are about to write to. The command prints the
   database name first; stop if it is not the one you expect.
2. Run the initialization from the same one-off tooling container used for
   migrations (it needs the source tree and `tsx`, as `pnpm migrate` does;
   SC-009 defines the image and the service name, written `tools` here):

   ```bash
   cd /srv/sazejchytre/production
   docker compose run --rm -it tools \
     node --no-deprecation --import tsx src/scripts/admin-init.ts \
       --email 'owner@example.cz' --name 'Owner Name'
   ```

   Locally, against a disposable database, the same command is:

   ```bash
   node --env-file-if-exists=.env --no-deprecation --import tsx \
     src/scripts/admin-init.ts --email 'owner@example.test' --name 'Owner'
   ```

   It prompts twice for the password without echoing it. To pipe it from a
   password manager instead, add `--password-stdin` and drop `-t` from
   `docker compose run`. The password is never accepted as an argument or an
   environment variable. Minimum 16 characters; common passwords are refused.

3. Expected output, in this order:

   ```
   admin-init: database "<name>"
   admin-init: administrator created (id <n>)
   admin-init: sign-in with the new credentials verified
   admin-init: verified administrators: 1
   ```

   Exit code 0. Exit code 2 means refused (an administrator already exists,
   bad arguments, weak password); nothing was created. The command refuses
   whenever a verified administrator exists, under the same database lock as
   the panel, so it cannot add a second account behind an existing owner's
   back. Further administrators are created by a signed-in administrator in
   the panel.

4. Start the application container. The log shows
   `[admin-presence] verified administrator present; re-checking every 5 s`
   and `/healthz` answers 200.
5. Sign in at `/admin` through the access path that is restricted to the
   operator (SC-009), and record the date and the output of step 3, without
   the email address, in the private tracker.

A lost password for an existing account is recovered with the panel's
"forgot password" email (Resend must be configured), not with this command.

### After a restore

Restoring a backup restores its administrators. If the server stops with
code 78 after a restore, the restored data has no verified administrator:
keep the host closed and run the procedure above against the restored
database before starting the container again.

## Backups and restore

- Neon point-in-time restore (plan-dependent window).
- Nightly `pg_dump --format=custom` from a one-off container to a private R2
  bucket, 30 days retention.
- R2 documents bucket: enable object versioning or a daily copy.
- **Restore drill before launch:** restore last night's dump into a new Neon
  branch, point staging at it, open history and an invoice. Record the date
  and duration in `docs/LAUNCH-CHECKLIST.md`. The staging server starts only
  if the restored data contains a verified administrator (see "First
  administrator").

## Rollback

`deploy.sh rollback` starts the previous image tag. Migrations are
forward-only; a release with a migration that is not backwards compatible
must say so in its PR and needs a restore plan instead of a tag rollback.

## Secrets

Production secrets live only in the server's `.env` (mode 600) and in a
password manager. GitHub Actions gets only what it needs to push images and
deploy (GHCR token, SSH deploy key restricted to the deploy user). Rotate
anything that was ever pasted into a chat or a ticket.
