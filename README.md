# Intense Care — Deep Cleaning Operations

A simple service-management app for a deep-cleaning business. **Four user types, one Job ID per job, one customer link per job.**

| Who | Experience | What they do |
|---|---|---|
| **Admin** | **Operations** (desk) | Customers, properties, services, jobs, Field Manager assignment, scheduling, quality status, rework, customer approvals and issues, payments, reports, users, settings |
| **Field Manager** | **My Jobs** (mobile) | Only their assigned jobs: Navigate → I'M HERE (GPS) → wait for customer → START SERVICE → checklist by area → before/after photos + notes → COMPLETE WORK → fix rework → SUBMIT FOR QC |
| **QC** | **Quality** (mobile) | Jobs waiting for inspection → INSPECT → PASS or REWORK REQUIRED (area · issue · photo · comment) → reinspection (PASS / REWORK AGAIN), full history kept |
| **Customer** | **My Service** (secure link, no login) | The page follows the job: View service → CONFIRM & START → progress → quality check pending → VIEW BEFORE / AFTER + APPROVE SERVICE → report, star rating, Google review |

## The job

One Job ID (`JOB-10245`) from booking to feedback — rework never creates a new job:

```
BOOKED → SCHEDULED → ASSIGNED → ARRIVED → CUSTOMER CONFIRMED → IN PROGRESS
→ WORK COMPLETED → QC → PASS ─────────────→ CUSTOMER APPROVAL → COMPLETED → FEEDBACK
                       └→ REWORK REQUIRED → Field Manager fixes → SUBMIT FOR QC → REINSPECTION ┘
```

Server-enforced: arrival is GPS-checked against the property (`ARRIVAL_GEOFENCE_METERS`, a reason is required to proceed without GPS); work cannot start until the customer confirms on their link; required checklist items must be done before COMPLETE WORK; status changes are compare-and-set so double taps or two devices can't apply twice.

## Customer link and QR

- **One secure link per job** — `APP_BASE_URL/customer/service/<token>`, valid for the whole job. 256-bit random token, only its SHA-256 hash is stored (plus an encrypted copy so Admin can re-share the same link). Admin can replace or turn it off. Old `/customer/job/<token>` links redirect.
- The customer only ever receives: service, date, property, team names, checklist progress and **before/after** photos (served through a token-checked proxy). Never amounts, notes, QC findings or QC/rework photos.
- **One optional property QR** (Admin → Properties → property → *Property QR*). Scanning it opens the customer page of that property's current or upcoming service. No other QR codes exist.

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

Production: `npm run build && npm run start`. **Set `APP_BASE_URL`** to your public https address — customer links and the property QR are built on it, and the app refuses to build them on localhost in production.

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
