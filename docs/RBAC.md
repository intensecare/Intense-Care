# Roles and access

Five user types. Four sign in; the customer uses the job's QR / secure link.

| Role (stored value) | Home | Sign-in |
|---|---|---|
| Admin (`admin`) | `/` Operations | email + password |
| Field Manager (`field_manager`) | `/my-jobs` My Jobs | email + password |
| QC (`qc_inspector`) | `/quality-queue` Quality | email + password |
| Tax Officer (`tax_officer`) | `/gst` GST | email + password |
| Customer | `/customer/service/<token>` My Service | none — secure link |

Legacy stored roles are mapped by `normalizeRole()` and the `20261008000000_simplify_four_roles` migration: `super_admin`, `ops_manager`, `scheduler`, `accounts` → `admin`; `staff`, `field_staff` → `field_manager`. Any other value (including `customer`, `referral_partner`) cannot sign in.

## How a request is authorized

`src/lib/rbac/permissions.ts` is the only place that says what a role may do: `permission → scope` where scope is `ALL`, `ASSIGNED` or `OWN`.

- **Admin** — every permission, `ALL` records.
- **Field Manager** — job, checklist, photo and rework permissions with `ASSIGNED` scope: only jobs where they are the assigned Field Manager. No finance, reports, users, settings, dashboard, assignment or QC decisions; customers/properties only for their own jobs; job amounts are redacted.
- **QC** — inspection (`qc.inspect`, `qc.pass`, `qc.rework`, `qc.reinspect`), job/checklist/photo read and QC evidence upload. No money, users, settings, field steps or assignment.
- **Tax Officer** — only `gst.view` and `gst.reports`. Every invoice API filters `invoiceType = 'GST'` server-side for anyone without `finance.view` (`invoiceWhereFor()` in `src/lib/server/invoices.ts`): a Non-GST request is 403, a Non-GST invoice id is 404. No jobs, customers, users, QC, payments, settings or customer links; nothing can be created, edited or deleted.
- **Customer** — never a session. `/api/customer/job/[token]` resolves the token (hash lookup, revocation) and allows only: view (the fields the job's visibility configuration permits, see below), confirm arrival (only after ARRIVED), approve (only after QC pass), report an issue, rate.

Server helpers (`src/lib/server/authz.ts`): `requirePermission(p)`, `authorizeJob(jobId, p)` (permission + record scope), `jobWhereFor(user, p)` (database filter for lists). The browser uses the same matrix only to decide what to show.

## Customer visibility

A second, narrower gate sits inside the customer's own job: what the business has chosen to show them. It is one module, `src/lib/visibility.ts`, and three rules.

**1. The server decides.** Every customer-facing read resolves `effectiveVisibility(job.customerVisibility, settings.defaultCustomerVisibility)` and omits what is switched off — the field is **absent from the JSON**, not sent and hidden with CSS. This is enforced in:

| Surface | What it filters |
|---|---|
| `GET /api/customer/job/[token]` | the whole page payload — date, location, team, photos, QC result, customer note, quotation, invoice, payment position, feedback |
| `GET /api/secure-photo/[id]` | the image bytes: with before photos off, a valid token plus a guessed photo id still returns 404 |
| `get_my_service` (Intense AI) | the assistant answers from the same configuration, so it cannot be asked for a hidden field |

**2. Internal information has no switch.** `NEVER_CUSTOMER_VISIBLE` — internal staff notes, internal QC comments, internal cost, staff salary, profit/margin, supplier information, internal operational notes, internal management comments, other customers, internal reports — is not part of the configuration at all. No payload, query string or settings value can turn any of it on. The internal work note (`Job.notes`) and the note written for the customer (`Job.customerNotes`) are separate columns for exactly this reason.

**3. A payload cannot widen or break the portal.** `normalizeVisibility()` drops unknown keys, ignores non-booleans and forces the locked keys (Job ID, service name, job status) on. Writing the configuration needs `jobs.update` at `ALL` scope — a Field Manager cannot change what a customer sees — and every change is audited (`JOB_VISIBILITY_UPDATED`).

`tests/visibility.test.ts` covers the normalization, the override precedence, the omit-not-blank rule and the never-visible list.

## Next action

`getNextAction(role, job)` (`src/lib/rbac/next-action.ts`) gives ONE primary action per role per status — e.g. Field Manager: *I'm Here → Start Service → Continue Checklist → Add Photos → Complete Work → Fix Rework*; QC: *Inspect / Reinspect*; Admin: *Assign Field Manager*, *Share Customer Link*, *Close Job*. Status changes are re-validated by the state machine (`src/lib/state-machine.ts`) on the server.

## Intense AI

The assistant has no access of its own: `ai.use` only switches it on for a role. Every piece of data comes from a tool in `src/lib/server/ai/tools.ts` that declares a permission (e.g. `get_revenue_summary` → `finance.view`, `get_invoices` → `gst.view`, `get_my_work_summary` → `jobs.arrive`). Tools are offered to the model only when the user holds that permission, re-checked on every call, and scoped with `jobWhereFor` / `authorizeJob` / `invoiceWhereFor`. Customers get one tool (`get_my_service`) bound to the job of their QR token, and its answer is filtered by that job's customer-visibility configuration. Prompt wording is never relied on for security.

