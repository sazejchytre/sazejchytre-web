# Architecture

Modular monolith: one Next.js 16 app with Payload CMS 3 mounted inside it,
one Postgres database, no microservices. Keep it that way unless a decision
in `docs/DECISIONS.md` says otherwise.

## Runtime pieces

```
Browser ── HTTPS ── reverse proxy (VPS) ── Next.js server (node, port 3000)
                                              ├─ src/proxy.ts      launch gate, every path except /_next/static
                                              ├─ App Router pages  src/app/(frontend)
                                              ├─ Payload admin/REST src/app/(payload)  /admin, /api/*  (no GraphQL)
                                              ├─ better-auth       /auth/[...all]
                                              ├─ Stripe webhook    /webhooks/stripe
                                              ├─ Cron endpoints    /api/cron/*  (bearer CRON_SECRET)
                                              └─ Health            /healthz
External: Neon Postgres · Cloudflare R2 (media + private documents bucket)
          Stripe · Fakturoid · Resend · Ecomail · Turnstile · Upstash Redis
```

## Source layout (verified 2026-11-27)

| Path                      | Contents                                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/app/(frontend)`      | Czech public pages: `/`, `historie`, `metodika`, `cenik`, `predplatne` (stub), `tipy/[slug]`, `kontakt`, auth pages, `ucet` (+ `doklady`, `zabezpeceni`), legal pages    |
| `src/app/(payload)`       | Payload admin and its REST API. GraphQL is disabled in `src/payload.config.ts` and has no route of its own; `GET /api/graphql` answers 404                               |
| `src/app/webhooks/stripe` | Stripe webhook route                                                                                                                                                     |
| `src/app/api/cron/*`      | `sweep-lockouts`, `retry-document-delivery`                                                                                                                              |
| `src/collections/*`       | Payload collections grouped by `auth`, `billing`, `content`, `tips`                                                                                                      |
| `src/globals`             | `SiteSettings`                                                                                                                                                           |
| `src/lib/billing`         | domain, ports, Stripe adapter (`stripe/`), fake adapter, entitlements, lifecycle                                                                                         |
| `src/lib/accounting`      | accounting port, Fakturoid adapter, fake adapter                                                                                                                         |
| `src/lib/invoicing`       | issuing, credit notes, storage, delivery, export                                                                                                                         |
| `src/lib/tips`            | settlement, series, visibility, ingestion schema, immutability helpers                                                                                                   |
| `src/lib/auth`            | better-auth config, actions, policies, lockouts, rate limits                                                                                                             |
| `src/lib/launch-gate`     | launch modes, the route table every path is classified by, the gate decision and responses, the PRIVATE-mode rule for the Payload API, the route inventory used by tests |
| `src/lib/forms`           | contact + newsletter, Turnstile, Ecomail                                                                                                                                 |
| `src/lib/legal`           | operator identity (single source)                                                                                                                                        |
| `src/lib/design`          | tokens, fonts, contrast checks                                                                                                                                           |
| `src/components`          | UI primitives (`ui/`), layout, history, tips, pricing, forms                                                                                                             |
| `src/i18n/messages/cs.ts` | all customer-facing copy                                                                                                                                                 |
| `src/migrations`          | Payload migrations (never edit committed ones)                                                                                                                           |
| `src/scripts`             | operational scripts (`pnpm` scripts in `package.json`)                                                                                                                   |
| `src/seed`                | billing and content seeds                                                                                                                                                |

## Launch gate

`LAUNCH_MODE` (`PRIVATE` | `INFORMATIONAL` | `FULL`, default `PRIVATE`) decides
which areas a deployment serves. Enforcement points, in request order:

1. `src/proxy.ts` calls `runLaunchGate` for every path except
   `/_next/static`. The decision (`src/lib/launch-gate/decide.ts`) is a pure
   function of mode, method and pathname over an allowlist
   (`src/lib/launch-gate/routes.ts`): a path that matches no rule is refused
   outside `FULL`.
2. `src/app/(payload)/api/[...slug]/route.ts` wraps Payload's REST handlers:
   in `PRIVATE` mode only an administrator session or an administrator
   sign-in operation reaches Payload.
3. `src/components/layout/Header.tsx` leaves out navigation to areas the mode
   closes. Presentation only; points 1 and 2 are the control.

A new route file under `src/app` fails `src/lib/launch-gate/routes.test.ts`
until it is classified in both `routes.ts` and `test-fixtures.ts`. Operations
and deployment controls: `docs/DEPLOYMENT.md`, "Launch gate".

## Boundaries

- Provider SDKs (`stripe`, Fakturoid HTTP) only inside their adapter folders.
  Everything else talks to `BillingPort` / accounting port.
- Visibility decisions only via `src/lib/tips/visibility.ts`. A page must not
  invent its own rule for who sees what.
- Copy only in `cs.ts`. Operator data only in `operator.ts`.
- Env access only through `env` / `publicEnv` objects.

## Data flow: paid subscription (designed, not yet live)

1. Customer picks a price, checkout creates a Stripe subscription via the port
   (UI missing, SC-014).
2. Stripe sends events to `/webhooks/stripe`; the event is claimed, handled
   idempotently, subscription state and entitlement grants are written.
3. `invoice.paid` triggers invoice issuing in Fakturoid; PDF stored in the
   private R2 documents bucket; email via Resend; retry cron for failures.
4. Entitlements decide FULL visibility (rendering missing, SC-008).
