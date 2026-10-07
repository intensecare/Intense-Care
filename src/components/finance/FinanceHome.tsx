"use client";

import React, { useState } from "react";
import Link from "next/link";
import { StatTile, AttentionPanel } from "@/components/workspace/WorkspaceWidgets";
import { useWorkspace } from "@/lib/use-workspace";
import { useApp } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Undo2, CheckCircle2 } from "lucide-react";

/**
 * ACCOUNTS home header — "Finance" (§11): Total Outstanding, Collected,
 * Pending, Overdue, Recent Payments + the attention list. Below it, the
 * refund desk: create refunds (approval authority applies above the
 * configured limit) and approve/reject pending ones.
 */
export function FinanceHome() {
  const { data } = useWorkspace(20000);
  const { invoices, payments, refunds, createRefund, decideRefund, systemSettings } = useApp();
  const { can } = useAuth();
  const fin = data?.finance;
  const today = new Date().toISOString().slice(0, 10);
  const overdue = invoices.filter((i) => i.balanceDue > 0 && i.dueDate < today);

  const [refundInvoiceId, setRefundInvoiceId] = useState("");
  const [refundAmount, setRefundAmount] = useState<number>(0);
  const [refundReason, setRefundReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refundable = invoices.filter((i) => i.amountPaid - (i.refundedAmount ?? 0) > 0.005);
  const pendingRefunds = refunds.filter((r) => r.status === "PENDING_APPROVAL");

  const submitRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!refundInvoiceId || refundAmount <= 0 || refundReason.trim().length < 5) return;
    setBusy(true);
    setMessage(null);
    const r = await createRefund(refundInvoiceId, refundAmount, refundReason.trim());
    setBusy(false);
    setMessage(r.message);
    if (r.success) {
      setRefundInvoiceId("");
      setRefundAmount(0);
      setRefundReason("");
    }
  };

  return (
    <div className="space-y-4 mb-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Total Outstanding" value={fin ? formatCurrency(fin.outstanding) : formatCurrency(invoices.reduce((a, i) => a + i.balanceDue, 0))} tone={fin?.outstanding ? "warning" : "neutral"} />
        <StatTile label="Collected" value={fin ? formatCurrency(fin.collected) : formatCurrency(invoices.reduce((a, i) => a + i.amountPaid, 0))} tone="success" hint={`${payments.length} payments`} />
        <StatTile label="Pending" value={fin ? formatCurrency(fin.pending) : "—"} hint={fin ? `${fin.pendingCount} invoices` : undefined} />
        <StatTile label="Overdue" value={fin ? formatCurrency(fin.overdueAmount) : formatCurrency(overdue.reduce((a, i) => a + i.balanceDue, 0))} tone={overdue.length ? "alert" : "neutral"} hint={`${overdue.length} invoice${overdue.length === 1 ? "" : "s"}`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <AttentionPanel items={data?.attention ?? []} />

        <div className="rounded-lg border border-zinc-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-100 text-sm font-semibold text-zinc-900">Recent payments</div>
          {payments.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-zinc-500">No payments recorded yet.</div>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {payments.slice(0, 5).map((p) => {
                const inv = invoices.find((i) => i.id === p.invoiceId);
                return (
                  <li key={p.id} className="px-4 py-2.5 flex items-center justify-between text-xs">
                    <div>
                      <div className="font-semibold text-zinc-900">{formatCurrency(p.amount)}</div>
                      <div className="text-[11px] text-zinc-500">{inv?.invoiceNumber ?? p.invoiceId} · {p.paymentMethod.replace("_", " ")} · {formatDate(p.paidAt)}</div>
                    </div>
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-100 text-sm font-semibold text-zinc-900 flex items-center gap-2">
            <Undo2 className="h-4 w-4 text-zinc-400" /> Refunds
          </div>
          <div className="p-4 space-y-3 text-xs">
            {pendingRefunds.length > 0 && (
              <ul className="space-y-1.5">
                {pendingRefunds.map((r) => {
                  const inv = invoices.find((i) => i.id === r.invoiceId);
                  return (
                    <li key={r.id} className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-amber-900">{formatCurrency(r.amount)} · {inv?.invoiceNumber ?? r.invoiceId}</span>
                        <span className="text-[10px] font-semibold text-amber-800">Awaiting approval</span>
                      </div>
                      <div className="text-[11px] text-amber-800">{r.reason}</div>
                      {can("refund.approve") && (
                        <div className="flex gap-1.5">
                          <Button size="sm" className="h-7 text-[11px] text-white" onClick={() => decideRefund(r.id, "approve").then((x) => setMessage(x.message))}>Approve</Button>
                          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => decideRefund(r.id, "reject").then((x) => setMessage(x.message))}>Reject</Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {can("refund.create") && (
              <form onSubmit={submitRefund} className="space-y-2">
                <select value={refundInvoiceId} onChange={(e) => { setRefundInvoiceId(e.target.value); const inv = invoices.find((i) => i.id === e.target.value); if (inv) setRefundAmount(Math.max(0, inv.amountPaid - (inv.refundedAmount ?? 0))); }} className="w-full h-9 rounded-md border border-zinc-200 px-2 text-xs">
                  <option value="">Refund a paid invoice…</option>
                  {refundable.map((i) => (
                    <option key={i.id} value={i.id}>{i.invoiceNumber} · paid {formatCurrency(i.amountPaid)}</option>
                  ))}
                </select>
                <div className="grid grid-cols-2 gap-2">
                  <Input type="number" min={1} value={refundAmount || ""} onChange={(e) => setRefundAmount(Number(e.target.value))} placeholder="Amount" className="h-9 text-xs" />
                  <Input value={refundReason} onChange={(e) => setRefundReason(e.target.value)} placeholder="Reason (required)" className="h-9 text-xs" />
                </div>
                <div className="flex items-center justify-between">
                  <span className={cn("text-[10px]", refundAmount > systemSettings.refundApprovalLimit ? "text-amber-700 font-semibold" : "text-zinc-400")}>
                    {refundAmount > systemSettings.refundApprovalLimit ? `Above ${formatCurrency(systemSettings.refundApprovalLimit)} — needs Ops Manager / Super Admin approval` : `Up to ${formatCurrency(systemSettings.refundApprovalLimit)} processed directly`}
                  </span>
                  <Button type="submit" size="sm" disabled={busy || !refundInvoiceId || refundAmount <= 0 || refundReason.trim().length < 5} className="h-8 text-[11px] text-white">
                    {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Record refund"}
                  </Button>
                </div>
              </form>
            )}
            {message && <div className="text-[11px] text-zinc-700 bg-zinc-50 border border-zinc-200 rounded px-2 py-1.5">{message}</div>}
            {refunds.filter((r) => r.status !== "PENDING_APPROVAL").length > 0 && (
              <ul className="divide-y divide-zinc-100 border-t border-zinc-100 pt-1">
                {refunds.filter((r) => r.status !== "PENDING_APPROVAL").slice(0, 4).map((r) => (
                  <li key={r.id} className="py-1.5 flex items-center justify-between text-[11px]">
                    <span>{formatCurrency(r.amount)} · {formatDate(r.createdAt)}</span>
                    <span className={cn("font-semibold", r.status === "PROCESSED" ? "text-emerald-700" : r.status === "REJECTED" ? "text-red-700" : "text-zinc-500")}>{r.status.toLowerCase()}</span>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/jobs?status=COMPLETED" className="block text-[11px] text-zinc-500 hover:text-zinc-900">Billable jobs →</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
