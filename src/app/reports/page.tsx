"use client";

import React, { useMemo, useState } from "react";
import { BarChart3, Download } from "lucide-react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SkeletonList } from "@/components/ui/states";
import { BusinessReport } from "@/components/reports/BusinessReport";
import { useApp } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import { formatCurrency, cn, toLocalDateString } from "@/lib/utils";

const DONE = ["COMPLETED", "FEEDBACK_REQUESTED", "CLOSED"];
const REWORK = ["REWORK_REQUIRED", "REWORK_ASSIGNED", "REWORK_IN_PROGRESS", "REWORK_COMPLETED", "REINSPECTION"];
type Preset = "month" | "last30" | "quarter" | "year" | "custom";
type SectionKey = "business" | "jobs" | "revenue" | "customers" | "services" | "qc" | "rework" | "gst" | "invoices" | "feedback" | "fm";

const SECTIONS: { key: SectionKey; label: string; money?: boolean }[] = [
  { key: "business", label: "Profit & costs", money: true },
  { key: "jobs", label: "Jobs" },
  { key: "revenue", label: "Revenue", money: true },
  { key: "customers", label: "Customers" },
  { key: "services", label: "Services" },
  { key: "qc", label: "QC" },
  { key: "rework", label: "Rework" },
  { key: "gst", label: "GST", money: true },
  { key: "invoices", label: "Invoices", money: true },
  { key: "feedback", label: "Feedback" },
  { key: "fm", label: "FM Performance" },
];

const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);

/** Downloads rows as a CSV file (opens in Excel / Sheets). */
function downloadCsv(name: string, rows: Record<string, string | number | null | undefined>[]) {
  if (!rows.length) return;
  const head = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const t = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const csv = [head.join(","), ...rows.map((r) => head.map((h) => esc(r[h])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Column chart over time — bars with values in an accessible table for screen readers. */
function TimeChart({ points, money }: { points: { label: string; value: number }[]; money?: boolean }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const fmt = (v: number) => (money ? formatCurrency(v) : String(v));
  if (!points.length) return <p className="text-sm text-zinc-500">No data in this range.</p>;
  const every = Math.ceil(points.length / 8);
  return (
    <figure>
      <div className="flex items-end gap-1 h-40" aria-hidden>
        {points.map((p) => (
          <div key={p.label} className="flex-1 min-w-0 flex flex-col justify-end h-full group relative">
            <div className="w-full rounded-t-md bg-rose-500/85 group-hover:bg-rose-600 transition-colors" style={{ height: `${Math.max(p.value ? 3 : 0, (p.value / max) * 100)}%` }} title={`${p.label}: ${fmt(p.value)}`} />
          </div>
        ))}
      </div>
      <div className="flex gap-1 mt-1.5" aria-hidden>
        {points.map((p, i) => (
          <div key={p.label} className="flex-1 min-w-0 text-[10px] text-zinc-500 text-center truncate">{i % every === 0 ? p.label : ""}</div>
        ))}
      </div>
      <table className="sr-only">
        <tbody>{points.map((p) => <tr key={p.label}><th>{p.label}</th><td>{fmt(p.value)}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

/** Horizontal bars for a ranking (services, FMs, ratings). */
function Bars({ rows, money }: { rows: { label: string; value: number; hint?: string }[]; money?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="text-sm text-zinc-500">No data in this range.</p>;
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="font-medium text-zinc-900 min-w-0 truncate">{r.label}</span>
            <span className="text-zinc-600 shrink-0 tabular-nums">{money ? formatCurrency(r.value) : r.value}{r.hint ? ` · ${r.hint}` : ""}</span>
          </div>
          <div className="mt-1.5 h-2 rounded-full bg-zinc-100 overflow-hidden" aria-hidden>
            <div className="h-full rounded-full bg-rose-500" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Card({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5 min-w-0">
      <div className="text-sm text-zinc-500">{label}</div>
      <div className={cn("text-2xl sm:text-3xl font-semibold mt-1 break-words", tone ?? "text-zinc-950")}>{value}</div>
      {hint && <div className="text-xs text-zinc-500 mt-1">{hint}</div>}
    </div>
  );
}

function Panel({ title, onExport, children }: { title: string; onExport?: () => void; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-zinc-950">{title}</h2>
        {onExport && <Button size="sm" variant="outline" onClick={onExport}><Download className="h-4 w-4" aria-hidden /> Export CSV</Button>}
      </div>
      {children}
    </section>
  );
}

/** Reports — cards, charts, filters and CSV export for every part of the business. */
export default function ReportsPage() {
  const { jobs, services, users, customers, complaints, qualityChecks, reworkTasks, invoices, payments, loading } = useApp();
  const { can } = useAuth();
  const showMoney = can("finance.view");
  const [preset, setPreset] = useState<Preset>("month");
  const [customFrom, setCustomFrom] = useState(toLocalDateString(new Date(Date.now() - 30 * 86400000)));
  const [customTo, setCustomTo] = useState(toLocalDateString());
  const [serviceId, setServiceId] = useState("");
  const [fmId, setFmId] = useState("");
  const [section, setSection] = useState<SectionKey>("jobs");
  const canBusiness = can("reports.financial");

  const [from, to] = useMemo((): [string, string] => {
    const today = toLocalDateString();
    const d = new Date();
    if (preset === "month") return [`${today.slice(0, 7)}-01`, today];
    if (preset === "last30") return [toLocalDateString(new Date(Date.now() - 29 * 86400000)), today];
    if (preset === "quarter") return [toLocalDateString(new Date(d.getFullYear(), d.getMonth() - 2, 1)), today];
    if (preset === "year") return [`${d.getFullYear()}-01-01`, today];
    return customFrom <= customTo ? [customFrom, customTo] : [customTo, customFrom];
  }, [preset, customFrom, customTo]);

  const managers = users.filter((u) => u.role === "field_manager");
  const inRange = (day: string | undefined | null) => !!day && day.slice(0, 10) >= from && day.slice(0, 10) <= to;
  const jobsIn = jobs.filter(
    (j) => inRange(j.scheduledDate) && j.status !== "CANCELLED" && (!serviceId || j.serviceId === serviceId) && (!fmId || j.assignedManagerId === fmId || j.assignedStaffIds.includes(fmId))
  );
  const jobIds = new Set(jobsIn.map((j) => j.id));
  const done = jobsIn.filter((j) => DONE.includes(j.status));
  const invIn = invoices.filter((i) => inRange(i.issuedAt) && i.status !== "CANCELLED" && (!serviceId && !fmId ? true : jobIds.has(i.jobId)));
  const gstInv = invIn.filter((i) => i.invoiceType === "GST");
  const checks = qualityChecks.filter((q) => jobIds.has(q.jobId));
  const rework = reworkTasks.filter((t) => jobIds.has(t.jobId));
  const rated = jobsIn.filter((j) => typeof j.customerFeedbackRating === "number");
  const issues = complaints.filter((c) => jobIds.has(c.jobId));
  const svcName = (id: string) => services.find((s) => s.id === id)?.name ?? "Service";
  const custName = (id: string) => customers.find((c) => c.id === id)?.name ?? "Customer";
  const jobNo = (id: string) => jobs.find((j) => j.id === id)?.jobNumber ?? id.slice(-6);

  // Day buckets for ≤ 62 days, month buckets beyond.
  const buckets = useMemo(() => {
    const start = new Date(`${from}T00:00:00`);
    const days = Math.round((new Date(`${to}T00:00:00`).getTime() - start.getTime()) / 86400000) + 1;
    const out: { key: string; label: string }[] = [];
    if (days <= 62) {
      for (let i = 0; i < days; i++) {
        const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        const k = toLocalDateString(d);
        out.push({ key: k, label: d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) });
      }
      return { out, len: 10 };
    }
    const d = new Date(`${from.slice(0, 7)}-01T00:00:00`);
    while (toLocalDateString(d).slice(0, 7) <= to.slice(0, 7)) {
      out.push({ key: toLocalDateString(d).slice(0, 7), label: d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" }) });
      d.setMonth(d.getMonth() + 1);
    }
    return { out, len: 7 };
  }, [from, to]);
  const series = <T,>(rows: T[], day: (r: T) => string | undefined | null, val: (r: T) => number = () => 1) =>
    buckets.out.map((b) => ({ label: b.label, value: r2(rows.filter((r) => (day(r) ?? "").slice(0, buckets.len) === b.key).reduce((a, r) => a + val(r), 0)) }));

  // ---- figures
  const billed = r2(invIn.reduce((a, i) => a + i.total, 0));
  const collected = r2(payments.filter((p) => inRange(p.paidAt) && (!serviceId && !fmId ? true : jobIds.has(p.jobId))).reduce((a, p) => a + p.amount, 0));
  const outstanding = r2(invIn.reduce((a, i) => a + i.balanceDue, 0));
  const firstRounds = Array.from(new Set(checks.map((q) => q.jobId))).map((id) => checks.filter((q) => q.jobId === id).sort((a, b) => (a.inspectedAt ?? "").localeCompare(b.inspectedAt ?? ""))[0]);
  const firstPass = pct(firstRounds.filter((q) => q.status === "PASS").length, firstRounds.length);
  const avgScore = checks.length ? Math.round(checks.reduce((a, q) => a + (q.score || 0), 0) / checks.length) : null;
  const avgRating = rated.length ? r2(rated.reduce((a, j) => a + (j.customerFeedbackRating ?? 0), 0) / rated.length) : null;
  const custJobs = new Map<string, number>();
  jobs.filter((j) => j.status !== "CANCELLED").forEach((j) => custJobs.set(j.customerId, (custJobs.get(j.customerId) ?? 0) + 1));
  const activeCustomers = new Set(jobsIn.map((j) => j.customerId));
  const newCustomers = customers.filter((c) => inRange(c.createdAt));
  const repeat = Array.from(activeCustomers).filter((id) => (custJobs.get(id) ?? 0) > 1).length;

  const byService = services
    .map((s) => {
      const list = jobsIn.filter((j) => j.serviceId === s.id);
      const d = list.filter((j) => DONE.includes(j.status));
      return { id: s.id, name: s.name, custom: !!s.isCustom, jobs: list.length, completed: d.length, revenue: r2(invIn.filter((i) => list.some((j) => j.id === i.jobId)).reduce((a, i) => a + i.total, 0)) };
    })
    .filter((r) => r.jobs > 0)
    .sort((a, b) => b.jobs - a.jobs);

  const byCustomer = Array.from(activeCustomers)
    .map((id) => {
      const list = jobsIn.filter((j) => j.customerId === id);
      return { id, name: custName(id), jobs: list.length, billed: r2(invIn.filter((i) => i.customerId === id).reduce((a, i) => a + i.total, 0)), allTime: custJobs.get(id) ?? 0 };
    })
    .sort((a, b) => b.jobs - a.jobs || b.billed - a.billed);

  const fmRows = managers
    .map((u) => {
      const mine = jobsIn.filter((j) => j.assignedManagerId === u.id || j.assignedStaffIds.includes(u.id));
      const ids = new Set(mine.map((j) => j.id));
      const mc = qualityChecks.filter((q) => ids.has(q.jobId));
      const r = mine.filter((j) => typeof j.customerFeedbackRating === "number");
      const fr = Array.from(new Set(mc.map((q) => q.jobId))).map((id) => mc.filter((q) => q.jobId === id).sort((a, b) => (a.inspectedAt ?? "").localeCompare(b.inspectedAt ?? ""))[0]);
      return {
        id: u.id,
        name: u.name,
        jobs: mine.length,
        completed: mine.filter((j) => DONE.includes(j.status)).length,
        rework: reworkTasks.filter((t) => ids.has(t.jobId)).length,
        firstPass: pct(fr.filter((q) => q.status === "PASS").length, fr.length),
        rating: r.length ? r2(r.reduce((a, j) => a + (j.customerFeedbackRating ?? 0), 0) / r.length) : null,
      };
    })
    .filter((m) => m.jobs > 0 || !fmId)
    .sort((a, b) => b.completed - a.completed);

  const gst = {
    taxable: r2(gstInv.reduce((a, i) => a + (i.subtotal - i.discount), 0)),
    cgst: r2(gstInv.reduce((a, i) => a + (i.cgst ?? 0), 0)),
    sgst: r2(gstInv.reduce((a, i) => a + (i.sgst ?? 0), 0)),
    igst: r2(gstInv.reduce((a, i) => a + (i.igst ?? 0), 0)),
    total: r2(gstInv.reduce((a, i) => a + i.tax, 0)),
  };

  const sections = SECTIONS.filter((s) => (s.key === "business" ? canBusiness : !s.money || showMoney));
  const tag = `${from}_to_${to}`;
  const jobCols: Column<(typeof jobsIn)[number]>[] = [
    { key: "id", header: "Job ID", mobile: "title", cell: (j) => <span className="font-mono font-semibold break-all">{j.jobNumber}</span> },
    { key: "c", header: "Customer", mobile: "subtitle", cell: (j) => custName(j.customerId) },
    { key: "s", header: "Service", cell: (j) => svcName(j.serviceId) },
    { key: "d", header: "Date", cell: (j) => j.scheduledDate },
    { key: "st", header: "Status", mobile: "badge", cell: (j) => j.status.replace(/_/g, " ").toLowerCase() },
  ];

  return (
    <AdminLayout>
      <PageHeader title="Reports" description="How the business is doing — pick a date range, filter, and export any report." />

      <section className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5 mb-6 space-y-4" aria-label="Filters">
        <div className="flex gap-2 overflow-x-auto pb-1" role="radiogroup" aria-label="Date range">
          {([["month", "This month"], ["last30", "Last 30 days"], ["quarter", "3 months"], ["year", "This year"], ["custom", "Custom"]] as const).map(([k, l]) => (
            <button key={k} role="radio" aria-checked={preset === k} onClick={() => setPreset(k)} className={cn("shrink-0 min-h-10 px-3.5 rounded-full border text-sm font-medium", preset === k ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-700")}>{l}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {preset === "custom" && (
            <>
              <label className="space-y-1"><span className="text-sm font-medium text-zinc-800">From</span><Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} /></label>
              <label className="space-y-1"><span className="text-sm font-medium text-zinc-800">To</span><Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} /></label>
            </>
          )}
          <label className="space-y-1">
            <span className="text-sm font-medium text-zinc-800">Service</span>
            <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} className="w-full h-11 rounded-xl border border-zinc-300 bg-white px-3 text-sm">
              <option value="">All services</option>
              {services.map((s) => <option key={s.id} value={s.id}>{s.name}{s.isCustom ? " (custom)" : ""}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium text-zinc-800">Field Manager</span>
            <select value={fmId} onChange={(e) => setFmId(e.target.value)} className="w-full h-11 rounded-xl border border-zinc-300 bg-white px-3 text-sm">
              <option value="">Everyone</option>
              {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
        </div>
        <p className="text-xs text-zinc-500">{new Date(`${from}T00:00:00`).toLocaleDateString("en-IN", { dateStyle: "medium" })} – {new Date(`${to}T00:00:00`).toLocaleDateString("en-IN", { dateStyle: "medium" })}</p>
      </section>

      {loading && jobs.length === 0 ? (
        <SkeletonList rows={3} />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card label="Jobs" value={String(jobsIn.length)} hint={`${done.length} completed`} />
            {showMoney ? <Card label="Revenue" value={formatCurrency(billed)} hint={`${formatCurrency(collected)} collected`} /> : <Card label="Customers" value={String(activeCustomers.size)} hint={`${newCustomers.length} new`} />}
            <Card label="First-time QC pass" value={firstPass === null ? "—" : `${firstPass}%`} hint={`${rework.length} rework task${rework.length === 1 ? "" : "s"}`} tone={firstPass !== null && firstPass < 80 ? "text-amber-700" : "text-emerald-700"} />
            <Card label="Customer rating" value={avgRating === null ? "—" : `${avgRating} ★`} hint={`${rated.length} rating${rated.length === 1 ? "" : "s"}`} />
          </div>

          <nav className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" role="tablist" aria-label="Report">
            {sections.map((s) => (
              <button key={s.key} role="tab" aria-selected={section === s.key} onClick={() => setSection(s.key)} className={cn("shrink-0 min-h-10 px-3.5 rounded-xl border text-sm font-semibold", section === s.key ? "border-rose-500 bg-rose-50 text-rose-700" : "border-zinc-200 bg-white text-zinc-700")}>{s.label}</button>
            ))}
          </nav>

          {jobsIn.length === 0 && invIn.length === 0 ? (
            <EmptyState icon={BarChart3} title="No activity in this range" description="Try a wider date range or clear the filters." />
          ) : (
            <>
              {section === "business" && canBusiness && <BusinessReport from={from} to={to} serviceId={serviceId} />}

              {section === "jobs" && (
                <>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <Card label="Booked" value={String(jobsIn.length)} />
                    <Card label="Completed" value={String(done.length)} tone="text-emerald-700" />
                    <Card label="In rework" value={String(jobsIn.filter((j) => REWORK.includes(j.status)).length)} tone="text-amber-700" />
                    <Card label="Completion rate" value={`${pct(done.length, jobsIn.length) ?? 0}%`} />
                  </div>
                  <Panel title="Jobs over time" onExport={() => downloadCsv(`jobs_${tag}`, jobsIn.map((j) => ({ jobId: j.jobNumber, customer: custName(j.customerId), service: svcName(j.serviceId), date: j.scheduledDate, timeSlot: j.scheduledTimeSlot, status: j.status, fieldManager: users.find((u) => u.id === j.assignedManagerId)?.name ?? "" })))}>
                    <TimeChart points={series(jobsIn, (j) => j.scheduledDate)} />
                  </Panel>
                  <DataTable caption="Jobs" rows={[...jobsIn].sort((a, b) => b.scheduledDate.localeCompare(a.scheduledDate)).slice(0, 50)} rowKey={(j) => j.id} href={(j) => `/jobs/${j.id}`} columns={jobCols} />
                </>
              )}

              {section === "revenue" && showMoney && (
                <>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <Card label="Billed" value={formatCurrency(billed)} />
                    <Card label="Collected" value={formatCurrency(collected)} tone="text-emerald-700" />
                    <Card label="Outstanding" value={formatCurrency(outstanding)} tone={outstanding ? "text-amber-700" : undefined} />
                    <Card label="Average job value" value={formatCurrency(invIn.length ? r2(billed / invIn.length) : 0)} />
                  </div>
                  <Panel title="Billed over time" onExport={() => {
                    const pts = series(invIn, (x) => x.issuedAt, (x) => x.total);
                    downloadCsv(`revenue_${tag}`, buckets.out.map((b, i) => ({ period: b.key, billed: pts[i].value })));
                  }}>
                    <TimeChart points={series(invIn, (i) => i.issuedAt, (i) => i.total)} money />
                  </Panel>
                  <Panel title="Revenue by service"><Bars rows={byService.filter((s) => s.revenue > 0).map((s) => ({ label: s.name, value: s.revenue }))} money /></Panel>
                </>
              )}

              {section === "customers" && (
                <>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <Card label="Customers served" value={String(activeCustomers.size)} />
                    <Card label="New customers" value={String(newCustomers.length)} />
                    <Card label="Repeat customers" value={`${pct(repeat, activeCustomers.size) ?? 0}%`} hint="booked more than once" />
                    <Card label="Total customers" value={String(customers.length)} />
                  </div>
                  <Panel title="Top customers" onExport={() => downloadCsv(`customers_${tag}`, byCustomer.map((c) => ({ customer: c.name, jobsInRange: c.jobs, ...(showMoney ? { billed: c.billed } : {}), jobsAllTime: c.allTime })))}>
                    <Bars rows={byCustomer.slice(0, 10).map((c) => ({ label: c.name, value: c.jobs, hint: showMoney ? formatCurrency(c.billed) : undefined }))} />
                  </Panel>
                </>
              )}

              {section === "services" && (
                <Panel title="Services" onExport={() => downloadCsv(`services_${tag}`, byService.map((s) => ({ service: s.name, type: s.custom ? "Custom" : "Standard", jobs: s.jobs, completed: s.completed, ...(showMoney ? { billed: s.revenue } : {}) })))}>
                  <Bars rows={byService.map((s) => ({ label: `${s.name}${s.custom ? " (custom)" : ""}`, value: s.jobs, hint: `${s.completed} done${showMoney ? ` · ${formatCurrency(s.revenue)}` : ""}` }))} />
                </Panel>
              )}

              {section === "qc" && (
                <>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <Card label="Inspections" value={String(checks.length)} />
                    <Card label="Passed" value={String(checks.filter((q) => q.status === "PASS").length)} tone="text-emerald-700" />
                    <Card label="First-time pass" value={firstPass === null ? "—" : `${firstPass}%`} />
                    <Card label="Average score" value={avgScore === null ? "—" : `${avgScore}/100`} />
                  </div>
                  <Panel title="Inspections over time" onExport={() => downloadCsv(`qc_${tag}`, checks.map((q) => ({ jobId: jobNo(q.jobId), inspector: q.inspectorName, result: q.status, score: q.score, itemsChecked: q.itemsChecked, itemsPassed: q.itemsPassed, issues: q.issuesCount, inspectedAt: q.inspectedAt ?? "" })))}>
                    <TimeChart points={series(checks, (q) => q.inspectedAt ?? q.completedAt)} />
                  </Panel>
                </>
              )}

              {section === "rework" && (
                <>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <Card label="Rework tasks" value={String(rework.length)} tone={rework.length ? "text-amber-700" : undefined} />
                    <Card label="Open" value={String(rework.filter((t) => t.status === "pending" || t.status === "in_progress").length)} />
                    <Card label="Jobs needing rework" value={String(new Set(rework.map((t) => t.jobId)).size)} />
                    <Card label="Rework rate" value={`${pct(new Set(rework.map((t) => t.jobId)).size, jobsIn.length) ?? 0}%`} hint="of jobs" />
                  </div>
                  <Panel title="Rework by service" onExport={() => downloadCsv(`rework_${tag}`, rework.map((t) => ({ jobId: jobNo(t.jobId), service: svcName(jobs.find((j) => j.id === t.jobId)?.serviceId ?? ""), assignedTo: users.find((u) => u.id === t.assignedStaffId)?.name ?? "", status: t.status, created: t.createdAt, completed: t.completedAt ?? "" })))}>
                    <Bars rows={byService.map((s) => ({ label: s.name, value: rework.filter((t) => jobsIn.find((j) => j.id === t.jobId)?.serviceId === s.id).length })).filter((r) => r.value > 0)} />
                  </Panel>
                </>
              )}

              {section === "gst" && showMoney && (
                <>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <Card label="GST invoices" value={String(gstInv.length)} hint={`${invIn.length - gstInv.length} Non-GST`} />
                    <Card label="Taxable value" value={formatCurrency(gst.taxable)} />
                    <Card label="CGST + SGST" value={formatCurrency(r2(gst.cgst + gst.sgst))} />
                    <Card label="IGST" value={formatCurrency(gst.igst)} />
                  </div>
                  <Panel title={`GST collected · ${formatCurrency(gst.total)}`} onExport={() => downloadCsv(`gst_${tag}`, gstInv.map((i) => ({ invoice: i.invoiceNumber, date: i.issuedAt.slice(0, 10), customer: custName(i.customerId), customerGstin: i.customerGstin ?? "", taxable: r2(i.subtotal - i.discount), cgst: i.cgst ?? 0, sgst: i.sgst ?? 0, igst: i.igst ?? 0, totalGst: i.tax, total: i.total })))}>
                    <TimeChart points={series(gstInv, (i) => i.issuedAt, (i) => i.tax)} money />
                  </Panel>
                </>
              )}

              {section === "invoices" && showMoney && (
                <>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <Card label="Invoices" value={String(invIn.length)} />
                    <Card label="Paid" value={String(invIn.filter((i) => i.balanceDue <= 0).length)} tone="text-emerald-700" />
                    <Card label="Unpaid" value={String(invIn.filter((i) => i.balanceDue > 0).length)} tone="text-amber-700" />
                    <Card label="Overdue" value={String(invIn.filter((i) => i.balanceDue > 0 && i.dueDate < toLocalDateString()).length)} tone="text-red-700" />
                  </div>
                  <Panel title="Invoices" onExport={() => downloadCsv(`invoices_${tag}`, invIn.map((i) => ({ invoice: i.invoiceNumber, type: i.invoiceType === "GST" ? "GST" : "Non-GST", date: i.issuedAt.slice(0, 10), customer: custName(i.customerId), jobId: jobNo(i.jobId), subtotal: i.subtotal, discount: i.discount, tax: i.tax, total: i.total, paid: i.amountPaid, balance: i.balanceDue, status: i.status, due: i.dueDate })))}>
                    <Bars rows={[{ label: "GST", value: r2(gstInv.reduce((a, i) => a + i.total, 0)) }, { label: "Non-GST", value: r2(invIn.filter((i) => i.invoiceType !== "GST").reduce((a, i) => a + i.total, 0)) }]} money />
                  </Panel>
                </>
              )}

              {section === "feedback" && (
                <>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <Card label="Ratings" value={String(rated.length)} />
                    <Card label="Average" value={avgRating === null ? "—" : `${avgRating} ★`} />
                    <Card label="Low ratings (≤ 3)" value={String(rated.filter((j) => (j.customerFeedbackRating ?? 5) <= 3).length)} tone="text-amber-700" />
                    <Card label="Complaints" value={String(issues.length)} hint={`${issues.filter((c) => c.status !== "resolved" && c.status !== "closed").length} open`} />
                  </div>
                  <Panel title="Rating breakdown" onExport={() => downloadCsv(`feedback_${tag}`, rated.map((j) => ({ jobId: j.jobNumber, customer: custName(j.customerId), service: svcName(j.serviceId), rating: j.customerFeedbackRating ?? "", comment: j.customerFeedbackComment ?? "", googleReview: j.googleReviewClicked ? "yes" : "no" })))}>
                    <Bars rows={[5, 4, 3, 2, 1].map((n) => ({ label: `${n} ★`, value: rated.filter((j) => j.customerFeedbackRating === n).length }))} />
                  </Panel>
                </>
              )}

              {section === "fm" && (
                <Panel title="Field Manager performance" onExport={() => downloadCsv(`fm_performance_${tag}`, fmRows.map((m) => ({ fieldManager: m.name, jobs: m.jobs, completed: m.completed, reworkTasks: m.rework, firstTimePassPct: m.firstPass ?? "", avgRating: m.rating ?? "" })))}>
                  {fmRows.length === 0 ? (
                    <p className="text-sm text-zinc-500">No Field Managers yet.</p>
                  ) : (
                    <DataTable
                      caption="Field Manager performance"
                      rows={fmRows}
                      rowKey={(m) => m.id}
                      columns={[
                        { key: "name", header: "Field Manager", mobile: "title", cell: (m) => <span className="font-semibold">{m.name}</span> },
                        { key: "jobs", header: "Jobs", align: "right", cell: (m) => m.jobs },
                        { key: "done", header: "Completed", align: "right", cell: (m) => m.completed },
                        { key: "rework", header: "Rework", align: "right", cell: (m) => <span className={m.rework ? "text-amber-700 font-semibold" : ""}>{m.rework}</span> },
                        { key: "fp", header: "First-time pass", align: "right", cell: (m) => (m.firstPass === null ? "—" : `${m.firstPass}%`) },
                        { key: "rating", header: "Avg rating", align: "right", cell: (m) => (m.rating === null ? "—" : `${m.rating} ★`) },
                      ]}
                    />
                  )}
                </Panel>
              )}
            </>
          )}
        </div>
      )}
    </AdminLayout>
  );
}
