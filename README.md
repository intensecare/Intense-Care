# Deep Cleaning Operations ERP (Intense Care)

A production-grade, database-backed field-service ERP for deep-cleaning businesses, built on Next.js 14 (App Router) with TypeScript strict mode, Prisma 7 + PostgreSQL (Neon), Cloudinary evidence-photo storage, and 2Factor.in SMS OTP.

Every entity lives in PostgreSQL — there are **no hardcoded catalogs, demo data, or mock flows**: services, checklist rubrics, referral partners, commission rules, and user accounts are all created by the company through the app.

## Tech Stack

- **Next.js 14.2 (App Router)** + **React 18** + **TypeScript (strict)**
- **Prisma 7** with the `@prisma/adapter-pg` driver adapter → **PostgreSQL** (built against [Neon](https://neon.tech); any Postgres works)
- **Tailwind CSS** + minimal shadcn-style UI primitives (`button`, `dialog`, `input`, `tabs`)
- **Cloudinary** — before/after evidence photos (stored in DB, served via CDN URLs)
- **2Factor.in** — provider-generated OTP over SMS (AUTOGEN DLT template); no plaintext OTP codes ever touch the database
- **bcryptjs** password hashing (cost 12) + HMAC-signed httpOnly session cookies

## Architecture

- **Server-authoritative APIs** under `src/app/api/*` with role-based authorization (`src/lib/server/authz.ts`). All lifecycle gates (state machine, OTP verification, assignment scope, dispatch window) are enforced on the server, not just in the UI.
- **Database is the single source of truth.** The client store (`src/lib/app-context.tsx`) hydrates every collection from the APIs on sign-in and writes through on every action; optimistic updates roll back on server rejection.
- **Three internal roles:**
  - `super_admin` — full control including finance (invoices, payments, expenses, commissions, referral ledger, audit log, user management).
  - `ops_manager` — dispatch and quality: job register within the dispatch window, staff assignment, QC audits, rework. **All financial payloads are redacted or 403'd server-side.**
  - `staff` (field worker) — only jobs directly assigned to them; mobile-first flow: Arrive → customer OTP (lead worker only) → Start → checklist → photos → Complete.
- **Customer** — no login; tokenized handover links (`/portal/[token]`) for sign-off, feedback, and Google review.
- **Referral partner** — public code-scoped dashboard (`/partner-portal/[code]`), no login.

## Job Lifecycle (strict state machine)

```
DRAFT → SCHEDULED → ASSIGNED → ARRIVED → CUSTOMER_VERIFIED → IN_PROGRESS
      → WORK_COMPLETED → QUALITY_CHECK → (PASS | REWORK_REQUIRED → REWORK_COMPLETED
      → REINSPECTION) → CUSTOMER_APPROVAL → COMPLETED → FEEDBACK_REQUESTED → CLOSED
```

- `CUSTOMER_VERIFIED` can **only** be reached through `/api/otp/verify` (server-side 2Factor session check) — a client PATCH cannot skip it.
- Work cannot start before OTP verification; mandatory checklist items must be completed before submitting for QC.
- Referral commissions settle automatically when a referred job completes (idempotent).

## Ops Manager dispatch window

Ops managers see jobs from the past through **today**, plus **tomorrow only after** the dispatch cutoff (`NEXT_DAY_DISPATCH_TIME`, default 20:00 local). The window is enforced in `/api/jobs` and `/api/jobs/[id]`; beyond-window jobs are never returned, and direct URL access renders as out-of-window.

## Getting Started

### Prerequisites

- Node.js 18.17+ (20+ recommended)
- A PostgreSQL database (Neon, Supabase, RDS, or local)
- Cloudinary account (evidence photos)
- 2Factor.in API key (customer OTP SMS)

### 1. Install

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# then fill in DATABASE_URL, ERP_SESSION_SECRET, TWOFACTOR_API_KEY,
# CLOUDINARY_* and the SEED_* credentials
```

Every variable is documented in `.env.example`. `ERP_SESSION_SECRET` can be generated with `openssl rand -hex 32`.

### 3. Apply the database schema

```bash
npx prisma migrate deploy     # apply committed migrations (production-safe)
# or, for a brand-new empty database:
npx prisma migrate dev
```

### 4. Seed the first super admin

```bash
npm run db:seed
```

This creates **only** the initial super_admin from `SEED_SUPERADMIN_EMAIL` / `SEED_SUPERADMIN_PASSWORD`. No other data is seeded — create services, rubrics, partners, and staff in the app.

### 5. Run

```bash
npm run dev          # development, http://localhost:3000
npm run build        # production build (type-checks + lints)
npm run start        # serve the production build
```

### 6. First-run checklist (in-app)

1. Sign in as the seeded super admin.
2. **Services & Rubrics** — create your service packages; add checklist rubric items (they instantiate onto every booking).
3. **Users & Roles** — create `ops_manager` and `staff` accounts.
4. **Settings** — configure GST rate/label, GSTIN, SAC code, dispatch cutoff, and Google review URL.
5. Optionally **Referrals & Partners** — create commission rules and partners before book referral-attributed jobs.

## Database migrations

Prisma 7 runs non-interactively here (config: `prisma7.config.ts`). Migration history lives in `prisma/migrations/`; apply with `npx prisma migrate deploy`. The schema covers users, customers, properties, services + rubric items, jobs + checklist items, OTP challenges, SMS logs, quality checks/issues/rework, completion invites (sign-off + feedback), invoices/payments/expenses/quotes, referral partners/rules/entries/payouts, and an audit log.

## Key API surface

| Area | Endpoints |
|---|---|
| Auth | `POST /api/auth/login`, `GET /api/auth/session` (httpOnly signed cookie) |
| Jobs | `GET/POST /api/jobs`, `GET/PATCH /api/jobs/[id]`, `POST /api/jobs/[id]/completion-link` |
| OTP | `POST /api/otp/send` / `verify` / `resend` (lead-worker gated, rate-limited) |
| Directory | `GET/POST/PATCH/DELETE /api/users` (super_admin), `PUT /api/users` staff directory (ops) |
| Catalog | `GET/POST/PATCH/PUT/DELETE /api/services` (rubric builder), `GET/POST /api/customers`, `/api/properties` |
| Quality | `GET/POST/PATCH /api/quality`, `GET /api/checklist` |
| Finance (super_admin) | `GET/POST /api/finance`, `GET/POST /api/referrals`, `GET /api/audit` |
| Photos | `GET/POST /api/photos`, `DELETE /api/photos/[id]` (Cloudinary) |
| Public tokenized | `GET /api/portal/[token]`, `POST /api/portal/[token]/sign`, `POST /api/feedback`, `GET /api/partner-portal/[code]` |
| Settings | `GET /api/settings` (all roles), `PATCH /api/settings` (super_admin) |

## Security notes

- Session cookies are HMAC-SHA256 signed, httpOnly, `sameSite=lax`, and re-validated against the `User` table (deactivated users are rejected immediately).
- OTP policy (expiry, max attempts, resend cooldown, per-job/per-phone hourly caps) is enforced server-side from environment variables; challenge state is database-tracked and single-use.
- Customer phone numbers are normalized to the 10-digit subscriber form for 2Factor; only masked numbers are ever returned to clients.
- The 2Factor API key, session secret, and all credentials are read exclusively from environment variables and never logged.
# Intense-Care
