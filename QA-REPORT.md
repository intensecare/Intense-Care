# Intense-Care ERP — Full QA & Implementation Verification Report

**Date:** 2026-10-04 · **Env:** local dev `:3100` (Next.js 14.2.15 App Router, Prisma 7 + PostgreSQL on Neon), super_admin session
**Scope:** Full rigorous test of the web application against `Deep_Cleaning_Testing_UX_Requirements.pdf` (§1–15) + all user additions (cream `#fdfbf8` sidebar, coral `#EA506C` primary, no maroon/red chrome).

---

## VERDICT: ✅ PASS — application is release-ready. 1 defect found during QA, fixed and re-verified.

| # | Area | Result |
|---|------|--------|
| 1 | Static gate (`tsc --noEmit` + clean production build) | ✅ PASS (exit 0 both; re-run after this turn's fix: exit 0) |
| 2 | API matrix — 21 authenticated GET routes | ✅ PASS (all 200, valid payloads) |
| 3 | Unauthenticated guards (7 protected routes + invalid portal token) | ✅ PASS (401 / 404 with safe message) |
| 4 | §13 edge cases | ✅ PASS — 1 defect (overpayment) **found & fixed**; all others correct |
| 5 | Browser walkthrough — 21 pages | ✅ PASS (all render, zero unexpected console errors, zero "Application error") |
| 6 | PDF §1–15 implementation audit | ✅ PASS (details below) |
| 7 | Auth lifecycle (login → session → sign-out → 401 → re-login) | ✅ PASS live |

---

## 1. Static gate

- `npx tsc --noEmit` → **exit 0** (re-verified after the finance fix in this turn).
- `rm -rf .next && npm run build` → **exit 0**. (Next.js logs per-route "Dynamic server usage … used `cookies`" bailouts for cookie-based API routes — normal behavior, not failures.)

## 2. API matrix (session-authenticated)

All 200 with valid payloads:
`/api/auth/session` · `/api/jobs` · `/api/customers` (5) · `/api/properties` (2) · `/api/services` (2) · `/api/checklist` (30) · `/api/quality` · `/api/finance` · `/api/referrals` · `/api/settings` · `/api/users` (7) · `/api/users/staff-directory` (4) · `/api/notifications/sms` (13) · `/api/audit` (183) · `/api/sms/balance` · `/api/integrations/google` · `/api/amc` (1 contract) · `/api/jobs/[id]` · `/api/activity?jobId=…` · `/api/feedback?jobId=…` · `/api/photos?jobId=…`

## 3. Unauthenticated guards

- 7 protected routes → **401** without session (re-proven live via real sign-out: `/api/jobs` → 401).
- `/login` (logged out) → 200, renders sign-in form.
- Invalid portal token → 404 `{"success":false,"error":"This link is invalid or has expired."}` — no data leak.

## 4. §13 Edge cases — full matrix

| Edge case | Result |
|-----------|--------|
| OTP verify on non-ARRIVED job | ✅ 409 — "OTP verification applies only while the job is ARRIVED (current: COMPLETED)" |
| Admin-mirror state override (COMPLETED → IN_PROGRESS) | ✅ Works by design (supervisor override); test job **restored to COMPLETED**, verified |
| Invalid AMC create payload | ✅ 400 (zod) |
| Invalid AMC action | ✅ 400 |
| Unknown AMC visit id | ✅ 404 |
| Zero-amount payment | ✅ 400 "Invalid payment payload." |
| **Overpayment (> balance due)** | 🐞→✅ **DEFECT FOUND & FIXED** (see §5) |
| Partial payment (₹2,000 of ₹5,900) | ✅ 201; invoice UNPAID→PARTIAL; job paymentStatus PARTIAL; customer lifetimeRevenue recomputed atomically in-transaction |
| Portal token replay / multi-open | ✅ `recordSignOff` idempotent (`alreadySigned` no-op on APPROVED invite); tokens 256-bit random, stored SHA-256 hash-only, expiry enforced; GET portal is read-only |
| Referral commission double-settle | ✅ `settleCommissionForJob` idempotent — returns existing entry, cannot double-credit partner aggregates |
| Auth expiry | ✅ Real sign-out → protected API 401; re-login restores session |
| Duplicate Google Calendar events | ✅ Static: `googleEventId` stored on Job; sync is idempotent via stored id; CANCELLED → `cancelJobEvent`. Live sync untestable (no GOOGLE_* env in dev — env-gated by design) |

## 5. Defect found & fixed this QA pass

**Overpayment guard missing** — `POST /api/finance {action:"record-payment"}` accepted any amount up to 1e8 against an invoice's remaining balance. A ₹9,99,999 payment on a ₹5,900 invoice forced `amountPaid > total`, flipped the invoice PAID with untracked credit, and (recomputation-by-design) inflated the customer's `lifetimeRevenue` from the ledger.

**Fix** ([src/app/api/finance/route.ts](src/app/api/finance/route.ts)): reject `amount − balanceDue > 0.005` with 400 `Payment amount (₹… ) exceeds the outstanding balance (₹…)`. Float tolerance absorbs 2-decimal money noise.

**Verified:** live re-test → 400 with clear message; invoice untouched. Test data fully restored via ledger recompute: invoice INV-BF16C3688 = PARTIAL ₹2,000/₹3,900 (single payment `E2E-PARTIAL-QA`), job `cmutbf151000204lgc5bzu0qo` paymentStatus PARTIAL, customer lifetimeRevenue recomputed to ₹2,000.

## 6. Browser walkthrough — 21 pages (zero unexpected console errors)

All render with real data, no "Application error" boundary, no unexpected console errors (only dev-HMR "Fast Refresh" lines from this QA's own route edit + one deliberate 401 probe):

`/` (Operations Dispatch & Overview: 9 jobs today, ₹55,100 collected, ₹1,06,560 receivables) · `/jobs` (Jobs Register, 21 jobs, filters) · `/jobs/cmusledf7000004kzshujnsvz` (COMPLETED) · `/jobs/cmutbf151000204lgc5bzu0qo` (CUSTOMER_VERIFIED) · `/calendar` · `/customers` · `/customers/[id]` (full file: tabs, stats, referral attribution, support issues) · `/properties` (2) · `/services` · `/quotations` (1 open) · `/dispatcher` (tomorrow's queue) · `/field` · `/quality` · `/finance` (Invoices 21 / Payments 7 / Quotes 7 / Expenses 1) · `/referrals` · `/reports` · `/notifications` (SMS gateway logs, masked) · `/users` · `/settings` · `/amc` (AMC-NO28B9607 + 12 visits) · `/portal/[token]` (live minted token) · `/login` (logged out)

## 7. PDF §1–15 implementation audit vs live app

| § | Requirement | Evidence | Result |
|---|-------------|----------|--------|
| 1 | Google Calendar per-job events; Connected/Not Connected in Settings; review CTA only after approval | Settings card "Google Calendar — Not Connected" + env setup hint; env-gated sync code idempotent via `googleEventId` | ✅ (live sync env-gated) |
| 2 | AMC module: contracts, auto visits, NRI visit report, dashboard | `/amc` live: contract AMC-NO28B9607, 12 visits, visit 1 COMPLETED qc=92 nriApproved, visit 2 RESCHEDULED→2026-11-15; full lifecycle exercised earlier this session | ✅ |
| 3 | Curved service-journey timeline | Job page "Service Journey" — 11 stages incl. "Customer OTP Verified 09:58 AM" timestamps | ✅ |
| 4 | Job page = Next-Action card + 6 tabs | "CURRENT STATUS / WHAT'S NEXT" engine + tabs Job Overview / Work Details / Quality / Customer / Billing / Activity (ARIA tablist) | ✅ |
| 5 | One primary action per state | CUSTOMER_VERIFIED→"Start Cleaning Job"; field ARRIVED→"Start Job & Begin Cleaning"; COMPLETED→"Send Feedback & Google Review Link" | ✅ |
| 6 | Handover chips + share + portal landing | Job page chips (Not Opened/Opened/Approval Pending/Approved/Issue Raised) + Generate Secure Link; **live token minted** → portal landing verified: journey strip, Visit Report for remote owners (team names server-resolved), Invoice & Payment line, Before↔After gallery, checklist, sign-off form | ✅ |
| 7 | Canonical area grouping + Before↔After slider + lazy loading | Gallery "Grouped by room · drag the slider"; canonical areas in checklist + portal | ✅ |
| 8 | Per-area QC checklist grid | Quality tab per-area rows (Kitchen/Bedroom, Mandatory/Critical, Mark Done/Skip); QC queue page | ✅ |
| 9 | Human-readable finance line | **Both variants live:** UNPAID "Total ₹5,900·Paid ₹0·Balance ₹5,900·Payment Pending" and PARTIAL "Paid ₹2,000·Balance ₹3,900·Status: Partially Paid" + history "₹2,000 · UPI · E2E-PARTIAL-QA" | ✅ |
| 10 | Field mobile: light header, sticky bottom primary action, bottom nav | Computed styles: sticky action `fixed bottom-16` "Start Job & Begin Cleaning"; nav `fixed bottom-0` white/95 "Job | Checklist | Photos"; body `rgb(253,251,248)` | ✅ |
| 11 | Polish | Colors verified earlier this session (sidebar=body cream, coral buttons, 0 maroon elements); ErrorBoundary in place | ✅ |
| 12–14 | Cross-cutting UX/data requirements (job lifecycle semantics, portal payload shape, notifications) | Covered by earlier full audit + this pass's API matrix, job-page, and portal-payload checks — no regressions | ✅ |
| 13 | Edge cases | See §4 above | ✅ |
| 15 | Priority order | All P0 flows (dispatch → OTP → execution → QC → handover → payment) exercised end-to-end with real data | ✅ |

## 8. Observed transient (not a defect)

Two 500s (21.5s each) on the *first* payment POST + following GET — Neon cold-start (`Invalid prisma.user.findUnique() invocation` at connection init during compute wake-up). Correctly caught by `errorResponse`, logged as `finance.post.route_error`, no data written; immediate retry succeeded (201). Recommendation (optional hardening): connection warm-up ping or Prisma `maxWait` tuning for serverless DB cold starts.

## 9. Limitations (environment-gated, by design)

- **Google Calendar live sync** — no `GOOGLE_*` env vars locally; integration card correctly shows "Not Connected". Code verified idempotent.
- **SMS dispatch** — provider send path beyond the balance check not exercised (2Factor logs show 13 masked dispatches from earlier flows).
- **Screenshots** — headless capture produced no frames; all visual checks done via computed styles / accessibility tree instead.
- **CANCELLED-job transition edge case** — no CANCELLED job in test data; calendar-cancel path (`cancelJobEvent`) verified statically.

## 10. Test data touched (all designated TEST data, left in coherent state)

- Invoice `INV-BF16C3688` (job `cmutbf151000204lgc5bzu0qo`, customer Prajwal Shetty): PARTIAL — paid ₹2,000 (UPI, ref `E2E-PARTIAL-QA`), due ₹3,900. Overpayment probe deleted, ledger-recomputed.
- Job `cmusledf7000004kzshujnsvz`: restored to COMPLETED; one new completion invite minted (used for live portal verification).
- Cleanup script kept at [`.e2e-tmp/cleanup-overpay.mjs`](.e2e-tmp/cleanup-overpay.mjs).

## 11. Files changed by QA

- [src/app/api/finance/route.ts](src/app/api/finance/route.ts) — overpayment guard (the only production code change; verified live + `tsc` exit 0).

**Everything remains UNCOMMITTED — no commits, pushes, or deploys were made. awaiting your confirmation.**
