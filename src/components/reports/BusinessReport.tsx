"use client";

import React from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Notice, SkeletonList } from "@/components/ui/states";
import { useApiList, inr, csvUrl } from "@/components/biz/Bits";
import { cn } from "@/lib/utils";

interface JobRow { jobId: string; jobNumber: string; date: string; customer: string; service: string; invoiced: number; collected: number; outstanding: number; revenue: number; directCosts: number; contribution: number; marginPercent: number | null }
interface StaffRow { employeeId: string; name: string; code: string; type: string; jobs: number; completed: number; hours: number; daysWorked: number; absent: number; leaveDays: number }
interface Amt { amount: number; count: number }
interface Data {
  range: { from: string; to: string };
  note: string | null;
  definitions: string[];
  money: { invoiced: number; gst: number; netRevenue: number; netCollected: number; outstanding: number; refunded: number; received: number; invoiceCount: number; gstInvoiceCount: number; nonGstInvoiceCount: number; gstInvoiced: number; nonGstInvoiced: number };
  costs: { counted: number; paid: number; count: number; tax: number; byCategory: { category: string; label: string; total: number; count: number }[] };
  obligations: { freelance: Amt; payroll: Amt; referralApproved: Amt; referralInReview: Amt; expensesPayable: Amt };
  result: { onInvoiced: number; onCash: number };
  jobs: JobRow[];
  jobTotals: { revenue: number; directCosts: number; contribution: number; marginPercent: number | null };
  staff: StaffRow[] | null;
  leaveByType: { type: string; days: number }[] | null;
  freelance: Record<string, Amt>;
  referrals: { total: number; registered: number; converted: number; conversionPercent: number; bonusPaid: number; bonusPending: number; revenueGenerated: number } | null;
}

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 min-w-0">
      <div className="text-sm text-zinc-500">{label}</div>
      <div className={cn("text-xl sm:text-2xl font-semibold mt-1 break-words", tone ?? "text-zinc-950")}>{value}</div>
      {hint && <div className="text-xs text-zinc-500 mt-1">{hint}</div>}
    </div>
  );
}

function Panel({ title, href, children }: { title: string; href?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-zinc-950">{title}</h2>
        {href && <a href={href} className="inline-flex items-center gap-1.5 min-h-10 px-3 rounded-xl border border-zinc-300 text-sm font-medium"><Download className="h-4 w-4" aria-hidden /> Export CSV</a>}
      </div>
      {children}
    </section>
  );
}

const FREE_LABEL: Record<string, string> = { PENDING_VERIFICATION: "Awaiting verification", VERIFIED: "Verified", APPROVED: "Approved", PAID: "Paid", REJECTED: "Rejected", CANCELLED: "Cancelled" };

/** Profitability, expenses, staff, freelance and referral reporting. Every figure comes from /api/reports/business. */
export function BusinessReport({ from, to, serviceId }: { from: string; to: string; serviceId: string }) {
  const [jobId, setJobId] = React.useState("");
  const [employeeId, setEmployeeId] = React.useState("");
  const params = { from, to, serviceId, jobId: jobId.trim() || undefined, employeeId };
  const { data, error, loading } = useApiList<Data>(() => csvUrl("/api/reports/business", params), [from, to, serviceId, jobId, employeeId]);
  const people = useApiList<{ rows: { id: string; fullName: string }[] }>(() => "/api/hr/employees?pageSize=200", []);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-2xl border border-zinc-200 bg-white p-4">
        <label className="space-y-1"><span className="text-sm font-medium text-zinc-800">Job (id)</span><input value={jobId} onChange={(e) => setJobId(e.target.value)} placeholder="Leave blank for all jobs" className="w-full h-11 rounded-xl border border-zinc-300 px-3 text-base sm:text-sm" /></label>
        <label className="space-y-1">
          <span className="text-sm font-medium text-zinc-800">Staff member</span>
          <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="w-full h-11 rounded-xl border border-zinc-300 bg-white px-3 text-base sm:text-sm">
            <option value="">All staff</option>
            {(people.data?.rows ?? []).map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
          </select>
        </label>
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {loading && !data ? <SkeletonList rows={3} /> : data && (
        <>
          {data.note && <Notice tone="info">{data.note}</Notice>}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile label="Revenue (before GST)" value={inr(data.money.netRevenue)} hint={`${data.money.invoiceCount} invoices · GST ${inr(data.money.gst)} shown separately`} />
            <Tile label="Collected" value={inr(data.money.netCollected)} hint={`Outstanding ${inr(data.money.outstanding)} · Refunded ${inr(data.money.refunded)}`} />
            <Tile label="Expenses counted" value={inr(data.costs.counted)} hint={`${data.costs.count} approved · ${inr(data.costs.paid)} paid`} />
            <Tile label="Operating result" value={inr(data.result.onInvoiced)} tone={data.result.onInvoiced < 0 ? "text-red-700" : "text-emerald-700"} hint={`Cash basis ${inr(data.result.onCash)}`} />
          </div>

          <Panel title="Money owed but not yet an expense">
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <Tile label="Freelance pay owed" value={inr(data.obligations.freelance.amount)} hint={`${data.obligations.freelance.count} payments`} />
              <Tile label="Payroll approved" value={inr(data.obligations.payroll.amount)} hint={`${data.obligations.payroll.count} records`} />
              <Tile label="Referral bonuses approved" value={inr(data.obligations.referralApproved.amount)} hint={`${data.obligations.referralApproved.count} unpaid`} />
              <Tile label="Referral bonuses in review" value={inr(data.obligations.referralInReview.amount)} hint={`${data.obligations.referralInReview.count} waiting`} />
              <Tile label="Expenses to pay" value={inr(data.obligations.expensesPayable.amount)} hint={`${data.obligations.expensesPayable.count} approved, unpaid`} />
            </div>
          </Panel>

          <Panel title="Job profitability" href={csvUrl("/api/reports/business", { ...params, format: "csv", section: "jobs" })}>
            <p className="text-sm text-zinc-600">Completed jobs in the range. Contribution = revenue − direct costs ({inr(data.jobTotals.revenue)} − {inr(data.jobTotals.directCosts)} = <strong>{inr(data.jobTotals.contribution)}</strong>{data.jobTotals.marginPercent !== null ? `, ${data.jobTotals.marginPercent}%` : ""}).</p>
            {data.jobs.length === 0 ? <p className="text-sm text-zinc-500">No completed jobs in this range.</p> : (
              <DataTable
                caption="Job profitability"
                rows={data.jobs}
                rowKey={(j) => j.jobId}
                href={(j) => `/jobs/${j.jobId}`}
                columns={[
                  { key: "n", header: "Job ID", mobile: "title", cell: (j) => <span className="font-mono font-semibold break-all">{j.jobNumber}</span> },
                  { key: "c", header: "Customer", mobile: "subtitle", cell: (j) => j.customer },
                  { key: "s", header: "Service", cell: (j) => j.service },
                  { key: "r", header: "Revenue", align: "right", cell: (j) => inr(j.revenue) },
                  { key: "co", header: "Direct costs", align: "right", cell: (j) => inr(j.directCosts) },
                  { key: "ct", header: "Contribution", align: "right", mobile: "badge", cell: (j) => <span className={cn("font-semibold", j.contribution < 0 ? "text-red-700" : "text-emerald-700")}>{inr(j.contribution)}</span> },
                  { key: "m", header: "Margin", align: "right", cell: (j) => (j.marginPercent === null ? "—" : `${j.marginPercent}%`) },
                  { key: "o", header: "Outstanding", align: "right", cell: (j) => inr(j.outstanding) },
                ]}
              />
            )}
          </Panel>

          <Panel title="Expenses by category" href={csvUrl("/api/reports/business", { ...params, format: "csv", section: "expenses" })}>
            {data.costs.byCategory.length === 0 ? <p className="text-sm text-zinc-500">No approved expenses in this range.</p> : (
              <DataTable caption="Expenses by category" rows={data.costs.byCategory} rowKey={(c) => c.category} pageSize={0} columns={[
                { key: "l", header: "Category", mobile: "title", cell: (c) => c.label },
                { key: "n", header: "Entries", align: "right", cell: (c) => c.count },
                { key: "t", header: "Total", align: "right", mobile: "badge", cell: (c) => <span className="font-semibold">{inr(c.total)}</span> },
              ]} />
            )}
          </Panel>

          <Panel title="Invoices: GST and non-GST">
            <div className="grid grid-cols-2 gap-3">
              <Tile label="GST invoices" value={inr(data.money.gstInvoiced)} hint={`${data.money.gstInvoiceCount} invoices`} />
              <Tile label="Non-GST invoices" value={inr(data.money.nonGstInvoiced)} hint={`${data.money.nonGstInvoiceCount} invoices`} />
            </div>
          </Panel>

          {data.staff && (
            <Panel title="Staff utilization and attendance" href={csvUrl("/api/reports/business", { ...params, format: "csv", section: "staff" })}>
              {data.staff.length === 0 ? <p className="text-sm text-zinc-500">No staff activity in this range.</p> : (
                <DataTable caption="Staff utilization" rows={data.staff} rowKey={(s) => s.employeeId} columns={[
                  { key: "n", header: "Name", mobile: "title", cell: (s) => <span className="font-semibold">{s.name}</span> },
                  { key: "c", header: "ID", mobile: "subtitle", cell: (s) => s.code },
                  { key: "j", header: "Jobs", align: "right", cell: (s) => `${s.completed}/${s.jobs}` },
                  { key: "h", header: "Hours", align: "right", cell: (s) => s.hours },
                  { key: "d", header: "Days worked", align: "right", cell: (s) => s.daysWorked },
                  { key: "a", header: "Absent", align: "right", cell: (s) => s.absent },
                  { key: "l", header: "Leave days", align: "right", cell: (s) => s.leaveDays },
                ]} />
              )}
              {data.leaveByType && data.leaveByType.length > 0 && <p className="text-sm text-zinc-600">Leave taken: {data.leaveByType.map((l) => `${l.type.toLowerCase()} ${l.days}d`).join(" · ")}</p>}
            </Panel>
          )}

          <Panel title="Freelance payments">
            {Object.keys(data.freelance).length === 0 ? <p className="text-sm text-zinc-500">No freelance payments in this range.</p> : (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {Object.entries(data.freelance).map(([s, v]) => <Tile key={s} label={FREE_LABEL[s] ?? s} value={inr(v.amount)} hint={`${v.count} payment${v.count === 1 ? "" : "s"}`} />)}
              </div>
            )}
          </Panel>

          {data.referrals && (
            <Panel title="Referrals">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Tile label="Referrals" value={String(data.referrals.total)} hint={`${data.referrals.registered} registered`} />
                <Tile label="Converted" value={`${data.referrals.conversionPercent}%`} hint={`${data.referrals.converted} qualifying jobs`} />
                <Tile label="Bonus paid" value={inr(data.referrals.bonusPaid)} hint={`${inr(data.referrals.bonusPending)} still to pay`} />
                <Tile label="Revenue generated" value={inr(data.referrals.revenueGenerated)} />
              </div>
            </Panel>
          )}

          <Panel title="How these figures are worked out">
            <ul className="list-disc pl-5 space-y-1.5 text-sm text-zinc-600">{data.definitions.map((d) => <li key={d}>{d}</li>)}</ul>
          </Panel>
        </>
      )}
    </div>
  );
}
