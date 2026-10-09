# Production readiness report — Intense Care ERP

What was audited, what was added, what was run, and what is still open. Every test result below comes from a command that was actually executed; nothing here is assumed.

## 1. Audit report (existing modules)

Method: read every API route and page for permission checks, validation and state handling; ran the three existing end-to-end suites, lint, type-check and a production build; checked every page at 320–1440 px.

| Area | Finding | Action |
|---|---|---|
| Expenses (old) | Hard-delete of expenses, no approval, no audit, no receipts | Rewritten: approve / reject / **void** (never delete), audit trail, receipts, duplicate and double-submit protection |
| Settings API | Business rules (referral rules, approval limits) were readable by any signed-in role | Redacted for roles without `settings.view` |
| Job assignment | A Field Manager could be double-booked on overlapping times | Overlap-aware conflict check (also on reschedule), history, notification |
| Lists | No pagination on any table | Shared `DataTable` paginates (25/page); server lists page too |
| Legacy partner/commission code | Dormant tables/types from earlier work | Left in place and inert (see known issues); not exposed |
| Route prefixes | A stale `/quotations/` permission prefix | Replaced with the real route table |
| Reports | Client-side only, no costs | New `/api/reports/business` with server-side filters, definitions and CSV |
| Validation | Referral rule percentage above 100 was silently ignored | Now rejected with 400 (found by the new suite) |
| Payments | Marking a payroll / freelance / referral payment **paid** failed with HTTP 500 (database rule: a PAID row must already point at its expense) | Fixed: the expense is written first, in the same transaction (found by the new suite) |

## 2. Missing fields and incomplete workflows that were found and completed

Expenses: category list, payment method, tax, paid-by, vendor, job/staff link, receipt, payment status, creator, approval. Referrals: the whole workflow and Admin-set rules. HR: profiles, attendance with corrections, leave, payroll, restricted compensation and documents. Assignment: multi-staff, leader, skills, duration, instructions, conflicts, history, notification. Freelance: employment type (not a role), rates, verification, accept/decline/complete, payment workflow. Reports: revenue vs invoiced/collected/outstanding/refunded, direct costs, contribution, operating result.

## 3. Implemented changes

- **Expenses** (`/expenses`, `/api/expenses`): 11 fixed categories, `EXP-FY-#####` ids, idempotency key against double submit, duplicate-warning (confirm to save), Field Manager expenses on own jobs wait for Admin approval, void with reason, receipts (JPEG/PNG/WebP/PDF, ≤ 3 MB, content-checked, served only through `/api/files/[id]` with a permission check), filters, search, pagination, monthly totals, CSV.
- **Referrals & Bonuses** (`/referrals`, `/api/referral-bonuses`): Created → Customer Registered → Bonus Review → Approved → Paid. Rules in Settings (fixed or percentage, minimum job value, must-be-paid, window, cap). Eligibility is computed by `syncReferrals` from real customers/jobs/invoices. One bonus per qualifying job; an existing customer is rejected automatically; approval records the approver; **nothing is ever paid automatically**; paying creates exactly one `REFERRAL_BONUSES` expense.
- **HR** (`/hr`, `/hr/[id]`): one `Employee` record type with `employmentType` PERMANENT / CONTRACT / FREELANCE (cleaning staff and freelancers have no login). Attendance (check-in/out/mark, no duplicates, Admin corrections need a reason and are audited, Field Managers record today's attendance for their own team only), leave (overlap check, approve/reject), payroll (one per person per month, net = basic + allowances + bonuses − deductions − advances, approve → pay once). Job-location checks are never treated as attendance proof.
- **Assignment** (`TeamCard` on the job page and the field flow, `/api/jobs/[id]/team`): several staff per job, one leader, required skills, duration, special instructions, confirm; approved leave and inactive/exited staff are **blocked**; overlapping jobs and missing skills ask for an acknowledgement; unverified freelancers are blocked; every change is in the assignment history. Existing job statuses are unchanged.
- **Freelance payments** (`/api/hr/freelance-payments`): created when the job completes, Pending verification → Verified → Approved → Paid. Hours are corrected at verification and the amount recomputed. Paying creates one `FREELANCE_PAYMENTS` expense. Manually entering that category is refused.
- **Reports** (`Reports → Profit & costs`): filters date range / service / job / staff; money, costs by category, owed-but-not-yet-expense, job profitability, GST vs non-GST, staff utilization and leave (HR only), freelance, referrals; CSV for jobs, expenses, staff; definitions printed on the page (`src/lib/profit.ts`).

### How profit is defined (no double counting)

- Revenue = billed value **before GST**. GST is separate and never revenue or profit.
- Collected = money actually received. An invoice is not collected until paid. Refunds reduce revenue by their before-GST share.
- A cost is an expense that is **approved and not voided**. Salaries, freelance pay and referral bonuses become expenses **only when paid**, once (unique source key + database rule), so the same money is never counted in two places. Approved-but-unpaid amounts are shown as *owed*, not as cost.
- Job contribution = job revenue − direct costs (approved expenses linked to the job + freelance pay still owed for it). Salaries and overheads are operating costs, not spread over jobs.
- Operating result = net revenue − counted expenses (billed basis); a cash-basis figure is shown beside it.

## 4. Database migrations

`prisma/migrations/20261011000000_expenses_referrals_hr_assignments/migration.sql` — additive and idempotent (safe to re-run): new sequences and tables (`StoredFile`, `Referral`, `Employee`, `AttendanceRecord`, `LeaveRequest`, `PayrollRecord`, `JobAssignment`, `JobAssignmentEvent`, `FreelancePayment`), reshaped `Expense` (old rows are back-filled: approved, numbered), new `Job` columns, foreign keys, CHECK constraints (statuses, non-negative money, "PAID needs its expense"), and unique indexes (one leader per job, one expense per payment source, one referral per customer/job). Nothing from the earlier migrations is dropped; tables created by `20261010000000_location_qr_custom_services_visibility` that the app no longer uses stay in place.

Verified on (a) an empty database and (b) a database holding legacy expense rows.

## 5. Role and permission matrix (generated from `src/lib/rbac/permissions.ts`)

Scope: ALL = every record · ASSIGNED = only jobs/staff assigned to that Field Manager · – = no access. The backend enforces this; the browser only hides what the server would refuse.

| Permission | admin | field_manager | qc | tax_officer | customer |
|---|---|---|---|---|---|
| finance.view | ALL | – | – | – | – |
| expenses.view | ALL | – | – | – | – |
| expenses.submit | ALL | ASSIGNED | – | – | – |
| expenses.manage | ALL | – | – | – | – |
| reports.view | ALL | – | – | – | – |
| reports.financial | ALL | – | – | – | – |
| settings.view | ALL | – | – | – | – |
| settings.manage | ALL | – | – | – | – |
| referrals.view | ALL | – | – | – | – |
| referrals.create | ALL | – | – | – | – |
| referrals.manage | ALL | – | – | – | – |
| referrals.approve | ALL | – | – | – | – |
| hr.view | ALL | ASSIGNED | – | – | – |
| hr.manage | ALL | – | – | – | – |
| hr.sensitive | ALL | – | – | – | – |
| attendance.record | ALL | ASSIGNED | – | – | – |
| attendance.correct | ALL | – | – | – | – |
| leave.manage | ALL | – | – | – | – |
| payroll.manage | ALL | – | – | – | – |
| freelance.manage | ALL | – | – | – | – |

Other rules enforced on the server:

- Tax Officer: GST invoices and GST reports only. Receipts, expenses, HR, payroll, referrals and business reports return 403/404.
- QC: inspection only. No money, staff or settings.
- Field Manager: expenses on own jobs (approval needed), today's attendance of own team, own job's team (names, roles, phones — **no pay rates, no history, no address/emergency contact**). Cannot change teams, approve anything, read payroll, referrals, other managers' staff or the company expense list.
- Customer (secure link): job status, arrival confirmation, approval, issue, rating. The portal shows the team's names only when the customer-visibility setting allows it; never staff phone numbers, address, emergency contacts or pay.
- Salary, payroll, compensation, documents, customer PII and margins are served only to Admin.

## 6. Automated test results (executed)

| Command | Result |
|---|---|
| `npx tsc --noEmit` | no errors |
| `npm run lint` | no warnings or errors |
| `TZ=Asia/Kolkata npm test` | 20/20 node tests pass + all custom checks pass (see note below) |
| `npm run build` | succeeds (Next prints "Dynamic server usage" notices for API routes while collecting page data; these are normal and not failures) |

Note: `tests/ops-visibility.test.ts` contains one assertion ("IST host: wall clock unchanged") that is only true when the machine's time zone is Asia/Kolkata. On a UTC host it reports 1 failed check; with `TZ=Asia/Kolkata` it passes. The application itself always works in IST.

Unit coverage added: `tests/profit.test.ts` (revenue/GST/refund/contribution/operating-result arithmetic), `tests/rbac.test.ts` (new permissions, navigation, Field Manager limits).

## 7. End-to-end test results (executed against a fresh PostgreSQL + production build)

Run in this order on one database (`scripts/*.mjs`, headers explain the setup):

| Suite | Result |
|---|---|
| `e2e-verify.mjs` (roles, job journey, GST, security) | 122 passed, 0 failed |
| `erp-verify.mjs` (quotations, location, visibility, QR arrival, reviews) | 78 passed, 0 failed |
| `biz-verify.mjs` (new: expenses, HR, payroll, assignment, freelance, referrals, reports, privacy) | 187 passed, 0 failed |
| `ai-verify.mjs` (Intense AI, mock provider) | 32 passed, 0 failed |

`biz-verify.mjs` covers: expense validation (negative/zero/future/unknown category/manual freelance & referral categories), double-submit and duplicate handling, Field Manager approval flow, void and no-delete, receipt type/size/content/authorization and one-receipt-one-expense, employee profiles and sensitive-field redaction, attendance duplicates / future dates / corrections with reason, leave overlap and decisions, payroll duplicates / net maths / **three simultaneous pay clicks → one payment → one expense**, staff conflicts (leave blocked, overlap acknowledged, unverified freelancer blocked), single leader, history, freelance verify → approve → pay (also with three simultaneous pay clicks), referral eligibility (unregistered, booked-only, unpaid, paid), duplicate referrals, self-referral, existing-customer rejection, concurrent approve/pay, rule validation, report figures against direct database sums, and role boundaries for every route.

### The 14-step scenario

Covered end to end by the suites above (job creation → assignment → field work → QC → customer approval → invoice/payment come from `e2e-verify`; expense, referral, HR, freelance payment and reporting come from `biz-verify`):

1. Admin creates customer, property, job → 2. assigns Field Manager and cleaning staff (leader + freelancer) → 3. team confirmed → 4. Field Manager arrives, starts, completes checklist → 5. Field Manager adds an expense (waits for approval) → 6. Admin approves it → 7. QC inspects (rework, reinspect, pass) → 8. customer approves → 9. invoice paid → 10. freelance payment verified, approved, paid (expense created once) → 11. referral qualifies, approved, paid (expense created once) → 12. payroll created, approved, paid → 13. Reports show revenue, collected, costs by category, job contribution, operating result matching the database → 14. Tax Officer sees GST only; Field Manager, QC and Customer are refused on the restricted routes.

Steps 5–14 were exercised through the API with real sessions; the field-app click path for steps 4 and 7–9 is covered by `e2e-verify`.

### Responsive check (executed)

A headless-Chromium sweep loads 22 pages at 320, 375, 390, 768, 1024, 1280 and 1440 px (154 page/width combinations, including the new Expenses, Referrals, HR, HR profile and Reports pages) and checks for horizontal overflow, clipped text and page errors. Final run after the fixes: 154/154 clean, no page errors. (An earlier run found the Referrals table 9–12 px too wide at 1280 px; two columns were merged and the sweep was re-run.)

## 8. Remaining known issues

- **Session secret fallback.** `src/lib/server/session.ts` still contains a development fallback secret from earlier work. In production you must set `ERP_SESSION_SECRET` (the deployment steps below require it). Likewise set `APP_BASE_URL`; the code otherwise falls back to the project's Vercel URL.
- **One host-timezone unit assertion** (see section 6).
- **Dormant tables.** Tables from earlier migrations (e.g. partner/commission, service-line tables) remain in the database but are unused. They were not dropped to keep every migration additive and reversible.
- **Files live in the database** (≤ 3 MB each). Fine for receipts and ID proofs at this scale; move to object storage if volume grows.
- **Lazy syncs.** Referral eligibility and freelance-payment creation are refreshed when the relevant list/report is opened (or via the Referrals "Re-check" button), not by a background job.
- **Notifications** need a WhatsApp/SMS provider configured; without one they are composed and logged only. The provider calls were not exercised against live accounts.
- **Advances.** Record a salary advance as an expense when it is given; payroll then records only the net still paid.
- **Staff attendance** is entered by Admin or the Field Manager; there is no staff login or self-service check-in.

## 9. Deployment and rollback

Before deploying:

1. Take a database backup (`pg_dump -Fc "$DATABASE_URL" > backup-$(date +%F).dump`).
2. Set in the host: `DATABASE_URL`, `ERP_SESSION_SECRET` (`openssl rand -hex 32`), `APP_BASE_URL` (the public https URL), plus the optional notification and `GEMINI_API_KEY` values from `.env.example`. Never put the AI key in client code.
3. Run `npx prisma migrate deploy` (applies `20261011000000_…`; safe to re-run).
4. `npm run build` then start the app; sign in as Admin and open Expenses, Referrals, HR and Reports → Profit & costs.
5. In Settings, review the referral rules (they default to ₹500 fixed, minimum job ₹2,000, must be paid, 90 days).

Smoke test: create an expense, add a staff member, assign them to a job, open Reports.

Rollback: redeploy the previous build — the previous code ignores the new tables and columns (the migration only adds). If data must also be reverted, restore the backup taken in step 1. Do not drop the new tables unless you are restoring from that backup.
