"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Plus, Download, Search, Users, CalendarCheck, CalendarOff, Wallet, Check, X, Trash2, HandCoins } from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";
import { PromptModal } from "@/components/common/PromptModal";
import { DataTable, Pager } from "@/components/ui/data-table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Notice, SkeletonList, ErrorState } from "@/components/ui/states";
import { Pill, SelectField, Stat, callApi, csvUrl, inr, textareaCls, useApiList } from "@/components/biz/Bits";
import { EmployeeDialog } from "@/components/hr/EmployeeDialog";
import { ATTENDANCE_STATUSES, EMPLOYMENT_TYPES, LEAVE_TYPES, PAYMENT_METHODS, FREELANCE_STATUSES, employmentLabel, freelanceStatusLabel, methodLabel, type EmployeeRow } from "@/lib/business";
import { formatDate, toLocalDateString } from "@/lib/utils";

type Notify = (n: { tone: "success" | "error"; text: string }) => void;
const thisMonth = () => toLocalDateString().slice(0, 7);

/** Staff the pickers can choose from. */
function useStaff(freelanceOnly = false) {
  const { data } = useApiList<{ rows: EmployeeRow[] }>(() => `/api/hr/employees?pageSize=200${freelanceOnly ? "&type=FREELANCE" : ""}`, [freelanceOnly]);
  return data?.rows ?? [];
}

function Pages({ d, setPage }: { d: { page: number; total: number; pageSize: number }; setPage: (p: number) => void }) {
  return <Pager page={d.page} pages={Math.max(1, Math.ceil(d.total / d.pageSize))} total={d.total} pageSize={d.pageSize} onPage={setPage} />;
}

/* ------------------------------------------------------------------ Staff */

export function StaffTab({ notify, canManage }: { notify: Notify; canManage: boolean }) {
  const [f, setF] = useState({ q: "", type: "", status: "" });
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApiList<{ rows: EmployeeRow[]; total: number; page: number; pageSize: number }>(() => csvUrl("/api/hr/employees", { ...f, page: String(page), pageSize: "25" }), [f, page]);
  const [adding, setAdding] = useState<string | null>(null);
  const set = (p: Partial<typeof f>) => { setPage(1); setF((x) => ({ ...x, ...p })); };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 justify-end">
        <a href={csvUrl("/api/hr/employees", { ...f, format: "csv" })} className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border border-zinc-300 bg-white text-sm font-semibold text-zinc-800 hover:bg-zinc-50"><Download className="h-4 w-4" aria-hidden /> Export CSV</a>
        {canManage && <Button variant="outline" onClick={() => setAdding("FREELANCE")}><Plus className="h-4 w-4" aria-hidden /> Add freelancer</Button>}
        {canManage && <Button onClick={() => setAdding("PERMANENT")}><Plus className="h-4 w-4" aria-hidden /> Add staff</Button>}
      </div>
      <section className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5 space-y-3" aria-label="Filters">
        <div className="relative"><Search className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden /><Input value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder="Search name, ID, phone or designation" aria-label="Search staff" className="pl-10" /></div>
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Type" id="hs-type" value={f.type} onChange={(v) => set({ type: v })}><option value="">All</option>{EMPLOYMENT_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</SelectField>
          <SelectField label="Status" id="hs-status" value={f.status} onChange={(v) => set({ status: v })}><option value="">All</option><option value="ACTIVE">Active</option><option value="ON_LEAVE">On leave</option><option value="INACTIVE">Inactive</option><option value="EXITED">Left</option></SelectField>
        </div>
      </section>
      {error ? <ErrorState message={error} onRetry={() => void reload()} /> : !data ? <SkeletonList rows={4} /> : data.rows.length === 0 ? (
        <EmptyState icon={Users} title="No staff found" description={f.q || f.type || f.status ? "Try clearing a filter." : "Add your first staff member or freelancer."} actionLabel={canManage ? "Add staff" : undefined} onAction={canManage ? () => setAdding("PERMANENT") : undefined} />
      ) : (
        <div className={loading ? "opacity-60 transition-opacity" : undefined}>
          <DataTable
            caption="Staff"
            rows={data.rows}
            pageSize={0}
            rowKey={(r) => r.id}
            href={(r) => `/hr/${r.id}`}
            columns={[
              { key: "name", header: "Name", mobile: "title", cell: (r) => <span className="font-semibold">{r.fullName}</span> },
              { key: "code", header: "ID", mobile: "subtitle", cell: (r) => <span className="font-mono">{r.employeeCode}</span> },
              { key: "st", header: "Status", mobile: "badge", cell: (r) => <Pill tone={r.status === "ACTIVE" ? "good" : r.status === "ON_LEAVE" ? "warn" : "neutral"}>{r.status === "ON_LEAVE" ? "On leave" : r.status === "EXITED" ? "Left" : r.status.charAt(0) + r.status.slice(1).toLowerCase()}</Pill> },
              { key: "type", header: "Type", cell: (r) => <span>{employmentLabel(r.employmentType)}{r.employmentType === "FREELANCE" ? <span className="block text-xs text-zinc-500">{r.verificationStatus === "VERIFIED" ? "Verified" : `Verification ${r.verificationStatus.toLowerCase()}`}</span> : null}</span> },
              { key: "role", header: "Designation", cell: (r) => r.designation ?? "—" },
              { key: "phone", header: "Phone", cell: (r) => <a href={`tel:${r.phone}`} className="text-rose-600">{r.phone}</a> },
              { key: "skills", header: "Skills", cell: (r) => <span className="break-words">{r.skills.slice(0, 3).join(", ") || "—"}{r.skills.length > 3 ? ` +${r.skills.length - 3}` : ""}</span> },
            ]}
          />
          <Pages d={data} setPage={setPage} />
        </div>
      )}
      {adding && <EmployeeDialog defaultType={adding} onClose={() => setAdding(null)} onSaved={(e) => { setAdding(null); notify({ tone: "success", text: `${e.fullName} added as ${e.employeeCode}.` }); void reload(); }} />}
    </div>
  );
}

/* ------------------------------------------------------------- Attendance */

interface AttData {
  range: { start: string; end: string };
  records: { id: string; employeeId: string; employeeName: string; employeeCode: string; date: string; checkIn: string | null; checkOut: string | null; status: string; jobNumber: string | null; verificationMethod: string; corrected: boolean; correctionReason: string | null }[];
  summary: { employeeId: string; name: string; code: string; present: number; half: number; absent: number; leaveDays: number; daysWorked: number }[];
}

export function AttendanceTab({ notify }: { notify: Notify }) {
  const [month, setMonth] = useState(thisMonth());
  const { data, error, reload } = useApiList<AttData>(() => csvUrl("/api/hr/attendance", { month }), [month]);
  const staff = useStaff();
  const [recording, setRecording] = useState(false);
  const [fixing, setFixing] = useState<AttData["records"][number] | null>(null);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 justify-between">
        <Field label="Month" htmlFor="at-month"><Input id="at-month" type="month" value={month} max={thisMonth()} onChange={(e) => e.target.value && setMonth(e.target.value)} /></Field>
        <div className="flex gap-2">
          <a href={csvUrl("/api/hr/attendance", { month, format: "csv" })} className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border border-zinc-300 bg-white text-sm font-semibold text-zinc-800 hover:bg-zinc-50"><Download className="h-4 w-4" aria-hidden /> Export CSV</a>
          <Button onClick={() => setRecording(true)}><Plus className="h-4 w-4" aria-hidden /> Record attendance</Button>
        </div>
      </div>
      <p className="text-sm text-zinc-500">Attendance is recorded by hand (or by a Field Manager for their team). Arriving at a job location does not count as attendance by itself.</p>
      {error ? <ErrorState message={error} onRetry={() => void reload()} /> : !data ? <SkeletonList rows={3} /> : (
        <>
          <section aria-label="Monthly summary" className="space-y-2">
            <h2 className="text-base font-semibold text-zinc-950">Summary for {new Date(`${month}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</h2>
            {data.summary.length === 0 ? <p className="text-sm text-zinc-500">Nothing recorded this month.</p> : (
              <DataTable caption="Attendance summary" rows={data.summary} rowKey={(s) => s.employeeId} columns={[
                { key: "n", header: "Name", mobile: "title", cell: (s) => <span className="font-semibold">{s.name}</span> },
                { key: "c", header: "ID", mobile: "subtitle", cell: (s) => <span className="font-mono">{s.code}</span> },
                { key: "w", header: "Days worked", align: "right", cell: (s) => <span className="font-semibold tabular-nums">{s.daysWorked}</span> },
                { key: "p", header: "Present", align: "right", cell: (s) => s.present },
                { key: "h", header: "Half days", align: "right", cell: (s) => s.half },
                { key: "a", header: "Absent", align: "right", cell: (s) => s.absent },
                { key: "l", header: "Leave", align: "right", cell: (s) => s.leaveDays },
              ]} />
            )}
          </section>
          <section aria-label="Records" className="space-y-2">
            <h2 className="text-base font-semibold text-zinc-950">Records</h2>
            {data.records.length === 0 ? <EmptyState icon={CalendarCheck} title="No attendance recorded" description="Use “Record attendance” to add a day." /> : (
              <DataTable caption="Attendance records" rows={data.records} rowKey={(r) => r.id} columns={[
                { key: "d", header: "Date", mobile: "title", cell: (r) => formatDate(r.date) },
                { key: "n", header: "Staff", mobile: "subtitle", cell: (r) => `${r.employeeName} (${r.employeeCode})` },
                { key: "s", header: "Status", mobile: "badge", cell: (r) => <Pill tone={r.status === "PRESENT" ? "good" : r.status === "ABSENT" ? "bad" : "neutral"}>{ATTENDANCE_STATUSES.find((s) => s.key === r.status)?.label ?? r.status}</Pill> },
                { key: "i", header: "In", cell: (r) => (r.checkIn ? new Date(r.checkIn).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "—") },
                { key: "o", header: "Out", cell: (r) => (r.checkOut ? new Date(r.checkOut).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "—") },
                { key: "j", header: "Job", cell: (r) => r.jobNumber ?? "—" },
                { key: "v", header: "Verified by", cell: (r) => (r.verificationMethod === "NONE" ? "—" : r.verificationMethod) },
                { key: "c", header: "Note", cell: (r) => (r.corrected ? <span className="text-amber-700 break-words">Corrected: {r.correctionReason}</span> : "") },
              ]} actions={(r) => <Button size="sm" variant="outline" onClick={() => setFixing(r)}>Correct</Button>} />
            )}
          </section>
        </>
      )}
      {recording && <RecordDialog staff={staff} onClose={() => setRecording(false)} onDone={(t) => { setRecording(false); notify({ tone: "success", text: t }); void reload(); }} />}
      {fixing && <CorrectDialog rec={fixing} onClose={() => setFixing(null)} onDone={() => { setFixing(null); notify({ tone: "success", text: "Attendance corrected." }); void reload(); }} />}
    </div>
  );
}

function RecordDialog({ staff, onClose, onDone }: { staff: EmployeeRow[]; onClose: () => void; onDone: (t: string) => void }) {
  const [v, setV] = useState({ employeeId: "", date: toLocalDateString(), action: "check-in", status: "PRESENT", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!v.employeeId) return setError("Choose the staff member.");
    setBusy(true);
    setError(null);
    const r = await callApi("/api/hr/attendance", { method: "POST", json: { employeeId: v.employeeId, date: v.date, action: v.action, ...(v.action === "mark" ? { status: v.status } : {}), verificationMethod: "MANUAL", notes: v.notes || null } });
    setBusy(false);
    if (r.error) return setError(r.error);
    onDone("Attendance recorded.");
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Record attendance</DialogTitle><DialogDescription>A day that already has a record can only be changed with a correction.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <SelectField label="Staff member" id="ra-emp" value={v.employeeId} onChange={(x) => setV({ ...v, employeeId: x })} required><option value="">Choose…</option>{staff.filter((s) => s.status !== "EXITED").map((s) => <option key={s.id} value={s.id}>{s.fullName} ({s.employeeCode})</option>)}</SelectField>
          <Field label="Date" htmlFor="ra-date"><Input id="ra-date" type="date" value={v.date} max={toLocalDateString()} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
          <SelectField label="What happened" id="ra-act" value={v.action} onChange={(x) => setV({ ...v, action: x })}><option value="check-in">Checked in now</option><option value="check-out">Checked out now</option><option value="mark">Mark the day (absent, half day, leave…)</option></SelectField>
          {v.action === "mark" && <SelectField label="Status" id="ra-st" value={v.status} onChange={(x) => setV({ ...v, status: x })}>{ATTENDANCE_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</SelectField>}
          <Field label="Notes" htmlFor="ra-n"><Input id="ra-n" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} maxLength={300} /></Field>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={() => void save()}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CorrectDialog({ rec, onClose, onDone }: { rec: AttData["records"][number]; onClose: () => void; onDone: () => void }) {
  const [status, setStatus] = useState(rec.status);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Correct attendance</DialogTitle><DialogDescription>{rec.employeeName} · {formatDate(rec.date)}. The reason and who changed it are kept on the record.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <SelectField label="Status" id="ca-st" value={status} onChange={setStatus}>{ATTENDANCE_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</SelectField>
          <Field label="Reason for the correction" htmlFor="ca-r" required><textarea id="ca-r" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className={textareaCls} maxLength={300} /></Field>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={async () => { if (reason.trim().length < 3) return setError("Say why it is being corrected."); setBusy(true); const r = await callApi(`/api/hr/attendance/${rec.id}`, { method: "PATCH", json: { status, reason } }); setBusy(false); if (r.error) return setError(r.error); onDone(); }}>Save correction</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ Leave */

interface LeaveRow { id: string; employeeName: string; employeeCode: string; leaveType: string; startDate: string; endDate: string; days: number; reason: string; status: string; approverName: string | null; decidedAt: string | null; decisionNote: string | null }

export function LeaveTab({ notify }: { notify: Notify }) {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const { data, error, reload } = useApiList<{ rows: LeaveRow[]; total: number; page: number; pageSize: number; pending: number }>(() => csvUrl("/api/hr/leave", { status, page: String(page) }), [status, page]);
  const staff = useStaff();
  const [adding, setAdding] = useState(false);
  const [rejecting, setRejecting] = useState<LeaveRow | null>(null);
  const act = async (l: LeaveRow, action: string, note?: string) => {
    const r = await callApi(`/api/hr/leave/${l.id}`, { method: "POST", json: { action, note } });
    notify({ tone: r.error ? "error" : "success", text: r.error ?? "Done." });
    if (!r.error) void reload();
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 justify-between">
        <SelectField label="Show" id="lv-st" value={status} onChange={(v) => { setPage(1); setStatus(v); }}><option value="">All requests</option><option value="PENDING">Waiting for a decision</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option><option value="CANCELLED">Cancelled</option></SelectField>
        <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" aria-hidden /> Add leave request</Button>
      </div>
      {data && data.pending > 0 && <Notice tone="info">{data.pending} request{data.pending === 1 ? " is" : "s are"} waiting for a decision.</Notice>}
      {error ? <ErrorState message={error} onRetry={() => void reload()} /> : !data ? <SkeletonList rows={3} /> : data.rows.length === 0 ? <EmptyState icon={CalendarOff} title="No leave requests" description="Add one when someone asks for time off." /> : (
        <>
          <DataTable caption="Leave requests" rows={data.rows} pageSize={0} rowKey={(l) => l.id} columns={[
            { key: "n", header: "Staff", mobile: "title", cell: (l) => <span className="font-semibold">{l.employeeName}</span> },
            { key: "d", header: "Dates", mobile: "subtitle", cell: (l) => `${formatDate(l.startDate)}${l.endDate !== l.startDate ? ` – ${formatDate(l.endDate)}` : ""} · ${l.days} day${l.days === 1 ? "" : "s"}` },
            { key: "s", header: "Status", mobile: "badge", cell: (l) => <Pill tone={l.status === "APPROVED" ? "good" : l.status === "PENDING" ? "warn" : l.status === "REJECTED" ? "bad" : "neutral"}>{l.status.charAt(0) + l.status.slice(1).toLowerCase()}</Pill> },
            { key: "t", header: "Type", cell: (l) => LEAVE_TYPES.find((t) => t.key === l.leaveType)?.label ?? l.leaveType },
            { key: "r", header: "Reason", cell: (l) => <span className="break-words">{l.reason}</span> },
            { key: "a", header: "Decision", cell: (l) => (l.approverName ? <span>{l.approverName}<span className="block text-xs text-zinc-500">{l.decidedAt ? formatDate(l.decidedAt) : ""}{l.decisionNote ? ` · ${l.decisionNote}` : ""}</span></span> : "—") },
          ]} actions={(l) => (
            <>
              {l.status === "PENDING" && <><Button size="sm" variant="outline" onClick={() => void act(l, "approve")}><Check className="h-4 w-4 text-emerald-600" aria-hidden /> Approve</Button><Button size="sm" variant="ghost" onClick={() => setRejecting(l)}><X className="h-4 w-4 text-red-600" aria-hidden /> Reject</Button></>}
              {(l.status === "PENDING" || l.status === "APPROVED") && <Button size="sm" variant="ghost" onClick={() => void act(l, "cancel")}>Cancel</Button>}
            </>
          )} />
          <Pages d={data} setPage={setPage} />
        </>
      )}
      {adding && <LeaveDialog staff={staff} onClose={() => setAdding(false)} onDone={() => { setAdding(false); notify({ tone: "success", text: "Leave request added." }); void reload(); }} />}
      <PromptModal isOpen={!!rejecting} onClose={() => setRejecting(null)} title="Reject this leave?" description="Say why." placeholder="Reason" confirmText="Reject" onSubmit={(t) => { if (t.length < 3 || !rejecting) return; const l = rejecting; setRejecting(null); void act(l, "reject", t); }} />
    </div>
  );
}

function LeaveDialog({ staff, onClose, onDone }: { staff: EmployeeRow[]; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState({ employeeId: "", leaveType: "CASUAL", startDate: toLocalDateString(), endDate: toLocalDateString(), halfDay: false, reason: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Add leave request</DialogTitle><DialogDescription>It stays pending until you approve or reject it.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <SelectField label="Staff member" id="lr-emp" value={v.employeeId} onChange={(x) => setV({ ...v, employeeId: x })} required><option value="">Choose…</option>{staff.filter((s) => s.status !== "EXITED").map((s) => <option key={s.id} value={s.id}>{s.fullName} ({s.employeeCode})</option>)}</SelectField>
          <SelectField label="Leave type" id="lr-type" value={v.leaveType} onChange={(x) => setV({ ...v, leaveType: x })}>{LEAVE_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</SelectField>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From" htmlFor="lr-from"><Input id="lr-from" type="date" value={v.startDate} onChange={(e) => setV({ ...v, startDate: e.target.value, endDate: v.endDate < e.target.value ? e.target.value : v.endDate })} /></Field>
            <Field label="To" htmlFor="lr-to"><Input id="lr-to" type="date" value={v.endDate} min={v.startDate} onChange={(e) => setV({ ...v, endDate: e.target.value })} /></Field>
          </div>
          <label className="flex items-center gap-3 min-h-11 text-sm font-medium text-zinc-800"><input type="checkbox" checked={v.halfDay} onChange={(e) => setV({ ...v, halfDay: e.target.checked, endDate: e.target.checked ? v.startDate : v.endDate })} className="h-5 w-5 accent-rose-500" /> Half day (single day only)</label>
          <Field label="Reason" htmlFor="lr-r" required><textarea id="lr-r" rows={2} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} className={textareaCls} maxLength={300} /></Field>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={async () => { if (!v.employeeId) return setError("Choose the staff member."); setBusy(true); setError(null); const r = await callApi("/api/hr/leave", { method: "POST", json: v }); setBusy(false); if (r.error) return setError(r.error); onDone(); }}>Save request</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- Payroll */

interface PayRow { id: string; employeeId: string; employeeName: string; employeeCode: string; period: string; basic: number; allowances: number; deductions: number; advances: number; bonuses: number; netPayable: number; status: string; notes: string | null; approvedBy: string | null; paidAt: string | null; paymentMethod: string | null }

export function PayrollTab({ notify }: { notify: Notify }) {
  const [period, setPeriod] = useState(thisMonth());
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const { data, error, reload } = useApiList<{ rows: PayRow[]; total: number; page: number; pageSize: number; totals: Record<string, { amount: number; count: number }> }>(() => csvUrl("/api/hr/payroll", { period, status, page: String(page) }), [period, status, page]);
  const staff = useStaff();
  const [editing, setEditing] = useState<PayRow | "new" | null>(null);
  const [paying, setPaying] = useState<PayRow | null>(null);
  const act = async (p: PayRow, body: Record<string, unknown>, text: string) => {
    const r = await callApi(`/api/hr/payroll/${p.id}`, { method: "POST", json: body });
    notify({ tone: r.error ? "error" : "success", text: r.error ?? text });
    if (!r.error) void reload();
    return !r.error;
  };
  const T = data?.totals ?? {};
  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-500">Payroll is for employees and contract staff. Freelancers are paid per job under “Freelance pay”. A paid salary is added to Expenses automatically — don&apos;t enter it there again.</p>
      <div className="flex flex-wrap items-end gap-3 justify-between">
        <div className="flex gap-3">
          <Field label="Month" htmlFor="pr-m"><Input id="pr-m" type="month" value={period} onChange={(e) => { setPage(1); setPeriod(e.target.value); }} /></Field>
          <SelectField label="Status" id="pr-s" value={status} onChange={(v) => { setPage(1); setStatus(v); }}><option value="">All</option><option value="DRAFT">Draft</option><option value="APPROVED">Approved</option><option value="PAID">Paid</option></SelectField>
        </div>
        <div className="flex gap-2">
          <a href={csvUrl("/api/hr/payroll", { period, status, format: "csv" })} className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border border-zinc-300 bg-white text-sm font-semibold text-zinc-800 hover:bg-zinc-50"><Download className="h-4 w-4" aria-hidden /> Export CSV</a>
          <Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" aria-hidden /> New payroll</Button>
        </div>
      </div>
      {data && <div className="grid grid-cols-3 gap-3"><Stat label="Draft" value={inr(T.DRAFT?.amount)} hint={`${T.DRAFT?.count ?? 0} records`} /><Stat label="Approved, to pay" value={inr(T.APPROVED?.amount)} hint={`${T.APPROVED?.count ?? 0} records`} tone={(T.APPROVED?.count ?? 0) > 0 ? "warn" : undefined} /><Stat label="Paid" value={inr(T.PAID?.amount)} hint={`${T.PAID?.count ?? 0} records`} tone="good" /></div>}
      {error ? <ErrorState message={error} onRetry={() => void reload()} /> : !data ? <SkeletonList rows={3} /> : data.rows.length === 0 ? <EmptyState icon={Wallet} title="No payroll records" description="Create one for each person each month." actionLabel="New payroll" onAction={() => setEditing("new")} /> : (
        <>
          <DataTable caption="Payroll" rows={data.rows} pageSize={0} rowKey={(p) => p.id} columns={[
            { key: "n", header: "Staff", mobile: "title", cell: (p) => <span className="font-semibold">{p.employeeName}</span> },
            { key: "p", header: "Month", mobile: "subtitle", cell: (p) => p.period },
            { key: "s", header: "Status", mobile: "badge", cell: (p) => <Pill tone={p.status === "PAID" ? "good" : p.status === "APPROVED" ? "info" : "neutral"}>{p.status.charAt(0) + p.status.slice(1).toLowerCase()}</Pill> },
            { key: "b", header: "Basic", align: "right", cell: (p) => inr(p.basic) },
            { key: "a", header: "Allowances + bonus", align: "right", cell: (p) => inr(p.allowances + p.bonuses) },
            { key: "d", header: "Deductions + advances", align: "right", cell: (p) => inr(p.deductions + p.advances) },
            { key: "net", header: "Net payable", align: "right", cell: (p) => <span className="font-semibold tabular-nums">{inr(p.netPayable)}</span> },
            { key: "paid", header: "Paid", cell: (p) => (p.paidAt ? `${formatDate(p.paidAt)} · ${methodLabel(p.paymentMethod)}` : "—") },
          ]} actions={(p) => (
            <>
              {p.status === "DRAFT" && <><Button size="sm" variant="outline" onClick={() => setEditing(p)}>Edit</Button><Button size="sm" variant="outline" onClick={() => void act(p, { action: "approve" }, "Payroll approved.")}><Check className="h-4 w-4 text-emerald-600" aria-hidden /> Approve</Button><Button size="sm" variant="ghost" aria-label="Delete draft" onClick={async () => { const r = await callApi(`/api/hr/payroll/${p.id}`, { method: "DELETE" }); notify({ tone: r.error ? "error" : "success", text: r.error ?? "Draft deleted." }); if (!r.error) void reload(); }}><Trash2 className="h-4 w-4 text-red-600" aria-hidden /></Button></>}
              {p.status === "APPROVED" && <Button size="sm" onClick={() => setPaying(p)}><Wallet className="h-4 w-4" aria-hidden /> Record payment</Button>}
            </>
          )} />
          <Pages d={data} setPage={setPage} />
        </>
      )}
      {editing && <PayrollDialog row={editing === "new" ? null : editing} staff={staff.filter((s) => s.employmentType !== "FREELANCE")} period={period} onClose={() => setEditing(null)} onDone={() => { setEditing(null); notify({ tone: "success", text: "Payroll saved." }); void reload(); }} />}
      {paying && <PayDialog title="Record salary payment" subtitle={`${paying.employeeName} · ${paying.period} · ${inr(paying.netPayable)}`} onClose={() => setPaying(null)} onPay={async (b) => { if (await act(paying, { action: "pay", ...b }, "Payment recorded and added to Expenses.")) setPaying(null); }} />}
    </div>
  );
}

function PayrollDialog({ row, staff, period, onClose, onDone }: { row: PayRow | null; staff: EmployeeRow[]; period: string; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState({ employeeId: row?.employeeId ?? "", period: row?.period ?? period, basic: row ? String(row.basic) : "", allowances: row ? String(row.allowances) : "0", bonuses: row ? String(row.bonuses) : "0", deductions: row ? String(row.deductions) : "0", advances: row ? String(row.advances) : "0", notes: row?.notes ?? "" });
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = (s: string) => (s === "" ? 0 : Number(s));
  const net = Math.round((n(v.basic) + n(v.allowances) + n(v.bonuses) - n(v.deductions) - n(v.advances)) * 100) / 100;
  const suggest = async () => {
    if (!v.employeeId) return setError("Choose the staff member first.");
    setError(null);
    const r = await callApi<{ basic: number; note: string; daysWorked: number; hoursWorked: number }>(`/api/hr/payroll?suggest=1&employeeId=${v.employeeId}&period=${v.period}`);
    if (r.error || !r.data) return setError(r.error ?? "No suggestion.");
    setV((x) => ({ ...x, basic: String(r.data!.basic) }));
    setHint(`${r.data.note} (${r.data.daysWorked} days, ${r.data.hoursWorked} h recorded)`);
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{row ? "Edit payroll" : "New payroll"}</DialogTitle><DialogDescription>One record per person per month. Net payable is worked out for you.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <SelectField label="Staff member" id="pd-emp" value={v.employeeId} onChange={(x) => setV({ ...v, employeeId: x })} disabled={!!row} required><option value="">Choose…</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.fullName} ({s.employeeCode})</option>)}</SelectField>
            <Field label="Pay month" htmlFor="pd-m"><Input id="pd-m" type="month" value={v.period} disabled={!!row} onChange={(e) => setV({ ...v, period: e.target.value })} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Basic pay (₹)" htmlFor="pd-b" required hint={hint ?? undefined}><Input id="pd-b" inputMode="decimal" value={v.basic} onChange={(e) => setV({ ...v, basic: e.target.value })} /></Field>
            <div className="flex items-end"><Button variant="outline" className="w-full" onClick={() => void suggest()} disabled={!!row}>Suggest from attendance</Button></div>
            <Field label="Allowances (₹)" htmlFor="pd-al"><Input id="pd-al" inputMode="decimal" value={v.allowances} onChange={(e) => setV({ ...v, allowances: e.target.value })} /></Field>
            <Field label="Approved bonus (₹)" htmlFor="pd-bo"><Input id="pd-bo" inputMode="decimal" value={v.bonuses} onChange={(e) => setV({ ...v, bonuses: e.target.value })} /></Field>
            <Field label="Deductions (₹)" htmlFor="pd-de"><Input id="pd-de" inputMode="decimal" value={v.deductions} onChange={(e) => setV({ ...v, deductions: e.target.value })} /></Field>
            <Field label="Advances to recover (₹)" htmlFor="pd-ad" hint="Record the advance as an expense when it is given"><Input id="pd-ad" inputMode="decimal" value={v.advances} onChange={(e) => setV({ ...v, advances: e.target.value })} /></Field>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-zinc-50 px-4 py-3 text-sm"><span className="text-zinc-600">Net payable</span><span className={net < 0 ? "font-semibold text-red-700" : "font-semibold text-zinc-950"}>{inr(net)}</span></div>
          <Field label="Notes" htmlFor="pd-n"><Input id="pd-n" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} maxLength={500} /></Field>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={async () => { if (!v.employeeId) return setError("Choose the staff member."); if (net < 0) return setError("Deductions and advances are more than the pay."); setBusy(true); setError(null); const body = { basic: n(v.basic), allowances: n(v.allowances), bonuses: n(v.bonuses), deductions: n(v.deductions), advances: n(v.advances), notes: v.notes || null }; const r = row ? await callApi(`/api/hr/payroll/${row.id}`, { method: "PATCH", json: body }) : await callApi("/api/hr/payroll", { method: "POST", json: { ...body, employeeId: v.employeeId, period: v.period } }); setBusy(false); if (r.error) return setError(r.error); onDone(); }}>Save draft</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Method / reference / date for recording a payment that has been made. */
export function PayDialog({ title, subtitle, onClose, onPay }: { title: string; subtitle: string; onClose: () => void; onPay: (b: { paymentMethod: string; paymentReference?: string; paidOn: string }) => Promise<void> }) {
  const [method, setMethod] = useState("bank_transfer");
  const [ref, setRef] = useState("");
  const [day, setDay] = useState(toLocalDateString());
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{subtitle}. Record it only after the money has been sent — it is added to Expenses and can&apos;t be recorded twice.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <SelectField label="Paid by" id="pay-m" value={method} onChange={setMethod}>{PAYMENT_METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</SelectField>
          <Field label="Transaction reference" htmlFor="pay-r"><Input id="pay-r" value={ref} onChange={(e) => setRef(e.target.value)} maxLength={120} /></Field>
          <Field label="Payment date" htmlFor="pay-d"><Input id="pay-d" type="date" value={day} max={toLocalDateString()} onChange={(e) => setDay(e.target.value)} /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={async () => { setBusy(true); await onPay({ paymentMethod: method, paymentReference: ref || undefined, paidOn: day }); setBusy(false); }}>Record payment</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------- Freelance pay */

interface FpRow { id: string; paymentNumber: string; employeeName: string; employeeCode: string; jobId: string; jobNumber: string; jobDate: string; service: string; rateType: string; rate: number; hours: number | null; amount: number; status: string; verifiedBy: string | null; approvedBy: string | null; paidAt: string | null; paymentMethod: string | null; rejectionReason: string | null }

export function FreelanceTab({ notify }: { notify: Notify }) {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const { data, error, reload } = useApiList<{ rows: FpRow[]; total: number; page: number; pageSize: number; totals: Record<string, { amount: number; count: number }> }>(() => csvUrl("/api/hr/freelance-payments", { status, page: String(page) }), [status, page]);
  const [verifying, setVerifying] = useState<FpRow | null>(null);
  const [paying, setPaying] = useState<FpRow | null>(null);
  const [rejecting, setRejecting] = useState<FpRow | null>(null);
  const act = async (p: FpRow, body: Record<string, unknown>, text: string) => {
    const r = await callApi(`/api/hr/freelance-payments/${p.id}`, { method: "POST", json: body });
    notify({ tone: r.error ? "error" : "success", text: r.error ?? text });
    if (!r.error) void reload();
    return !r.error;
  };
  const T = data?.totals ?? {};
  const pendingAmt = (T.PENDING_VERIFICATION?.amount ?? 0) + (T.VERIFIED?.amount ?? 0) + (T.APPROVED?.amount ?? 0);
  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-500">When a job a freelancer worked is completed, a payment record appears here. Verify the work, approve the payment, then record it once it has been paid.</p>
      <div className="flex flex-wrap items-end gap-3 justify-between">
        <SelectField label="Show" id="fp-st" value={status} onChange={(v) => { setPage(1); setStatus(v); }}><option value="">All</option>{FREELANCE_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</SelectField>
        <a href={csvUrl("/api/hr/freelance-payments", { status, format: "csv" })} className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border border-zinc-300 bg-white text-sm font-semibold text-zinc-800 hover:bg-zinc-50"><Download className="h-4 w-4" aria-hidden /> Export CSV</a>
      </div>
      {data && <div className="grid grid-cols-2 lg:grid-cols-4 gap-3"><Stat label="Awaiting verification" value={inr(T.PENDING_VERIFICATION?.amount)} hint={`${T.PENDING_VERIFICATION?.count ?? 0} payments`} tone={(T.PENDING_VERIFICATION?.count ?? 0) > 0 ? "warn" : undefined} /><Stat label="Verified, to approve" value={inr(T.VERIFIED?.amount)} hint={`${T.VERIFIED?.count ?? 0} payments`} /><Stat label="Approved, to pay" value={inr(T.APPROVED?.amount)} hint={`${T.APPROVED?.count ?? 0} payments`} tone={(T.APPROVED?.count ?? 0) > 0 ? "warn" : undefined} /><Stat label="Paid" value={inr(T.PAID?.amount)} hint={`${inr(pendingAmt)} still owed`} tone="good" /></div>}
      {error ? <ErrorState message={error} onRetry={() => void reload()} /> : !data ? <SkeletonList rows={3} /> : data.rows.length === 0 ? <EmptyState icon={HandCoins} title="No freelance payments" description="They appear here after a freelancer's job is completed." /> : (
        <>
          <DataTable caption="Freelance payments" rows={data.rows} pageSize={0} rowKey={(p) => p.id} columns={[
            { key: "n", header: "Freelancer", mobile: "title", cell: (p) => <span className="font-semibold">{p.employeeName}</span> },
            { key: "j", header: "Job", mobile: "subtitle", cell: (p) => <Link href={`/jobs/${p.jobId}`} className="font-mono text-rose-600 break-all">{p.jobNumber}</Link> },
            { key: "s", header: "Status", mobile: "badge", cell: (p) => <Pill tone={p.status === "PAID" ? "good" : p.status === "APPROVED" ? "info" : p.status === "REJECTED" ? "bad" : "warn"}>{freelanceStatusLabel(p.status)}</Pill> },
            { key: "no", header: "Payment", cell: (p) => <span className="font-mono">{p.paymentNumber}</span> },
            { key: "d", header: "Job date", cell: (p) => formatDate(p.jobDate) },
            { key: "r", header: "Rate", cell: (p) => (p.rateType === "HOURLY" ? `${inr(p.rate)}/h${p.hours ? ` × ${p.hours} h` : ""}` : `${inr(p.rate)} fixed`) },
            { key: "a", header: "Amount", align: "right", cell: (p) => <span className="font-semibold tabular-nums">{inr(p.amount)}</span> },
            { key: "p", header: "Paid", cell: (p) => (p.paidAt ? `${formatDate(p.paidAt)} · ${methodLabel(p.paymentMethod)}` : p.rejectionReason ?? "—") },
          ]} actions={(p) => (
            <>
              {p.status === "PENDING_VERIFICATION" && <Button size="sm" variant="outline" onClick={() => (p.rateType === "HOURLY" ? setVerifying(p) : void act(p, { action: "verify" }, "Work verified."))}><Check className="h-4 w-4 text-emerald-600" aria-hidden /> Verify work</Button>}
              {p.status === "VERIFIED" && <Button size="sm" variant="outline" onClick={() => void act(p, { action: "approve" }, "Payment approved.")}><Check className="h-4 w-4 text-emerald-600" aria-hidden /> Approve</Button>}
              {p.status === "APPROVED" && <Button size="sm" onClick={() => setPaying(p)}><Wallet className="h-4 w-4" aria-hidden /> Record payment</Button>}
              {["PENDING_VERIFICATION", "VERIFIED", "APPROVED"].includes(p.status) && <Button size="sm" variant="ghost" onClick={() => setRejecting(p)}><X className="h-4 w-4 text-red-600" aria-hidden /> Reject</Button>}
            </>
          )} />
          <Pages d={data} setPage={setPage} />
        </>
      )}
      {verifying && <HoursDialog row={verifying} onClose={() => setVerifying(null)} onDone={async (hours) => { if (await act(verifying, { action: "verify", hours }, "Work verified.")) setVerifying(null); }} />}
      {paying && <PayDialog title="Record freelance payment" subtitle={`${paying.employeeName} · ${paying.jobNumber} · ${inr(paying.amount)}`} onClose={() => setPaying(null)} onPay={async (b) => { if (await act(paying, { action: "pay", ...b }, "Payment recorded and added to Expenses.")) setPaying(null); }} />}
      <PromptModal isOpen={!!rejecting} onClose={() => setRejecting(null)} title="Reject this payment?" description="Say why." placeholder="Reason" confirmText="Reject" onSubmit={(t) => { if (t.length < 3 || !rejecting) return; const p = rejecting; setRejecting(null); void act(p, { action: "reject", reason: t }, "Payment rejected."); }} />
    </div>
  );
}

function HoursDialog({ row, onClose, onDone }: { row: FpRow; onClose: () => void; onDone: (hours: number) => Promise<void> }) {
  const [h, setH] = useState(row.hours ? String(row.hours) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hours = Number(h);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Verify hours worked</DialogTitle><DialogDescription>{row.employeeName} · {row.jobNumber} · {inr(row.rate)} per hour. The amount is worked out from the hours you confirm.</DialogDescription></DialogHeader>
        <Field label="Hours worked" htmlFor="hw" required><Input id="hw" inputMode="decimal" value={h} onChange={(e) => setH(e.target.value)} /></Field>
        <div className="flex items-center justify-between rounded-xl bg-zinc-50 px-4 py-3 text-sm"><span className="text-zinc-600">Amount</span><span className="font-semibold">{inr(hours > 0 ? Math.round(hours * row.rate * 100) / 100 : 0)}</span></div>
        {error && <Notice tone="error">{error}</Notice>}
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={async () => { if (!(hours >= 0.25)) return setError("Enter the hours worked."); setBusy(true); await onDone(hours); setBusy(false); }}>Verify work</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

