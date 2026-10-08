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

Server-enforced: arrival is verified against the job's service location (see below); work cannot start until the customer confirms on their link; required checklist items must be done before COMPLETE WORK; status changes are compare-and-set so double taps or two devices can't apply twice.

## The service location

Admin picks the exact location when creating the job (**New Job → step 3**): the service address, a pin on a map (drag it, or tap **Use my location**), and optional location notes for the crew (gate code, which floor, parking). Latitude, longitude and the device accuracy are saved on the job — nobody types coordinates. The map is OpenStreetMap tiles drawn directly by the app: no map SDK, no API key, no extra dependency.

That pin is the **official service location** for the job. It appears on the job page, the Field Manager's job screen and card, and the customer's QR page where Admin permits it, each with one **OPEN NAVIGATION** button. A property with no pin inherits the first one dropped on it, so the next job at that address is GPS-verifiable from the start. Admin can re-point a job's location later (audited, `JOB_LOCATION_UPDATED`).

## Arrival verification — GPS, QR, or a reason

GPS fails in basements, lift lobbies, thick buildings and on tired phones. The Field Manager is therefore **never blocked from starting the job** — but how arrival was verified is always recorded:

| Method | When | What it means |
|---|---|---|
| **GPS Verified** | the crew is inside `ARRIVAL_GEOFENCE_METERS` (default 300 m) of the pin, device accuracy counted in their favour | the location is proven by coordinates |
| **QR Verified** | GPS was unavailable or too far, so the crew scanned the job QR on site | being able to scan THAT job's QR is itself proof of presence |
| **Manual Admin Override** | neither worked | an explicit reason is required and audited |

**[ VERIFY LOCATION WITH QR ]** sits on the job screen from the start, not only after GPS fails. The scanner uses the browser's own barcode reader (live camera, or a photo of the QR) and falls back to pasting the link, so a phone without a scanner is not a dead end. The server checks that the scanned token is live **and belongs to this job** — a token from another job is rejected, not waved through. There is still exactly ONE QR per job: the same customer link, used for verification as well.

Every arrival writes the method, the measured distance, the QR token id or the override reason to the job activity feed and the audit log (user, role, time, Job ID, method).

## One QR per job

- **ONE QR → ONE secure customer job portal.** The QR encodes only the job's secure link, `APP_BASE_URL/customer/service/<token>` — a 256-bit random token. No phone number, GSTIN, customer id, invoice data or anything personal is in it. Only the token's SHA-256 hash is stored (plus an encrypted copy so Admin can re-show the same QR). The server validates the token on every request; Admin can replace it (the old QR stops working) or turn it off.
- The same QR works for the whole job: confirm the team, progress, before/after photos, QC result, quotation, invoice, approval, feedback — **and the Field Manager's location verification when GPS fails**. There are no separate QR codes for Field Manager, QC, rework, approval, completion or invoices, and the old per-property QR has been removed.
- **"Scan QR to View Service"** appears on the job page, on each job card / row in Jobs, and is printed on the invoice. Old `/customer/job/<token>` links redirect.
- The customer receives: Job ID, their name, service, date, team names, status, checklist progress, **before/after** photos (served through a token-checked proxy), a plain QC result (being checked / finishing touches / passed) and their own invoice. Never internal notes, QC findings or QC/rework photos.

## Services, custom services and multiple services per job

Services are company data (**Services** page): name, description, price, estimated duration, **tax treatment** (taxable at the configured rate, or GST-exempt), an internal note the customer never sees, and a checklist by area. The create form offers one-tap starting points — Deep Cleaning, Sofa Cleaning, Carpet Cleaning, Kitchen Cleaning, Bathroom Cleaning, Move-in, Move-out, Custom Service — which only prefill the name; nothing exists until the company creates it.

A job or a quotation can carry **one or many services**. In New Job → step 2 (and on a quotation) Admin ticks catalog services and can type a **custom service** inline — name, description, price, duration, tax treatment — which is kept in the catalog by default so it can be booked again and shows up in reports:

```
CUSTOM SERVICE
Service:      Post Construction Deep Cleaning
Description:  Complete cleaning of newly constructed property
Price:        ₹25,000
Duration:     2 days
```

Each line carries its own quantity, unit price and discount. The job's checklist comes from the first catalog service on it. The lines are the single money model (`src/lib/documents.ts`) behind the quotation, the job value and the invoice, so those three can never disagree: GST is charged only on taxable lines, a document discount is spread across lines so the printed amounts still add up to the grand total, and CGST and SGST always re-add to the total GST.

## Quotations

**Admin → Quotations** raises a professional quotation: company logo and identity, quotation number (`QTN-2627-00001`), date, valid-until, the customer and the service address, a priced service table (service · description · qty · unit price · discount · tax · total), the totals ladder, payment and service terms, notes, and a customer acceptance block. GST or Non-GST is chosen when it is raised.

From the document: **mark as sent**, **record acceptance** (who accepted, and when — printed on the quotation), **mark declined**, or **convert to job**. Converting creates the job and its invoice with *exactly* the quoted lines, figures and GST split, mints the job's QR, and links the two records (`Quote.jobId`), so the customer sees the quotation and the invoice for the same job on one page.

Every document page has **[ Download PDF ] [ Print ] [ Share ]**. Download and Print open the browser's print dialog (where *Save as PDF* produces the PDF of the styled document); Share uses the phone's native share sheet — which is how these usually reach WhatsApp — and copies the link when there is no sheet. A print stylesheet drops the app chrome so the paper carries only the document.

## Customer visibility

Admin controls what each customer sees of their own job — on the job (**New Job → step 7**, or *Change* on the job page) over a company default (**Settings → Customer visibility**).

Switchable: service date · service location · assigned team name · before photos · after photos · QC result · service notes · customer feedback · quotation · invoice · payment status. **Job ID, service name and job status are always shown** — a service page that cannot say which job it is, what was done or where it stands is not a service page.

**Never visible to any customer, with no switch anywhere in the product:** internal staff notes · internal QC comments · internal cost · staff salary · internal profit/margin · supplier information · internal operational notes · internal management comments · other customers · internal reports. The job's work notes (`Job.notes`) are internal; a note *for* the customer is a separate field (`Job.customerNotes`) so an internal note cannot leak by accident.

**The server enforces it, not the UI** (`src/lib/visibility.ts`): a field whose switch is off is **absent from the API response**, never sent and hidden with CSS. The same configuration filters the customer page payload, the photo proxy (guessing a photo id with a valid token returns 404 when before photos are off) and the customer's Intense AI answers, so the assistant is not a side channel. Unknown keys in a visibility payload are dropped and locked keys forced on, so a hostile request can neither widen the portal nor break it.

## GST and Non-GST invoices

- Every invoice is **GST** or **NON_GST** (`Invoice.invoiceType`), chosen by Admin when booking the job (New Job → *Invoice*: GST Invoice / Non-GST Invoice) and changeable on the invoice page until it is finalized.
- The document carries the company logo and identity, the invoice number and date, the due date and Job ID, the billing address **and** the service address, an item table (service · description · qty · rate · discount · tax · amount), the totals ladder, payment terms, bank/payment details while money is owed, the job QR and an authorised-signature area.
- **GST INVOICE:** both GSTINs, SAC code, place of supply, taxable amount, GST %, CGST + SGST (same state) or IGST (other state), total GST, grand total. **NON-GST INVOICE:** customer details, invoice number and date, amount, grand total — every GST row is **absent, not zeroed**. The heading says which it is.
- Separate number series: `GST-2627-00001` and `INV-2627-00001` (financial year + sequence). A database check constraint stops a Non-GST invoice from ever carrying GST data.
- Admin → **Invoices** filters *All / GST Invoices / Non-GST Invoices*; each invoice has **[ Download PDF ] [ Print ] [ Share ]** and prints with the job QR.
- **Tax Officer → GST only, enforced on the server:** `/api/invoices`, `/api/invoices/[id]` and `/api/invoices/report` always filter `invoiceType = 'GST'` for anyone without `finance.view`. Asking for Non-GST invoices returns 403, and a Non-GST invoice id returns 404, however the URL or request is edited.

## Intense AI

A business assistant inside the app (**Intense AI** in the menu for every signed-in role, and an **Intense AI** button on the customer's QR page). Ask in plain language — "Summarize today's business performance", "Why are we getting more rework this month?", "Which customers haven't booked again?", "Give me a monthly business report" — or tap a suggested question or quick action. Answers stream in, keep **What the data shows** separate from **Recommendations**, and reports follow Executive Summary → … → Next Actions.

- **It sees only what the user can see.** The model never gets the database. It can only call server-side data tools (`src/lib/server/ai/tools.ts`), and each tool (1) is offered only to roles holding its permission, (2) is re-checked when the model calls it, and (3) queries through the same scoping as the normal APIs (`jobWhereFor`, `authorizeJob`, `invoiceWhereFor`), with money fields only for `finance.view`. So:
  - Admin — full business intelligence (metrics, jobs, customers, revenue, invoices, GST, QC, rework, feedback, Field Manager and service performance).
  - Field Manager — their own assigned jobs, customers on those jobs, their QC results and rework; no money.
  - QC — quality checks, rework and the jobs behind them; no money.
  - Tax Officer — GST invoices and GST summaries only (Non-GST requests return "not permitted").
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

- **Admin** — desktop sidebar: Dashboard, Jobs, Customers, Quotations, Invoices, QC, Reports, Users, with Schedule, Properties, Services, GST and Settings under *More*; on phones a bottom bar with Home / Jobs / More. **New Job** is eight short steps: customer → services → location → date & time → Field Manager → notes → customer visibility → create.
- **Tax Officer** — GST Dashboard / GST Invoices / GST Reports (bottom bar on phones, plus Profile with sign-out).
- **Field Manager** — Home / Jobs / Tasks / Profile. Each job card shows customer, service, location, time and status with **NAVIGATE**. The job screen shows the service location, the journey, the current step and one sticky next-action button (I'm here → Start service → Checklist → Photos → Complete work → Submit for QC), with **VERIFY LOCATION WITH QR** available throughout.
- **QC** — Home / Quality / History / Profile. Large PASS and REWORK buttons; rework items take area, issue, severity, photo and comment.
- **Customer link** — Home / My Service / Reports / Profile: Job ID, service, date, location, status, team, QC result, payment and documents on Home; confirm & start, progress, before/after, quotation and invoice (print / save), approve, rating and Google review. Every section obeys the job's customer-visibility configuration, which the server applied before the page was served.

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

First run: sign in as Admin → **Services** (add services, their tax treatment and their checklist by area) → **Users** (add Field Managers and QC) → **Settings** (company identity and logo, tax, document terms, bank details, customer visibility default, Google review URL) → **New Job**.

Upgrading an existing database: `migrate deploy` maps old accounts automatically — every desk role (super admin, ops manager, scheduler, accounts) becomes **Admin**, field staff become **Field Manager**, and customer / referral-partner logins are disabled (customers use their link). Existing jobs get readable Job IDs. The location / custom-services / visibility migration also backfills one service line per existing job from its service and amount, so older jobs print the same figures on the new documents; existing jobs have no location pin until someone sets one, so their arrivals use the QR or a reason until then.

## Notifications

Composed for every step and logged (`SmsLog`); delivered when a provider is configured:
- **WhatsApp Cloud API** — `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_NAME` (template with one body variable). The older `WHATSAPP_API_URL` webhook is still supported.
- **SMS** — `TWOFACTOR_API_KEY`.

Messages: job assigned (Field Manager), team arrived (customer link), QC ready / reinspection (QC), rework (Field Manager), approve your service (customer link).

## Tests

```bash
npm test     # roles, permissions, routing, next action, state machine,
             # customer visibility, document/GST figures, distance maths
```
