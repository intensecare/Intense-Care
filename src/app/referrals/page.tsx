"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Plus, Download, Gift, Search, Check, X, Wallet, RefreshCw } from "lucide-react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { PromptModal } from "@/components/common/PromptModal";
import { DataTable, Pager } from "@/components/ui/data-table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Notice, SkeletonList, ErrorState } from "@/components/ui/states";
import { Pill, SelectField, Stat, callApi, csvUrl, inr, textareaCls, useApiList } from "@/components/biz/Bits";
import { useApp } from "@/lib/app-context";
import { PAYMENT_METHODS, REFERRAL_STATUSES, referralStatusLabel, methodLabel, type ReferralRow, type ReferralRules } from "@/lib/business";
import { formatDate, toLocalDateString } from "@/lib/utils";

interface Data {
  rows: ReferralRow[];
  total: number;
  page: number;
  pageSize: number;
  rules: ReferralRules;
  stats: { total: number; registered: number; converted: number; conversionPercent: number; bonusPaid: number; bonusPending: number; revenueGenerated: number; byStatus: Record<string, number> };
}

const tone = (s: string) => (s === "PAID" ? "good" : s === "APPROVED" ? "info" : s === "BONUS_REVIEW" || s === "QUALIFYING_JOB_COMPLETED" ? "warn" : s === "REJECTED" || s === "EXPIRED" ? "bad" : "neutral");

/** Admin → Referrals: who referred whom, when a bonus is earned, and approving and paying it. */
export default function ReferralsPage() {
  const [f, setF] = useState({ status: "", q: "", from: "", to: "" });
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApiList<Data>(() => csvUrl("/api/referral-bonuses", { ...f, page: String(page), pageSize: "25" }), [f, page]);
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState<ReferralRow | null>(null);
  const [rejecting, setRejecting] = useState<ReferralRow | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const set = (p: Partial<typeof f>) => { setPage(1); setF((x) => ({ ...x, ...p })); };

  const act = async (r: ReferralRow, body: Record<string, unknown>, okText: string) => {
    const res = await callApi(`/api/referral-bonuses/${r.id}`, { method: "POST", json: body });
    setNotice({ tone: res.error ? "error" : "success", text: res.error ?? okText });
    if (!res.error) void reload();
    return !res.error;
  };

  const st = data?.stats;
  return (
    <AdminLayout>
      <PageHeader
        title="Referrals & Bonuses"
        description="Track who referred whom, when a bonus is earned, and approve and pay it. Paid bonuses appear in Expenses."
        actions={
          <>
            <a href={csvUrl("/api/referral-bonuses", { ...f, format: "csv" })} className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border border-zinc-300 bg-white text-sm font-semibold text-zinc-800 hover:bg-zinc-50"><Download className="h-4 w-4" aria-hidden /> Export CSV</a>
            <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" aria-hidden /> New referral</Button>
          </>
        }
      />
      {notice && <Notice tone={notice.tone} className="mb-4">{notice.text}</Notice>}

      {st && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <Stat label="Referrals" value={st.total} hint={`${st.registered} became customers`} />
          <Stat label="Converted" value={`${st.conversionPercent}%`} hint={`${st.converted} completed a qualifying job`} />
          <Stat label="Bonus cost" value={inr(st.bonusPaid)} hint={`${inr(st.bonusPending)} awaiting approval or payment`} tone={st.bonusPending > 0 ? "warn" : undefined} />
          <Stat label="Revenue generated" value={inr(st.revenueGenerated)} hint="paid, before GST, from converted customers" />
        </div>
      )}

      <Tabs defaultValue="list" className="space-y-4">
        <TabsList>
          <TabsTrigger value="list">Referrals</TabsTrigger>
          <TabsTrigger value="rules">Bonus rules</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-4">
          <section className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5 space-y-3" aria-label="Filters">
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden />
              <Input value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder="Search referrer, customer, phone or referral ID" aria-label="Search referrals" className="pl-10" />
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <SelectField label="Status" id="rf-st" value={f.status} onChange={(v) => set({ status: v })} className="col-span-2 lg:col-span-1"><option value="">All</option>{REFERRAL_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</SelectField>
              <Field label="From" htmlFor="rf-from"><Input id="rf-from" type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} /></Field>
              <Field label="To" htmlFor="rf-to"><Input id="rf-to" type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} /></Field>
              <div className="flex items-end"><Button variant="outline" className="w-full" onClick={async () => { const r = await callApi("/api/referral-bonuses", { method: "POST", json: { action: "sync" } }); setNotice({ tone: r.error ? "error" : "success", text: r.error ?? "Eligibility re-checked." }); void reload(); }}><RefreshCw className="h-4 w-4" aria-hidden /> Re-check eligibility</Button></div>
            </div>
          </section>

          {error ? <ErrorState message={error} onRetry={() => void reload()} /> : !data ? <SkeletonList rows={4} /> : data.rows.length === 0 ? (
            <EmptyState icon={Gift} title="No referrals found" description={f.q || f.status || f.from || f.to ? "Try clearing a filter." : "Add a referral when a customer recommends someone."} actionLabel="New referral" onAction={() => setCreating(true)} />
          ) : (
            <div className={loading ? "opacity-60 transition-opacity" : undefined}>
              <DataTable
                caption="Referrals"
                rows={data.rows}
                pageSize={0}
                rowKey={(r) => r.id}
                columns={[
                  { key: "no", header: "Referral", mobile: "title", cell: (r) => <span className="font-mono font-semibold">{r.referralNumber}<span className="block font-sans text-xs font-normal text-zinc-500">{formatDate(r.referralDate)}</span></span> },
                  { key: "who", header: "Referrer → customer", mobile: "subtitle", cell: (r) => <span className="break-words">{r.referrerName} → {r.referredCustomerId ? <Link href={`/customers/${r.referredCustomerId}`} className="text-rose-600">{r.referredName}</Link> : r.referredName}</span> },
                  { key: "st", header: "Status", mobile: "badge", cell: (r) => <Pill tone={tone(r.status)}>{referralStatusLabel(r.status)}</Pill> },
                  { key: "job", header: "Qualifying job", cell: (r) => r.qualifyingJobId ? <Link href={`/jobs/${r.qualifyingJobId}`} className="font-mono text-rose-600 break-all">{r.qualifyingJobNumber}</Link> : "—" },
                  { key: "bonus", header: "Bonus", align: "right", cell: (r) => r.bonusAmount !== null ? <span className="tabular-nums font-semibold">{inr(r.bonusAmount)}<span className="block text-xs font-normal text-zinc-500">{r.bonusType === "PERCENT" ? `${r.bonusValue}%` : "fixed"}</span></span> : "—" },
                  { key: "appr", header: "Approval and payment", cell: (r) => <div className="space-y-1">{(                  (r: ReferralRow) => r.approvalStatus === "APPROVED" ? <span>Approved{r.approvedBy ? ` by ${r.approvedBy}` : ""}{r.approvedAt ? <span className="block text-xs text-zinc-500">{formatDate(r.approvedAt)}</span> : null}</span> : r.approvalStatus === "REJECTED" ? <span className="text-red-700 break-words">{r.rejectionReason ?? "Rejected"}</span> : "Pending")(r)}<div className="text-sm">{(                  (r: ReferralRow) => r.paymentStatus === "PAID" ? <span>Paid {r.paidAt ? formatDate(r.paidAt) : ""}<span className="block text-xs text-zinc-500">{methodLabel(r.paymentMethod)} · {r.expenseNumber}</span></span> : "Unpaid")(r)}</div></div> },
                  { key: "rev", header: "Revenue", align: "right", cell: (r) => r.revenueGenerated ? inr(r.revenueGenerated) : "—" },
                ]}
                actions={(r) => (
                  <>
                    {r.status === "BONUS_REVIEW" && <Button size="sm" variant="outline" onClick={() => void act(r, { action: "approve" }, "Bonus approved.")}><Check className="h-4 w-4 text-emerald-600" aria-hidden /> Approve</Button>}
                    {r.status === "APPROVED" && r.paymentStatus === "UNPAID" && <Button size="sm" onClick={() => setPaying(r)}><Wallet className="h-4 w-4" aria-hidden /> Record payment</Button>}
                    {["CREATED", "CUSTOMER_REGISTERED", "QUALIFYING_JOB_COMPLETED", "BONUS_REVIEW", "APPROVED"].includes(r.status) && r.paymentStatus === "UNPAID" && <Button size="sm" variant="ghost" onClick={() => setRejecting(r)}><X className="h-4 w-4 text-red-600" aria-hidden /> Reject</Button>}
                  </>
                )}
              />
              <Pager page={data.page} pages={Math.max(1, Math.ceil(data.total / data.pageSize))} total={data.total} pageSize={data.pageSize} onPage={setPage} />
            </div>
          )}
        </TabsContent>

        <TabsContent value="rules">{data ? <Rules rules={data.rules} onSaved={(t) => { setNotice({ tone: "success", text: t }); void reload(); }} /> : <SkeletonList rows={2} />}</TabsContent>
      </Tabs>

      {creating && <CreateDialog onClose={() => setCreating(false)} onSaved={() => { setCreating(false); setNotice({ tone: "success", text: "Referral recorded." }); void reload(); }} />}
      {paying && <PayDialog row={paying} onClose={() => setPaying(null)} onPay={async (body) => { const ok = await act(paying, { action: "pay", ...body }, "Payment recorded and added to Expenses."); if (ok) setPaying(null); }} />}
      <PromptModal isOpen={!!rejecting} onClose={() => setRejecting(null)} title="Reject this referral?" description="No bonus will be paid. Say why." placeholder="Reason" confirmText="Reject" onSubmit={(t) => { if (t.length < 3 || !rejecting) return; const r = rejecting; setRejecting(null); void act(r, { action: "reject", reason: t }, "Referral rejected."); }} />
    </AdminLayout>
  );
}

function Rules({ rules, onSaved }: { rules: ReferralRules; onSaved: (t: string) => void }) {
  const { updateSystemSettings } = useApp();
  const [v, setV] = useState({ ...rules });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = (x: string) => (x === "" ? NaN : Number(x));
  const save = async () => {
    if (!(v.bonusValue >= 0) || (v.bonusType === "PERCENT" && v.bonusValue > 100)) return setError(v.bonusType === "PERCENT" ? "A percentage must be between 0 and 100." : "Enter the bonus amount.");
    setBusy(true);
    setError(null);
    const r = await updateSystemSettings({ referralRules: v });
    setBusy(false);
    if (!r.success) return setError(r.message);
    onSaved("Bonus rules saved. They apply to referrals that qualify from now on.");
  };
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6 space-y-4 max-w-2xl">
      <div>
        <h2 className="text-base font-semibold text-zinc-950">When does a referral earn a bonus?</h2>
        <p className="text-sm text-zinc-500 mt-1">The referred person must become a new customer (no earlier bookings), and their first qualifying job must be completed and approved by the customer within the window below. Bonuses already calculated keep the rules they qualified under.</p>
      </div>
      <label className="flex items-center gap-3 min-h-11 text-sm font-medium text-zinc-800"><input type="checkbox" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} className="h-5 w-5 accent-rose-500" /> Referral bonuses are switched on</label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <SelectField label="Bonus type" id="rr-type" value={v.bonusType} onChange={(t) => setV({ ...v, bonusType: t as ReferralRules["bonusType"] })}><option value="FIXED">Fixed amount (₹)</option><option value="PERCENT">Percentage of the job value</option></SelectField>
        <Field label={v.bonusType === "PERCENT" ? "Percentage (%)" : "Amount (₹)"} htmlFor="rr-val"><Input id="rr-val" inputMode="decimal" value={String(v.bonusValue)} onChange={(e) => setV({ ...v, bonusValue: n(e.target.value) })} /></Field>
        <Field label="Minimum job value (₹, before GST)" htmlFor="rr-min"><Input id="rr-min" inputMode="decimal" value={String(v.minJobValue)} onChange={(e) => setV({ ...v, minJobValue: n(e.target.value) })} /></Field>
        <Field label="Job must be completed within (days)" htmlFor="rr-days" hint="Counted from the referral date"><Input id="rr-days" inputMode="numeric" value={String(v.eligibilityDays)} onChange={(e) => setV({ ...v, eligibilityDays: n(e.target.value) })} /></Field>
        <Field label="Highest bonus per referral (₹)" htmlFor="rr-max" hint="0 = no limit"><Input id="rr-max" inputMode="decimal" value={String(v.maxBonus)} onChange={(e) => setV({ ...v, maxBonus: n(e.target.value) })} /></Field>
      </div>
      <label className="flex items-center gap-3 min-h-11 text-sm font-medium text-zinc-800"><input type="checkbox" checked={v.requirePaid} onChange={(e) => setV({ ...v, requirePaid: e.target.checked })} className="h-5 w-5 accent-rose-500" /> The job&apos;s invoice must be fully paid</label>
      {error && <Notice tone="error">{error}</Notice>}
      <Button onClick={() => void save()} loading={busy}>Save rules</Button>
    </section>
  );
}

function CreateDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { customers } = useApp();
  const [v, setV] = useState({ referrerCustomerId: "", referrerName: "", referrerContact: "", referredName: "", referredContact: "", referralDate: toLocalDateString(), source: "customer", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const up = (p: Partial<typeof v>) => setV((x) => ({ ...x, ...p }));
  const save = async () => {
    setBusy(true);
    setError(null);
    const r = await callApi("/api/referral-bonuses", { method: "POST", json: { ...v, referrerCustomerId: v.referrerCustomerId || null, notes: v.notes || null } });
    setBusy(false);
    if (r.error) return setError(r.error);
    onSaved();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>New referral</DialogTitle><DialogDescription>Who recommended us, and who they recommended. When the new customer books, the referral links to them automatically.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <SelectField label="Referred by an existing customer?" id="nr-cust" value={v.referrerCustomerId} onChange={(id) => { const c = customers.find((x) => x.id === id); up({ referrerCustomerId: id, ...(c ? { referrerName: c.name, referrerContact: c.phone } : {}) }); }}><option value="">No — someone else</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}</SelectField>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Referrer name" htmlFor="nr-rn" required><Input id="nr-rn" value={v.referrerName} onChange={(e) => up({ referrerName: e.target.value })} /></Field>
            <Field label="Referrer contact" htmlFor="nr-rc"><Input id="nr-rc" type="tel" inputMode="tel" value={v.referrerContact} onChange={(e) => up({ referrerContact: e.target.value })} /></Field>
            <Field label="Referred customer" htmlFor="nr-dn" required><Input id="nr-dn" value={v.referredName} onChange={(e) => up({ referredName: e.target.value })} /></Field>
            <Field label="Their phone number" htmlFor="nr-dc" required hint="Used to recognise them when they book"><Input id="nr-dc" type="tel" inputMode="tel" value={v.referredContact} onChange={(e) => up({ referredContact: e.target.value })} /></Field>
            <Field label="Referral date" htmlFor="nr-date" required><Input id="nr-date" type="date" value={v.referralDate} max={toLocalDateString()} onChange={(e) => up({ referralDate: e.target.value })} /></Field>
            <SelectField label="Referral source" id="nr-src" value={v.source} onChange={(s) => up({ source: s })}><option value="customer">Customer</option><option value="staff">Staff member</option><option value="partner">Business partner</option><option value="online">Online</option><option value="other">Other</option></SelectField>
          </div>
          <Field label="Notes" htmlFor="nr-notes"><textarea id="nr-notes" rows={2} value={v.notes} onChange={(e) => up({ notes: e.target.value })} className={textareaCls} maxLength={1000} /></Field>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={() => void save()}>Save referral</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PayDialog({ row, onClose, onPay }: { row: ReferralRow; onClose: () => void; onPay: (b: { paymentMethod: string; paymentReference?: string; paidOn: string }) => Promise<void> }) {
  const [method, setMethod] = useState("upi");
  const [ref, setRef] = useState("");
  const [day, setDay] = useState(toLocalDateString());
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Record bonus payment</DialogTitle><DialogDescription>{row.referralNumber} · {row.referrerName} · {inr(row.bonusAmount)}. Only record this after the money has been sent — it is added to Expenses and can&apos;t be recorded twice.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <SelectField label="Paid by" id="pb-m" value={method} onChange={setMethod}>{PAYMENT_METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</SelectField>
          <Field label="Transaction reference" htmlFor="pb-r"><Input id="pb-r" value={ref} onChange={(e) => setRef(e.target.value)} maxLength={120} /></Field>
          <Field label="Payment date" htmlFor="pb-d"><Input id="pb-d" type="date" value={day} max={toLocalDateString()} onChange={(e) => setDay(e.target.value)} /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={async () => { setBusy(true); await onPay({ paymentMethod: method, paymentReference: ref || undefined, paidOn: day }); setBusy(false); }}>Record payment</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
