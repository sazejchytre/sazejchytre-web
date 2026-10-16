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

Payment-layer scripts:

| Script                         | Purpose                                                   |
| ------------------------------ | --------------------------------------------------------- |
| `pnpm sync:prices`             | Dry run: what would change in Stripe products and prices  |
| `pnpm sync:prices:apply`       | Push `Plans` and `Prices` into Stripe                     |
| `pnpm reconcile:subscriptions` | Report where our subscriptions differ from the provider's |
| `pnpm test:stripe`             | Run the port contract against the real Stripe test API    |

`pnpm test:stripe` needs a **test** key in `.env` and prices already synced; it
refuses outright to run against a live key, because it charges cards and issues
refunds. It is deliberately not part of `pnpm test` (no network or credentials
there) or `pnpm test:db` (which must not depend on a third party being up).

`sync:prices` refuses to run against a live key unless `CONFIRM_LIVE=1` is
set, and refuses to change the amount of a price that already has
subscriptions attached. `reconcile:subscriptions` never writes — see
[Payments](#payments).

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

## Payments

Nothing outside `src/lib/billing/` imports a payment SDK. Everything goes
through a provider-agnostic port, and a second provider is one adapter file
plus one line in the registry.

| File                           | Responsibility                                          |
| ------------------------------ | ------------------------------------------------------- |
| `billing/port.ts`              | The interface. Our domain types only, no provider types |
| `billing/registry.ts`          | Resolves the active adapter from `BILLING_PROVIDER`     |
| `billing/fake-adapter.ts`      | In-memory provider, for tests and local work            |
| `billing/port-contract.ts`     | The contract, as a suite any adapter can be run against |
| `billing/lifecycle.ts`         | Upgrade/downgrade/cancellation policy                   |
| `billing/ordering.ts`          | Whether an event is new enough to act on                |
| `billing/redact.ts`            | Making payment data safe to log                         |
| `billing/stripe/translate.ts`  | Stripe objects → our types. Pure                        |
| `billing/stripe/status.ts`     | The status mapping table                                |
| `billing/stripe/webhook.ts`    | What we do when Stripe tells us something               |
| `app/webhooks/stripe/route.ts` | Verify, claim, handle, acknowledge                      |

### Every operation returns a result

A declined card is an ordinary outcome of asking for money, not an
exceptional one, so it comes back as a typed `BillingFailure` with a Czech
message. Exceptions are reserved for two things a caller cannot handle:
`BillingConfigurationError` (we are misconfigured) and
`BillingProviderUnreachableError` (the provider is down). Telling a customer
their card was declined when Stripe is simply unreachable is a lie that costs
the sale and generates a support ticket.

### An event type is not a receipt

`invoice.paid` does not mean an invoice was paid; it means an object changed
and the object carries the real state. Every handler that could grant
anything re-reads the object's own `status` / `payment_status` /
`amount_remaining` / `refunded` field first. Events are redelivered, replayed
from the dashboard and sent for objects that were later voided — trusting the
event name is how a subscription service serves paid content to somebody whose
payment never completed.

### Out-of-order events

Stripe makes no ordering guarantee. Every subscription row carries
`providerUpdatedAt`: the provider-side instant its contents were last known
true. An event older than that is recorded and **not applied**. A second guard
refuses to move a subscription out of `CANCELED` or `EXPIRED` whatever the
timestamp says, because Stripe never un-cancels and cancellation commonly
shares a second with a final `updated` event.

### Stripe API version

Pinned in `billing/stripe/client.ts`, never left to the account default — a
dashboard setting someone else can change must not reshape every object we
parse. Two things moved in `2026-09-30.endive` and fail **silently** if read
from the old place:

- `subscription.current_period_{start,end}` → on each subscription **item**
- `invoice.subscription` → `invoice.parent.subscription_details.subscription`
- `invoice.payment_intent` → `invoice.payments[].payment` (and the Payment
  Element secret is `invoice.confirmation_secret.client_secret`)

The pinned literal is typed as the SDK's own latest-version type, so bumping
the `stripe` package without revisiting that file is a type error.

### Disputes

A chargeback is a `disputes` row in our own admin, not just a line in Stripe's
dashboard — it has a hard evidence deadline and somebody here has to act on
it. An `OPEN` or `UNDER_REVIEW` dispute suspends **all** of that customer's
entitlements immediately, overriding subscriptions and manual grants alike.
The subscription itself stays `ACTIVE` throughout, which is exactly why the
suspension cannot be inferred from it.

`charge.dispute.closed` resolves the row, so a dispute decided in our favour
restores access without anybody remembering to do it. A dispute we lose leaves
access withdrawn through the subscription's own status.

### Refunds

A refund writes a `credit_notes` row against the invoice. **The invoice is
never modified** — only its `status` marker moves to `CREDITED`. An issued
invoice has been sent and may already be in somebody's accounting, and in
Czech VAT terms a correction is a separate document, not an edit.
`credit_notes.provider_refund_id` is unique, so a redelivered refund event
cannot produce a second credit note.

### Logging

Never a card number, a client secret, a webhook secret or a raw event
payload. `redactForLog` is pattern-based rather than key-based, so a secret
interpolated into a message or a URL is caught too. Card-number detection
uses a Luhn check, because a 13-digit epoch-millisecond timestamp is exactly
as long as a Visa PAN and redacting every one of them would destroy the
timestamps that make out-of-order handling debuggable.

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
- **No checkout UI.** The Stripe adapter returns a client secret for the
  Payment Element; the page that confirms it is step 5.
- **No invoice issuing or PDF.** `invoices` rows are modelled and immutable,
  but nothing creates one from a paid Stripe invoice yet (step 5b). Until it
  does, a refund or chargeback can only be tied back to a document if
  `invoices.providerPaymentId` has been filled in, and the webhook handler
  reports `NO_LOCAL_INVOICE_FOR_CHARGE` / `DISPUTE_NOT_ATTRIBUTABLE` rather
  than guessing.
- **The product/price sync and the Stripe adapter have never run against the
  Stripe API.** No test keys were available when they were written, so they
  are typechecked against the pinned API version's type definitions and
  covered by contract and fixture tests, but not yet exercised live. Run
  `pnpm sync:prices` (dry) first.
- Dispute **evidence** is still submitted in the Stripe dashboard. We record
  the deadline and the reason and restore access automatically when a dispute
  is won, but nothing here uploads evidence.
- `next/image` `remotePatterns` for the R2 domain is not configured yet — add
  it in the step that first renders a remote image.
