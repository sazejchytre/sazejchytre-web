# Accounting integration — Fakturoid

**Status: built.** Fakturoid is the system of record for accounting documents.
It issues them, it numbers them, and it renders their PDFs.

This document describes what exists. An earlier version of it argued the
opposite case — that we should keep our own numbering and treat Fakturoid as a
mirror — and that argument lost. The reasoning is kept in
[Why the earlier plan was reversed](#why-the-earlier-plan-was-reversed), because
the trade-off is real and anyone revisiting it deserves both sides.

---

## The one thing to understand before touching any of this

**There is no Fakturoid sandbox.** The credentials in `.env` point at the
operator's actual accounting account. Every document created against it is a
real document carrying a real number in a statutory series, and **deleting one
leaves a gap that has to be explained to a tax inspection**. There is no undo.

Three things follow, and all three are enforced in code rather than by
convention:

1. `ACCOUNTING_PROVIDER` defaults to **`FAKE`**. The real provider has to be
   asked for by name. Anything unrecognised — unset, a typo, a test process
   that forgot to configure itself — gets the in-memory fake. See
   [src/lib/accounting/registry.ts](../src/lib/accounting/registry.ts).
2. No ordinary test touches the live account. `pnpm test`, `pnpm test:db` and
   `pnpm test:stripe` all run against the fake or an in-memory HTTP stub.
3. The only thing that talks to the real account is `pnpm test:fakturoid`,
   which additionally refuses to run unless `FAKTUROID_LIVE_TEST=1` — which
   only that script sets. It creates the minimum (one subject, one invoice, one
   correction), deletes nothing, and prints every document number it created.

If you run it, read the numbers it prints and file them.

---

## Who owns what

| Fact                                       | Owner                                       |
| ------------------------------------------ | ------------------------------------------- |
| Document number                            | **Fakturoid**                               |
| Rendered PDF                               | **Fakturoid** renders it; we store a copy   |
| What the customer receives                 | **Us** — our bucket, our sender, our domain |
| Entitlements, audit trail, customer access | **Us**                                      |
| Operator identity on the document          | **Fakturoid** account settings              |
| VAT treatment                              | **Fakturoid** account settings (`vat_mode`) |

Our `invoices` and `credit_notes` rows remain the source of truth for
everything on our side of the line: what was sold, to whom, for which period,
at what price, against which Stripe payment, and where the customer was. They
keep their snapshots. That is deliberate — see
[Why the snapshots stay](#why-the-snapshots-stay).

---

## The shape of the code

```
src/lib/accounting/
  port.ts            the provider-agnostic port. No Fakturoid type appears here
  decimal.ts         the ONE place integer minor units become decimals
  fake-adapter.ts    in-memory provider; what every ordinary test runs against
  port-contract.ts   the contract, runnable against any adapter
  port.test.ts       the contract, against the fake                  (pnpm test)
  registry.ts        resolves the adapter from config; defaults to FAKE
  fakturoid/
    config.ts        credentials, validated at boot
    token.ts         OAuth 2 client credentials, cached
    http.ts          one request path: User-Agent, rate limits, status mapping
    schemas.ts       zod validation of every response
    adapter.ts       the port, implemented
    stub-server.ts   an in-memory Fakturoid, so the adapter is testable
    adapter.test.ts  the contract + adapter specifics, no network    (pnpm test)
    adapter.fakturoid-test.ts   the contract against the REAL account
                                            (pnpm test:fakturoid, opt-in only)

src/lib/invoicing/
  issue.ts               records the invoice ROW
  credit-note.ts         records the credit-note ROW
  accounting-document.ts turns a row into a Fakturoid document, and fetches its PDF
  delivery.ts            emails our stored copy
  document-key.ts        where a document lives, as a path (pure)
  storage.ts             R2, private bucket
  export.ts              the CSV an accountant can read
```

The port is checked mechanically: `grep -i fakturoid src/lib/accounting/port.ts`
returns only prose. If a provider type ever appears there, "replace the
accounting provider" stops being a file and becomes a refactor.

---

## The order of operations, and why it is that order

A sale produces four things, in this order, each retryable from wherever the
last one stopped:

1. **Our row** — written the moment Stripe confirms the payment.
   `accountingState: 'PENDING'`, no document number.
2. **The Fakturoid document** — created, paid, locked. Our row records
   `fakturoidDocumentId` and `fakturoidNumber`, and moves to `ISSUED`.
3. **The PDF** — polled from Fakturoid, stored in `R2_DOCUMENTS_BUCKET`.
4. **The email** — our stored copy, attached, from our domain.

**Step 1 comes first and is unconditional.** This is the whole safety property.
If issuing the accounting document were part of recording the sale, then
Fakturoid being unreachable would mean one of two things: we lose a payment, or
we roll back an entitlement a customer has already paid for. Neither is
acceptable. So the row is written, `accountingState` stays `PENDING`, and the
existing retry cron (`/api/cron/retry-document-delivery`) finishes the job.

A row with no document number is a normal, expected state.

### Idempotency

Three layers, and the third is the one that only Fakturoid can provide:

1. **Read-first** on `providerPaymentId` / `providerRefundId`.
2. **A unique index** on those columns, which is what actually stops two
   concurrent webhook deliveries — they genuinely both pass layer 1.
3. **`custom_id` adoption at Fakturoid.** Every document carries our row id as
   its `custom_id` (`inv-42`, `cn-9`), and the adapter queries by it before
   creating anything. If a document with our id is there, it is **adopted**.

Layer 3 covers the failure the first two cannot see: Fakturoid creates the
document, the response is lost to a timeout, our row never learns the id, and
the cron comes round. Without the lookup, that retry puts a second real
document in the operator's number series.

The prefix on `custom_id` is load-bearing. Fakturoid keeps corrections in the
same collection as invoices, so a bare numeric id would mean our invoice #7 and
our credit note #7 both search for `custom_id=7` — and a refund would "find"
the invoice it meant to correct and report itself as already done.

`adopted` is reported separately from `issued` all the way out to the log,
because "issued 2026-0001" and "adopted the 2026-0001 that already existed" are
different events, and a log that cannot tell them apart cannot tell a recovered
failure from a duplicate-creation bug.

---

## Failure behaviour

Every distinguishable cause gets its own reason string, and a test asserts they
stay distinct (`ACCOUNTING_REASONS` in
[accounting-document.ts](../src/lib/invoicing/accounting-document.ts)). This is
not fastidiousness: step 4 cost an afternoon to a webhook that reported two
different problems with one reason, and these four all read as "issuing didn't
work" while needing four different responses.

| Reason                      | HTTP          | Row goes to  | What to do                                      |
| --------------------------- | ------------- | ------------ | ----------------------------------------------- |
| `PROVIDER_UNREACHABLE`      | — (no answer) | `PENDING`    | Nothing. The cron retries.                      |
| `RATE_LIMITED`              | 429           | `PENDING`    | Nothing. Honours `Retry-After`.                 |
| `PROVIDER_MAINTENANCE`      | 503           | `PENDING`    | Nothing. Retry later.                           |
| `PROVIDER_ERROR`            | 5xx           | `PENDING`    | Nothing, but worth watching.                    |
| `REJECTED_DATA`             | 400/415/422   | **`FAILED`** | Fix our payload. Retrying sends the same thing. |
| `ACCOUNT_BLOCKED`           | 402           | **`FAILED`** | Somebody pays a Fakturoid bill.                 |
| `ADOPTED_EXISTING_DOCUMENT` | 200           | `ISSUED`     | Nothing. A healthy retry.                       |
| `MISCONFIGURED`             | —             | `PENDING`    | Fix the env and deploy.                         |
| `PDF_GENERATING`            | 204           | `ISSUED`     | Nothing. The cron fetches it.                   |

`MISCONFIGURED` stays `PENDING` although it is equally non-retryable right now.
The difference is who fixes it: a bad payload needs somebody to look at _that
document_, whereas missing credentials get fixed by a deploy, after which every
row that landed during the outage should go through on the next cron run rather
than needing to be reset by hand.

A **429 is retried inline**, twice, honouring `Retry-After` — and only if the
wait is short. Past 15 seconds it hands back a retryable failure instead,
because holding a webhook open longer makes the caller time out and redeliver,
which is more load rather than less, and retrying _early_ just gets us
throttled harder.

A **5xx on a write is never retried automatically.** The document may have been
created before the error, and a blind retry would put a second one in the
series. Safety comes from `custom_id` adoption, which is a stronger guarantee
than careful retry rules because it holds even when the retry arrives from
somewhere else an hour later.

---

## Things worth knowing about the Fakturoid API

- **`User-Agent` is mandatory.** Without it every request is a 400, and the 400
  says nothing about headers. It is attached in one place
  ([http.ts](../src/lib/accounting/fakturoid/http.ts)) so no call site can
  forget it, and the in-memory stub enforces the same rule so losing it in a
  refactor is a failed test rather than a confusing afternoon.
- **The token lasts two hours** and is cached. Fetching one per call would
  spend two requests of a 150-per-minute budget on every one that does work,
  and the throttling would land on the document-creating call.
- **PDFs are generated asynchronously.** `GET …/download.pdf` answers **204**
  until one is ready. That is an ordinary answer, not a failure. Polling is
  bounded (5 attempts, doubling from 400 ms); exhaustion is a retryable state,
  not a failure of issuing.
- **Rate limit headers** are `X-RateLimit-Policy` (`default;q=150;w=60` on this
  account) and `X-RateLimit` (`default;r=149;t=60`). Read and logged, so a run
  approaching the limit is visible before it starts failing.
- **A correction document is only available to a VAT payer.** This one cost a
  live run to discover, and it is the single most surprising thing here:

  ```
  correction_id: "Opravný daňový doklad lze vytvořit pouze k faktuře
                  od plátce DPH"
  ```

  An _opravný daňový doklad_ is a VAT instrument. A trader who is not
  registered for VAT does not issue daňové doklady at all, so there is nothing
  for one to correct — their credit note is an ordinary invoice carrying
  **negative amounts**, numbered in the ordinary invoice series.

  The adapter reads the account's `vat_mode` once, caches it, and issues
  accordingly: `document_type: "correction"` with `correction_id` for a VAT
  payer, a negative `"invoice"` otherwise. The day this operator registers for
  VAT, proper correction documents start being issued with no code change.

  A negative invoice has no `correction_id` field to carry the link, so the
  note does it in words: _"Opravný doklad k faktuře FA2026-0001."_ An
  accountant holding the document has to be able to find the one it corrects.

  Our side is unaffected: a document whose total is negative is a
  `CREDIT_NOTE` to us whatever Fakturoid files it as. Reading one as revenue
  would overstate the books.

- **Correction line signs are not documented**, and there is no sandbox in
  which to find out. The adapter sends **negative** unit prices and takes the
  absolute value first, so a credit note always _reduces_ what the customer
  owes whatever sign the caller passes. The contract asserts the returned total
  is negative, which is what the live run proves. The failure mode this guards
  against is a document that bills the customer a second time — issued into a
  statutory series, and not deletable.
- **403 means "already in that state"** for payments and locks. Treated as
  success: we wanted the state, and the state is what we have.
- **`Accept: application/json` is required on the token request**, and its
  absence does not look like what it is. Without it the OAuth endpoint answers
  **415 Unsupported Media Type**, which reads like a complaint about the body
  being sent — the one thing that is fine. The in-memory stub now enforces the
  same rule, so losing the header is a failed test rather than a failed deploy.
- **`remaining_amount` can disagree with `status`.** A paid invoice on this
  account came back `status: "paid"` with `remaining_amount: "1.0"`. The
  adapter treats either signal as settled, which is why the paid-state
  assertion holds; trusting the balance alone would have reported a paid
  invoice as outstanding and put the customer in a dunning list.

---

## What we deliberately do not use

- **Fakturoid's email sending.** Delivery is ours. The customer must receive
  the same bytes the account page serves, and a re-fetch could differ, leaving
  two files that both claim to be one document.
- **`html_url`, or any Fakturoid URL, anywhere near a customer.** It is an
  accounting account's address, and it would outlive our control of it. A test
  asserts the adapter never calls anything that looks like their delivery
  endpoints.
- **Their numbering format, as an assumption.** `documentStorageKey` used to
  assert our own `FA2026-000001` shape. It now checks only what makes a key
  _safe_ — a filename whitelist that refuses path traversal — because the
  number comes from a provider that may change its format without consulting
  us.

---

## VAT, and where the operator's identity lives

The operator is a Czech sole trader who is **not VAT registered**. That fact is
now an account setting at Fakturoid (`vat_mode: "non_vat_payer"`), not a branch
in our code, which is one of the reasons for the move.

It is not _only_ presentational, though, and that was the one real surprise of
this step: the VAT mode decides which document types the account may use at
all. See the correction note above — a non-VAT payer cannot issue an opravný
daňový doklad, so credit notes take a different shape for them. `pnpm test:fakturoid`
asserts it, so a change surfaces as a failed test rather than as VAT lines
appearing on documents the rest of the system does not model.

Operator identity — name, address, IČO — is likewise held by Fakturoid and
printed by Fakturoid. [src/lib/legal/operator.ts](../src/lib/legal/operator.ts)
is **no longer on the document-rendering path**. What still depends on it is
listed in the step 5c report; in short, the invoice row's
`operatorSnapshot` and the public-facing legal pages.

> **A privacy note that matters.** The Fakturoid account carries a `vat_no` of
> the form `CZ` + rodné číslo, which is how a natural person's DIČ is
> constructed in Czechia. It is a personal identifier. It is **not** copied
> into our database, our snapshots or our logs, and must never be. See the
> standing rule at the top of `operator.ts`.

---

## The CSV export is a convenience, not the system of record

`pnpm export:accounting` still works and still reports a row per document — now
with Fakturoid's numbers and an `accountingState` column, so an unissued
document is visible rather than silently absent.

**Fakturoid exports to Pohoda and Money S3 natively.** The accountant does not
need our CSV and should not be told to use it instead. It stays because it is
the one view that joins the accounting document to _our_ side of the story —
the Stripe payment id, the subscription, the location evidence — which is what
gets asked for when a payout has to be reconciled or an EU distance-selling
threshold checked.

---

## Why the earlier plan was reversed

The previous version of this document recommended keeping our own numbering and
pushing finished documents to Fakturoid as a mirror. It was not a bad argument:
the allocator was correct, proven gap-free under concurrency, and it kept a
third party off the critical path of issuing.

It lost on one point, and the point is decisive: **two numbering series inside
one accounting year is not something an accountant can reconcile.** Everything
else Fakturoid brings — correction documents, OSS mode for a Slovak expansion,
non-VAT-payer handling as a setting, direct access for the accountant, native
Pohoda and Money S3 export — is work we would otherwise write ourselves, badly,
later.

The cost of the reversal was paid in full and is worth naming:

- Our numbering is gone: `allocateDocumentNumber`, `formatDocumentNumber`,
  `parseDocumentNumber`, `isContiguousFromOne`, the `invoice_number_counters`
  table, and the concurrency test that proved the series contiguous.
- Our PDF renderer is gone: `pdf.ts`, its content tests, `pdfkit`, and the
  embedded DejaVu font with the `outputFileTracingIncludes` entries it needed.
- Issuing now has a third party on it. That is mitigated by the ordering above
  rather than eliminated, and the mitigation is the reason the row comes first.

The swap had to happen **before the first real invoice was issued**, and it
did: the account held zero documents when this was built.

---

## Why the snapshots stay

Because the document is at a third party. If Fakturoid is unreachable, goes
away, or is replaced, our row still has to say who was billed, for what period,
how much, in which currency, against which payment, and where they were —
enough to answer a customer and to reconstruct the document.

A row that was only a foreign key into somebody else's system would be
worthless on the day that system was not there.
