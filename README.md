# Intense Care — Deep Cleaning Operations

A simple service-management app for a deep-cleaning business. **Five user types, one Job ID per job, ONE QR / secure link per job, GST and Non-GST invoices kept apart.**

| Who | Experience | What they do |
|---|---|---|
| **Admin** | **Operations** (desk) | Customers, properties, services, jobs, Field Manager assignment, scheduling, quality status, rework, customer approvals and issues, GST / Non-GST invoices and payments, reports, users, settings |
| **Field Manager** | **My Jobs** (mobile) | Only their assigned jobs: Navigate → I'M HERE (GPS) → wait for customer → START SERVICE → checklist by area → before/after photos + notes → COMPLETE WORK → fix rework → SUBMIT FOR QC |
| **QC** | **Quality** (mobile) | Jobs waiting for inspection → INSPECT → PASS or REWORK REQUIRED (area · issue · photo · comment) → reinspection (PASS / REWORK AGAIN), full history kept |
| **Tax Officer** | **GST** (desk, read-only) | GST Dashboard, GST Invoices (search, date and customer filters, GST breakdown, print / PDF), GST Reports (month-wise CGST / SGST / IGST, CSV). Never sees Non-GST invoices, jobs, customers, users or settings, and cannot change anything |
| **Customer** | **My Service** (QR / secure link, no login, no app) | The page follows the job: Job ID, team, status → CONFIRM & START → progress → quality check → before / after photos → invoice → APPROVE SERVICE → star rating, Google review |

## The job

One Job ID from booking to feedback — rework never creates a new job. The ID is `CUSTOMER-NAME-DDMMYYYY-NNN` (e.g. `RAHUL-SHARMA-08102026-001`, then `-002` for that customer's next job on the same date): the name upper-cased with symbols removed, the service date, and a sequence. It is unique in the database (unique index; concurrent bookings take turns via an advisory lock). Jobs created before this format keep their `JOB-10001` style ID.

```
BOOKED → SCHEDULED → ASSIGNED → ARRIVED → CUSTOMER CONFIRMED → IN PROGRESS
→ WORK COMPLETED → QC → PASS ─────────────→ CUSTOMER APPROVAL → COMPLETED → FEEDBACK
                       └→ REWORK REQUIRED → Field Manager fixes → SUBMIT FOR QC → REINSPECTION ┘
```

Server-enforced: arrival is GPS-checked against the property (`ARRIVAL_GEOFENCE_METERS`, a reason is required to proceed without GPS); work cannot start until the customer confirms on their link; required checklist items must be done before COMPLETE WORK; status changes are compare-and-set so double taps or two devices can't apply twice.

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

## Tests

```bash
npm test     # roles, permissions, routing, next action, state machine
```
