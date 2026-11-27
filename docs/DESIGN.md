# Design

Status: **direction proposed, not approved.** No page redesign starts until
D-005 in `docs/DECISIONS.md` is marked approved.

## Direction

A sports-data publication, not a bookmaker and not a SaaS template. Think
"results desk": calm surface, dense but legible tables, numbers that line up,
editorial text for the analysis. Reference qualities: Linear (type precision,
consistency), Vercel (grid, restraint), Sofascore (sports data handling), The
Athletic (paid editorial reading), Stripe (forms, clarity). Borrow qualities,
not layouts or assets.

The one sentence the design must prove: **"Výsledky neschováváme. Ani ty
špatné."** The history table is the hero of the product, not decoration.

## Tokens

| Token       | Value                                                                                                                         | Use                                                   |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `bg`        | `#F8F9F6`                                                                                                                     | page background                                       |
| `surface`   | `#FFFFFF`                                                                                                                     | tables, panels, inputs                                |
| `ink`       | `#171A18`                                                                                                                     | primary text                                          |
| `ink-muted` | `#6B716E`                                                                                                                     | secondary text (check contrast per size, see rule 31) |
| `border`    | `#DFE3DF`                                                                                                                     | hairlines, dividers                                   |
| `accent`    | `#236344`                                                                                                                     | primary actions, links, focus ring                    |
| `win`       | `#18794E`                                                                                                                     | won result                                            |
| `loss`      | `#B42318`                                                                                                                     | lost result                                           |
| `pending`   | `#8C6D28`                                                                                                                     | unsettled / void-pending                              |
| radius      | `6px` (inputs, buttons, panels), `0` for table rows                                                                           |                                                       |
| spacing     | 4 px base: 4, 8, 12, 16, 24, 32, 48, 64                                                                                       |                                                       |
| type        | Geist Sans; Geist Mono for odds, units, money, dates in tables; `font-variant-numeric: tabular-nums` everywhere numbers align |                                                       |
| sizes       | H1 48/56, H2 32/40, H3 20/28, body 16/26, small 14/20, table 14/20                                                            | mobile H1 32/40                                       |
| max width   | 1200 px content, 720 px for long reading                                                                                      |                                                       |

Contrast must be measured, not assumed: `src/lib/design/contrast.ts` already
has a checker with tests. Every token pair used for text gets a test.

Note on the typeface: Geist (like Inter, which the current build uses)
appears on community lists of fonts associated with generic AI-built sites.
It is still a sound, legible choice with good figures; distinctiveness here
must come from data presentation, copy and restraint, not from the font.
Load it from the `geist` npm package (self-hosted, no build-time network
fetch) if adopted.

## Rules

Source tags: **[WCAG]** WCAG 2.2 AA requirement, **[CWV]** Google Core Web
Vitals guidance, **[Baymard]** Baymard Institute checkout/form research,
**[NNg]** established Nielsen Norman Group usability guidance, **[Slop]**
patterns widely called out as generic AI design in designer communities,
**[P]** product or taste decision for this project (not research).

### Accessibility (1 to 20)

1. Text contrast at least 4.5:1, large text (24 px, or 18.66 px bold) 3:1. [WCAG]
2. UI component boundaries and focus indicators at least 3:1 against adjacent colours. [WCAG]
3. Win/loss/pending is never colour-only: always a text label or symbol too (e.g. "Výhra", "Prohra", "Čeká"). [WCAG]
4. Every pointer target at least 24 × 24 CSS px, or spaced so a 24 px circle does not overlap another target; aim for 44 px on primary mobile actions. [WCAG]
5. Visible focus on every interactive element; never `outline: none` without a replacement. [WCAG]
6. A focused element must not be fully hidden by a sticky header, cookie bar or toast. [WCAG]
7. Full keyboard path for sign-up, sign-in, 2FA, checkout, cancel, filters. [WCAG]
8. Skip link to main content on every page. [WCAG]
9. One `h1` per page; headings in order; landmarks (`header`, `nav`, `main`, `footer`). [WCAG]
10. Data tables use `<table>`, `<th scope>`, a `<caption>`; never div grids for tabular data. [WCAG]
11. Charts have a text alternative: the same numbers available as a table or summary sentence. [WCAG]
12. Form fields have visible labels, not placeholder-only labels. [WCAG]
13. Errors are announced (`aria-live` or focus to the error summary) and say how to fix. [WCAG]
14. Authentication must not require a cognitive test: allow paste and password managers in all password and code fields. [WCAG]
15. Do not ask for the same information twice in one flow; prefill what is known. [WCAG]
16. Help and contact are in the same place on every page (footer link at minimum). [WCAG]
17. Respect `prefers-reduced-motion`; nothing auto-animates longer than 5 s. [WCAG]
18. Content reflows at 320 px wide with no horizontal scroll except data tables, which scroll inside their own container with a visible hint. [WCAG]
19. Text resizes to 200 % without loss; no fixed-height text containers. [WCAG]
20. `lang="cs"` on the document; Czech typographic quotes and non-breaking spaces before single-letter prepositions. [WCAG] [P]

### Performance (21 to 30)

21. LCP at most 2.5 s, INP at most 200 ms, CLS at most 0.1, at the 75th percentile, mobile. [CWV]
22. The LCP element on every page is text or a table, not an image or a chart. [CWV] [P]
23. Fonts self-hosted, at most two families, `font-display: swap` with metric-adjusted fallback. [CWV]
24. Reserve space for charts, images and embeds (explicit width/height or aspect-ratio). [CWV]
25. Server-render history and analyses; client JS only for filters, charts and forms. [CWV]
26. No third-party script on pages that do not need it (Turnstile only on form pages, as the footer already does). [CWV]
27. Charts as inline SVG rendered on the server; no heavy chart library for a line chart. [CWV] [P]
28. Images: `next/image`, AVIF/WebP, sized to the slot. [CWV]
29. Measure LCP only when a change can affect it (layout, fonts, images, data loading); pure colour changes do not need a run. [P]
30. Performance budget per route: under 100 kB compressed JS for public pages. [P]

### Typography and layout (31 to 45)

31. Body text minimum 16 px; `ink-muted` only at sizes where it passes rule 1. [WCAG] [P]
32. Reading width 60 to 75 characters for analysis text. [NNg]
33. All numbers that are compared (odds, units, ROI, dates in rows) use tabular figures and right alignment. [P]
34. Odds always two decimals with a comma (`1,85`); units one decimal (`1,5 j.`); money with a non-breaking space thousands separator (`1 890 Kč`). [P]
35. Dates in Czech format (`27. 11. 2026, 20:45`), time zone stated once on the page (Europe/Prague). [P]
36. One grid: 12 columns, 24 px gutter desktop, 16 px mobile. [P]
37. Vertical rhythm from the spacing scale only; no arbitrary pixel values. [P]
38. Hero is at most ~50 % of a desktop viewport and states what the service is in one sentence. [Slop] [P]
39. No headline without information; the H1 says what the page contains. [NNg]
40. No decorative eyebrow badges above headings. [Slop]
41. No "three cards with icons" feature rows; explain with real examples instead. [Slop]
42. Cards only when items are independent and clickable; lists and tables otherwise. [Slop] [P]
43. Borders over shadows; at most one subtle shadow level for overlays. [Slop] [P]
44. Radius 6 px everywhere it applies; no pill buttons, no 16 px+ rounded containers. [Slop] [P]
45. No gradients, glow, glassmorphism or neon. Flat surfaces only. [Slop] [P]

### Data presentation and trust (46 to 65)

46. The full history is reachable in one click from every page and needs no account. [P]
47. Losses use the same row height, weight and position as wins. Never collapse, fade or paginate them away. [P]
48. Summary figures (tips, win rate, units, ROI, yield) show their period and sample size next to them. [P]
49. Every summary figure links to the rows it is computed from. [P]
50. Show the worst stretch (max drawdown, longest losing run) alongside the best. [P]
51. With fewer than ~30 settled tips, say the sample is too small to judge. [P]
52. Empty state is honest: "Zatím žádné vyhodnocené analýzy" plus when the first one is expected; no fake rows. [P]
53. Never mock data in production screenshots or OG images. [Slop] [P]
54. Odds shown are odds at publication, labelled as such; minimum odds labelled separately. [P]
55. Each analysis shows publication time; a delayed public view says it is delayed and by how long (already implemented). [P]
56. Pending, won, lost, void, push each have one fixed label and colour across the site. [P]
57. The chart shows cumulative units over time from real settled tips, with the zero line visible. [P]
58. Filters (sport, month, result) are links with URL state, so a filtered view can be shared. [NNg] [P]
59. Tables sort by date descending by default; sorting is announced to assistive tech. [WCAG] [P]
60. On mobile, history rows become a two-line layout, not a horizontally scrolling 9-column table. [P]
61. Methodology is one click from every figure ("Jak to počítáme"). [P]
62. Operator identity (name, IČO, address, contact) in the footer of every page. [P]
63. No logos of media, bookmakers or "as seen on". [P]
64. No testimonials unless real, attributable and consented. [P]
65. No bookmaker names as calls to action, no affiliate links, no "vsaď teď". [P]

### Copywriting (66 to 78)

66. Czech, plain, second person plural or neutral; consistent "vy"/"tvé" choice across the site (decide once). [P]
67. Describe the work, not the outcome: "rozbor, kurz, velikost sázky", never "vyděláte". [P]
68. Banned words in marketing copy: zaručený, jistý, garantovaný, bezrizikový, zbohatněte, exkluzivní tip. [P]
69. Buttons say what happens ("Zobrazit historii", "Předplatit Pro za 799 Kč měsíčně"). [NNg]
70. Sentence case in headings and buttons; no ALL CAPS buttons (current copy uses them, change in SC-005). [NNg] [P]
71. Numbers in copy are live from the database or absent. [P]
72. Every error message says what went wrong and what to do next, without blame. [NNg]
73. Responsible-gambling notice is short, factual, visible in the footer and on every analysis, with a link to help. [P]
74. No urgency devices: countdowns, "jen dnes", "zbývá 3 místa". [P]
75. FAQ answers real objections: what if I lose, how is ROI computed, how to cancel, refunds, invoices. [P]
76. Legal pages written for reading: headings, short paragraphs, effective date. [NNg]
77. Microcopy for empty, loading and error states exists for every data view. [NNg]
78. No emoji as icons or bullet points. [Slop]

### Forms, account and checkout (79 to 92)

79. Single-column forms. [Baymard]
80. Ask only for what is needed; checkout for a Czech consumer: email, name, payment, optional billing details for a company invoice. [Baymard]
81. Inline validation after the user leaves a field, not on the first keystroke; remove the error as soon as it is fixed. [Baymard]
82. Keep entered data after a validation error, including the payment form state the provider allows. [Baymard]
83. Show the total, interval, renewal date and cancellation terms before the pay button. [Baymard] [P]
84. Price includes the statement that the operator is not a VAT payer, as on the invoice. [P]
85. Cancellation is reachable from the account in at most two clicks, needs no email to support, and confirms the end date. [P]
86. After cancellation, the account shows "aktivní do …" and what happens then. [P]
87. Card declines show the reason class the provider returns and a way forward. [Baymard]
88. Password field: show/hide toggle, paste allowed, requirements shown before typing. [Baymard] [WCAG]
89. 2FA: allow paste of the 6-digit code, `autocomplete="one-time-code"`, recovery codes explained. [WCAG] [P]
90. Turnstile only where abuse is real (contact, newsletter, sign-up), never on sign-in retry loops for a legitimate user. [P]
91. Invoices list with download links in the account; filenames include the document number. [P]
92. Success states confirm what happened and what comes next (email sent, access active until…). [NNg]

### Mobile, components and consistency (93 to 100)

93. Design mobile first at 375 px; the paid daily analyses must be readable one-handed. [P]
94. Primary navigation: at most 5 items (Historie, Metodika, Ceník, Přihlášení/Účet); no mega menu. [NNg] [P]
95. Sticky elements at most one (header), at most 56 px tall on mobile. [WCAG] [P]
96. Use the existing primitives in `src/components/ui` (Button, Input, Card, States, ResultIndicator) and extend them; no parallel component sets. [P]
97. shadcn/ui only for complex interactive widgets (dialog, popover, select, tabs) when it saves real work; restyle to the tokens, never ship its defaults. [Slop] [P]
98. Motion limited to 150 to 200 ms opacity/transform for state changes. [P]
99. Every component has defined default, hover, focus, active, disabled, loading and error states. [NNg]
100.  Before a page is merged: screenshot at 375 and 1280 px, keyboard pass, axe check with zero serious issues, and the honest-data check (no number on the page that is not from the database). [WCAG] [P]

## Research notes

- WCAG 2.2 (W3C Recommendation, Oct 2023) added 9 criteria; the AA-relevant
  ones used above are target size 24 px, focus not obscured, accessible
  authentication, redundant entry, consistent help, dragging alternatives.
- Core Web Vitals "good" thresholds at the 75th percentile: LCP 2.5 s,
  INP 200 ms, CLS 0.1 (web.dev).
- Baymard: inline validation should avoid premature errors, clear errors as
  soon as fixed, and confirm valid input; a large share of sites still lack
  it.
- "AI slop" tells repeatedly named in community discussions: default
  gradients (purple/indigo), glow, emoji icons, pill badges, identical hero
  plus three cards layouts, unmodified component-library defaults, generic
  sans fonts. Reddit threads were not read directly for this document; this
  is a synthesis of secondary write-ups of those discussions and should be
  treated as taste guidance, not research.
