# Laundry Operations

A simple, production-ready laundry operations system: **customer → order → pickup → processing → QC → ready → delivery → completed**.

Built with Next.js 14 (App Router, server components), TypeScript, Prisma 7 + PostgreSQL, Tailwind CSS. WhatsApp Business Cloud API for customer updates, Cloudinary (optional) for pickup photos.

## Four user types

| Who | Where | Answers |
|---|---|---|
| **Admin** | `/admin` — Dashboard, Orders, Customers, Users, Services, Payments, Reports, Settings | "What needs my attention?" |
| **Field Manager** | `/field` — Today, Pickups, Deliveries, Profile (mobile app) | "What do I pick up or deliver today?" |
| **QC** | `/qc` — QC Queue, Passed, Failed, Profile (mobile app) | "What do I need to inspect?" |
| **Customer** | `/customer/order/AC1024?k=…` — no login | "Where is my order?" |

Admins run the entire workflow from one **Order** screen (`/admin/orders/[id]`): status and next step, customer, pickup, items, QC, delivery, payment, customer link and the full activity timeline.

## The order workflow

```
CREATED → PICKUP_ASSIGNED → PICKED_UP → PROCESSING → QC_PENDING → QC_PASSED → READY → OUT_FOR_DELIVERY → DELIVERED
QC_PENDING → QC_FAILED → REWORK → QC_PENDING        QC_PENDING → REWORK (needs rework)
CREATED / PICKUP_ASSIGNED / PICKED_UP / PROCESSING → CANCELLED (admin, reason required)
```

- The transition table lives in `src/lib/workflow.ts`; `src/lib/server/orders.ts` enforces it. Invalid moves are rejected (409).
- Each status write is a compare-and-set inside a database transaction, so double taps and races cannot apply a step twice.
- Every change is written to `ActivityLog`; every WhatsApp message to `Notification`.
- **Automation:** order created → pickup assigned to the least-busy field manager · picked up → processing · QC passed → ready → delivery assigned → customer notified · delivery started → customer notified · delivered → completed.
- QC **Fail** and **Needs rework** require a reason. Payments at the door are recorded in the same transaction as "Delivered".

## Security

- Staff sign in with email + password (bcrypt). The session cookie is HMAC-signed and holds only the user id; role and active flag are re-read from the database on every request.
- Every page layout and API route checks the role on the server. Field managers can only act on pickups/deliveries assigned to them (anything else returns 404). QC can only make QC decisions.
- Customer links carry `k = HMAC(secret, orderId:linkVersion)`. Changing the order number in the URL fails; "Revoke & create new link" bumps `linkVersion` and kills old links. Rate-limited, `no-referrer`, `no-store`.
- Money is stored in paise (integers). Payments are idempotent per form submission and can never exceed the balance.

## Setup

```bash
npm install
cp .env.example .env            # fill DATABASE_URL, SESSION_SECRET, APP_BASE_URL, SEED_ADMIN_*
npx prisma migrate deploy       # create the tables
npm run db:seed                 # first admin (SEED_STARTER_SERVICES=1 adds a starter price list)
npm run dev                     # http://localhost:3000
```

Then sign in as the admin → **Services** (prices) → **Users** (field managers, QC) → **Settings** (business name, support contacts, UPI ID) → **New Order**.

> **Upgrading from the previous cleaning-services version:** this is a new data model with a fresh baseline migration. Deploy it to a **new, empty database**. `migrate deploy` on the old database fails safely rather than altering it; `npx prisma migrate reset` would wipe it.

## Scripts

```bash
npm run build   # prisma generate + next build
npm test        # workflow, pricing and customer-link tests
npm run lint
```

## Data model

`User`, `Customer`, `Order`, `OrderItem`, `Service`, `Pickup`, `QCRecord`, `Delivery`, `Payment`, `Notification`, `ActivityLog`, plus `Setting` for the admin-editable business settings. See `prisma/schema.prisma`.
