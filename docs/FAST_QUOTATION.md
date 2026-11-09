# Fast quotation, Quick Create Job and PDFs

## Why a property was needed, and what changed
Audit of the existing model: `Quote.propertyId` was already nullable and the API accepted a quotation without one; the real
blockers were (1) the form required an *existing customer*, (2) a quotation had nowhere to keep a typed address, and (3) *Convert to Job*
demanded an existing property, while `Job.propertyId` stays required (every job, GPS or not, belongs to a property record).

* **Quotation** can now be created for a new customer typed inline (name only is required; phone/email/address optional) or an existing
  one, with an optional linked property, an optional typed **service address**, requirements, internal notes (never printed) and an
  advance. Migration `20261107000000_fast_quotation` only adds four nullable `Quote` columns.
* **Customers** are matched on the phone number's last 10 digits; a known number reuses the customer and never renames it.
* **Convert to Job** takes customer, lines, prices and address from the quotation. The property is: the linked one → one the user picks →
  one quick-created from an address → one made from the quotation's typed address. A property made from an address has **no coordinates**
  (nothing is invented) and an address the customer already has (any spacing/case) is **reused, not duplicated**. The typed address is kept
  as the job's service address.
* **Quick Create Job** (`/jobs/new`, default) — customer (search / inline new / recent) → service → date & time → verification mode
  (the four existing modes) → Field Operations Manager → create; optional quotation link. **Advanced** (`/jobs/new?mode=advanced`) is the previous
  full form. GPS is not needed to create a job; GPS modes still refuse to *start* without a saved location (`NO_SAVED_LOCATION`).
* `POST /api/jobs` now reuses an existing customer (same phone) and property (same address) instead of creating duplicates.

## PDFs
Server-side with `pdfkit` (`src/lib/server/pdf/`), fonts Inter (SIL OFL) and the logo in `/assets` (traced into the PDF routes in `next.config.mjs`).
`GET /api/quotations/[id]/pdf`, `GET /api/invoices/[id]/pdf`, `GET /api/quote/[token]/pdf` (customer share link); `?inline=1` views instead of downloading.
The on-screen preview is the same PDF in an embedded viewer, so preview, download, print and share are one file. A4, ₹ with Indian digit grouping, repeating
table header, keep-together totals, page x of y, long names/descriptions wrap. GST and Non-GST are separate layouts (a Non-GST document has no GST fields);
an invoice shows PAID only when its recorded status is PAID. Amounts, lines, terms and addresses come from the stored document; the letterhead comes from Settings
(+ optional `COMPANY_WEBSITE`, default `intensecare.in`).

## Tests
`npm test` (tests/pdf.test.ts renders real PDFs), `scripts/fast-flow-verify.mjs` (API: 14 scenarios + PDF content), `scripts/fast-flow-ui-verify.mjs` (browser, desktop + phone).
Run the two scripts after `scripts/e2e-verify.mjs`.
