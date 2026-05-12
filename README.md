# SázejChytře — Betting Advisory Platform

Production-ready sports betting advisory SaaS built with Next.js 15, Supabase, and Stripe.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15.3 (App Router, React 19) |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS v4 |
| Auth + DB | Supabase (PostgreSQL + Row Level Security) |
| Payments | Stripe Checkout + Customer Portal + Webhooks |
| i18n | next-intl v3 (Czech, English, Slovak) |
| Validation | Zod |
| Deploy | Vercel |

---

## Local Development

### Prerequisites

- Node.js 20+
- A Supabase project
- A Stripe account (test mode is fine)

### 1. Clone and install

```bash
git clone https://github.com/your-org/sazejchytre-web.git
cd sazejchytre-web
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local` and fill in all values — see [Environment Variables](#environment-variables) below.

### 3. Set up Supabase

Run migrations in order:

```bash
# In the Supabase SQL Editor, paste and run:
# 1. supabase/migrations/001_initial_schema.sql
# 2. supabase/migrations/002_rls_policies.sql
```

Or if you have the Supabase CLI:

```bash
supabase db push
```

### 4. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Environment Variables

Copy `.env.example` to `.env.local` and fill in:

### Supabase

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL from Supabase dashboard |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon (public) key |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server-only** service role key — NEVER expose client-side |

### Stripe

| Variable | Description |
|---|---|
| `STRIPE_SECRET_KEY` | Secret key from Stripe dashboard (`sk_test_…` for test) |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret from `stripe listen` or Stripe dashboard |
| `STRIPE_BASIC_PRICE_ID` | Price ID for the BASIC plan |
| `STRIPE_PRO_PRICE_ID` | Price ID for the PRO plan |
| `STRIPE_ELITE_PRICE_ID` | Price ID for the ELITE plan |

### App

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_APP_URL` | Full origin URL, e.g. `https://sazejchytre.cz` |

---

## Supabase Setup

### Create price plans in Stripe first

Create **weekly** recurring products in Stripe:

1. Go to Products → Add product
2. Name: `BASIC / PRO / ELITE`, Price: `1499 CZK`, Billing: `Weekly`
3. Copy each Price ID into `.env.local`

### Google OAuth (optional)

1. Supabase dashboard → Authentication → Providers → Google
2. Add your OAuth client credentials
3. Authorized redirect URI: `https://[project].supabase.co/auth/v1/callback`

### Create the first super_admin

After signing up with your email, run in Supabase SQL Editor:

```sql
UPDATE profiles
SET role = 'super_admin'
WHERE id = (SELECT id FROM auth.users WHERE email = 'your@email.com');
```

---

## Stripe Setup

### Webhook configuration

**Local development** — forward events to localhost:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Copy the printed webhook signing secret to `STRIPE_WEBHOOK_SECRET`.

**Production** — in Stripe dashboard:

1. Developers → Webhooks → Add endpoint
2. URL: `https://yourdomain.com/api/stripe/webhook`
3. Select events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
4. Copy signing secret to Vercel env var `STRIPE_WEBHOOK_SECRET`

### Customer Portal

1. Stripe dashboard → Settings → Billing → Customer portal
2. Enable cancel subscriptions, update payment methods
3. Test with `/dashboard/billing` → "Manage Billing"

---

## Vercel Deployment

```bash
npm run build   # Verify build locally first
vercel --prod
```

Set all env vars in Vercel dashboard (Project Settings → Environment Variables). Mark `SUPABASE_SERVICE_ROLE_KEY` and `STRIPE_SECRET_KEY` as **Server** only.

Set `NEXT_PUBLIC_APP_URL` to your production domain.

---

## URL Structure

```
/cs/           Czech (default)
/en/           English
/sk/           Slovak

/[locale]/pricing
/[locale]/dashboard
/[locale]/dashboard/billing
/[locale]/admin
/[locale]/admin/tips
/[locale]/admin/categories
/[locale]/admin/users
```

---

## Access Control

| Role | Access |
|---|---|
| Anonymous | Public pages only |
| Authenticated (no sub) | Dashboard visible, tips locked |
| BASIC subscriber | BASIC tips |
| PRO subscriber | BASIC + PRO tips |
| ELITE subscriber | All tips |
| Admin / Super Admin | Admin panel, all tips |

Access is enforced **server-side** via Supabase RLS — not just in the UI.

---

## Security Notes

- `SUPABASE_SERVICE_ROLE_KEY` is **never** used in client-side code
- All admin API routes verify identity via `requireAdmin()` before any DB operation
- Stripe webhook signature is verified before processing any event
- All user inputs are validated with Zod
- RLS policies prevent users from accessing or modifying data they don't own
- Rate limiting on checkout endpoint (5 req/min per IP)
- All admin actions are written to `audit_logs`
- Open redirect prevention on OAuth callback
- Security headers set in `next.config.ts` (XSS, frame-options, HSTS, etc.)

See [SECURITY_CHECKLIST.md](./SECURITY_CHECKLIST.md) for the full pre-launch checklist.

---

## Troubleshooting

**"No billing account found" on portal**
The user has no row in `subscriptions`. They need to complete a checkout first.

**Webhook events not processed**
Check that `STRIPE_WEBHOOK_SECRET` matches the secret for your endpoint. Events are idempotent — re-delivery is safe.

**User sees no tips after subscribing**
The `user_entitlements` row may not have been written. Check `stripe_events` for processing errors. Run `handleSubscriptionChange` manually by re-triggering the webhook in Stripe dashboard.

**TypeScript `never` inference on Supabase queries**
Use `createClient` (raw, no Database generic) for write operations in API routes — see `getRawAdminClient()` pattern in the Stripe and admin routes.

**Build error: STRIPE_SECRET_KEY is not set**
Expected in CI without env vars. The Stripe client is lazy-initialized and only throws at runtime when a request actually needs it. For CI builds, mock or skip the env check.
