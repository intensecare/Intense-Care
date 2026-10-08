"use client";

import React, { useMemo, useState } from "react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { DataTable } from "@/components/ui/data-table";
import { SkeletonList } from "@/components/ui/states";
import { useApp } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import { formatCurrency, cn } from "@/lib/utils";
import { BarChart3 } from "lucide-react";

const DONE = ["COMPLETED", "FEEDBACK_REQUESTED", "CLOSED"];
type Period = "month" | "quarter" | "year";

/** Reports — a handful of numbers that answer "how are we doing?". */
export default function ReportsPage() {
  const { jobs, services, users, complaints, qualityChecks, loading } = useApp();
  const { can } = useAuth();
  const [period, setPeriod] = useState<Period>("month");

  const from = useMemo(() => {
    const d = new Date();
    if (period === "month") return `${d.toISOString().slice(0, 7)}-01`;
    if (period === "quarter") return new Date(d.getFullYear(), d.getMonth() - 2, 1).toISOString().slice(0, 10);
    return `${d.getFullYear()}-01-01`;
  }, [period]);

  const inPeriod = jobs.filter((j) => j.scheduledDate >= from && j.status !== "CANCELLED");
  const ids = new Set(inPeriod.map((j) => j.id));
  const done = inPeriod.filter((j) => DONE.includes(j.status));
  const checks = qualityChecks.filter((q) => ids.has(q.jobId));
  // First-time pass: the job's FIRST QC round passed.
  const firstRounds = Array.from(new Set(checks.map((q) => q.jobId))).map((id) => checks.filter((q) => q.jobId === id).sort((a, b) => (a.inspectedAt ?? "").localeCompare(b.inspectedAt ?? ""))[0]);
  const firstPass = firstRounds.length ? Math.round((firstRounds.filter((q) => q.status === "PASS").length / firstRounds.length) * 100) : null;
  const rated = inPeriod.filter((j) => typeof j.customerFeedbackRating === "number");
  const avgRating = rated.length ? Math.round((rated.reduce((a, j) => a + (j.customerFeedbackRating ?? 0), 0) / rated.length) * 10) / 10 : null;
  const custCounts = new Map<string, number>();
  jobs.forEach((j) => custCounts.set(j.customerId, (custCounts.get(j.customerId) ?? 0) + 1));
  const repeat = custCounts.size ? Math.round((Array.from(custCounts.values()).filter((n) => n > 1).length / custCounts.size) * 100) : null;
  const issues = complaints.filter((c) => ids.has(c.jobId));
  const openIssues = issues.filter((c) => c.status !== "resolved" && c.status !== "closed").length;
  const showMoney = can("finance.view");
  const revenue = done.reduce((a, j) => a + (j.amount ?? 0), 0);

  const byService = services
    .map((s) => {
      const list = done.filter((j) => j.serviceId === s.id);
      return { id: s.id, name: s.name, jobs: list.length, revenue: list.reduce((a, j) => a + (j.amount ?? 0), 0) };
    })
    .filter((r) => r.jobs > 0)
    .sort((a, b) => b.jobs - a.jobs);
  const maxJobs = Math.max(1, ...byService.map((r) => r.jobs));

  const managers = users
    .filter((u) => u.role === "field_manager")
    .map((u) => {
      const mine = inPeriod.filter((j) => j.assignedManagerId === u.id || j.assignedStaffIds.includes(u.id));
      const mineIds = new Set(mine.map((j) => j.id));
      const mineChecks = qualityChecks.filter((q) => mineIds.has(q.jobId));
      const r = mine.filter((j) => typeof j.customerFeedbackRating === "number");
      return {
        id: u.id,
        name: u.name,
        jobs: mine.length,
        completed: mine.filter((j) => DONE.includes(j.status)).length,
        rework: mineChecks.filter((q) => q.status !== "PASS").length,
        rating: r.length ? (r.reduce((a, j) => a + (j.customerFeedbackRating ?? 0), 0) / r.length).toFixed(1) : "—",
      };
    })
    .sort((a, b) => b.completed - a.completed);

  const metrics = [
    { label: "Jobs completed", value: String(done.length), hint: `${inPeriod.length} booked` },
    { label: "First-time QC pass", value: firstPass === null ? "—" : `${firstPass}%`, hint: "passed without rework", tone: firstPass !== null && firstPass < 80 ? "text-amber-700" : "text-emerald-700" },
    { label: "Customer rating", value: avgRating === null ? "—" : `${avgRating} ★`, hint: `${rated.length} rating${rated.length === 1 ? "" : "s"}` },
    showMoney
      ? { label: "Revenue (completed)", value: formatCurrency(revenue), hint: "from completed jobs" }
      : { label: "Repeat customers", value: repeat === null ? "—" : `${repeat}%`, hint: "booked more than once" },
  ];

  return (
    <AdminLayout>
      <PageHeader
        title="Reports"
        description="How the business is doing."
        actions={
          <div className="inline-flex rounded-xl bg-zinc-100 p-1" role="radiogroup" aria-label="Period">
            {([["month", "This month"], ["quarter", "3 months"], ["year", "This year"]] as const).map(([k, l]) => (
              <button key={k} role="radio" aria-checked={period === k} onClick={() => setPeriod(k)} className={cn("h-9 px-3.5 rounded-lg text-sm font-medium", period === k ? "bg-white shadow-sm font-semibold text-zinc-950" : "text-zinc-600")}>
                {l}
              </button>
            ))}
          </div>
        }
      />

      {loading && jobs.length === 0 ? (
        <SkeletonList rows={3} />
      ) : inPeriod.length === 0 ? (
        <EmptyState icon={BarChart3} title="No jobs in this period" description="Reports fill in as jobs are booked and completed." />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {metrics.map((m) => (
              <div key={m.label} className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5">
                <div className="text-sm text-zinc-500">{m.label}</div>
                <div className={cn("text-2xl sm:text-3xl font-semibold mt-1 break-words", "tone" in m && m.tone ? m.tone : "text-zinc-950")}>{m.value}</div>
                <div className="text-xs text-zinc-500 mt-1">{m.hint}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6">
              <h2 className="text-base font-semibold text-zinc-950 mb-4">Completed jobs by service</h2>
              {byService.length === 0 ? (
                <p className="text-sm text-zinc-500">No completed jobs yet in this period.</p>
              ) : (
                <ul className="space-y-4">
                  {byService.map((r) => (
                    <li key={r.id}>
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="font-medium text-zinc-900 min-w-0 truncate">{r.name}</span>
                        <span className="text-zinc-600 shrink-0">{r.jobs} job{r.jobs === 1 ? "" : "s"}{showMoney ? ` · ${formatCurrency(r.revenue)}` : ""}</span>
                      </div>
                      <div className="mt-1.5 h-2 rounded-full bg-zinc-100 overflow-hidden" aria-hidden>
                        <div className="h-full rounded-full bg-rose-500" style={{ width: `${(r.jobs / maxJobs) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6">
              <h2 className="text-base font-semibold text-zinc-950 mb-4">Customer issues</h2>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-zinc-50 p-4"><div className="text-sm text-zinc-500">Reported</div><div className="text-2xl font-semibold text-zinc-950">{issues.length}</div></div>
                <div className="rounded-xl bg-zinc-50 p-4"><div className="text-sm text-zinc-500">Still open</div><div className={cn("text-2xl font-semibold", openIssues ? "text-red-700" : "text-emerald-700")}>{openIssues}</div></div>
              </div>
              {repeat !== null && showMoney && <p className="text-sm text-zinc-600 mt-4"><strong className="text-zinc-950">{repeat}%</strong> of customers booked more than once.</p>}
            </section>
          </div>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-zinc-950">Field Managers</h2>
            {managers.length === 0 ? (
              <p className="text-sm text-zinc-500">No Field Managers yet.</p>
            ) : (
              <DataTable
                caption="Field Manager performance"
                rows={managers}
                rowKey={(m) => m.id}
                columns={[
                  { key: "name", header: "Field Manager", mobile: "title", cell: (m) => <span className="font-semibold">{m.name}</span> },
                  { key: "jobs", header: "Jobs", align: "right", cell: (m) => m.jobs },
                  { key: "done", header: "Completed", align: "right", cell: (m) => m.completed },
                  { key: "rework", header: "Rework rounds", align: "right", cell: (m) => <span className={m.rework ? "text-amber-700 font-semibold" : ""}>{m.rework}</span> },
                  { key: "rating", header: "Avg rating", align: "right", cell: (m) => m.rating },
                ]}
              />
            )}
          </section>
        </div>
      )}
    </AdminLayout>
  );
}
