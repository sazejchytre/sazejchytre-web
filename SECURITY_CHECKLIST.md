# Security Checklist — SázejChytře

Use this before every production deployment.

---

## 1. Environment Variables

- [ ] `SUPABASE_SERVICE_ROLE_KEY` is set only as a **server** env var in Vercel (not prefixed with `NEXT_PUBLIC_`)
- [ ] `STRIPE_SECRET_KEY` is set only as a **server** env var in Vercel
- [ ] `STRIPE_WEBHOOK_SECRET` is set and matches the signing secret in Stripe dashboard
- [ ] `NEXT_PUBLIC_APP_URL` matches the production domain exactly (no trailing slash)
- [ ] No secrets are committed to git — verify with `git log -p | grep -i secret`

---

## 2. Supabase RLS Policies

- [ ] RLS is **enabled** on all tables — verify in Supabase dashboard → Table Editor → each table shows "RLS enabled"
- [ ] Run this SQL to confirm no table has RLS disabled:
  ```sql
  SELECT tablename, rowsecurity
  FROM pg_tables
  WHERE schemaname = 'public' AND rowsecurity = false;
  ```
  Expected result: 0 rows.
- [ ] `tips` table: users can only SELECT rows where `has_plan_access(required_plan)` returns true
- [ ] `profiles` table: users can only UPDATE their own row, and the UPDATE policy blocks `role` field changes
- [ ] `audit_logs` table: no INSERT policy for authenticated users (service role only via API routes)
- [ ] `stripe_events` table: no INSERT/UPDATE for authenticated users (service role only)

---

## 3. Stripe Webhook

- [ ] Webhook signature verified with `stripe.webhooks.constructEvent(body, signature, secret)` before any processing
- [ ] Webhook endpoint is registered in Stripe dashboard with the correct events
- [ ] `stripe_events` table used for idempotency — duplicate deliveries are safe
- [ ] Webhook handler returns 200 even for unsupported event types (no 4xx that would trigger Stripe retries unnecessarily)

---

## 4. Admin Access

- [ ] All `/api/admin/**` routes call `requireAdmin()` as the first operation — verify by reading each file
- [ ] Admin panel pages (`/[locale]/admin/**`) redirect to home if `requireAdmin()` throws
- [ ] No admin functionality is accessible without authentication
- [ ] `requireAdmin()` checks `role IN ('admin', 'super_admin')` — not just any authenticated user

---

## 5. Server-Side Paywall

- [ ] Tips content is gated at the DB level via `has_plan_access(required_plan)` RLS policy — NOT only in the frontend
- [ ] API routes serving tips content use the server Supabase client (cookies-based session), not admin client
- [ ] Locked tip cards in the UI are for UX only — the underlying data is never sent in the response

---

## 6. Role Escalation Prevention

- [ ] The profiles UPDATE RLS policy prevents users from changing their own `role` field:
  ```sql
  -- Policy should include:
  WITH CHECK (role = (SELECT role FROM profiles WHERE id = auth.uid()))
  ```
- [ ] `requireAdmin()` reads role from the DB, not from a JWT claim or client-sent value
- [ ] No API endpoint accepts a `role` field from the request body for user operations

---

## 7. Service Role Key Usage

- [ ] `SUPABASE_SERVICE_ROLE_KEY` appears **only** in these files:
  - `src/lib/supabase/admin.ts`
  - `src/lib/utils/audit.ts`
  - `src/app/api/stripe/checkout/route.ts` (via `getRawAdminClient`)
  - `src/app/api/stripe/portal/route.ts` (via `getRawAdminClient`)
  - `src/app/api/stripe/webhook/route.ts` (via `getRawAdminClient`)
  - `src/app/api/admin/tips/route.ts` (via `getRawAdminClient`)
  - `src/app/api/admin/tips/[id]/route.ts` (via `getRawAdminClient`)
  - `src/app/api/admin/categories/route.ts` (via `getRawAdminClient`)
  - `src/app/api/admin/categories/[id]/route.ts` (via `getRawAdminClient`)
- [ ] Run this to verify no `SUPABASE_SERVICE_ROLE_KEY` reference in client components:
  ```bash
  grep -r "SUPABASE_SERVICE_ROLE_KEY" src/components src/app --include="*.tsx" --include="*.ts" \
    | grep -v "route.ts" | grep -v "layout.tsx" | grep -v "/api/"
  ```
  Expected: 0 matches (or only server files).

---

## 8. Input Validation

- [ ] All API routes parse request body with Zod before using any field
- [ ] Zod schemas use `.min()`, `.max()`, `.uuid()`, `.datetime()` constraints — no raw strings accepted
- [ ] Rate limiting on checkout: 5 requests per minute per IP

---

## 9. Audit Logging

- [ ] Every admin action writes to `audit_logs`: tip create, tip update, tip delete, category operations
- [ ] Audit logs include `actor_id`, `action`, `entity_type`, `entity_id`, `ip_address`, `user_agent`
- [ ] `audit_logs` table has no INSERT RLS policy for authenticated users — only service role can write

---

## 10. OAuth / Auth Callback

- [ ] OAuth callback validates `next` parameter with `startsWith('/')` before redirecting — no open redirect
- [ ] `next` parameter cannot point to an external URL

---

## 11. Security Headers

Verify these headers are returned on production responses:

```bash
curl -I https://yourdomain.com
```

- [ ] `X-Frame-Options: DENY`
- [ ] `X-Content-Type-Options: nosniff`
- [ ] `X-XSS-Protection: 1; mode=block`
- [ ] `Referrer-Policy: strict-origin-when-cross-origin`
- [ ] `Permissions-Policy` is set
- [ ] `Strict-Transport-Security` (HSTS) is set in production

---

## 12. Production Final Checklist

- [ ] `npm run build` passes with 0 errors and 0 warnings
- [ ] All Stripe price IDs point to **live** mode prices (not test mode) for production
- [ ] Stripe webhook is registered in **live** mode (separate from test mode webhook)
- [ ] Supabase project is not in paused state
- [ ] Google OAuth redirect URI includes the production domain
- [ ] First super_admin account has been created and tested
- [ ] A test subscription has been created and the entitlement was written correctly
- [ ] Webhook delivery logs in Stripe dashboard show no failures
- [ ] Legal pages (terms, privacy, cookies, responsible gambling) have been reviewed by a legal professional

---

## Known Accepted Risks

| Risk | Mitigation |
|---|---|
| RLS bypass via service role | Service role key is never in client code; only used in server API routes that also perform auth checks |
| Stripe price ID hardcoded per plan | Price IDs are server-only env vars; a compromised frontend cannot substitute a different price |
| Tip content cached by CDN | Dashboard and tips pages use `dynamic = 'force-dynamic'` where applicable; no sensitive data in static cache |
