# Intense Care — Deep Cleaning Operations

A simple service-management app for a deep-cleaning business. **Five user types, one Job ID per job, ONE QR / secure link per job, GST and Non-GST invoices kept apart.**

| Who | Experience | What they do |
|---|---|---|
| **Admin** | **Operations** (desk) | Customers, properties, services, jobs, Field Manager assignment, scheduling, quality status, rework, customer approvals and issues, GST / Non-GST invoices and payments, reports, users, settings |
| **Field Manager** | **My Jobs** (mobile) | Only their assigned jobs: Navigate → I'M HERE (GPS) → wait for customer → START SERVICE → checklist by area → before/after photos + notes → COMPLETE WORK → fix rework → SUBMIT FOR QC |
| **QC** | **Quality** (mobile) | Jobs waiting for inspection → INSPECT → PASS or REWORK REQUIRED (area · issue · photo · comment) → reinspection (PASS / REWORK AGAIN), full history kept |
| **Tax Officer** | **GST** (desk, read-only) | GST Dashboard, GST Invoices (search, date and customer filters, GST breakdown, print / PDF), GST Reports (month-wise CGST / SGST / IGST, CSV). Never sees Non-GST invoices, jobs, customers, users or settings, and cannot change anything |
| **Customer** | **My Service** (QR / secure link, no login, no app) | The page follows the job: Job ID, team, status → CONFIRM & START → progress → quality check → before / after photos → invoice → APPROVE SERVICE → star rating, Google review |

## Structure

Sidebar — **Main:** Dashboard · Intense AI · Jobs · Customers · Quotations · Invoices · QC · Reports · Users. **More:** Schedule · Properties · Services · GST · Reviews & Feedback · Settings. QR, location, rework, approval, custom services, payment, field staff and job tracking are parts of the Job, not separate modules.

- **Jobs are the centre.** New Job (`/jobs/new`) walks through Customer → Property → Location (map: address search, current location, drop / drag the pin, lat / lng, address, Navigate) → Service → Date & time → Field Manager → Notes (internal + for the customer) → Customer visibility. The Job Details page shows customer, property, location, service, schedule, team, work, QC, quotation, invoice, approval and feedback in one place.
- **Quotations** (`/quotations`): catalogue and custom lines, quantity, rate, discount, GST / Non-GST (CGST + SGST or IGST), terms, payment terms, valid-until. Download PDF / Print (browser *Save as PDF*), Share (share sheet, WhatsApp, copy link), Edit, Duplicate, Convert to Job, Convert to Invoice. The share link `APP_BASE_URL/customer/quote/<token>` carries only a random token; the customer can accept or decline it once while it is valid.
- **Quotations and invoices print as one professional document:** logo, company details, number and date, customer, property / service address, service table, totals (GST rows only on GST documents), payment terms, notes / T&C and the authorized signature (Settings → Logo & signature).
- **Services:** Standard and Custom in one module; a custom service has its own price, duration, GST treatment, checklist and notes and works in quotations, jobs, invoices, reports and the customer page.
- **Customer visibility** (Settings → Customer portal for the company default, and per job on the Job page): Job ID, service, date, location, team, status, before / after photos, QC result, quotation, invoice, payment status, service notes, feedback. **Enforced by the API** — anything hidden is left out of `/api/customer/job/<token>`, the photo proxy and the customer's Intense AI answers, not just hidden in the page. Internal notes, costs, margins, QC comments and staff details are never sent.
- **Arrival verification:** GPS against the job's pin (else the property's). If GPS can't confirm it, the Field Manager taps **Scan QR to Verify Location** and scans the customer's QR — accepted only when it belongs to this job or this property. Otherwise they continue with a reason. The activity log records *verified by GPS*, *verified by QR scan*, *Admin override* (reason required) or *not verified*.
- **Reviews & Feedback** (`/reviews`): private ratings and comments from the customer page, complaints, Google review status, and — with `GOOGLE_PLACES_API_KEY` + `GOOGLE_PLACE_ID` — the public Google rating and latest reviews. Kept separate.
- **Reports:** date range, service and Field Manager filters, cards, charts and CSV export for Jobs, Revenue, Customers, Services, QC, Rework, GST, Invoices, Feedback and FM Performance.
- **Dashboard:** Today's Jobs, Active, Completed, Pending QC, Rework, Revenue, Pending Invoices, Customer Feedback, and *Attention Required* grouped by QC pending, payment pending, rework, unassigned and upcoming.
- **Settings is configuration only:** company details, logo & signature, GST details, invoice and quotation defaults, users & permissions, customer portal defaults, notification switches.

## The job

One Job ID from booking to feedback — rework never creates a new job. The ID is `CUSTOMER-NAME-DDMMYYYY-NNN` (e.g. `RAHUL-SHARMA-08102026-001`, then `-002` for that customer's next job on the same date): the name upper-cased with symbols removed, the service date, and a sequence. It is unique in the database (unique index; concurrent bookings take turns via an advisory lock). Jobs created before this format keep their `JOB-10001` style ID.

```
BOOKED → SCHEDULED → ASSIGNED → ARRIVED → CUSTOMER CONFIRMED → IN PROGRESS
→ WORK COMPLETED → QC → PASS ─────────────→ CUSTOMER APPROVAL → COMPLETED → FEEDBACK
                       └→ REWORK REQUIRED → Field Manager fixes → SUBMIT FOR QC → REINSPECTION ┘
```

Server-enforced: arrival is GPS-checked against the job's location (`ARRIVAL_GEOFENCE_METERS`), or verified by scanning the customer's QR, or continued with a recorded reason; work cannot start until the customer confirms on their link; required checklist items must be done before COMPLETE WORK; status changes are compare-and-set so double taps or two devices can't apply twice.

## One QR per job

- **ONE QR → ONE secure customer job portal.** The QR encodes only the job's secure link, `APP_BASE_URL/customer/service/<token>` — a 256-bit random token. No phone number, GSTIN, customer id, invoice data or anything personal is in it. Only the token's SHA-256 hash is stored (plus an encrypted copy so Admin can re-show the same QR). The server validates the token on every request; Admin can replace it (the old QR stops working) or turn it off.
- The same QR works for the whole job: confirm the team, progress, before/after photos, QC result, invoice, approval, feedback. There are no separate QR codes for Field Manager, QC, rework, approval, completion or invoices, and the old per-property QR has been removed.
- **"Scan QR to View Service"** appears on the job page, on each job card / row in Jobs, and is printed on the invoice. Old `/customer/job/<token>` links redirect.
- The customer receives: Job ID, their name, service, date, team names, status, checklist progress, **before/after** photos (served through a token-checked proxy), a plain QC result (being checked / finishing touches / passed) and their own invoice. Never internal notes, QC findings or QC/rework photos.

## GST and Non-GST invoices

- Every invoice is **GST** or **NON_GST** (`Invoice.invoiceType`), chosen by Admin when booking the job (New Job → *Invoice*: GST Invoice / Non-GST Invoice) and changeable on the invoice page until it is finalized.
- **GST invoice:** customer details and GSTIN, company GSTIN, invoice number and date, taxable amount, GST %, CGST + SGST (same state) or IGST (other state), total GST, grand total. **Non-GST invoice:** customer details, invoice number and date, amount, grand total — no GST fields anywhere.
- Separate number series: `GST-2627-00001` and `INV-2627-00001` (financial year + sequence). A database check constraint stops a Non-GST invoice from ever carrying GST data.
- Admin → **Invoices** filters *All / GST Invoices / Non-GST Invoices*; each invoice prints (or saves as PDF) with the job QR.
- **Tax Officer → GST only, enforced on the server:** `/api/invoices`, `/api/invoices/[id]` and `/api/invoices/report` always filter `invoiceType = 'GST'` for anyone without `finance.view`. Asking for Non-GST invoices returns 403, and a Non-GST invoice id returns 404, however the URL or request is edited.

## Intense AI

A business assistant inside the app (**Intense AI** in the Admin menu, and an **Intense AI** button on the customer's QR page — Field Manager, QC and Tax Officer do not have it; the API returns 403 for them). Ask in plain language — "Summarize today's business performance", "Why are we getting more rework this month?", "Which customers haven't booked again?", "Give me a monthly business report" — or tap a suggested question or quick action. Answers stream in, keep **What the data shows** separate from **Recommendations**, and reports follow Executive Summary → … → Next Actions.

- **It sees only what the user can see.** The model never gets the database. It can only call server-side data tools (`src/lib/server/ai/tools.ts`), and each tool (1) is offered only to roles holding its permission, (2) is re-checked when the model calls it, and (3) queries through the same scoping as the normal APIs (`jobWhereFor`, `authorizeJob`, `invoiceWhereFor`), with money fields only for `finance.view`. So:
  - Admin — full business intelligence (metrics, jobs, customers, revenue, invoices, GST, QC, rework, feedback, Field Manager and service performance).
  - Customer — only their own job, via the QR token.
- The provider key (`GEMINI_API_KEY`) stays on the server; the browser talks only to `/api/ai/chat`. Users never see the provider's name — errors are replaced with plain messages.
- Limits: 40 questions per user per 10 minutes (20 per customer IP), questions up to 4,000 characters, at most 6 rounds of data lookups per answer.
- The conversation is kept for the browser session (cleared on sign-out); **New chat** starts over.
- `node scripts/ai-verify.mjs` runs the security checks against a stand-in provider that deliberately asks for data each role must not get.

## Demo sign-in

For client walkthroughs: run `npm run db:seed:demo`, then start the server with `DEMO_LOGINS_ENABLED=true`. The login page shows **Try a demo** — one button each for Admin, Field Manager, QC and Tax Officer, plus **Customer**, which opens the sample job's QR page. The demo accounts (`*@demo.intensecare.local`) have random passwords that are never shown or sent to the browser; the server signs them in by role. Each demo account has exactly its role's normal permissions. Without the flag, the buttons and `/api/auth/demo-login` are gone (404), so keep it off in production.

## Sign-out

Sign-out revokes the session on the server (a copied cookie stops working), expires the cookie, clears local/session storage (`Clear-Site-Data`) and replaces the page with Login. `src/middleware.ts` redirects every protected page to Login when there is no valid session and serves protected pages with `Cache-Control: no-store`, so Back after sign-out shows Login, not the old page. Customers never sign in — their QR / link is their access.

## Screens and design system

- **Admin** — desktop sidebar: Dashboard, Jobs, Customers, Invoices, QC, Reports, Users, with Schedule, Properties, Services, GST and Settings under *More*; on phones a bottom bar with Home / Jobs / More.
- **Tax Officer** — GST Dashboard / GST Invoices / GST Reports (bottom bar on phones, plus Profile with sign-out).
- **Field Manager** — Home / Jobs / Tasks / Profile. The job screen shows the journey, the current step and one sticky next-action button (I'm here → Start service → Checklist → Photos → Complete work → Submit for QC).
- **QC** — Home / Quality / History / Profile. Large PASS and REWORK buttons; rework items take area, issue, severity, photo and comment.
- **Customer link** — Home / My Service / Reports / Profile: status, Job ID, team, QC result and invoice on Home; confirm & start, progress, before/after, invoice (print / save), approve, rating and Google review.

Shared building blocks live in `src/components/ui` and `src/components/job`: `StatusBadge` (labels and tones from `src/lib/status.ts`, always icon + text), `JobJourney`, `NextActionCard`, `DataTable` (table at ≥1280px, cards below), `Dialog` (bottom sheet on phones with a sticky footer), `Field`/`Input`/`Button` (44px+ touch targets, `loading` state), skeleton / empty / error / offline states. Palette: coral brand, green success, amber warning, red error, blue info, warm neutrals. Every screen is checked for horizontal overflow at 320, 360, 375, 390, 414, 430, 768, 1024, 1280 and 1440px.

## Stack

Next.js 14 (App Router) · React 18 · TypeScript strict · Prisma 7 + PostgreSQL · Tailwind · Cloudinary (before / after / QC / rework photos) · WhatsApp / SMS notifications with links.

Authorization: `src/lib/rbac/` holds the one permission matrix (permission + scope). Every API route checks permission and record scope on the server — the UI hiding a button is never the guard. Sessions are HMAC-signed httpOnly cookies; the role is re-read from the database on every request. See [docs/RBAC.md](docs/RBAC.md).

## Getting started

```bash
npm install
cp .env.example .env          # DATABASE_URL, ERP_SESSION_SECRET, APP_BASE_URL, CLOUDINARY_*, WHATSAPP_* …
npx prisma migrate deploy     # apply migrations
npm run db:seed               # creates the first Admin from SEED_SUPERADMIN_EMAIL / _PASSWORD
npm run dev                   # http://localhost:3000
```

Production: `npm run build && npm run start`. **Set `APP_BASE_URL`** to your public https address — customer links and the job QR are built on it, and the app refuses to build them on localhost in production.

First run: sign in as Admin → **Services** (add services and their checklist by area) → **Users** (add Field Managers and QC) → **Settings** (tax, Google review URL) → **New Job**.

Upgrading an existing database: `migrate deploy` maps old accounts automatically — every desk role (super admin, ops manager, scheduler, accounts) becomes **Admin**, field staff become **Field Manager**, and customer / referral-partner logins are disabled (customers use their link). Existing jobs get readable Job IDs.

## Notifications

Composed for every step and logged (`SmsLog`); delivered when a provider is configured:
- **WhatsApp Cloud API** — `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_NAME` (template with one body variable). The older `WHATSAPP_API_URL` webhook is still supported.
- **SMS** — `TWOFACTOR_API_KEY`.

Messages: job assigned (Field Manager), team arrived (customer link), QC ready / reinspection (QC), rework (Field Manager), approve your service (customer link).

## Expenses, referrals, HR and profitability

Admin-only modules (Field Managers see only what concerns their own jobs):

- **Expenses** (`/expenses`) — 11 fixed categories, receipts, approval for Field Manager expenses, void instead of delete, duplicate protection, CSV.
- **Referrals** (`/referrals`) — Created → Customer Registered → Bonus Review → Approved → Paid; rules in Settings; a bonus is never paid automatically.
- **HR** (`/hr`) — staff profiles (`employmentType`: permanent / contract / freelance, not a role), attendance, leave, payroll, freelance payments, restricted compensation and documents.
- **Job team** — assign several cleaners (leader, skills, duration, instructions, conflict checks, history) from the job page.
- **Reports → Profit & costs** — revenue vs collected vs outstanding, costs by category, job contribution, operating result.

Money rules (no double counting) and the full audit/test/deployment record are in [`docs/PRODUCTION_READINESS.md`](docs/PRODUCTION_READINESS.md).

## Tests

```bash
npm test     # roles, permissions, routing, next action, state machine
# Against a running server + empty test database (see the header of each script):
node scripts/e2e-verify.mjs   # five user types, the job journey, GST rules, security
node scripts/erp-verify.mjs   # quotations, job location, visibility, QR arrival, settings, reviews
node scripts/biz-verify.mjs   # expenses, referrals, HR, payroll, assignment, freelance payments, reports
# npm test needs TZ=Asia/Kolkata for one wall-clock assertion on non-IST machines
```
