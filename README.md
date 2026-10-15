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
| `pnpm seed:tips`          | Sports, competitions and 15 historical tips  |
| `pnpm seed:tips:purge`    | Delete every row marked `seed-step-3b`       |
| `pnpm sweep:lockouts`     | Delete `auth_lockouts` past 90 days          |

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

## Tip immutability

A published tip is **frozen**, enforced by **database triggers** as well as by
Payload hooks. This is the only place in the codebase that uses a trigger, so
it is worth knowing why, and what the cost is.

### Why a trigger and not just a hook

Everywhere else the thing to defend against is a bad request, and a request has
to go through Payload — so a hook is enough. Here the thing to defend against
is **our own server code**: a migration, a support script, a patch applied with
`overrideAccess: true`, a well-meant fix that nudges an odds figure on a tip
that happened to win.

A hook cannot see any of that. The published ROI is computed from these rows
and customers pay because of it, so "a developer could quietly improve the
record" is a real threat rather than a theoretical one. A trigger sees
everything that reaches Postgres.

### What is frozen

Once a tip leaves `DRAFT`:

| Table            | May still change                               | Everything else |
| ---------------- | ---------------------------------------------- | --------------- |
| `tips`           | `status` (legal transitions only), `settledAt` | frozen          |
| `tip_selections` | `outcome`, `closingOdds`, `settledAt`          | frozen          |

Selections cannot be **added to** or **removed from** a published tip, a
published tip cannot be **deleted**, and `SETTLED` / `VOIDED` are terminal — a
settled tip can never return to `PUBLISHED` to be settled differently.

`tip_audit_events` is append-only: no update, no delete, ever.

Each trigger uses a **whitelist** of columns that may change, so a field added
later is frozen by default rather than editable because nobody updated a
blacklist.

### The triggers

Created by `src/migrations/20261015_201500_tip_immutability_triggers.ts`:

| Trigger                                      | Table              | Fires on |
| -------------------------------------------- | ------------------ | -------- |
| `tips_immutable_after_publication`           | `tips`             | UPDATE   |
| `tips_no_delete_after_publication`           | `tips`             | DELETE   |
| `tip_selections_immutable_after_publication` | `tip_selections`   | UPDATE   |
| `tip_selections_no_insert_after_publication` | `tip_selections`   | INSERT   |
| `tip_selections_no_delete_after_publication` | `tip_selections`   | DELETE   |
| `tip_audit_events_no_update`                 | `tip_audit_events` | UPDATE   |
| `tip_audit_events_no_delete`                 | `tip_audit_events` | DELETE   |

All raise `SQLSTATE 23000` (`integrity_constraint_violation`) with a message
naming the row and a hint saying what to do instead.

### The cost, accepted knowingly

**Triggers are not in Payload's schema snapshot.** `pnpm migrate:create`
neither knows about them nor manages them. Consequences:

- If the tips tables are ever dropped and recreated, the triggers must be
  **re-applied** — re-run that migration's `up`.
- `pnpm migrate:create` will never notice a trigger that has gone missing.
  `pnpm test:db` is what notices: it attacks the rules through raw SQL, and
  those tests fail if a trigger is absent.

That trade was made deliberately: single-source migrations are worth more
almost everywhere, and less than tamper-evidence here.

### Working around them legitimately

Two places need to, and both are development-only:

- `pnpm seed:tips` publishes **through** the triggers rather than around them —
  the immutability trigger permits any update while the row is still `DRAFT`,
  and the backdated publication is that `DRAFT → PUBLISHED` statement itself.
- `pnpm seed:tips:purge` does disable the delete triggers, because refusing to
  delete a published tip is exactly what they are for. It only touches rows
  carrying the seed marker.

Nothing in the application code disables a trigger.

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
