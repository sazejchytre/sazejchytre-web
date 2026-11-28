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

| Mode            | Serves                                                                                                                                              | Refuses                                                                                                                                                                             |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PRIVATE`       | `/healthz`, `/api/cron/*` (bearer), `/admin` and `/api/*` (Payload; anonymous API reads refused, administrator session and sign-in only)            | every page and public output, known or not: **503** with a short Czech "temporarily unavailable" page; `robots.txt` answers `Disallow: /`                                           |
| `INFORMATIONAL` | the above, plus `/`, `/historie`, `/metodika`, `/cenik`, `/kontakt`, the three legal pages, `/tipy/<slug>`, `robots.txt`, `sitemap.xml`, `llms.txt` | registration, sign-in, password and email flows, `/ucet/*`, `/auth/*`, `/predplatne`, `/webhooks/*`, and any path not in the route table: **404** with a short Czech not-found page |
| `FULL`          | everything, unchanged behaviour                                                                                                                     | nothing                                                                                                                                                                             |

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
- **Refusals are final and answered by the proxy step itself**, for every
  method and request kind (document, RSC navigation, prefetch, form post,
  Server Action), never by routing the request elsewhere, so the answer
  does not depend on the host name or bind address. `PRIVATE` answers a
  short Czech maintenance page (503), `INFORMATIONAL` a short Czech
  not-found page (404) that links to the home page. Both are self-contained
  HTML (no script, stylesheet or image) in
  `src/lib/launch-gate/responses.ts`; `responses.test.ts` checks their copy
  against the copy rules.
- **Refusals are `Cache-Control: no-store`, `X-Robots-Tag: noindex`** and
  carry `x-launch-gate: <reason>`. Every response the gate handled, passed
  or refused, carries `x-launch-gate-seen: 1`, which lets the verification
  script tell an application answer from a reverse proxy's.
- **REST answers are never cacheable.** Every response of the Payload REST
  mount, in every mode (success, Payload's errors, the `PRIVATE` refusal, a
  generic 500), carries `Cache-Control: private, no-store` and
  `Vary: Authorization, Cookie` in addition to the framework's own `Vary`.
  This does not rely on purging a cache after a mode change.
- **No link into a closed area.** The header's sign-in button and the
  pricing cards' purchase button are rendered only when the gate would serve
  their destination (`isLinkServed` in `src/lib/launch-gate/server.ts`, which
  asks `decide()` itself). Outside `FULL` the pricing cards are a price list
  without a purchase button. `link-guard.test.ts` fails when a component or
  public page links into a closed area without that check, and
  `--check-links` checks the rendered pages of a running deployment.

### Value per environment

| Environment             | `LAUNCH_MODE`                                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local development       | `.env.example` ships `PRIVATE`; set `FULL` (or `INFORMATIONAL`) in your own `.env` and restart `pnpm dev`                                                                            |
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

**Verified locally** (2026-11-28, production build of this branch, marked
disposable local Postgres): `node src/scripts/verify-launch-gate.ts
--build-dir .next --include-unsafe-methods` against `next start`, with every
route of the build's route manifest, all seven methods, every GET also as an
RSC navigation and prefetch, every POST also as a Server Action, and raw
path spellings: 541 probes, 0 mismatches in each of `PRIVATE` (variable
unset), `INFORMATIONAL` and `FULL`. `INFORMATIONAL` was also run with the
server bound to `127.0.0.1` and four `Host` values (`127.0.0.1`,
`localhost`, `sazejchytre.cz`, `staging.sazejchytre.cz`), all identical. A
registration Server Function posted to a closed page and to an open page
did not run in `INFORMATIONAL` (no account created). Through a local
caching reverse proxy, no REST response was stored. An invalid value
answered 500 everywhere.

**SC-015 limitation, not a gate result:** under `next start` every frontend
page answers 500 until the operator identity is filled in
(`src/lib/legal/operator.ts`). The gate passes those pages; the script lists
them as "permitted but 5xx" and does not count them as working (27 in
`INFORMATIONAL`, 150 in `FULL`, all with that one server-side cause; none in
`PRIVATE`, which serves no page). The rendered pages were therefore checked
against `next dev`: 281 probes, 0 mismatches, 0 server errors, and
`--check-links` found no link to a refused path on the 9 public pages.

These are guarantees of the application only. They say nothing about what
the internet can reach on a real host; that is the list below.

### The administrative surface

The application serves `/admin` and the Payload REST API in **every** mode,
`PRIVATE` included, because the administrator must be able to sign in to
prepare content before launch. The application side, verified locally in
`PRIVATE`:

- Anonymous REST requests for content are refused (503) except the sign-in
  operations listed in `src/lib/launch-gate/payload-api.ts`.
- Anonymous calls to the admin panel's own Server Functions are refused by
  Payload's access checks (`render-list` and `render-document` answer
  "Unauthorized"; `table-state` and `form-state` return no data). The gate
  adds nothing here; it relies on Payload.
- Reachable anonymously **by design**: the sign-in page, login, logout,
  token refresh, password reset, unlock and verification, `/api/users/me`
  (answers `null`), `/api/users/init` (says whether an administrator
  exists), `/api/access` (the permission map: names of the fields of the
  publicly readable collections, no documents), and
  `/api/users/first-register`, which creates the first administrator **when
  the database has none**. Admin sign-in is locked for 10 minutes after 5
  failed attempts (`src/collections/Users.ts`).

So the application does not, and cannot by itself, keep the admin panel off
the public internet. That is checked from outside with the verification
script's proxy mode (next section).

### Verification script: targets and proxy policies

| Invocation                            | Use it                                                       | Passes when                                                                                                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--target app` (default)              | against the container port, on the host                      | every answer is the application's (`x-launch-gate-seen`) and is what the gate decides for the mode                                                                                                          |
| `--target proxy --proxy-policy none`  | through the public host, from an allowlisted client          | the same as `app`                                                                                                                                                                                           |
| `--target proxy --proxy-policy admin` | through the public host, from a client outside the allowlist | `/admin` and `/api/*` are refused **by the proxy** (401, 403 or 404 without the gate marker); an application answer there fails, whatever its status. `/api/cron/*` may be either. Everything else as `app` |
| `--target proxy --proxy-policy site`  | a non-public host (staging, closed production)               | every path except `/healthz` is refused by the proxy; `/healthz` reaches the application                                                                                                                    |

A proxy refusal of a public page under `admin` fails too: that would be a
different policy. Every REST answer the application gives must carry
`private, no-store`. A route the gate passes that answers 5xx is reported as
"permitted but 5xx" and fails the run unless `--tolerate-permitted-5xx` is
given; a route the gate must refuse that answers 5xx is always a mismatch.
`--host-header <host>` repeats the run with another `Host`.

Verified locally against nginx in front of a `PRIVATE` build: with `/admin`
and `/api/*` (except `/api/cron/*`) denied, `--proxy-policy admin` passed
(281 of 281); with the same proxy but no restriction it failed with 57
mismatches, every administrative probe reported as reachable. One run hit a
transient container-to-host timeout on an unrelated path and was repeated.

**Requires SC-009 verification on staging and production** (none of this is
done yet):

1. The reverse proxy forwards every path and method to the application and
   does not serve anything itself for the application's host, so the gate
   sees every request.
2. No response cache at the proxy or a CDN in front of the application, or
   one that honours `Cache-Control` and `Vary` and is **purged after every
   `LAUNCH_MODE` change**. REST and refusal responses are marked
   non-storable by the application, but `llms.txt` and `sitemap.xml` are
   cacheable by design while the site is public, and a cache would replay
   them after a switch to `PRIVATE`. The proxy must not strip
   `Cache-Control`, `Vary` or `x-launch-gate-seen`.
3. While staging (or production in `PRIVATE`) is not public, an access
   restriction at VPS Centrum in front of the whole host (HTTP basic auth or
   an IP allowlist), with `/healthz` exempt for the uptime monitor. A
   content-review staging in `INFORMATIONAL` is allowed **only** behind this
   restriction, verified independently (from a client outside it) before
   anyone is given the address.
4. `/admin` and `/api/*` restricted at the proxy to the operator's addresses
   (or a VPN, or basic auth) in `PRIVATE` mode, and wherever feasible in
   every mode. `/api/cron/*` must stay reachable for the scheduler, either
   through the same allowlist or by calling the container on `127.0.0.1`.
   Verified with `--target proxy --proxy-policy admin` from a client outside
   the allowlist, and `--proxy-policy none` from an allowed client.
5. The first administrator is created **before** the host is reachable from
   outside, and `/api/users/init` answers `{"initialized":true}` before the
   proxy is opened; until then the first-administrator form is open to any
   client that reaches the host. The application-side guard for this is
   SC-019.
6. Rate limiting at the proxy for `/api/users/login` and
   `/api/users/forgot-password`, which are anonymous by design.
7. The proxy strips framework-internal request headers (for example
   `x-middleware-subrequest`) from client requests. The framework version in
   use already ignores them; this is defence in depth.
8. The container port is bound to `127.0.0.1` only. Direct access would not
   bypass the gate, but it would bypass the proxy controls above.
9. After every deploy and every mode change, run the verification against the
   host and keep its summary line with the deploy record:
   `node src/scripts/verify-launch-gate.ts --base-url https://<host> --mode <MODE> --target proxy --proxy-policy <policy>`,
   and on the host against the container port with `--target app`.
   Add `--check-links` in `INFORMATIONAL` (it fails if no public page could
   be read). Do not use `--tolerate-permitted-5xx` on a real host. Add
   `--include-unsafe-methods` only on staging: it sends anonymous empty
   POST/PUT/PATCH/DELETE requests, which reach open handlers.
10. Monitoring: in `PRIVATE` mode `/` answers 503 by design, so the uptime
    monitor must watch `/healthz`, or expect 503 on `/`.

Until each of these is done and recorded by SC-009, the launch gate's
guarantees hold for the application only; none of the controls above is
verified.

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
