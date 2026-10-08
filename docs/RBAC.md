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
- **Customer** — never a session. `/api/customer/job/[token]` resolves the token (hash lookup, revocation) and allows only: view (minimal fields), confirm arrival (only after ARRIVED), approve (only after QC pass), report an issue, rate.

Server helpers (`src/lib/server/authz.ts`): `requirePermission(p)`, `authorizeJob(jobId, p)` (permission + record scope), `jobWhereFor(user, p)` (database filter for lists). The browser uses the same matrix only to decide what to show.

## Next action

`getNextAction(role, job)` (`src/lib/rbac/next-action.ts`) gives ONE primary action per role per status — e.g. Field Manager: *I'm Here → Start Service → Continue Checklist → Add Photos → Complete Work → Fix Rework*; QC: *Inspect / Reinspect*; Admin: *Assign Field Manager*, *Share Customer Link*, *Close Job*. Status changes are re-validated by the state machine (`src/lib/state-machine.ts`) on the server.
