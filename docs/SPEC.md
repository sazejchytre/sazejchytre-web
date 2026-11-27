# Product specification

## Product in one paragraph

sazejchytre.cz sells access to 1 to 3 written sports analyses per day. Each
analysis states the event, market, selection, odds at publication, minimum
acceptable odds, recommended stake in units, a written rationale and its
sources. The service never takes, brokers or advertises bets, has no
bookmaker affiliate links and no gambling. Its differentiator is a public,
complete, unfiltered history of every published analysis, losses included,
readable without an account.

Operator: Adam Veverka, OSVČ, IČO 23302828 (must be confirmed against the
register before it goes into `src/lib/legal/operator.ts`, see SC-015).
Market: Czech Republic. Language: Czech.

## Users

| User             | Needs                                                                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Visitor          | Understand in 10 seconds what this is and why the record is believable; inspect the full history without signing up                           |
| Free account     | Same as visitor plus newsletter and account; no paid content                                                                                  |
| Subscriber       | Today's analyses in full, as early as possible, on a phone; manage or cancel the subscription and download invoices without contacting anyone |
| Admin (operator) | Publish analyses, settle results, see subscribers, refunds, invoices                                                                          |

## Visibility rules (implemented in `src/lib/tips/visibility.ts`)

- **Result is always public.** Settled outcome, odds and profit/loss of every
  published tip are visible to everyone, in every state.
- **LOCKED**: pending tip, viewer without entitlement. Event and kick-off are
  visible; selection, odds, stake and rationale are not.
- **DELAYED**: `PUBLIC_DELAY_HOURS = 24` after publication, the selection
  becomes public, the rationale does not.
- **FULL**: viewer with a matching entitlement sees selection, odds, minimum
  odds, stake, rationale, sources. **Not rendered anywhere yet (SC-008).**

## Plans (seeded in `src/seed/billing.ts`)

| Plan    | Monthly  | Yearly    | Features in seed                                      |
| ------- | -------- | --------- | ----------------------------------------------------- |
| Start   | 349 Kč   | 3 490 Kč  | TIPS_REALTIME, VALUE_RATING                           |
| Pro     | 799 Kč   | 7 990 Kč  | + TIPS_ALL_SPORTS, FULL_RATIONALE, PUSH_NOTIFICATIONS |
| Insider | 1 890 Kč | 18 900 Kč | + ARCHIVE_EXPORT, API_ACCESS, EARLY_ACCESS            |

**Open decision (D-006):** PUSH_NOTIFICATIONS, ARCHIVE_EXPORT, API_ACCESS and
EARLY_ACCESS have no implementation. Selling them would be a misleading claim.
Before payments go live either remove them from plans and copy, or build them.
Recommendation: launch with one or two plans whose every listed feature
exists.

## MVP scope

Launch is split in two phases because the paid path is not built (see
`docs/STATUS.md`).

**Phase A, public site (target: Monday 2026-11-30, conditional):**
homepage, public history, methodology, pricing as information without a buy
button, legal pages, contact, newsletter, admin for publishing analyses,
monitoring, backups, VPS deployment. Registration only if transactional email
(Resend domain) is verified end to end.

**Phase B, paid service (date set after Stripe written approval):**
paid zone (SC-008), checkout, cancellation and payment-method UI (SC-014),
live verification of Stripe webhooks and Fakturoid invoicing (SC-010),
security and readiness review (SC-004, SC-012).

## Out of scope for the first release

PWA, mobile app, community chat, Discord, gamification, personalization,
other languages, decorative animation, any feature not required above.

## Content rules

- Never: invented statistics, testimonials, sample results shown as real,
  "guaranteed profit", "sure tips", countdown timers or false scarcity.
- Every published number is computed from the database. With no data, the
  page says so.
- Methodology page explains units, stake sizing, how odds are recorded, when
  a tip is settled and what void/push means.
- Responsible-gambling notice wording is pending legal review (README).
