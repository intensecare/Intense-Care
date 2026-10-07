# RBAC + UI/UX Architecture

This document is the contract between the permission system (`src/lib/rbac/`), the server (`src/lib/server/authz.ts` + every `src/app/api/*` route) and the role workspaces (`src/app/*`). The code is the source of truth; this page explains the model.

RBAC here is **not** menu hiding. For every user it defines:

1. **What they can see** — the workspace, its navigation and the response projection.
2. **Which records they can access** — the *scope* of each permission.
3. **What actions they can perform** — `MODULE.ACTION` permissions.
4. **What they can approve** — approval authority on top of permissions.
5. **What they cannot access** — everything not granted is denied, on the server.
6. **What their next action is** — one primary action per role per job state.

---

## 1. Model

```
permission  = MODULE.ACTION                               (what)
scope       = ALL | BRANCH | TEAM | ASSIGNED | OWN | NONE  (which records)
approval    = approval authority for sensitive actions     (who may approve)
next action = f(role, job state, job context)              (what to do now)
```

| File | Responsibility |
|---|---|
| `src/lib/rbac/roles.ts` | The nine roles, labels, `normalizeRole()` |
| `src/lib/rbac/permissions.ts` | Permission list, scopes, **the matrix** (`ROLE_PERMISSIONS`) |
| `src/lib/rbac/approval.ts` | Approval authority policies + configurable limits |
| `src/lib/rbac/engine.ts` | `can()`, `scopeOf()`, `authorize()`, `matchesScope()`, customer features (AMC/NRI) |
| `src/lib/rbac/next-action.ts` | `TRANSITION_PERMISSION`, `getNextAction()`, customer-facing vocabulary |
| `src/lib/rbac/workspaces.ts` | One workspace per role: home, queue, layout, nav, `routeAllowed()` |
| `src/lib/rbac/deep-links.ts` | Notification deep links per role/event |
| `src/lib/server/authz.ts` | `requirePermission()`, `authorizeJob()`, `jobWhereFor()`, `requireApproval()` |
| `src/lib/server/audit.ts` | Append-only audit log (user, role, action, resource, job, states, reason, IP/UA) |

Nothing branches on a role name. UI and API call the same pure functions, so a hidden button is never the only guard.

---

## 2. Roles

| Role | Purpose | Workspace (home) | Layout |
|---|---|---|---|
| `super_admin` | Complete control | **Business Overview** `/` | desk |
| `ops_manager` | Run daily operations | **Operations** `/operations` | desk |
| `scheduler` | Appointments, calendar, assignments | **Schedule** `/schedule` | desk |
| `field_manager` | Lead the on-site team | **My Jobs** `/my-jobs` | mobile |
| `field_staff` | Execute assigned tasks | **My Tasks** `/my-tasks` | mobile |
| `qc_inspector` | Independent quality verification | **Quality Queue** `/quality-queue` | desk |
| `accounts` | Billing & payments | **Finance** `/finance` | desk |
| `referral_partner` | Generate & track referrals | **My Referrals** `/my-referrals` | portal |
| `customer` | Own services, approvals, AMC | **My Services** `/my-services` | portal |

AMC / NRI is **not** a role. `customerFeatures(contracts)` derives `{ amc, nri }` from the customer's contracts and the portal adds the maintenance section and the remote-confirmation copy. The local representative never needs to use the software.

Legacy `staff` accounts are migrated to `field_manager` (they ran the full on-site flow as lead workers).

---

## 3. Permission matrix

Scopes: **A** = ALL, **T** = TEAM, **S** = ASSIGNED, **O** = OWN, blank = NONE. Super Admin holds every permission with scope ALL.

| Module / permission | ops_manager | scheduler | field_manager | field_staff | qc_inspector | accounts | referral_partner | customer |
|---|---|---|---|---|---|---|---|---|
| customers.view / create / update | A / A / A | A / A / – | S / – / – | – | – | A / – / – | – | O / – / O |
| customers.delete | – | – | – | – | – | – | – | – |
| properties.view / create / update / delete | A / A / A / – | A / A / – / – | S | S | – | A | – | O |
| jobs.view | A (dispatch window) | A | S | S | A (money redacted) | A (billing) | O (summary) | O (customer-safe) |
| jobs.create / update / assign / reschedule / cancel / close | A | A (no close) | update: S (notes) | – | – | – | – | – |
| jobs.arrive / start / complete | – | – | S | – | – | – | – | – |
| scheduling.view / manage | A | A | – | – | – | – | – | – |
| services.view / manage | A / – | A / – | A / – | A / – | A / – | A / – | – | – |
| checklist.view / execute / manage | A / – / A | A / – / – | S / S / – | S / S / – | A / – / – | – | – | O / – / – |
| photos.view / upload / delete | A / – / – | – | S / S / O | S / S / O | A / A / – | – | – | O / – / – |
| qc.view | A (monitor) | A (status) | S (result) | – | A | A (result) | – | O (result) |
| qc.inspect / pass / rework / reinspect | – | – | – | – | A | – | – | – |
| rework.view / create / complete | A / A / – | – | S / – / S | S / – / S | A / A / – | – | – | – |
| complaints.view / create / manage | A / – / A | – | – | – | – | – | – | – / O / – |
| finance.view, invoice.*, payment.record, refund.create, expenses, quotes | – | – | – | – | – | A | – | invoice.view O, payment.make O |
| refund.approve | A | – | – | – | – | – | – | – |
| reports.view / financial | A / – | – | S / – | – | – | A / A | – | O / – |
| users.view / manage / delete | A / – / – | A / – / – | – | – | – | – | – | – |
| settings.view / manage, integrations.manage | A / – / – | – | – | – | – | – | – | – |
| audit.view | A | – | – | – | – | – | – | – |
| referrals.view / create / manage | – | – | – | – | – | A / – / – | O / O / – | – |
| commission.view / manage, payouts.view / manage | – | – | – | – | – | A | O (view) | – |
| amc.view / manage | A / A | A / – | – | – | – | A / – | – | O / – |
| customer_approval.view / request / view_result / approve | A / A / A / – | A / – / – / – | S / – / – / – | – | – / – / A / – | – | – | O / – / – / O |
| feedback.view / create / manage | A / – / A | – | S / – / – | – | A / – / – | – | – | O / O / – |
| notifications.view / send | A / A | A / A | – | – | – | A / – | – | – |
| links.manage (customer secure link) | A | A | – | – | – | – | – | – |

The authoritative table is `ROLE_PERMISSIONS` in `src/lib/rbac/permissions.ts`; `tests/rbac.test.ts` pins the separation-of-duties rules (QC never touches money, Accounts never touches QC, Scheduler never QCs or pays, Ops never manages RBAC or settings, field roles never see finance or commission).

### Scope resolution

| Scope | Resolves to |
|---|---|
| ALL | every record (Ops Manager additionally restricted by the dispatch-window *policy*) |
| BRANCH | records in the user's `branchId` (or assigned to them) |
| TEAM | records whose crew shares the user's `teamId` (or assigned to them) |
| ASSIGNED | `job.assignedManagerId === user.id` or `user.id ∈ job.assignedStaffIds` |
| OWN | `record.customerId === user.customerId`, `record.referralPartnerId === user.referralPartnerId`, or the record was created/uploaded by the user |
| NONE | denied |

Server query builders (`jobWhereFor`, `visibleJobIds`) turn the scope into Prisma filters so the database never returns rows outside the scope; `authorizeJob(jobId, permission)` does the record-level check for single writes.

---

## 4. Approval authority (§17)

| Action | Who | Where enforced |
|---|---|---|
| Refund ≤ `refundApprovalLimit` | Accounts | `POST /api/finance create-refund` → processed immediately |
| Refund > limit | Ops Manager or Super Admin | refund waits in `PENDING_APPROVAL`; `approve-refund` requires `refund.approve` **and** `requireApproval("refund.high_value")` |
| Discount > `discountApprovalLimitPercent` | Ops Manager or Super Admin | `update-invoice` + reason required |
| User deletion | Super Admin | `users.delete` + `requireApproval("users.delete")` |
| Critical configuration / role changes on admins | Super Admin | `settings.manage`, `requireApproval("settings.critical")` |
| Audit log deletion | never | no delete handler exists |
| State-machine override | Super Admin | `PATCH /api/jobs/[id]` with `override: true` + mandatory reason, audited as `JOB_STATUS_OVERRIDE` |

Limits live in System Settings (`refundApprovalLimit`, `discountApprovalLimitPercent`); the approver roles are fixed in code.

---

## 5. Contextual next action (§19 / §29)

`getNextAction(role, jobContext)` returns the ONE primary action for the role at that job state (`label`, `kind`, `target`, `hint`, `waiting`). It feeds:

- the field app sticky CTA (`FieldJobFlow`),
- every queue row (`/api/me/workspace` → `nextAction`),
- the customer portal buttons (Confirm & Start → View Progress → Review → Approve → Rate),
- and the server: `TRANSITION_PERMISSION[status]` is the permission a status change requires, validated by `validateTransition()` in `PATCH /api/jobs/[id]`.

Field Manager journey: `Scheduled → [ARRIVED] → GPS verified → waiting for customer → [START SERVICE] → [CONTINUE CHECKLIST] → [CAPTURE PHOTOS] → [COMPLETE WORK] → waiting for QC → view handover/report`. Field Staff follow the same screen but their CTA never leaves checklist / photos / rework.

QC: `Quality Queue → [INSPECT] → review checklist + before/after → [PASS] | [REWORK REQUIRED] → team fixes → [REINSPECT] → PASS`.

Accounts: `Finance → billable job → [Finalize Invoice] → [Record Payment] → paid`.

---

## 6. Workspaces (§18)

Each role has ONE home, ONE primary queue and ONE clear next action. `WORKSPACES[role].nav` is filtered through the matrix (`navFor`), the sidebar renders from it, and `routeAllowed(role, path)` is the route guard. Detail routes (`/jobs/:id`, `/quality-queue/:id`, `/my-jobs/:id`, `/my-services/:id`) are gated by permission *and* layout, so a customer can never open the desk job file even with a URL.

| Layout | Shell | Used by |
|---|---|---|
| desk | `AdminLayout` (sidebar + navbar) | admin, ops, scheduler, QC, accounts |
| mobile | `MobileLayout` (sticky header with GPS + network, sticky bottom CTA, ≥44px targets) | field manager, field staff |
| portal | `PortalLayout` (consumer typography, no internal navigation) | customer, referral partner |

Customer-facing wording never exposes internal statuses: `customerStageLabel()` maps the state machine to "Booked / Team Arrived / Service In Progress / Quality Check / Ready for Approval / Completed".

---

## 7. One link, one QR (§25 / §26)

The only token is the customer's secure job link (`/customer/job/{token}`), minted once per job. The same page changes with the state (confirm → progress → review → approve → report/feedback). The customer portal (`/my-services`) and every customer notification deep-link to that same page. Internal roles sign in; there are no manager/QC/rework/approval QRs.

---

## 8. Audit log (§27)

`recordAudit()` writes user, role, action, resource, job id, previous/new state, reason, IP and user-agent for every important action (login, job create/assign/reschedule/status, GPS bypass, QC decisions, rework, payments, refunds and their approvals, invoice finalize/update, user/customer/property/service changes, link revocation, customer confirmation/approval). `GET /api/audit` requires `audit.view`; there is no delete endpoint.

---

## 9. Security checklist (§28)

- Server-side authorization on every route through the matrix (permission + scope + record).
- Sessions: HMAC-signed httpOnly cookie carrying only the user id; role and scope attributes are re-read from the database on every request.
- Customer tokens: 256-bit random, stored hashed, revocable, optional expiry, rate-limited resolve; private photos served only through the token proxy.
- Rate limiting on login, customer link reads/writes, referral leads, photo proxy.
- Idempotency: payment reference per invoice, refund processing, customer confirm/approve, commission settlement.
- Transactions for booking creation, payments, refunds, rework completion.
- Validation with zod on every body; file validation on photo uploads; GPS geofence (`ARRIVAL_GEOFENCE_METERS`) with mandatory reason to bypass.
- Never trust the client: `CUSTOMER_VERIFIED` is reachable only via the customer's link; status changes are validated against the state machine for every role; Super Admin overrides need a reason and are audited.

---

## 10. Adding a permission or role

1. Add the permission string to `PERMISSIONS` and grant it in `ROLE_PERMISSIONS`.
2. Gate the route with `requirePermission("module.action")` (or `authorizeJob(id, "module.action")` for job records).
3. Gate the UI with `const { can } = useAuth(); can("module.action")`.
4. If it is a job transition, map it in `TRANSITION_PERMISSION` and give the role a next action.
5. Add a line to `tests/rbac.test.ts` (`npm test`).
