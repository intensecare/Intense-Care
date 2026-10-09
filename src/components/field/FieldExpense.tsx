"use client";

import React, { useMemo, useState } from "react";
import { Receipt, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Notice } from "@/components/ui/states";
import { FilePick, Pill, SelectField, callApi, inr, uploadFile, useApiList } from "@/components/biz/Bits";
import { EXPENSE_CATEGORIES, PAYMENT_METHODS, SYSTEM_CATEGORIES, categoryLabel, type ExpenseRow } from "@/lib/business";
import { toLocalDateString } from "@/lib/utils";

/** A Field Manager's costs on one job (fuel, supplies…). They go to Admin for approval; the FM sees the outcome. */
export function FieldExpense({ jobId, jobDate }: { jobId: string; jobDate: string }) {
  const { data, reload } = useApiList<{ rows: ExpenseRow[] }>(() => `/api/expenses?jobId=${jobId}&pageSize=20`, [jobId]);
  const [open, setOpen] = useState(false);
  const rows = data?.rows ?? [];
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-zinc-950 flex items-center gap-2"><Receipt className="h-5 w-5 text-rose-500" aria-hidden /> Job expenses</h2>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Plus className="h-4 w-4" aria-hidden /> Add expense</Button>
      </div>
      {rows.length === 0 ? <p className="text-sm text-zinc-500">Spent money on this job? Add it with the bill so Admin can approve it.</p> : (
        <ul className="divide-y divide-zinc-100">
          {rows.map((r) => (
            <li key={r.id} className="py-2.5 flex items-start justify-between gap-3">
              <div className="min-w-0"><div className="text-sm font-medium text-zinc-900 break-words">{r.description}</div><div className="text-xs text-zinc-500">{categoryLabel(r.category)} · {r.expenseNumber}</div></div>
              <div className="text-right shrink-0"><div className="text-sm font-semibold tabular-nums">{inr(r.amount)}</div><Pill tone={r.voided || r.approvalStatus === "REJECTED" ? "bad" : r.approvalStatus === "APPROVED" ? "good" : "warn"}>{r.voided ? "Voided" : r.approvalStatus === "APPROVED" ? "Approved" : r.approvalStatus === "REJECTED" ? "Rejected" : "Waiting"}</Pill></div>
            </li>
          ))}
        </ul>
      )}
      {open && <Form jobId={jobId} jobDate={jobDate} onClose={() => setOpen(false)} onDone={() => { setOpen(false); void reload(); }} />}
    </section>
  );
}

function Form({ jobId, jobDate, onClose, onDone }: { jobId: string; jobDate: string; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState({ category: "FUEL", description: "", amount: "", paymentMethod: "cash", vendor: "" });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useMemo(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2)}`), []);
  const save = async (confirmDuplicate = false) => {
    const amount = Number(v.amount);
    if (!(amount > 0)) return setError("Enter the amount.");
    if (v.description.trim().length < 2) return setError("Say what it was for.");
    setBusy(true);
    setError(null);
    let receiptFileId: string | undefined;
    if (file) {
      const up = await uploadFile(file, { ownerType: "expense", category: "RECEIPT" });
      if (up.error || !up.data) { setBusy(false); return setError(up.error ?? "The bill couldn't be uploaded."); }
      receiptFileId = up.data.id;
    }
    const today = toLocalDateString();
    const r = await callApi("/api/expenses", { method: "POST", json: { date: jobDate <= today ? jobDate : today, category: v.category, description: v.description, amount, taxAmount: 0, paymentMethod: v.paymentMethod, vendor: v.vendor || null, jobId, paymentStatus: "PAID", receiptFileId, idempotencyKey: key, confirmDuplicate } });
    setBusy(false);
    if (r.status === 409 && (r.extra as { duplicate?: boolean } | undefined)?.duplicate) return setError(`${r.error} Tap Save again to add it anyway.`);
    if (r.error) return setError(r.error);
    onDone();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Add job expense</DialogTitle><DialogDescription>Admin approves it before it counts.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <SelectField label="What for" id="fe-cat" value={v.category} onChange={(c) => setV({ ...v, category: c })}>{EXPENSE_CATEGORIES.filter((c) => !SYSTEM_CATEGORIES.includes(c.key)).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</SelectField>
          <Field label="Description" htmlFor="fe-d" required><Input id="fe-d" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} maxLength={300} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (₹)" htmlFor="fe-a" required><Input id="fe-a" inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></Field>
            <SelectField label="Paid by" id="fe-m" value={v.paymentMethod} onChange={(m) => setV({ ...v, paymentMethod: m })}>{PAYMENT_METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</SelectField>
          </div>
          <Field label="Shop or vendor" htmlFor="fe-v"><Input id="fe-v" value={v.vendor} onChange={(e) => setV({ ...v, vendor: e.target.value })} maxLength={160} /></Field>
          <FilePick file={file} onFile={setFile} label="Photo of the bill" />
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={() => void save(/Tap Save again/.test(error ?? ""))}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
