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
(STRIPE), `ACCOUNTING_PROVIDER` (FAKE), `SUPPORTED_BILLING_COUNTRIES` (CZ),
`LAUNCH_MODE` (PRIVATE, see "Launch gate" below).

Phase A (no payments) still needs Stripe variables to boot: use `sk_test_` /
`pk_test_` keys and keep `ACCOUNTING_PROVIDER=FAKE` until Phase B.

## Launch gate (`LAUNCH_MODE`, SC-017)

One run-time variable decides which parts of the application a deployment
serves. It is read from `.env` when the process starts; changing it means
restarting the container, not rebuilding the image.

| Mode            | Serves                                                                                                                                              | Refuses                                                                                                                                                                                  |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PRIVATE`       | `/healthz`, `/api/cron/*` (bearer), `/admin` and `/api/*` (Payload; anonymous API reads refused, administrator session and sign-in only)            | every page and public output, known or not: **503**; `robots.txt` answers `Disallow: /`                                                                                                  |
| `INFORMATIONAL` | the above, plus `/`, `/historie`, `/metodika`, `/cenik`, `/kontakt`, the three legal pages, `/tipy/<slug>`, `robots.txt`, `sitemap.xml`, `llms.txt` | registration, sign-in, password and email flows, `/ucet/*`, `/auth/*`, `/predplatne`, `/webhooks/*`, and any path not in the route table: **404** (the site's own 404 page for GET/HEAD) |
| `FULL`          | everything, unchanged behaviour                                                                                                                     | nothing                                                                                                                                                                                  |

Rules that hold in every mode:

- **Default and errors fail closed.** Unset means `PRIVATE`. Any other value
  than the three exact names (`full`, `FULL `, an empty string) is a
  configuration error: every request, `/healthz` included, answers 500 and
  the log names `LAUNCH_MODE` without echoing the value. The Docker
  healthcheck therefore fails and a deploy must not be considered done.
- **Only method, path and mode decide.** No header, cookie or query parameter
  changes the answer. There is no preview bypass. In `PRIVATE` mode even a
  valid administrator session does not open a page; it opens the Payload API
  only.
- **All methods.** A closed area refuses GET, HEAD, POST, PUT, PATCH, DELETE
  and OPTIONS alike. An open page accepts GET, HEAD and POST (POST is how
  forms invoke Server Functions); other methods get 405.
- **Server Functions.** A Server Function invoked against a different page is
  forwarded by Next to its owning page, which passes the gate again, so an
  account action cannot be run through an open page.
- **Refusals are `Cache-Control: no-store`, `X-Robots-Tag: noindex`** and
  carry `x-launch-gate: <reason>` so the verification script can tell them
  from the application's own 404s.

### Value per environment

| Environment             | `LAUNCH_MODE`                                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local development       | `FULL` in your `.env` (unset gives `PRIVATE`, which closes every page)                                                                                                               |
| CI build and unit tests | unset; the build does not read it and the tests set it themselves                                                                                                                    |
| Staging                 | `PRIVATE` by default. `INFORMATIONAL` for pre-launch review **only behind the reverse-proxy access restriction below**. `FULL` only for Phase B verification (SC-010) with test keys |
| Production              | `PRIVATE` until every Phase A item in `docs/LAUNCH-CHECKLIST.md` is ticked (D-012 fallback), then `INFORMATIONAL`. `FULL` only after the owner approves Phase B                      |

### Why the gate is in the application

The control that keeps the site private has to be provable before the VPS
setup is (SC-009). In the application it is covered by the unit suite on
every push, behaves identically on a laptop, in CI, on staging and in
production, and fails closed when unset. A reverse-proxy rule cannot be
tested in CI and depends on VPS Centrum configuration that is not verified
yet. The reverse proxy is the second layer, not the only one.

### Verified locally vs. to be verified on the server

**Verified locally** (2026-11-27, production build of this branch, local
Postgres): `node src/scripts/verify-launch-gate.ts` against `next start` in
each mode, with every route of the build's route manifest, all seven methods
and raw path spellings (encoded characters, dot segments, double and
trailing slashes): 352 of 352 probes as expected in `PRIVATE` (variable
unset), `INFORMATIONAL` and `FULL`. A registration Server Function posted to
an open page ran in `FULL` and did not run in `INFORMATIONAL`. In `PRIVATE`
the Payload API answered an administrator session and refused anonymous and
cross-origin requests. An invalid value answered 500 everywhere.

**Requires SC-009 verification on staging and production** (none of this is
done yet):

1. The reverse proxy forwards every path and method to the application and
   does not serve anything itself for the application's host, so the gate
   sees every request.
2. No response cache at the proxy or a CDN in front of the application, or
   one that honours `Cache-Control` and is **purged after every
   `LAUNCH_MODE` change**. `llms.txt` and `sitemap.xml` are cacheable by
   design while the site is public, and a cache would replay them after a
   switch to `PRIVATE`.
3. While staging (or production in `PRIVATE`) is not public, an access
   restriction at VPS Centrum in front of the whole host (HTTP basic auth or
   an IP allowlist), with `/healthz` exempt for the uptime monitor. Where
   feasible, restrict `/admin` and `/api` to known addresses in every mode.
4. The proxy strips framework-internal request headers (for example
   `x-middleware-subrequest`) from client requests. The framework version in
   use already ignores them; this is defence in depth.
5. The container port is bound to `127.0.0.1` only. Direct access would not
   bypass the gate, but it would bypass the proxy controls above.
6. After every deploy and every mode change, run the verification against the
   host and keep its summary line with the deploy record:
   `node src/scripts/verify-launch-gate.ts --base-url https://<host> --mode <MODE>`.
   Add `--include-unsafe-methods` only on staging: it sends anonymous empty
   POST/PUT/PATCH/DELETE requests, which reach open handlers.
7. Monitoring: in `PRIVATE` mode `/` answers 503 by design, so the uptime
   monitor must watch `/healthz`, or expect 503 on `/`.

Not covered by the gate: the public R2 media bucket is served by the CDN
directly and stays reachable in every mode. It holds images uploaded for the
public pages only; documents live in the private bucket.

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
