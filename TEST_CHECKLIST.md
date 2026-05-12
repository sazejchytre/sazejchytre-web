# Test Checklist — SázejChytře

Manual test scenarios to verify before every release. Run against the staging environment with real Stripe test mode events.

---

## Setup

1. Create 5 test accounts: `anon`, `no_sub`, `basic_user`, `pro_user`, `elite_user`
2. Create an `admin` account and set `role = 'admin'` in the `profiles` table
3. Create a `super_admin` account and set `role = 'super_admin'`
4. Create tips for each plan level: one BASIC, one PRO, one ELITE — all published

---

## Authentication

| Scenario | Expected |
|---|---|
| Visit `/cs/dashboard` while logged out | Redirect to `/cs/login` |
| Visit `/cs/admin` while logged out | Redirect to `/cs` |
| Register new account | Profile row created in `profiles` table with `role = 'user'` |
| Sign in with Google OAuth | Redirect to dashboard; no infinite loop |
| Sign out | Session cleared; redirect to home |
| Visit `/cs/login` while already logged in | Redirect to dashboard |

---

## Subscription Flow

| Scenario | Expected |
|---|---|
| `no_sub` user visits `/cs/pricing` | Sees all three plan cards with "Subscribe" buttons |
| `no_sub` clicks Subscribe on PRO plan | Redirects to Stripe Checkout (CS locale) |
| Complete Stripe test checkout | Redirect to `/cs/dashboard?checkout=success` |
| After checkout, `subscriptions` row | `status = 'active'`, `plan = 'pro'`, `stripe_customer_id` set |
| After checkout, `user_entitlements` row | `active = true`, `plan = 'pro'`, `source = 'stripe'` |
| `pro_user` visits `/cs/dashboard/billing` | "Manage Billing" button present |
| Click "Manage Billing" | Redirects to Stripe Customer Portal |
| Cancel subscription in portal | Webhook received; `subscriptions.status = 'canceled'`; `user_entitlements.active = false` |
| Webhook duplicate delivery | Second delivery returns `{ received: true, skipped: 'already_processed' }` |

---

## Paywall — Tip Access

| User | BASIC tip | PRO tip | ELITE tip |
|---|---|---|---|
| `anon` (not logged in) | Not visible | Not visible | Not visible |
| `no_sub` | Locked (shimmer) | Locked | Locked |
| `basic_user` | **Visible** | Locked | Locked |
| `pro_user` | **Visible** | **Visible** | Locked |
| `elite_user` | **Visible** | **Visible** | **Visible** |
| `admin` | **Visible** | **Visible** | **Visible** |

For each locked tip: the API response must **not** contain the tip content, analysis, or prediction — only the title/summary shimmer.

---

## Role Escalation Prevention

| Scenario | Expected |
|---|---|
| `basic_user` sends `PUT /api/admin/tips/:id` | 403 Forbidden |
| `basic_user` sends `POST /api/admin/tips` | 403 Forbidden |
| `basic_user` sends `PUT /profiles/:id` with `{"role": "admin"}` via Supabase client | RLS blocks update; role remains `user` |
| `admin` tries to set own role to `super_admin` via API | No such endpoint; any direct DB attempt blocked by RLS |

---

## Admin Panel

| Scenario | Expected |
|---|---|
| `admin` visits `/cs/admin` | Admin sidebar visible; tips list loads |
| `admin` creates a new DRAFT tip with CS/EN translations | Tip appears in list with status `draft`; `audit_logs` row written |
| `admin` publishes tip | `tips.status = 'published'`; `published_at` set |
| `admin` updates tip result to `won` | `tips.result = 'won'`; audit log written |
| `admin` deletes tip | Tip removed; audit log written |
| `user` (non-admin) visits `/cs/admin` | Redirect to `/cs` |

---

## i18n and Routing

| Scenario | Expected |
|---|---|
| Visit `/` (no locale) | Redirected to `/cs` |
| Change language in navbar | URL prefix changes; page content changes language |
| Visit `/cs/ceniky` (localized pricing URL) | Renders pricing page in Czech |
| Visit `/en/pricing` | Renders pricing page in English |

---

## Stripe Webhook Events

Test by triggering events in Stripe dashboard → Developers → Webhooks → Send test webhook:

| Event | Expected outcome |
|---|---|
| `checkout.session.completed` | `subscriptions` upserted; `user_entitlements` upserted with `active = true` |
| `customer.subscription.updated` | `subscriptions` updated with new status |
| `customer.subscription.deleted` | `subscriptions.status = 'canceled'`; `user_entitlements.active = false` |
| `invoice.payment_succeeded` | Subscription refreshed; `user_entitlements.active = true` |
| `invoice.payment_failed` | `subscriptions.status = 'past_due'`; `user_entitlements.active = false` |
| Invalid signature | 400 Bad Request; nothing written to DB |

---

## Security Headers

```bash
curl -I https://staging.yourdomain.com | grep -E "X-Frame|X-Content|X-XSS|Referrer|Permissions"
```

All five headers must be present.

---

## Rate Limiting

Send 6 checkout requests from the same IP within 60 seconds. The 6th request must return `429 Too Many Requests`.

---

## Passing Criteria

All rows in the table above must show the expected result before a release can proceed.
