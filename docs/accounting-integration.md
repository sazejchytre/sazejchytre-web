# Accounting integration — Fakturoid

**Status: design only. Nothing in this document is implemented.**

What exists today is the typed export shape in
[src/lib/invoicing/export.ts](../src/lib/invoicing/export.ts) and a CSV writer
over it (`pnpm export:accounting`). This document records how that shape would
map onto [Fakturoid](https://www.fakturoid.cz/) so the decision can be taken
later with the trade-offs already written down, rather than rediscovered.

Fakturoid is the assumed target because it is Czech, speaks to Czech
accountants, handles the VAT regimes this operator will eventually need, and
has a documented REST API (v3, OAuth 2.0). Nothing below depends on that choice
being final.

## The question that decides everything else

**Who owns the document numbers?**

This is not a detail. Invoice numbering must be sequential and gap-free, and
exactly one system can guarantee that.

### Option A — we stay the source of truth (recommended)

We allocate the number, render the PDF, and push the finished document to
Fakturoid for the accountant's benefit. Fakturoid becomes a mirror.

- Numbering stays in `invoice_number_counters`, allocated atomically by
  `allocateDocumentNumber`, which is already proven gap-free under concurrency.
- Our PDF remains the document the customer received. That matters: the
  customer has the file, and a second renderer producing a slightly different
  one for the same number is the exact problem the write-once `pdfStorageKey`
  exists to prevent.
- Fakturoid must be configured **not** to renumber on import. Its API accepts
  an explicit `number`; if that is ever ignored or overridden, two numbering
  authorities exist and the series can diverge silently.
- A Fakturoid outage cannot stop a sale. Pushing is a background job with
  retries, exactly like document delivery.

### Option B — Fakturoid owns the numbers

We create a draft there, it assigns the number, we read it back and store it.

- Removes our numbering code, which is the only honest argument for it.
- Makes issuing an invoice depend on a third party being reachable **at the
  moment a payment is confirmed**. That is the worst possible coupling: the
  money has already moved, the customer is waiting, and the statutory document
  cannot be created.
- Their PDF becomes the real document, so ours must be deleted or never shown
  — otherwise two files claim to be the same invoice.
- A number allocated for a draft that then fails to finalise is a gap we would
  have to explain to a tax inspection without being able to see why.

**Recommendation: Option A.** The coupling in Option B is on the critical path
of taking money.

## Field mapping

From `AccountingDocumentRow` to Fakturoid's invoice resource.

| Ours                 | Fakturoid                           | Notes                                                                                                                                        |
| -------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `number`             | `number`                            | Only if Fakturoid is configured not to renumber. See above.                                                                                  |
| `issuedAt`           | `issued_on`                         | Date only; Fakturoid has no time component.                                                                                                  |
| `taxableSupplyDate`  | `taxable_fulfillment_due`           | Separate field there too.                                                                                                                    |
| `currency`           | `currency`                          | `CZK`.                                                                                                                                       |
| `subtotalMinor`      | `lines[].unit_price`                | **Convert to a decimal string.** Fakturoid takes major units; we hold integer minor units. One conversion, at the boundary, in one function. |
| `taxMinor`           | —                                   | Derived there from the rate. We send `vat_rate: 0`.                                                                                          |
| `taxRateBasisPoints` | `lines[].vat_rate`                  | 0 today. Basis points ÷ 100 → percent.                                                                                                       |
| `taxTreatment`       | `vat_price_mode` / `supply_code`    | `NONE_NOT_VAT_REGISTERED` has no direct equivalent; see below.                                                                               |
| `customerName`       | `client_name`                       | From the invoice **snapshot**, never the live customer row — the document must keep saying who it was issued to.                             |
| `customerEmail`      | `client_email`                      | As above.                                                                                                                                    |
| `customerCountry`    | `client_country`                    | ISO alpha-2.                                                                                                                                 |
| `description`        | `lines[].name`                      | Single line; we sell one subscription per invoice.                                                                                           |
| `documentType`       | resource                            | `INVOICE` → invoice; `CREDIT_NOTE` → **separate** resource.                                                                                  |
| `correctsNumber`     | `correction_subject_id`             | Needs Fakturoid's internal id of the corrected invoice, not our number — so a mapping table is required (below).                             |
| `correctionReason`   | `note`                              | No dedicated field.                                                                                                                          |
| `providerPaymentId`  | `variable_symbol` or a custom field | What makes a Stripe payout reconcilable against a document.                                                                                  |
| `totalMinor`         | —                                   | Derived there. Ours is signed; theirs is not.                                                                                                |

### Not-a-VAT-payer

The operator is not VAT registered, so documents carry no VAT and must say so.
Fakturoid models this at the **account** level (`vat_mode` /
"nejsem plátce DPH"), not per document. So:

- The Fakturoid account must be configured as a non-VAT payer before the first
  push, or its own templates will render VAT lines we do not charge.
- `vat_rate: 0` per line is then consistent rather than contradictory.
- When the operator registers for VAT, this is the first thing to revisit —
  and the `taxTreatment` enum already has the members for it
  (`CZ_VAT_STANDARD`, `EU_OSS_B2C`, …), which is why it was built with more
  values than today needs.

## What would have to be built

1. **A mapping table.** Fakturoid's ids are not ours. A credit note needs the
   Fakturoid id of the invoice it corrects, so something must persist
   `(our document id) → (fakturoid id)`. Probably two nullable columns on
   `invoices` / `credit_notes` rather than a new collection.
2. **A money conversion at the boundary.** Minor units → decimal string, in
   one place, tested. Never a float: `799.00` arriving as
   `798.9999999999999` is how a one-haléř discrepancy enters a VAT return.
3. **A push job with retries.** Same shape as document delivery: a
   `fakturoidState` (PENDING / SENT / FAILED) with an attempt count, swept by
   cron. A push failure must not unissue a document, for the same reason a
   delivery failure does not.
4. **OAuth 2.0 client credentials.** Another secret in the env schema with no
   default, and a token cache — their tokens are short-lived.
5. **Idempotency.** Pushing the same document twice must not create two
   invoices there. Their API has no idempotency key, so this is our
   responsibility: check the mapping table first, and treat "already exists"
   as success.

## Open questions

- **Does Fakturoid accept an externally supplied `number` unconditionally?**
  Option A depends entirely on this. It must be verified against a real
  sandbox account before committing to the design, not inferred from docs.
- **Does it accept a document that is already paid, without creating a payment
  record we would then have to reconcile?** Our invoices are always issued
  from a confirmed payment, so every push is of a settled document.
- **Can our own PDF be attached**, so the accountant sees the file the customer
  actually received rather than a re-render?
- **Credit notes:** is `correction_subject_id` required, or can a correcting
  document stand alone? Ours always reference an invoice.
- **Who is the API consumer** — the operator's own Fakturoid account via OAuth,
  or a partner integration? Changes the auth model and the onboarding.
- **Retention.** Fakturoid holds the same statutory documents. If a customer
  requests erasure we anonymise our `customers` row and keep the documents
  (see [Retention](../README.md#retention)); the same reasoning has to hold
  there, and their data-processing terms need reading before any personal data
  is pushed.
- **Is a push even wanted?** The CSV export may be enough. An accountant who
  is happy with a CSV is cheaper to serve than an API integration that has to
  be kept working.
