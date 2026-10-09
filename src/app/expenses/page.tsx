"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Download, Receipt, Search, Paperclip, Check, X, Ban, BadgeCheck } from "lucide-react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { PromptModal } from "@/components/common/PromptModal";
import { DataTable, Pager } from "@/components/ui/data-table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Notice, SkeletonList, ErrorState } from "@/components/ui/states";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { FilePick, Pill, SelectField, Stat, callApi, csvUrl, inr, textareaCls, uploadFile, useApiList } from "@/components/biz/Bits";
import { useApp } from "@/lib/app-context";
import { EXPENSE_CATEGORIES, PAYMENT_METHODS, SYSTEM_CATEGORIES, categoryLabel, methodLabel, type ExpenseRow } from "@/lib/business";
import { cn, formatDate, toLocalDateString } from "@/lib/utils";

interface ListData {
  rows: ExpenseRow[];
  total: number;
  page: number;
  pageSize: number;
  pendingApproval: number;
  summary: { count: number; total: number; tax: number; payable: number; payableCount: number; byCategory: { category: string; total: number; count: number }[]; byMonth: { month: string; total: number }[] } | null;
}

const blank = () => ({ date: toLocalDateString(), category: "CLEANING_SUPPLIES", description: "", amount: "", taxAmount: "", paymentMethod: "cash", paidBy: "", vendor: "", reference: "", jobId: "", employeeId: "", paymentStatus: "PAID", notes: "" });

/** Admin → Expenses: business costs and job costs, with receipts, approvals and export. */
export default function ExpensesPage() {
  const { jobs, customers } = useApp();
  const [f, setF] = useState({ from: "", to: "", category: "", jobId: "", paymentStatus: "", approvalStatus: "", q: "", sort: "date", dir: "desc" });
  const [page, setPage] = useState(1);
  const url = () => csvUrl("/api/expenses", { ...f, page: String(page), pageSize: "25" });
  const { data, error, loading, reload } = useApiList<ListData>(url, [f, page]);

  const [editing, setEditing] = useState<ExpenseRow | "new" | null>(null);
  const [reason, setReason] = useState<{ row: ExpenseRow; action: "reject" | "void" } | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const set = (patch: Partial<typeof f>) => {
    setPage(1);
    setF((x) => ({ ...x, ...patch }));
  };

  const act = async (row: ExpenseRow, action: string, reasonText?: string) => {
    const r = await callApi(`/api/expenses/${row.id}`, { method: "POST", json: { action, ...(reasonText ? { reason: reasonText } : {}) } });
    setNotice({ tone: r.error ? "error" : "success", text: r.error ?? "Done." });
    if (!r.error) void reload();
  };

  const custOf = (jobId: string) => customers.find((c) => c.id === jobs.find((j) => j.id === jobId)?.customerId)?.name;
  const s = data?.summary;
  const maxMonth = Math.max(1, ...(s?.byMonth.map((m) => m.total) ?? [1]));

  return (
    <AdminLayout>
      <PageHeader
        title="Expenses"
        description="Business costs and job costs. Payroll, freelance payments and referral bonuses appear here automatically when they are paid."
        actions={
          <>
            <a href={csvUrl("/api/expenses", { ...f, format: "csv" })} className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border border-zinc-300 bg-white text-sm font-semibold text-zinc-800 hover:bg-zinc-50"><Download className="h-4 w-4" aria-hidden /> Export CSV</a>
            <Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" aria-hidden /> New expense</Button>
          </>
        }
      />
      {notice && <Notice tone={notice.tone} className="mb-4">{notice.text}</Notice>}

      {s && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <Stat label="Total expenses" value={inr(s.total)} hint={`${s.count} approved, matching the filters`} />
            <Stat label="Tax included" value={inr(s.tax)} />
            <Stat label="Still to pay" value={inr(s.payable)} hint={`${s.payableCount} unpaid`} tone={s.payable > 0 ? "warn" : undefined} />
            <Stat label="Waiting for approval" value={data?.pendingApproval ?? 0} hint="submitted by Field Managers" tone={(data?.pendingApproval ?? 0) > 0 ? "warn" : undefined} />
          </div>
          {s.byMonth.length > 0 && (
            <section className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5 mb-4" aria-label="Expenses by month">
              <h2 className="text-sm font-semibold text-zinc-950 mb-3">By month</h2>
              <ul className="space-y-2">
                {s.byMonth.slice(-12).map((m) => (
                  <li key={m.month} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 text-sm">
                    <span className="text-zinc-600">{new Date(`${m.month}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "2-digit" })}</span>
                    <span className="h-2.5 rounded-full bg-zinc-100 overflow-hidden" aria-hidden><span className="block h-full rounded-full bg-rose-500" style={{ width: `${(m.total / maxMonth) * 100}%` }} /></span>
                    <span className="tabular-nums font-medium text-zinc-900">{inr(m.total)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <section className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5 mb-4 space-y-3" aria-label="Filters">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden />
          <Input value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder="Search description, vendor, expense ID" aria-label="Search expenses" className="pl-10" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Field label="From" htmlFor="ef-from"><Input id="ef-from" type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} /></Field>
          <Field label="To" htmlFor="ef-to"><Input id="ef-to" type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} /></Field>
          <SelectField label="Category" id="ef-cat" value={f.category} onChange={(v) => set({ category: v })}><option value="">All categories</option>{EXPENSE_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</SelectField>
          <SelectField label="Job" id="ef-job" value={f.jobId} onChange={(v) => set({ jobId: v })}><option value="">All jobs</option>{jobs.slice(0, 300).map((j) => <option key={j.id} value={j.id}>{j.jobNumber}</option>)}</SelectField>
          <SelectField label="Payment" id="ef-pay" value={f.paymentStatus} onChange={(v) => set({ paymentStatus: v })}><option value="">Paid and unpaid</option><option value="PAID">Paid</option><option value="PENDING">Unpaid</option></SelectField>
          <SelectField label="Approval" id="ef-appr" value={f.approvalStatus} onChange={(v) => set({ approvalStatus: v })}><option value="">Any</option><option value="APPROVED">Approved</option><option value="PENDING_APPROVAL">Waiting for approval</option><option value="REJECTED">Rejected</option></SelectField>
          <SelectField label="Sort by" id="ef-sort" value={`${f.sort}:${f.dir}`} onChange={(v) => { const [sort, dir] = v.split(":"); set({ sort, dir }); }}>
            <option value="date:desc">Newest date</option><option value="date:asc">Oldest date</option><option value="amount:desc">Highest amount</option><option value="amount:asc">Lowest amount</option><option value="createdAt:desc">Recently added</option>
          </SelectField>
        </div>
      </section>

      {error ? (
        <ErrorState message={error} onRetry={() => void reload()} />
      ) : !data ? (
        <SkeletonList rows={4} />
      ) : data.rows.length === 0 ? (
        <EmptyState icon={Receipt} title="No expenses found" description={f.q || f.from || f.to || f.category || f.jobId || f.paymentStatus || f.approvalStatus ? "Try clearing a filter." : "Record the first expense with “New expense”."} actionLabel="New expense" onAction={() => setEditing("new")} />
      ) : (
        <div className={cn(loading && "opacity-60 transition-opacity")}>
          <DataTable
            caption="Expenses"
            rows={data.rows}
            pageSize={0}
            rowKey={(r) => r.id}
            columns={[
              { key: "no", header: "Expense", mobile: "title", cell: (r) => <span className="font-mono font-semibold">{r.expenseNumber}</span> },
              { key: "desc", header: "Description", mobile: "subtitle", cell: (r) => <span className="break-words">{r.description}{r.vendor ? <span className="text-zinc-500"> · {r.vendor}</span> : null}</span> },
              { key: "status", header: "Status", mobile: "badge", cell: (r) => r.voided ? <Pill tone="bad">Voided</Pill> : r.approvalStatus === "PENDING_APPROVAL" ? <Pill tone="warn">Needs approval</Pill> : r.approvalStatus === "REJECTED" ? <Pill tone="bad">Rejected</Pill> : r.paymentStatus === "PENDING" ? <Pill tone="warn">Unpaid</Pill> : <Pill tone="good">Paid</Pill> },
              { key: "date", header: "Date", cell: (r) => formatDate(r.date) },
              { key: "cat", header: "Category", cell: (r) => categoryLabel(r.category) },
              { key: "amt", header: "Amount", align: "right", cell: (r) => <span className={cn("font-semibold tabular-nums", r.voided && "line-through text-zinc-400")}>{inr(r.amount)}</span> },
              { key: "job", header: "Job / staff", cell: (r) => <span className="break-words">{r.jobNumber ? <Link href={`/jobs/${r.jobId}`} className="font-mono text-rose-600 break-all">{r.jobNumber}</Link> : null}{r.jobNumber && r.employeeName ? " · " : null}{r.employeeName ?? (r.jobNumber ? "" : "—")}</span> },
              { key: "rec", header: "Receipt", cell: (r) => r.receipt ? <a href={`/api/files/${r.receipt.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-rose-600 font-medium"><Paperclip className="h-4 w-4" aria-hidden /> View</a> : <span className="text-zinc-400">—</span> },
            ]}
            actions={(r) => (
              <>
                {r.approvalStatus === "PENDING_APPROVAL" && !r.voided && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => void act(r, "approve")}><Check className="h-4 w-4 text-emerald-600" aria-hidden /> Approve</Button>
                    <Button size="sm" variant="ghost" onClick={() => setReason({ row: r, action: "reject" })}><X className="h-4 w-4 text-red-600" aria-hidden /> Reject</Button>
                  </>
                )}
                {!r.voided && r.approvalStatus === "APPROVED" && r.paymentStatus === "PENDING" && <Button size="sm" variant="outline" onClick={() => void act(r, "mark-paid")}><BadgeCheck className="h-4 w-4" aria-hidden /> Mark paid</Button>}
                {!r.voided && <Button size="sm" variant="outline" onClick={() => setEditing(r)}>Edit</Button>}
                {!r.voided && !r.source && <Button size="sm" variant="ghost" onClick={() => setReason({ row: r, action: "void" })}><Ban className="h-4 w-4 text-red-600" aria-hidden /> Void</Button>}
              </>
            )}
          />
          <Pager page={data.page} pages={Math.max(1, Math.ceil(data.total / data.pageSize))} total={data.total} pageSize={data.pageSize} onPage={setPage} />
        </div>
      )}

      {editing && (
        <ExpenseDialog
          row={editing === "new" ? null : editing}
          jobs={jobs.map((j) => ({ id: j.id, label: `${j.jobNumber} · ${custOf(j.id) ?? ""}` }))}
          onClose={() => setEditing(null)}
          onSaved={(text) => {
            setEditing(null);
            setNotice({ tone: "success", text });
            void reload();
          }}
        />
      )}
      <PromptModal
        isOpen={!!reason}
        onClose={() => setReason(null)}
        title={reason?.action === "void" ? "Void this expense?" : "Reject this expense?"}
        description={reason?.action === "void" ? "It stays in the records but is no longer counted. Say why." : "The Field Manager will see it as rejected. Say why."}
        placeholder="Reason"
        confirmText={reason?.action === "void" ? "Void expense" : "Reject"}
        onSubmit={(text) => {
          if (text.length < 3) return;
          const r = reason!;
          setReason(null);
          void act(r.row, r.action, text);
        }}
      />
    </AdminLayout>
  );
}

function ExpenseDialog({ row, jobs, onClose, onSaved }: { row: ExpenseRow | null; jobs: { id: string; label: string }[]; onClose: () => void; onSaved: (text: string) => void }) {
  const sourced = !!row?.source;
  const [v, setV] = useState(() => (row ? { date: row.date, category: row.category, description: row.description, amount: String(row.amount), taxAmount: row.taxAmount ? String(row.taxAmount) : "", paymentMethod: row.paymentMethod, paidBy: row.paidBy ?? "", vendor: row.vendor ?? "", reference: row.reference ?? "", jobId: row.jobId ?? "", employeeId: row.employeeId ?? "", paymentStatus: row.paymentStatus, notes: row.notes ?? "" } : blank()));
  const [file, setFile] = useState<File | null>(null);
  const [staff, setStaff] = useState<{ id: string; fullName: string; employeeCode: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  // One key per form: pressing Save twice (or a retry after a slow network) can't create two expenses.
  const key = useMemo(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2)}`), []);
  const up = (p: Partial<typeof v>) => setV((x) => ({ ...x, ...p }));
  useEffect(() => {
    void callApi<{ rows: { id: string; fullName: string; employeeCode: string }[] }>("/api/hr/employees?pageSize=100&status=ACTIVE").then((r) => r.data && setStaff(r.data.rows));
  }, []);

  const save = async (confirmDuplicate = false) => {
    setError(null);
    const amount = Number(v.amount);
    const tax = v.taxAmount === "" ? 0 : Number(v.taxAmount);
    if (!sourced) {
      if (!(amount > 0)) return setError("Enter the amount.");
      if (!(tax >= 0) || tax > amount) return setError("The tax amount can't be more than the total.");
      if (v.description.trim().length < 2) return setError("Describe the expense.");
    }
    setBusy(true);
    let receiptFileId: string | undefined;
    if (file) {
      const sent = await uploadFile(file, { ownerType: "expense", ownerId: row?.id, category: "RECEIPT" });
      if (sent.error || !sent.data) {
        setBusy(false);
        return setError(sent.error ?? "The receipt couldn't be uploaded.");
      }
      receiptFileId = sent.data.id;
    }
    const body = sourced
      ? { notes: v.notes }
      : { date: v.date, category: v.category, description: v.description, amount, taxAmount: tax, paymentMethod: v.paymentMethod, paidBy: v.paidBy || null, vendor: v.vendor || null, reference: v.reference || null, jobId: v.jobId || null, employeeId: v.employeeId || null, paymentStatus: v.paymentStatus, notes: v.notes || null };
    const r = row
      ? await callApi(`/api/expenses/${row.id}`, { method: "PATCH", json: { ...body, ...(receiptFileId ? { receiptFileId } : {}) } })
      : await callApi("/api/expenses", { method: "POST", json: { ...body, ...(receiptFileId ? { receiptFileId } : {}), idempotencyKey: key, confirmDuplicate } });
    setBusy(false);
    if (r.status === 409 && (r.extra as { duplicate?: boolean } | undefined)?.duplicate) {
      setDuplicate(true);
      return setError(r.error ?? "This looks like a duplicate.");
    }
    if (r.error) return setError(r.error);
    onSaved(row ? "Expense updated." : "Expense saved.");
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{row ? `Edit ${row.expenseNumber}` : "New expense"}</DialogTitle>
          <DialogDescription>{sourced ? "Created automatically from a payment. Only the notes and receipt can be changed." : "Amount is the total paid, including any tax."}</DialogDescription>
        </DialogHeader>
        {!sourced && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Expense date" htmlFor="ex-date" required><Input id="ex-date" type="date" value={v.date} max={toLocalDateString()} onChange={(e) => up({ date: e.target.value })} /></Field>
              <SelectField label="Category" id="ex-cat" value={v.category} onChange={(c) => up({ category: c })} required>
                {EXPENSE_CATEGORIES.filter((c) => !(SYSTEM_CATEGORIES.includes(c.key) && c.key !== "STAFF_WAGES" && c.key !== v.category)).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </SelectField>
            </div>
            {v.category === "STAFF_WAGES" && <Notice tone="info">Monthly salaries paid under HR → Payroll are added here automatically — don&apos;t enter them again. Use this for casual or daily wages only.</Notice>}
            <Field label="Description" htmlFor="ex-desc" required><Input id="ex-desc" value={v.description} onChange={(e) => up({ description: e.target.value })} maxLength={300} placeholder="e.g. Floor cleaner, 20 L" /></Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Amount (₹)" htmlFor="ex-amt" required><Input id="ex-amt" inputMode="decimal" value={v.amount} onChange={(e) => up({ amount: e.target.value })} placeholder="0" /></Field>
              <Field label="Of which tax (₹)" htmlFor="ex-tax" hint="If any"><Input id="ex-tax" inputMode="decimal" value={v.taxAmount} onChange={(e) => up({ taxAmount: e.target.value })} placeholder="0" /></Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <SelectField label="Payment method" id="ex-pm" value={v.paymentMethod} onChange={(m) => up({ paymentMethod: m })}>{PAYMENT_METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</SelectField>
              <SelectField label="Payment status" id="ex-ps" value={v.paymentStatus} onChange={(p) => up({ paymentStatus: p })}><option value="PAID">Paid</option><option value="PENDING">Not paid yet</option></SelectField>
              <Field label="Vendor or supplier" htmlFor="ex-vendor"><Input id="ex-vendor" value={v.vendor} onChange={(e) => up({ vendor: e.target.value })} maxLength={160} /></Field>
              <Field label="Paid by" htmlFor="ex-by" hint="Who spent the money"><Input id="ex-by" value={v.paidBy} onChange={(e) => up({ paidBy: e.target.value })} maxLength={120} /></Field>
              <Field label="Bill or reference no." htmlFor="ex-ref"><Input id="ex-ref" value={v.reference} onChange={(e) => up({ reference: e.target.value })} maxLength={120} /></Field>
              <div className="space-y-1.5">
                <div className="text-sm font-medium text-zinc-800">Related job</div>
                <SearchableSelect value={v.jobId} onChange={(j) => up({ jobId: j })} options={[{ value: "", label: "No job" }, ...jobs.map((j) => ({ value: j.id, label: j.label }))]} placeholder="Search job" />
              </div>
              <SelectField label="Related staff member" id="ex-staff" value={v.employeeId} onChange={(e) => up({ employeeId: e })}><option value="">None</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.fullName} ({s.employeeCode})</option>)}</SelectField>
            </div>
          </div>
        )}
        <FilePick file={file} onFile={setFile} existing={row?.receipt ? { id: row.receipt.id, fileName: row.receipt.fileName } : null} />
        <Field label="Notes" htmlFor="ex-notes"><textarea id="ex-notes" value={v.notes} onChange={(e) => up({ notes: e.target.value })} rows={2} maxLength={1000} className={textareaCls} /></Field>
        {error && <Notice tone="error">{error}</Notice>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {duplicate && <Button variant="outline" loading={busy} onClick={() => void save(true)}>Save anyway</Button>}
          <Button loading={busy} onClick={() => void save(false)}>{row ? "Save changes" : "Save expense"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
