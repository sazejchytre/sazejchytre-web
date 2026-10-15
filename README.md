# sazejchytre.cz

Subscription service providing AI-assisted sports betting **analysis**. The
service is informational: it does not accept bets and does not broker gambling.

> **Status: step 1 — foundation only.** Repository scaffold, validated config,
> database, Payload core, health endpoint and CI. There are no real pages, no
> auth flows, no payments, no i18n and no brand design yet.

## Stack

| Concern     | Choice                                       |
| ----------- | -------------------------------------------- |
| Framework   | Next.js 16 (App Router, Turbopack), React 19 |
| Language    | TypeScript, `strict` plus every extra check  |
| Styling     | Tailwind CSS v4 (`@theme` tokens)            |
| CMS         | Payload CMS 3, mounted inside the Next app   |
| Database    | Neon Postgres via `@payloadcms/db-postgres`  |
| Media       | Cloudflare R2 via `@payloadcms/storage-s3`   |
| Cache       | Upstash Redis (configured, not yet used)     |
| Hosting     | Vercel Pro                                   |
| Package mgr | pnpm                                         |

## Getting started

```bash
pnpm install
cp .env.example .env     # then fill in every value
pnpm migrate             # 1. Payload migrations — also creates the `auth` schema
pnpm auth:migrate        # 2. better-auth migrations — into the `auth` schema
pnpm seed                # optional: the three plans and their CZK prices
pnpm dev                 # http://localhost:3000
```

**The order matters.** `pnpm migrate` creates the `auth` schema that
`pnpm auth:migrate` writes into; run them the other way round and the second
one refuses with an explanation rather than creating the schema itself. See
[Database ownership](#database-ownership) below.

Open <http://localhost:3000/admin> and create the first admin user.

There are no fallback values for secrets. A missing or malformed variable
crashes the boot with a list of what is wrong — see `src/lib/env.ts`.

## Scripts

| Script                    | Purpose                                      |
| ------------------------- | -------------------------------------------- |
| `pnpm dev`                | Dev server                                   |
| `pnpm build`              | Production build (typechecks as it goes)     |
| `pnpm typecheck`          | `tsc --noEmit`                               |
| `pnpm lint`               | ESLint                                       |
| `pnpm test`               | Node test runner                             |
| `pnpm format`             | Prettier, write                              |
| `pnpm audit`              | Fails on high/critical advisories            |
| `pnpm migrate:create`     | Generate a migration from config changes     |
| `pnpm migrate`            | Apply pending migrations                     |
| `pnpm generate:types`     | Regenerate `src/payload-types.ts`            |
| `pnpm generate:importmap` | Regenerate the admin import map              |
| `pnpm auth:migrate`       | Apply better-auth migrations (`auth` schema) |
| `pnpm auth:migrate:dry`   | Print better-auth's SQL, change nothing      |
| `pnpm seed`               | Upsert plans and CZK prices                  |
| `pnpm test:db`            | Integration tests against Neon (not in CI)   |

## Layout

```
src/
├── app/
│   ├── (frontend)/          public site — layout, page, globals.css
│   ├── (payload)/           admin panel + REST API (Payload owns /api)
│   └── healthz/             health probe
├── collections/             Users, Media
├── lib/
│   ├── access.ts            shared access-control predicates
│   ├── env.ts               server env schema (secrets)
│   ├── env.public.ts        NEXT_PUBLIC_* schema (client-safe)
│   ├── legal/operator.ts    operator identity — single source of truth
│   └── uploads/             content-based image type detection
├── migrations/              generated, reviewed, committed
├── payload.config.ts
└── proxy.ts                 Next 16 proxy (formerly middleware.ts)
```

## Database ownership

One Neon database, **two migration systems, two schemas**. Neither tool knows
the other exists, so they are kept apart by namespace rather than by
convention.

| Schema   | Owner           | Managed by          | Contains                                                  |
| -------- | --------------- | ------------------- | --------------------------------------------------------- |
| `public` | **Payload**     | `pnpm migrate`      | admin users, media, and the whole billing domain          |
| `auth`   | **better-auth** | `pnpm auth:migrate` | `user`, `session`, `account`, `verification`, `twoFactor` |

### Why they must not share a schema

Each tool decides what to do by comparing the live database against its own
idea of the schema. Pointed at the same namespace, each would see the other's
tables as drift:

- Payload's `migrate:create` would offer to **drop** better-auth's tables,
  because they are not in its config.
- better-auth's introspection would report Payload's 22 tables as a schema
  mismatch.

Separate schemas make that impossible instead of merely unlikely. It is
verified in both directions: after `pnpm auth:migrate`, `pnpm migrate:create`
reports _"No schema changes detected"_, and no auth table exists in `public`.

### Two different kinds of user

Both schemas have something called a user, and they are not the same thing.

- `public.users` — **admins**. Payload's own auth, for the `/admin` panel.
- `auth.user` — **customers**. better-auth, for the public site.

They have separate tables, separate session cookies and separate signing
secrets (`PAYLOAD_SECRET` vs `BETTER_AUTH_SECRET`), so a compromise of one
cannot forge a session in the other. The only link between the two worlds is
`public.customers.auth_user_id`, set once when a customer verifies their email.

### Why better-auth does not rely on `search_path`

better-auth is configured with `schemaName: 'auth'`, which qualifies every
statement it issues (`insert into "auth"."user" …`). The alternative — setting
`search_path` on the connection — would not be safe here: Neon's pooled
endpoint is pgBouncer in transaction mode, where a session-level
`SET search_path` is not guaranteed to still apply to the next statement.

### From scratch on an empty database

```bash
pnpm migrate        # 5 migrations: 22 tables in `public`, plus the `auth` schema
pnpm auth:migrate   # 5 tables in `auth`
```

Rolling back the schema is deliberately awkward: the `down` of the
`create_auth_schema` migration uses `DROP SCHEMA … RESTRICT`, so it fails
rather than cascading away every customer account. Roll back better-auth
first if that is genuinely what you want.

## Conventions that are not negotiable

- **Every collection declares every access rule.** Payload's defaults are
  permissive; "we forgot to set it" must never be reachable.
- **Secrets never get a default.** Boot fails instead.
- **`src/proxy.ts`, never `src/middleware.ts`.** Next 16 convention.
- **Payload owns `/api`.** The health check lives at `/healthz` so it cannot
  collide with the catch-all.
- **Operator identity is imported, never retyped.** Footer, legal pages,
  invoices, Stripe metadata and JSON-LD all read `src/lib/legal/operator.ts`.
  Never store or render a date of birth for the operator.
- **Uploads are validated by their bytes**, not their extension or declared
  Content-Type. SVG is rejected — it executes script on our own origin.

## Known gaps (deliberate, scheduled for later steps)

- No Content-Security-Policy yet. Nonce-based CSP is its own step; a partial
  one would either protect nothing or break every later feature.
- Brand colour tokens are an explicit `TODO` block in `globals.css`.
- `src/lib/legal/operator.ts` holds `TODO:` placeholders. Nothing public may
  ship until they are replaced and `OPERATOR_DETAILS_CONFIRMED` is `true`.
- Responsible-gambling disclaimer wording is pending legal review.
- Upstash Redis is validated at boot but not consumed.
- `next/image` `remotePatterns` for the R2 domain is not configured yet — add
  it in the step that first renders a remote image.
