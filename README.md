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
pnpm migrate             # apply database migrations
pnpm dev                 # http://localhost:3000
```

Open <http://localhost:3000/admin> and create the first admin user.

There are no fallback values for secrets. A missing or malformed variable
crashes the boot with a list of what is wrong — see `src/lib/env.ts`.

## Scripts

| Script                    | Purpose                                  |
| ------------------------- | ---------------------------------------- |
| `pnpm dev`                | Dev server                               |
| `pnpm build`              | Production build (typechecks as it goes) |
| `pnpm typecheck`          | `tsc --noEmit`                           |
| `pnpm lint`               | ESLint                                   |
| `pnpm test`               | Node test runner                         |
| `pnpm format`             | Prettier, write                          |
| `pnpm audit`              | Fails on high/critical advisories        |
| `pnpm migrate:create`     | Generate a migration from config changes |
| `pnpm migrate`            | Apply pending migrations                 |
| `pnpm generate:types`     | Regenerate `src/payload-types.ts`        |
| `pnpm generate:importmap` | Regenerate the admin import map          |

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
