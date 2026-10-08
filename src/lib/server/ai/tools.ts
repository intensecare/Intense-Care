import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/prisma";
import { jobWhereFor, authorizeJob, HttpError } from "@/lib/server/authz";
import { invoiceWhereFor, istDayStart } from "@/lib/server/invoices";
import { getSystemSettings, resolveVisibility } from "@/lib/server/settings";
import type { SessionUser } from "@/lib/server/session";
import { can, scopeOf, type Permission } from "@/lib/rbac";

/**
 * INTENSE AI — the ONLY way the assistant can read business data.
 *
 * Security model (never relies on the prompt):
 *   1. A tool is offered to the model only if the signed-in user holds the
 *      tool's permission (`toolsFor`).
 *   2. Every call is re-checked before it runs (`runTool`) — a model asking
 *      for a tool it was not offered gets "not permitted".
 *   3. Every query is scoped with the same helpers the normal APIs use
 *      (jobWhereFor / authorizeJob / invoiceWhereFor), and money fields are
 *      only included for users with finance.view. So the assistant can never
 *      see more than the user could see in the app.
 * Customers (no login) get one tool, scoped to the job of their QR token.
 */

export type AiPrincipal =
  | { kind: "user"; user: SessionUser }
  | { kind: "customer"; jobId: string; customerName: string };

type Args = Record<string, unknown>;
type Schema = { type: string; description?: string; enum?: string[]; properties?: Record<string, Schema>; items?: Schema; required?: string[] };

interface AiTool {
  name: string;
  description: string;
  parameters?: Schema;
  /** What the user sees while it runs, e.g. "Checking revenue". */
  status: string;
  permission: Permission | "customer";
  run: (p: AiPrincipal, args: Args) => Promise<unknown>;
}

/* ------------------------------------------------------------- helpers */

const DONE = ["COMPLETED", "FEEDBACK_REQUESTED", "CLOSED"];
const REWORK = ["REWORK_REQUIRED", "REWORK_ASSIGNED", "REWORK_IN_PROGRESS", "REWORK_COMPLETED", "REINSPECTION"];
const QC_WAIT = ["WORK_COMPLETED", "QUALITY_CHECK", "REWORK_COMPLETED", "REINSPECTION"];
const ACTIVE = ["ARRIVED", "CUSTOMER_VERIFIED", "IN_PROGRESS"];
const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const avg = (xs: number[]) => (xs.length ? r2(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const str = (v: unknown, max = 80) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown, def: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
};

function userOf(p: AiPrincipal): SessionUser {
  if (p.kind !== "user") throw new HttpError(403, "Not permitted.");
  return p.user;
}
const money = (u: SessionUser) => can(u, "finance.view");

/** Today in India, YYYY-MM-DD. */
export function istToday(): string {
  return new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
}
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export interface Range {
  from: string; // inclusive YYYY-MM-DD
  to: string; // inclusive YYYY-MM-DD
  label: string;
}

const PERIODS = ["today", "yesterday", "this_week", "last_week", "this_month", "last_month", "last_30_days", "this_quarter", "this_year", "all_time"];

/** Turns a period word (or from/to dates) into an IST date range. */
export function resolveRange(args: Args, fallback = "this_month"): Range {
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const from = str(args.from, 10);
  const to = str(args.to, 10);
  if (DATE.test(from) || DATE.test(to)) {
    const f = DATE.test(from) ? from : "2000-01-01";
    const t = DATE.test(to) ? to : istToday();
    return { from: f, to: t, label: `${f} to ${t}` };
  }
  const today = istToday();
  const [y, m] = today.split("-").map(Number);
  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  const monthStart = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, "0")}-01`;
  const period = PERIODS.includes(str(args.period, 20)) ? str(args.period, 20) : fallback;
  switch (period) {
    case "today":
      return { from: today, to: today, label: `today (${today})` };
    case "yesterday": {
      const d = addDays(today, -1);
      return { from: d, to: d, label: `yesterday (${d})` };
    }
    case "this_week":
      return { from: addDays(today, -dow), to: today, label: "this week" };
    case "last_week":
      return { from: addDays(today, -dow - 7), to: addDays(today, -dow - 1), label: "last week" };
    case "last_month": {
      const pm = m === 1 ? 12 : m - 1;
      const py = m === 1 ? y - 1 : y;
      return { from: monthStart(py, pm), to: addDays(monthStart(y, m), -1), label: `last month (${monthStart(py, pm).slice(0, 7)})` };
    }
    case "last_30_days":
      return { from: addDays(today, -29), to: today, label: "the last 30 days" };
    case "this_quarter": {
      const qm = Math.floor((m - 1) / 3) * 3 + 1;
      return { from: monthStart(y, qm), to: today, label: "this quarter" };
    }
    case "this_year":
      return { from: `${y}-01-01`, to: today, label: `this year (${y})` };
    case "all_time":
      return { from: "2000-01-01", to: today, label: "all time" };
    default:
      return { from: monthStart(y, m), to: today, label: `this month (${today.slice(0, 7)})` };
  }
}

/** The same-length period immediately before `r` (for comparisons). */
export function previousRange(r: Range): Range {
  const days = Math.round((Date.parse(r.to) - Date.parse(r.from)) / 86400000) + 1;
  // Calendar months compare with the previous calendar month.
  if (r.from.endsWith("-01") && r.label.startsWith("this month")) {
    const [y, m] = r.from.split("-").map(Number);
    const pm = m === 1 ? 12 : m - 1;
    const py = m === 1 ? y - 1 : y;
    const from = `${py}-${String(pm).padStart(2, "0")}-01`;
    const sameDay = addDays(from, days - 1);
    return { from, to: sameDay < r.from ? sameDay : addDays(r.from, -1), label: "the same days of last month" };
  }
  return { from: addDays(r.from, -days), to: addDays(r.from, -1), label: "the previous period" };
}

const dt = (r: Range) => ({ gte: istDayStart(r.from), lt: new Date(istDayStart(r.to).getTime() + 86400000) });

async function jobScope(u: SessionUser, permission: Permission): Promise<Prisma.JobWhereInput> {
  const w = await jobWhereFor(u, permission);
  if (!w) throw new HttpError(403, "Not permitted.");
  return w;
}

async function names(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const list = Array.from(new Set(ids.filter((x): x is string => !!x)));
  if (!list.length) return new Map();
  const rows = await prisma.user.findMany({ where: { id: { in: list } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
}

const PERIOD_PARAM: Schema = {
  type: "STRING",
  description: "Time period. One of: today, yesterday, this_week, last_week, this_month, last_month, last_30_days, this_quarter, this_year, all_time. Default this_month.",
  enum: PERIODS,
};
const DATE_PARAMS: Record<string, Schema> = {
  from: { type: "STRING", description: "Optional start date YYYY-MM-DD (overrides period)." },
  to: { type: "STRING", description: "Optional end date YYYY-MM-DD (overrides period)." },
};
const COMPARE: Schema = { type: "BOOLEAN", description: "Also return the previous period for comparison." };

/* ----------------------------------------------------------- core metrics */

async function businessMetrics(u: SessionUser, r: Range) {
  const scope = await jobScope(u, "jobs.view");
  const jobs = await prisma.job.findMany({
    where: { AND: [scope, { scheduledDate: { gte: r.from, lte: r.to } }] },
    select: { id: true, status: true, customerId: true, customerFeedbackRating: true },
  });
  const ids = jobs.map((j) => j.id);
  const checks = await prisma.qualityCheck.findMany({ where: { jobId: { in: ids } }, select: { jobId: true, decision: true, createdAt: true }, orderBy: { createdAt: "asc" } });
  const firstByJob = new Map<string, string>();
  for (const c of checks) if (!firstByJob.has(c.jobId)) firstByJob.set(c.jobId, c.decision);
  const firstPass = Array.from(firstByJob.values()).filter((d) => d === "PASS").length;
  const ratings = jobs.map((j) => j.customerFeedbackRating).filter((x): x is number => typeof x === "number");
  const customerIds = Array.from(new Set(jobs.map((j) => j.customerId)));
  const newCustomers = customerIds.length
    ? await prisma.customer.count({ where: { id: { in: customerIds }, createdAt: dt(r) } })
    : 0;
  const repeatCustomers = customerIds.length
    ? (await prisma.job.groupBy({ by: ["customerId"], where: { customerId: { in: customerIds }, status: { not: "CANCELLED" } }, _count: { _all: true } })).filter((g) => g._count._all > 1).length
    : 0;
  const complaints = can(u, "complaints.view") ? await prisma.complaint.findMany({ where: { jobId: { in: ids } }, select: { status: true } }) : null;
  const byStatus: Record<string, number> = {};
  for (const j of jobs) byStatus[j.status] = (byStatus[j.status] ?? 0) + 1;

  const out: Record<string, unknown> = {
    period: r.label,
    jobs: {
      booked: jobs.filter((j) => j.status !== "CANCELLED").length,
      completed: jobs.filter((j) => DONE.includes(j.status)).length,
      inProgress: jobs.filter((j) => ACTIVE.includes(j.status)).length,
      waitingForQc: jobs.filter((j) => QC_WAIT.includes(j.status)).length,
      inRework: jobs.filter((j) => REWORK.includes(j.status) && !QC_WAIT.includes(j.status)).length,
      awaitingCustomerApproval: jobs.filter((j) => ["PASS", "CUSTOMER_APPROVAL"].includes(j.status)).length,
      cancelled: byStatus.CANCELLED ?? 0,
      byStatus,
    },
    quality: {
      jobsInspected: firstByJob.size,
      firstTimePassRatePercent: pct(firstPass, firstByJob.size),
      reworkRounds: checks.filter((c) => c.decision !== "PASS").length,
    },
    customers: { served: customerIds.length, new: newCustomers, repeat: repeatCustomers, repeatRatePercent: pct(repeatCustomers, customerIds.length) },
    satisfaction: {
      averageRating: avg(ratings),
      ratings: ratings.length,
      ...(complaints ? { complaints: complaints.length, openComplaints: complaints.filter((c) => !["resolved", "closed"].includes(c.status)).length } : {}),
    },
  };
  if (money(u)) {
    const inv = await prisma.invoice.findMany({ where: { issuedAt: dt(r), status: { not: "CANCELLED" } }, select: { total: true, tax: true, balanceDue: true } });
    const paid = await prisma.payment.aggregate({ where: { paidAt: dt(r) }, _sum: { amount: true } });
    out.revenue = {
      billed: r2(inv.reduce((a, i) => a + i.total, 0)),
      gstCharged: r2(inv.reduce((a, i) => a + i.tax, 0)),
      collected: r2(paid._sum.amount ?? 0),
      stillToCollectOnTheseInvoices: r2(inv.reduce((a, i) => a + i.balanceDue, 0)),
      currency: "INR",
    };
  }
  return out;
}

async function jobRows(u: SessionUser, where: Prisma.JobWhereInput, limit: number) {
  const rows = await prisma.job.findMany({
    where,
    orderBy: [{ scheduledDate: "desc" }, { scheduledTimeSlot: "asc" }],
    take: limit,
    select: {
      jobSerial: true, scheduledDate: true, scheduledTimeSlot: true, status: true, amount: true, startedAt: true, completedAt: true,
      assignedManagerId: true, assignedStaffIds: true, customerFeedbackRating: true,
      service: { select: { name: true, estimatedDurationHours: true } },
      customer: { select: { name: true } },
      property: { select: { city: true, title: true } },
      checklistItems: { select: { status: true } },
    },
  });
  const nm = await names(rows.flatMap((j) => [j.assignedManagerId, ...j.assignedStaffIds]));
  return rows.map((j) => {
    const hours = j.startedAt && j.completedAt ? r2((j.completedAt.getTime() - j.startedAt.getTime()) / 3600000) : null;
    const expected = j.service.estimatedDurationHours;
    return {
      jobId: j.jobSerial,
      date: j.scheduledDate,
      timeWindow: j.scheduledTimeSlot,
      status: j.status,
      service: j.service.name,
      customer: j.customer.name,
      property: j.property.title,
      fieldManager: (j.assignedManagerId && nm.get(j.assignedManagerId)) || j.assignedStaffIds.map((id) => nm.get(id)).filter(Boolean)[0] || null,
      checklist: `${j.checklistItems.filter((c) => c.status === "completed" || c.status === "skipped").length}/${j.checklistItems.length}`,
      workHours: hours,
      expectedHours: expected,
      overranBy: hours !== null && hours > expected ? r2(hours - expected) : 0,
      customerRating: j.customerFeedbackRating ?? null,
      ...(money(u) ? { amount: j.amount } : {}),
    };
  });
}

/* ------------------------------------------------------------------ tools */

const TOOLS: AiTool[] = [
  {
    name: "get_business_metrics",
    status: "Reading business performance",
    permission: "dashboard.view",
    description: "Headline business numbers for a period: jobs by stage, QC first-time pass rate, rework rounds, customers (new/repeat), ratings, complaints and (if allowed) revenue billed/collected. Use for summaries, 'how are we doing', daily/weekly/monthly reports and comparisons.",
    parameters: { type: "OBJECT", properties: { period: PERIOD_PARAM, ...DATE_PARAMS, compare_previous: COMPARE } },
    run: async (p, a) => {
      const u = userOf(p);
      const r = resolveRange(a);
      const current = await businessMetrics(u, r);
      return a.compare_previous ? { current, previous: await businessMetrics(u, previousRange(r)) } : current;
    },
  },
  {
    name: "get_jobs",
    status: "Looking at jobs",
    permission: "jobs.view",
    description: "List jobs the user may see, newest first, with status, service, customer, Field Manager, checklist progress, actual vs expected work hours (overranBy) and rating. Filters: period, status group, search text, Field Manager name, overran_only.",
    parameters: {
      type: "OBJECT",
      properties: {
        period: PERIOD_PARAM,
        ...DATE_PARAMS,
        status: { type: "STRING", description: "open | today | in_progress | qc_pending | rework | awaiting_approval | completed | cancelled | any", enum: ["open", "in_progress", "qc_pending", "rework", "awaiting_approval", "completed", "cancelled", "any"] },
        search: { type: "STRING", description: "Job ID, customer or service name contains this text." },
        field_manager: { type: "STRING", description: "Field Manager name contains this text." },
        overran_only: { type: "BOOLEAN", description: "Only jobs whose work took longer than the service's expected hours." },
        limit: { type: "INTEGER", description: "Max rows (default 25, max 50)." },
      },
    },
    run: async (p, a) => {
      const u = userOf(p);
      const r = resolveRange(a, "this_month");
      const st = str(a.status, 20);
      const statusWhere: Prisma.JobWhereInput =
        st === "open" ? { status: { notIn: [...DONE, "CANCELLED"] } }
        : st === "in_progress" ? { status: { in: ACTIVE } }
        : st === "qc_pending" ? { status: { in: QC_WAIT } }
        : st === "rework" ? { status: { in: REWORK } }
        : st === "awaiting_approval" ? { status: { in: ["PASS", "CUSTOMER_APPROVAL"] } }
        : st === "completed" ? { status: { in: DONE } }
        : st === "cancelled" ? { status: "CANCELLED" }
        : {};
      const q = str(a.search, 60);
      const fm = str(a.field_manager, 60);
      let fmIds: string[] | null = null;
      if (fm) fmIds = (await prisma.user.findMany({ where: { name: { contains: fm, mode: "insensitive" } }, select: { id: true } })).map((x) => x.id);
      const where: Prisma.JobWhereInput = {
        AND: [
          await jobScope(u, "jobs.view"),
          { scheduledDate: { gte: r.from, lte: r.to } },
          statusWhere,
          q ? { OR: [{ jobSerial: { contains: q, mode: "insensitive" } }, { customer: { name: { contains: q, mode: "insensitive" } } }, { service: { name: { contains: q, mode: "insensitive" } } }] } : {},
          fmIds ? { OR: [{ assignedManagerId: { in: fmIds } }, { assignedStaffIds: { hasSome: fmIds } }] } : {},
        ],
      };
      const limit = num(a.limit, 25, 1, 50);
      let rows = await jobRows(u, where, a.overran_only ? 300 : limit);
      if (a.overran_only) rows = rows.filter((j) => j.overranBy > 0).sort((x, y) => y.overranBy - x.overranBy).slice(0, limit);
      return { period: r.label, total: await prisma.job.count({ where }), shown: rows.length, jobs: rows };
    },
  },
  {
    name: "get_job_details",
    status: "Opening the job",
    permission: "jobs.view",
    description: "Full detail of ONE job by its Job ID (e.g. RAHUL-SHARMA-08102026-001): status, timeline, checklist by area, every QC round with issues, rework items, rating and (if allowed) invoice.",
    parameters: { type: "OBJECT", properties: { job_id: { type: "STRING", description: "The Job ID." } }, required: ["job_id"] },
    run: async (p, a) => {
      const u = userOf(p);
      const key = str(a.job_id, 80);
      const found = await prisma.job.findFirst({ where: { OR: [{ jobSerial: { equals: key, mode: "insensitive" } }, { id: key }] }, select: { id: true } });
      if (!found) return { error: `No job found with ID ${key}.` };
      await authorizeJob(found.id, "jobs.view"); // same check as opening the job page
      const j = await prisma.job.findUnique({
        where: { id: found.id },
        include: {
          service: { select: { name: true, estimatedDurationHours: true } },
          customer: { select: { name: true } },
          property: { select: { title: true, address: true, city: true } },
          checklistItems: { select: { area: true, task: true, status: true, critical: true } },
          qualityChecks: { select: { decision: true, score: true, createdAt: true, inspectorId: true, issues: { select: { area: true, itemDescription: true, severity: true, status: true } } }, orderBy: { createdAt: "asc" } },
          reworkTasks: { select: { status: true, createdAt: true, completedAt: true } },
          invoices: { select: { invoiceNumber: true, invoiceType: true, total: true, balanceDue: true, status: true } },
        },
      });
      if (!j) return { error: "Job not found." };
      const nm = await names([j.assignedManagerId, ...j.assignedStaffIds, ...j.qualityChecks.map((q) => q.inspectorId)]);
      const areas: Record<string, { done: number; total: number }> = {};
      for (const c of j.checklistItems) {
        areas[c.area] ??= { done: 0, total: 0 };
        areas[c.area].total++;
        if (c.status === "completed" || c.status === "skipped") areas[c.area].done++;
      }
      return {
        jobId: j.jobSerial,
        status: j.status,
        service: j.service.name,
        customer: j.customer.name,
        property: `${j.property.title}, ${j.property.city ?? ""}`.trim(),
        date: j.scheduledDate,
        timeWindow: j.scheduledTimeSlot,
        fieldManager: (j.assignedManagerId && nm.get(j.assignedManagerId)) || null,
        timeline: { arrivedAt: j.arrivedAt, customerConfirmedAt: j.customerConfirmedAt, startedAt: j.startedAt, completedAt: j.completedAt, approvedAt: j.approvedAt },
        workHours: j.startedAt && j.completedAt ? r2((j.completedAt.getTime() - j.startedAt.getTime()) / 3600000) : null,
        expectedHours: j.service.estimatedDurationHours,
        checklistByArea: areas,
        qcRounds: j.qualityChecks.map((q, i) => ({ round: i + 1, decision: q.decision, score: q.score, date: q.createdAt, inspector: nm.get(q.inspectorId) ?? "QC", issues: q.issues })),
        reworkItems: { total: j.reworkTasks.length, open: j.reworkTasks.filter((t) => t.status !== "completed").length },
        customerRating: j.customerFeedbackRating ?? null,
        ...(money(u) ? { amount: j.amount, invoices: j.invoices } : {}),
      };
    },
  },
  {
    name: "get_customers",
    status: "Looking at customers",
    permission: "customers.view",
    description: "Customers the user may see with bookings, first/last job date, days since last job, average rating and complaints. segment: all | not_rebooked (only one job and none for `inactive_days`) | top (most bookings) | new (first job in period) | inactive (no job for inactive_days).",
    parameters: {
      type: "OBJECT",
      properties: {
        segment: { type: "STRING", enum: ["all", "not_rebooked", "top", "new", "inactive"] },
        inactive_days: { type: "INTEGER", description: "For not_rebooked / inactive (default 30)." },
        period: PERIOD_PARAM,
        limit: { type: "INTEGER", description: "Max rows (default 25, max 50)." },
      },
    },
    run: async (p, a) => {
      const u = userOf(p);
      const scope = scopeOf(u.role, "customers.view");
      const jobWhere = await jobScope(u, "jobs.view");
      const jobs = await prisma.job.findMany({
        where: { AND: [jobWhere, { status: { not: "CANCELLED" } }] },
        select: { customerId: true, scheduledDate: true, customerFeedbackRating: true, amount: true },
      });
      const byC = new Map<string, { n: number; first: string; last: string; ratings: number[]; value: number }>();
      for (const j of jobs) {
        const e = byC.get(j.customerId) ?? { n: 0, first: j.scheduledDate, last: j.scheduledDate, ratings: [], value: 0 };
        e.n++;
        if (j.scheduledDate < e.first) e.first = j.scheduledDate;
        if (j.scheduledDate > e.last) e.last = j.scheduledDate;
        if (typeof j.customerFeedbackRating === "number") e.ratings.push(j.customerFeedbackRating);
        e.value += j.amount;
        byC.set(j.customerId, e);
      }
      const custs = await prisma.customer.findMany({ where: { id: { in: Array.from(byC.keys()) } }, select: { id: true, name: true, phone: true, createdAt: true } });
      const complaintCounts = can(u, "complaints.view")
        ? new Map((await prisma.complaint.groupBy({ by: ["customerId"], _count: { _all: true } })).map((g) => [g.customerId, g._count._all]))
        : null;
      const today = istToday();
      const days = num(a.inactive_days, 30, 1, 3650);
      const r = resolveRange(a, "this_month");
      let rows = custs.map((c) => {
        const e = byC.get(c.id)!;
        return {
          customer: c.name,
          ...(scope === "ALL" ? { phone: c.phone } : {}),
          bookings: e.n,
          firstJob: e.first,
          lastJob: e.last,
          daysSinceLastJob: Math.max(0, Math.round((Date.parse(today) - Date.parse(e.last)) / 86400000)),
          averageRating: avg(e.ratings),
          ...(complaintCounts ? { complaints: complaintCounts.get(c.id) ?? 0 } : {}),
          ...(money(u) ? { totalBookedValue: r2(e.value) } : {}),
        };
      });
      const seg = str(a.segment, 20) || "all";
      if (seg === "not_rebooked") rows = rows.filter((c) => c.bookings === 1 && c.daysSinceLastJob >= days);
      if (seg === "inactive") rows = rows.filter((c) => c.daysSinceLastJob >= days);
      if (seg === "new") rows = rows.filter((c) => c.firstJob >= r.from && c.firstJob <= r.to);
      rows.sort((x, y) => (seg === "top" ? y.bookings - x.bookings : x.lastJob < y.lastJob ? 1 : -1));
      return { segment: seg, totalCustomers: custs.length, matching: rows.length, customers: rows.slice(0, num(a.limit, 25, 1, 50)) };
    },
  },
  {
    name: "get_revenue_summary",
    status: "Checking revenue",
    permission: "finance.view",
    description: "Money for a period: billed (invoice totals), taxable, GST, collected (payments), outstanding, split by service and by invoice type (GST / Non-GST). Optional comparison with the previous period.",
    parameters: { type: "OBJECT", properties: { period: PERIOD_PARAM, ...DATE_PARAMS, compare_previous: COMPARE } },
    run: async (_p, a) => {
      const sum = async (r: Range) => {
        const inv = await prisma.invoice.findMany({
          where: { issuedAt: dt(r), status: { not: "CANCELLED" } },
          select: { invoiceType: true, subtotal: true, discount: true, tax: true, total: true, balanceDue: true, job: { select: { service: { select: { name: true } } } } },
        });
        const paid = await prisma.payment.aggregate({ where: { paidAt: dt(r) }, _sum: { amount: true }, _count: { _all: true } });
        const byService: Record<string, { invoices: number; billed: number }> = {};
        const byType: Record<string, { invoices: number; billed: number; gst: number }> = {};
        for (const i of inv) {
          const s = i.job.service.name;
          byService[s] ??= { invoices: 0, billed: 0 };
          byService[s].invoices++;
          byService[s].billed = r2(byService[s].billed + i.total);
          byType[i.invoiceType] ??= { invoices: 0, billed: 0, gst: 0 };
          byType[i.invoiceType].invoices++;
          byType[i.invoiceType].billed = r2(byType[i.invoiceType].billed + i.total);
          byType[i.invoiceType].gst = r2(byType[i.invoiceType].gst + i.tax);
        }
        return {
          period: r.label,
          invoices: inv.length,
          billed: r2(inv.reduce((x, i) => x + i.total, 0)),
          taxable: r2(inv.reduce((x, i) => x + i.subtotal - i.discount, 0)),
          gst: r2(inv.reduce((x, i) => x + i.tax, 0)),
          collected: r2(paid._sum.amount ?? 0),
          payments: paid._count._all,
          outstandingOnTheseInvoices: r2(inv.reduce((x, i) => x + i.balanceDue, 0)),
          byService,
          byInvoiceType: byType,
          currency: "INR",
        };
      };
      const r = resolveRange(a);
      const current = await sum(r);
      return a.compare_previous ? { current, previous: await sum(previousRange(r)) } : current;
    },
  },
  {
    name: "get_invoices",
    status: "Looking at invoices",
    permission: "gst.view",
    description: "List invoices with number, type (GST / NON_GST), date, customer, taxable value, CGST/SGST/IGST, total. Filters: type, period, customer name, limit. Users who may only see GST invoices always receive GST invoices only.",
    parameters: {
      type: "OBJECT",
      properties: {
        type: { type: "STRING", enum: ["ALL", "GST", "NON_GST"] },
        period: PERIOD_PARAM,
        ...DATE_PARAMS,
        customer: { type: "STRING", description: "Customer name contains this text." },
        limit: { type: "INTEGER", description: "Max rows (default 25, max 50)." },
      },
    },
    run: async (p, a) => {
      const u = userOf(p);
      const scope = invoiceWhereFor(u);
      if (!scope) return { error: "Not permitted." };
      const type = str(a.type, 10).toUpperCase() || "ALL";
      if (type === "NON_GST" && scope.invoiceType === "GST") return { error: "Not permitted: this user can only view GST invoices." };
      const r = resolveRange(a, "this_month");
      const cust = str(a.customer, 60);
      const where: Prisma.InvoiceWhereInput = {
        AND: [scope, type === "GST" || type === "NON_GST" ? { invoiceType: type } : {}, { issuedAt: dt(r) }, cust ? { job: { customer: { name: { contains: cust, mode: "insensitive" } } } } : {}],
      };
      const full = money(u);
      const rows = await prisma.invoice.findMany({ where, orderBy: { issuedAt: "desc" }, take: num(a.limit, 25, 1, 50), include: { job: { select: { jobSerial: true, customer: { select: { name: true } } } } } });
      const agg = await prisma.invoice.aggregate({ where, _sum: { total: true, tax: true, cgst: true, sgst: true, igst: true }, _count: { _all: true } });
      return {
        period: r.label,
        count: agg._count._all,
        totals: { grandTotal: r2(agg._sum.total ?? 0), gst: r2(agg._sum.tax ?? 0), cgst: r2(agg._sum.cgst ?? 0), sgst: r2(agg._sum.sgst ?? 0), igst: r2(agg._sum.igst ?? 0) },
        invoices: rows.map((i) => ({
          invoiceNumber: i.invoiceNumber,
          type: i.invoiceType,
          date: i.issuedAt.toISOString().slice(0, 10),
          customer: i.job.customer.name,
          jobId: i.job.jobSerial,
          taxable: r2(i.subtotal - i.discount),
          ...(i.invoiceType === "GST" ? { gstRate: i.gstRate, cgst: i.cgst, sgst: i.sgst, igst: i.igst, totalGst: i.tax, customerGstin: i.customerGstin ?? "Unregistered" } : {}),
          grandTotal: i.total,
          ...(full ? { paid: i.amountPaid, balanceDue: i.balanceDue, status: i.status } : {}),
        })),
      };
    },
  },
  {
    name: "get_gst_summary",
    status: "Summarising GST",
    permission: "gst.reports",
    description: "GST summary from GST invoices only (never Non-GST): invoice count, taxable value, CGST, SGST, IGST, total GST, grand total — overall and month by month. Optional comparison with the previous period.",
    parameters: { type: "OBJECT", properties: { period: PERIOD_PARAM, ...DATE_PARAMS, compare_previous: COMPARE } },
    run: async (_p, a) => {
      const sum = async (r: Range) => {
        const rows = await prisma.invoice.findMany({
          where: { invoiceType: "GST", status: { not: "CANCELLED" }, issuedAt: dt(r) },
          select: { issuedAt: true, subtotal: true, discount: true, cgst: true, sgst: true, igst: true, tax: true, total: true },
        });
        const months: Record<string, { invoices: number; taxable: number; cgst: number; sgst: number; igst: number; totalGst: number; grandTotal: number }> = {};
        const t = { invoices: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, totalGst: 0, grandTotal: 0 };
        for (const i of rows) {
          const m = new Date(i.issuedAt.getTime() + 330 * 60000).toISOString().slice(0, 7);
          months[m] ??= { invoices: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, totalGst: 0, grandTotal: 0 };
          for (const b of [months[m], t]) {
            b.invoices++;
            b.taxable = r2(b.taxable + i.subtotal - i.discount);
            b.cgst = r2(b.cgst + i.cgst);
            b.sgst = r2(b.sgst + i.sgst);
            b.igst = r2(b.igst + i.igst);
            b.totalGst = r2(b.totalGst + i.tax);
            b.grandTotal = r2(b.grandTotal + i.total);
          }
        }
        return { period: r.label, totals: t, byMonth: months };
      };
      const r = resolveRange(a);
      const current = await sum(r);
      return a.compare_previous ? { current, previous: await sum(previousRange(r)) } : current;
    },
  },
  {
    name: "get_qc_report",
    status: "Analysing quality checks",
    permission: "qc.view",
    description: "Quality-check analysis for a period over the jobs the user may see: inspections, pass vs rework decisions, first-time pass rate, average score, issues by area, by severity and by service, most common issue descriptions, results per Field Manager and per inspector.",
    parameters: { type: "OBJECT", properties: { period: PERIOD_PARAM, ...DATE_PARAMS, compare_previous: COMPARE } },
    run: async (p, a) => {
      const u = userOf(p);
      const scope = await jobScope(u, "qc.view");
      const sum = async (r: Range) => {
        const checks = await prisma.qualityCheck.findMany({
          where: { createdAt: dt(r), job: scope },
          select: { jobId: true, decision: true, score: true, inspectorId: true, createdAt: true, job: { select: { assignedManagerId: true, service: { select: { name: true } } } }, issues: { select: { area: true, severity: true, itemDescription: true } } },
          orderBy: { createdAt: "asc" },
        });
        const jobIds = Array.from(new Set(checks.map((c) => c.jobId)));
        const firstEver = jobIds.length
          ? await prisma.qualityCheck.findMany({ where: { jobId: { in: jobIds } }, orderBy: { createdAt: "asc" }, distinct: ["jobId"], select: { jobId: true, decision: true, createdAt: true } })
          : [];
        const firsts = firstEver.filter((f) => f.createdAt >= dt(r).gte && f.createdAt < dt(r).lt);
        const nm = await names([...checks.map((c) => c.inspectorId), ...checks.map((c) => c.job.assignedManagerId)]);
        const count = (xs: string[]) => Object.entries(xs.reduce<Record<string, number>>((acc, x) => ((acc[x] = (acc[x] ?? 0) + 1), acc), {})).sort((x, y) => y[1] - x[1]);
        const issues = checks.flatMap((c) => c.issues.map((i) => ({ ...i, service: c.job.service.name })));
        const perFm: Record<string, { inspections: number; rework: number }> = {};
        const perInspector: Record<string, { inspections: number; rework: number }> = {};
        for (const c of checks) {
          const fm = (c.job.assignedManagerId && nm.get(c.job.assignedManagerId)) || "Unassigned";
          const qi = nm.get(c.inspectorId) ?? "QC";
          for (const [map, k] of [[perFm, fm], [perInspector, qi]] as const) {
            map[k] ??= { inspections: 0, rework: 0 };
            map[k].inspections++;
            if (c.decision !== "PASS") map[k].rework++;
          }
        }
        return {
          period: r.label,
          inspections: checks.length,
          passed: checks.filter((c) => c.decision === "PASS").length,
          sentToRework: checks.filter((c) => c.decision !== "PASS").length,
          firstInspections: firsts.length,
          firstTimePassRatePercent: pct(firsts.filter((f) => f.decision === "PASS").length, firsts.length),
          averageScore: avg(checks.map((c) => c.score)),
          issuesTotal: issues.length,
          issuesByArea: count(issues.map((i) => i.area)),
          issuesBySeverity: count(issues.map((i) => i.severity)),
          issuesByService: count(issues.map((i) => i.service)),
          commonIssues: count(issues.map((i) => i.itemDescription.toLowerCase().slice(0, 80))).slice(0, 10),
          byFieldManager: perFm,
          byInspector: perInspector,
        };
      };
      const r = resolveRange(a);
      const current = await sum(r);
      return a.compare_previous ? { current, previous: await sum(previousRange(r)) } : current;
    },
  },
  {
    name: "get_rework_report",
    status: "Analysing rework",
    permission: "rework.view",
    description: "Rework analysis for a period over the jobs the user may see: rework items raised, still open, fixed, average hours to fix, by area and by Field Manager, and jobs that needed more than one rework round. Optional comparison with the previous period.",
    parameters: { type: "OBJECT", properties: { period: PERIOD_PARAM, ...DATE_PARAMS, compare_previous: COMPARE } },
    run: async (p, a) => {
      const u = userOf(p);
      const scope = await jobScope(u, "rework.view");
      const sum = async (r: Range) => {
        const tasks = await prisma.reworkTask.findMany({
          where: { createdAt: dt(r), job: scope },
          select: { jobId: true, status: true, createdAt: true, completedAt: true, qualityIssueId: true, job: { select: { jobSerial: true, assignedManagerId: true } } },
        });
        const issueAreas = new Map(
          (await prisma.qualityIssue.findMany({ where: { id: { in: tasks.map((t) => t.qualityIssueId) } }, select: { id: true, area: true } })).map((i) => [i.id, i.area])
        );
        const nm = await names(tasks.map((t) => t.job.assignedManagerId));
        const by = (f: (t: (typeof tasks)[number]) => string) =>
          Object.entries(tasks.reduce<Record<string, number>>((acc, t) => ((acc[f(t)] = (acc[f(t)] ?? 0) + 1), acc), {})).sort((x, y) => y[1] - x[1]);
        const rounds = await prisma.qualityCheck.groupBy({ by: ["jobId"], where: { decision: { not: "PASS" }, jobId: { in: Array.from(new Set(tasks.map((t) => t.jobId))) } }, _count: { _all: true } });
        const serial = new Map(tasks.map((t) => [t.jobId, t.job.jobSerial]));
        const fixed = tasks.filter((t) => t.completedAt);
        return {
          period: r.label,
          reworkItems: tasks.length,
          jobsAffected: new Set(tasks.map((t) => t.jobId)).size,
          open: tasks.filter((t) => t.status !== "completed").length,
          fixed: fixed.length,
          averageHoursToFix: avg(fixed.map((t) => (t.completedAt!.getTime() - t.createdAt.getTime()) / 3600000)),
          byArea: by((t) => issueAreas.get(t.qualityIssueId) ?? "Other"),
          byFieldManager: by((t) => (t.job.assignedManagerId && nm.get(t.job.assignedManagerId)) || "Unassigned"),
          jobsWithRepeatRework: rounds.filter((g) => g._count._all > 1).map((g) => ({ jobId: serial.get(g.jobId), reworkRounds: g._count._all })),
        };
      };
      const r = resolveRange(a);
      const current = await sum(r);
      return a.compare_previous ? { current, previous: await sum(previousRange(r)) } : current;
    },
  },
  {
    name: "get_customer_feedback",
    status: "Reading customer feedback",
    permission: "feedback.view",
    description: "Customer satisfaction for a period: star-rating distribution and average, Google review clicks, complaints by category and status, and the latest complaint texts.",
    parameters: { type: "OBJECT", properties: { period: PERIOD_PARAM, ...DATE_PARAMS } },
    run: async (p, a) => {
      const u = userOf(p);
      const r = resolveRange(a);
      const scope = await jobScope(u, "jobs.view");
      const rated = await prisma.job.findMany({ where: { AND: [scope, { customerFeedbackAt: dt(r) }] }, select: { customerFeedbackRating: true, googleReviewClicked: true } });
      const dist: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
      for (const j of rated) if (j.customerFeedbackRating) dist[String(j.customerFeedbackRating)]++;
      const complaints = can(u, "complaints.view")
        ? await prisma.complaint.findMany({ where: { createdAt: dt(r), job: scope }, orderBy: { createdAt: "desc" }, select: { category: true, status: true, description: true, createdAt: true, job: { select: { jobSerial: true, customer: { select: { name: true } } } } } })
        : [];
      const by = (f: (c: (typeof complaints)[number]) => string) => complaints.reduce<Record<string, number>>((acc, c) => ((acc[f(c)] = (acc[f(c)] ?? 0) + 1), acc), {});
      return {
        period: r.label,
        ratings: rated.length,
        averageRating: avg(rated.map((j) => j.customerFeedbackRating ?? 0).filter(Boolean)),
        distribution: dist,
        googleReviewClicks: rated.filter((j) => j.googleReviewClicked).length,
        complaints: complaints.length,
        complaintsByCategory: by((c) => c.category),
        complaintsByStatus: by((c) => c.status),
        latestComplaints: complaints.slice(0, 10).map((c) => ({ date: c.createdAt.toISOString().slice(0, 10), jobId: c.job.jobSerial, customer: c.job.customer.name, category: c.category, status: c.status, text: c.description.slice(0, 200) })),
      };
    },
  },
  {
    name: "get_field_manager_performance",
    status: "Comparing Field Managers",
    permission: "reports.view",
    description: "Per Field Manager for a period: jobs assigned, completed, completion rate, first-time QC pass rate, rework rounds, average rating, jobs that overran expected hours, complaints.",
    parameters: { type: "OBJECT", properties: { period: PERIOD_PARAM, ...DATE_PARAMS } },
    run: async (p, a) => {
      const u = userOf(p);
      const r = resolveRange(a);
      const scope = await jobScope(u, "jobs.view");
      const jobs = await prisma.job.findMany({
        where: { AND: [scope, { scheduledDate: { gte: r.from, lte: r.to } }, { status: { not: "CANCELLED" } }] },
        select: { id: true, status: true, assignedManagerId: true, customerFeedbackRating: true, startedAt: true, completedAt: true, service: { select: { estimatedDurationHours: true } }, qualityChecks: { select: { decision: true, createdAt: true }, orderBy: { createdAt: "asc" } }, _count: { select: { complaints: true } } },
      });
      const managers = await prisma.user.findMany({ where: { role: { in: ["field_manager", "field_staff", "staff"] } }, select: { id: true, name: true, active: true } });
      return {
        period: r.label,
        fieldManagers: managers
          .map((m) => {
            const mine = jobs.filter((j) => j.assignedManagerId === m.id);
            const inspected = mine.filter((j) => j.qualityChecks.length);
            const ratings = mine.map((j) => j.customerFeedbackRating).filter((x): x is number => typeof x === "number");
            return {
              name: m.name,
              active: m.active,
              jobs: mine.length,
              completed: mine.filter((j) => DONE.includes(j.status)).length,
              completionRatePercent: pct(mine.filter((j) => DONE.includes(j.status)).length, mine.length),
              firstTimePassRatePercent: pct(inspected.filter((j) => j.qualityChecks[0].decision === "PASS").length, inspected.length),
              reworkRounds: mine.reduce((x, j) => x + j.qualityChecks.filter((q) => q.decision !== "PASS").length, 0),
              averageRating: avg(ratings),
              overranJobs: mine.filter((j) => j.startedAt && j.completedAt && (j.completedAt.getTime() - j.startedAt.getTime()) / 3600000 > j.service.estimatedDurationHours).length,
              complaints: mine.reduce((x, j) => x + j._count.complaints, 0),
            };
          })
          .filter((m) => m.jobs > 0 || m.active)
          .sort((x, y) => y.completed - x.completed),
      };
    },
  },
  {
    name: "get_service_performance",
    status: "Comparing services",
    permission: "reports.view",
    description: "Per service package for a period: bookings, completed, cancellations, average rating, rework rate, average actual vs expected hours and (if allowed) booked value. Use for 'best services', 'which service to promote', pricing questions.",
    parameters: { type: "OBJECT", properties: { period: PERIOD_PARAM, ...DATE_PARAMS } },
    run: async (p, a) => {
      const u = userOf(p);
      const r = resolveRange(a);
      const scope = await jobScope(u, "jobs.view");
      const jobs = await prisma.job.findMany({
        where: { AND: [scope, { scheduledDate: { gte: r.from, lte: r.to } }] },
        select: { status: true, amount: true, customerFeedbackRating: true, startedAt: true, completedAt: true, service: { select: { name: true, basePrice: true, estimatedDurationHours: true } }, qualityChecks: { select: { decision: true } } },
      });
      const by: Record<string, typeof jobs> = {};
      for (const j of jobs) (by[j.service.name] ??= []).push(j);
      return {
        period: r.label,
        services: Object.entries(by)
          .map(([name, js]) => {
            const live = js.filter((j) => j.status !== "CANCELLED");
            const hours = live.filter((j) => j.startedAt && j.completedAt).map((j) => (j.completedAt!.getTime() - j.startedAt!.getTime()) / 3600000);
            return {
              service: name,
              bookings: live.length,
              completed: live.filter((j) => DONE.includes(j.status)).length,
              cancelled: js.length - live.length,
              averageRating: avg(live.map((j) => j.customerFeedbackRating).filter((x): x is number => typeof x === "number")),
              reworkRatePercent: pct(live.filter((j) => j.qualityChecks.some((q) => q.decision !== "PASS")).length, live.filter((j) => j.qualityChecks.length).length),
              averageWorkHours: avg(hours),
              expectedHours: js[0].service.estimatedDurationHours,
              ...(money(u) ? { listPrice: js[0].service.basePrice, bookedValue: r2(live.reduce((x, j) => x + j.amount, 0)) } : {}),
            };
          })
          .sort((x, y) => y.bookings - x.bookings),
      };
    },
  },
  {
    name: "get_my_work_summary",
    status: "Reading your jobs",
    permission: "jobs.arrive",
    description: "For a Field Manager: their own jobs today and in the period — what is next, jobs by stage, open rework items, first-time QC pass rate, average rating and jobs that overran.",
    parameters: { type: "OBJECT", properties: { period: PERIOD_PARAM, ...DATE_PARAMS } },
    run: async (p, a) => {
      const u = userOf(p);
      const scope = await jobScope(u, "jobs.view"); // ASSIGNED: only their own jobs
      const r = resolveRange(a);
      const today = istToday();
      const todayJobs = await jobRows(u, { AND: [scope, { scheduledDate: today }] }, 20);
      const periodJobs = await prisma.job.findMany({ where: { AND: [scope, { scheduledDate: { gte: r.from, lte: r.to } }] }, select: { id: true, status: true, customerFeedbackRating: true, qualityChecks: { select: { decision: true }, orderBy: { createdAt: "asc" } } } });
      const openRework = await prisma.reworkTask.count({ where: { status: { not: "completed" }, job: scope } });
      const inspected = periodJobs.filter((j) => j.qualityChecks.length);
      return {
        today: { date: today, jobs: todayJobs },
        period: r.label,
        jobs: periodJobs.length,
        completed: periodJobs.filter((j) => DONE.includes(j.status)).length,
        openReworkItems: openRework,
        firstTimePassRatePercent: pct(inspected.filter((j) => j.qualityChecks[0].decision === "PASS").length, inspected.length),
        averageRating: avg(periodJobs.map((j) => j.customerFeedbackRating).filter((x): x is number => typeof x === "number")),
      };
    },
  },
  {
    name: "get_my_service",
    status: "Checking your service",
    permission: "customer",
    description: "The customer's own service: Job ID, service, date and time, team names, status, checklist progress, quality-check result, invoice and approval/feedback state. Only the items the company shares with this customer are returned — anything missing is not available to them.",
    parameters: { type: "OBJECT", properties: {} },
    run: async (p) => {
      if (p.kind !== "customer") throw new HttpError(403, "Not permitted.");
      const j = await prisma.job.findUnique({
        where: { id: p.jobId },
        select: {
          jobSerial: true, status: true, scheduledDate: true, scheduledTimeSlot: true, assignedStaffIds: true, assignedManagerId: true,
          approvedAt: true, customerFeedbackRating: true, customerVisibility: true, customerNotes: true, locationAddress: true,
          service: { select: { name: true } },
          property: { select: { title: true } },
          checklistItems: { select: { status: true } },
          qualityChecks: { select: { decision: true }, orderBy: { createdAt: "desc" }, take: 1 },
          invoices: { where: { status: { not: "CANCELLED" } }, select: { invoiceNumber: true, invoiceType: true, subtotal: true, discount: true, tax: true, total: true, balanceDue: true, status: true }, take: 1 },
        },
      });
      if (!j) return { error: "Service not found." };
      // The same visibility the customer page uses — hidden items are never given to the model.
      const vis = resolveVisibility((await getSystemSettings()).customerVisibility, j.customerVisibility);
      const team = await names([j.assignedManagerId, ...j.assignedStaffIds]);
      const inv = j.invoices[0];
      const done = j.checklistItems.filter((c) => c.status === "completed" || c.status === "skipped").length;
      return {
        ...(vis.jobId ? { jobId: j.jobSerial } : {}),
        ...(vis.service ? { service: j.service.name } : {}),
        ...(vis.location ? { property: j.property.title, address: j.locationAddress ?? undefined } : {}),
        ...(vis.serviceDate ? { date: j.scheduledDate, timeWindow: j.scheduledTimeSlot } : {}),
        ...(vis.team ? { team: Array.from(team.values()) } : {}),
        ...(vis.status ? { status: j.status, progress: `${done} of ${j.checklistItems.length} tasks done` } : {}),
        ...(vis.qcResult
          ? { qualityCheck: DONE.includes(j.status) || ["PASS", "CUSTOMER_APPROVAL"].includes(j.status) ? "passed" : REWORK.includes(j.status) ? "finishing touches" : QC_WAIT.includes(j.status) ? "being checked" : "not yet" }
          : {}),
        ...(vis.serviceNotes && j.customerNotes ? { notes: j.customerNotes } : {}),
        approved: !!j.approvedAt,
        ...(vis.feedback ? { rating: j.customerFeedbackRating ?? null } : {}),
        invoice:
          vis.invoice && inv
            ? {
                invoiceNumber: inv.invoiceNumber,
                type: inv.invoiceType,
                amount: r2(inv.subtotal - inv.discount),
                ...(inv.invoiceType === "GST" ? { gst: inv.tax } : {}),
                total: inv.total,
                ...(vis.paymentStatus ? { balanceDue: inv.balanceDue, status: inv.status } : {}),
              }
            : null,
      };
    },
  },
];

/* ------------------------------------------------------------- dispatch */

function allowed(p: AiPrincipal, t: AiTool): boolean {
  if (t.permission === "customer") return p.kind === "customer";
  return p.kind === "user" && can(p.user, t.permission) && can(p.user, "ai.use");
}

/** The tools this principal may use — the ONLY ones the model is offered. */
export function toolsFor(p: AiPrincipal): AiTool[] {
  return TOOLS.filter((t) => allowed(p, t));
}

export function toolStatus(name: string): string {
  return TOOLS.find((t) => t.name === name)?.status ?? "Analysing";
}

/** Runs a tool call from the model — permission re-checked, errors contained. */
export async function runTool(p: AiPrincipal, name: string, args: Args): Promise<unknown> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool || !allowed(p, tool)) return { error: "Not permitted for this user." };
  try {
    return await tool.run(p, args && typeof args === "object" ? args : {});
  } catch (err) {
    if (err instanceof HttpError) return { error: err.status === 403 ? "Not permitted for this user." : err.message };
    throw err;
  }
}

export function declarationsFor(p: AiPrincipal) {
  return toolsFor(p).map((t) => ({ name: t.name, description: t.description, ...(t.parameters ? { parameters: t.parameters } : {}) }));
}
