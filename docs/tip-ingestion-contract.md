# Tip ingestion contract

**Version 1.** This document fixes the payload shape for sending a tip from the
partner application to sazejchytre.cz, so both sides can build against it
before the endpoint exists.

**There is no endpoint yet.** No URL, no authentication scheme, no rate limit —
those come with the implementation. What is fixed here is the payload and the
behaviour the handler will guarantee. If you build to this document, your
integration will not need reshaping when the endpoint ships.

The schema in code is `tipIngestionPayloadSchema` in
`src/lib/tips/ingestion.ts`. It is the contract; this document explains it.

---

## The five rules that will surprise you

### 1. Every number is an integer in a stated scale

There are no decimals anywhere in the payload. Send `2100`, not `2.1`.

| Field                              | Scale       | `2.100` becomes | `-0.75` becomes |
| ---------------------------------- | ----------- | --------------- | --------------- |
| `oddsAtPublication`, `minimumOdds` | thousandths | `2100`          | —               |
| `line`                             | hundredths  | —               | `-75`           |

`2.1` is rejected, not rounded.

This is not pedantry. The published return on investment is computed from these
numbers, and customers pay because of that figure. `2.1` has no exact binary
floating-point representation, so a few hundred of them summed in a different
order produce a different last digit — and a track record that answers
differently each time it is computed is not evidence of anything. Integers make
it reproducible by anyone, including by you.

### 2. The payload is idempotent on `externalId`

`externalId` is your own id for the tip, and it is the idempotency key.

Sending the same `externalId` twice returns `ALREADY_INGESTED` with the id of
the tip created the first time. Nothing is written and nothing is duplicated.

So: **retry freely.** A timeout does not mean the tip was not created, and
retrying after one will not produce a second published tip. Use a stable id
derived from your own record, not a per-request UUID.

### 3. Events are referenced, never embedded

A selection names an event by _your_ id:

```json
{ "eventExternalId": "partner-event-884213" }
```

The handler resolves it against the `externalRefs` of an existing sporting
event. **An unknown id is a rejection, not an implicit create.** A tip on an
event we cannot identify is a tip we could never settle, so it is refused at
the door rather than accepted and stranded.

Events therefore have to exist before the tips that reference them. How they
get there — a separate sync, a manual entry, a later endpoint — is outside this
contract.

### 4. A tip arrives complete or not at all

All selections are sent in one payload. There is no "add a leg later".

Published tips are immutable, and an accumulator that gained a leg after
publication would be a published claim that changed shape — exactly the thing
the immutability rules exist to prevent. The tip and all its selections are
written in one transaction, so a partial accumulator cannot exist even if the
request fails halfway.

One selection is a single. Two or more make an accumulator, and its combined
price is the product of the legs.

### 5. You cannot publish

There is no `status` field. Every ingested tip arrives as a **draft** and is
published by a separate, deliberate act on our side.

A bug in your integration should never be able to put a public claim on the
record.

---

## Payload

```ts
{
  version: 1,                    // literal 1
  externalId: string,            // your id; the idempotency key
  sportCode: string,             // must match an existing sport
  title: string,                 // 3–200 chars
  rationale: string,             // 1–20 000 chars, stored verbatim
  sourcesSummary?: Array<{       // optional, max 20
    kind: string,                // e.g. "MODEL", "MARKET", "INJURY_NEWS"
    detail: string,
  }>,
  stakeUnits: number,            // integer 1–10
  confidence?: number,           // integer 1–100, presentational only
  requiredFeatureKey: FeatureKey,// which entitlement unlocks it
  publicAfterHours?: number,     // integer 0–720; default 24
  selections: Array<{            // 1–12
    eventExternalId: string,
    market: string,              // free text, e.g. "OVER_UNDER"
    selection: string,           // the pick, e.g. "OVER"
    line?: number | null,        // hundredths, where the market has one
    oddsAtPublication: number,   // thousandths
    minimumOdds: number,         // thousandths, ≤ oddsAtPublication
  }>,
}
```

Unknown properties are **rejected**, not ignored (`.strict()`). A typo in a
field name is a validation error rather than silently dropped data.

### Field notes

- **`requiredFeatureKey`** — one of `TIPS_REALTIME`, `TIPS_ALL_SPORTS`,
  `FULL_RATIONALE`, `VALUE_RATING`, `PUSH_NOTIFICATIONS`, `ARCHIVE_EXPORT`,
  `API_ACCESS`, `EARLY_ACCESS`. This decides who sees the tip immediately;
  everyone else sees it after the public delay.

- **`minimumOdds` must be ≤ `oddsAtPublication`.** Otherwise the tip is
  un-takeable at the price it was published at, which is a contradiction rather
  than a strict requirement.

- **`market`** is free text, deliberately. New markets appear constantly, and
  an enum would make "we can price a new market" into a schema migration that
  has to ship before your first payload can use it. We understand `1X2`,
  `DOUBLE_CHANCE`, `OVER_UNDER`, `ASIAN_HANDICAP`, `BOTH_TEAMS_TO_SCORE`,
  `CORRECT_SCORE`, `DRAW_NO_BET`, `HANDICAP`, `MONEYLINE`, `PLAYER_PROPS`,
  `TOTALS` today; send something else and it is stored as given.

- **`line`** is required in practice for `OVER_UNDER`, `ASIAN_HANDICAP`,
  `HANDICAP` and `TOTALS`. Omit it for markets that have no line.

- **`publicAfterHours`** of `0` means the tip is public immediately. The
  default of 24 is applied at publication, not at ingestion, so the delay is
  measured from when the claim was actually made.

---

## Worked example

A single tip on over 2.5 goals, priced at 1.910, minimum 1.830, two units,
visible immediately to `TIPS_REALTIME` subscribers and to everyone after 24
hours.

```json
{
  "version": 1,
  "externalId": "partner-tip-2026-03-14-0001",
  "sportCode": "FOOTBALL",
  "title": "Slavia – Plzeň: více než 2,5 branky",
  "rationale": "Obě mužstva hrají vysoko postavenou obranu a v posledních pěti vzájemných zápasech padlo v průměru 3,4 branky. Model dává 61 % na překročení 2,5 branky, trh nabízí implikovaných 52 %.",
  "sourcesSummary": [
    { "kind": "MODEL", "detail": "xG model v4, 61,2 % na Over 2.5" },
    { "kind": "MARKET", "detail": "Průměr tří burz, implikovaných 52,4 %" }
  ],
  "stakeUnits": 2,
  "confidence": 61,
  "requiredFeatureKey": "TIPS_REALTIME",
  "publicAfterHours": 24,
  "selections": [
    {
      "eventExternalId": "partner-event-884213",
      "market": "OVER_UNDER",
      "selection": "OVER",
      "line": 250,
      "oddsAtPublication": 1910,
      "minimumOdds": 1830
    }
  ]
}
```

Reading the numbers back: `line: 250` is the 2.5 goals line,
`oddsAtPublication: 1910` is decimal 1.910, `minimumOdds: 1830` is 1.830.

### An accumulator

Two legs. The combined price is the product: 1.910 × 1.750 = 3.343.

```json
{
  "version": 1,
  "externalId": "partner-tip-2026-03-14-0002",
  "sportCode": "FOOTBALL",
  "title": "Dvojitý tip: Slavia a Sparta",
  "rationale": "Obě doporučení vycházejí ze stejného modelu…",
  "stakeUnits": 1,
  "requiredFeatureKey": "TIPS_REALTIME",
  "selections": [
    {
      "eventExternalId": "partner-event-884213",
      "market": "OVER_UNDER",
      "selection": "OVER",
      "line": 250,
      "oddsAtPublication": 1910,
      "minimumOdds": 1850
    },
    {
      "eventExternalId": "partner-event-884219",
      "market": "1X2",
      "selection": "HOME",
      "oddsAtPublication": 1750,
      "minimumOdds": 1700
    }
  ]
}
```

---

## Responses

| Outcome                      | Meaning                                           | What you should do                      |
| ---------------------------- | ------------------------------------------------- | --------------------------------------- |
| `CREATED` + `tipId`          | The tip was created as a draft.                   | Record `tipId`. Done.                   |
| `ALREADY_INGESTED` + `tipId` | This `externalId` was already received.           | Nothing. This is success, not an error. |
| `REJECTED` + `problems[]`    | The payload is invalid or a reference is unknown. | Fix and resend.                         |

`problems` lists **every** problem, not just the first:

```json
{
  "status": "REJECTED",
  "problems": [
    {
      "path": "selections.0.oddsAtPublication",
      "message": "odds must be an integer in thousandths, e.g. 2100 for 2.100"
    },
    {
      "path": "selections.0.minimumOdds",
      "message": "minimumOdds must be at or below oddsAtPublication — otherwise the tip is not takeable at the price it was published at"
    }
  ]
}
```

Fixing an integration one deploy at a time is miserable, so you get the whole
list in one response.

---

## What happens after ingestion

Worth knowing, because it constrains what you can send later:

1. The tip exists as a **draft**. Everything about it is still editable on our
   side.
2. Someone publishes it. At that moment the claim **freezes**: the selections,
   their prices, the stake, the reasoning and the publication time can never
   change again — enforced by database triggers, not only by application code.
3. Results are recorded per selection. The tip settles automatically once every
   selection has an outcome.
4. The settled result enters the public track record, **including losses**, and
   cannot be withdrawn from it.

So there is no "correct a published tip" call in this contract, and there will
not be one. A mistake after publication is handled by publishing a correction,
the same way an invoice is corrected by a credit note rather than an edit.

---

## Open questions for the implementation step

Listed so they are not forgotten, not because you need to answer them now:

- **Authentication.** Likely a shared secret with a request signature over the
  body, plus a replay window. Not decided.
- **Transport.** `POST` of a single tip, or a batch endpoint. A batch changes
  the idempotency story, so it needs deciding before the endpoint exists.
- **Event sync.** How events reach `sporting_events` before the tips that
  reference them.
- **Clock skew.** Whether `publishedAt` is ours or yours. Currently ours, since
  it is the timestamp the record is defended with.
