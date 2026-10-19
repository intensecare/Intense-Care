"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/states";
import { Pill, callApi } from "@/components/biz/Bits";
import { useApp } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import { formatDateTime, formatMoney } from "@/lib/utils";

interface Attempt {
  id: string;
  status: "INITIATED" | "SUBMITTED" | "VERIFIED" | "REJECTED" | "CANCELLED";
  reference: string;
  amount: number;
  utr: string | null;
  payerNote: string | null;
  createdAt: string;
  submittedAt: string | null;
  reviewedByName: string | null;
  reviewNote: string | null;
  events: { at: string; to: string; by: string | null; note: string | null }[];
}

const TONE = { INITIATED: "neutral", SUBMITTED: "warn", VERIFIED: "good", REJECTED: "bad", CANCELLED: "neutral" } as const;
const LABEL = { INITIATED: "Started — not confirmed", SUBMITTED: "Needs checking", VERIFIED: "Verified", REJECTED: "Rejected", CANCELLED: "Cancelled" } as const;

/**
 * Admin: customer UPI payments for this invoice. A customer reporting "I paid" is only a claim — verify it against the bank
 * statement, then confirm. Confirming records the payment on the invoice (once); rejecting tells the customer why.
 */
export function UpiReviewPanel({ invoiceId, balanceDue, onChanged }: { invoiceId: string; balanceDue: number; onChanged: () => void }) {
  const { can } = useAuth();
  const { refreshFinance } = useApp();
  const [rows, setRows] = useState<Attempt[] | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [utrs, setUtrs] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const allowed = can("payment.record");

  const load = useCallback(async () => {
    const r = await callApi<Attempt[]>(`/api/payments/upi?status=ALL&invoiceId=${encodeURIComponent(invoiceId)}`);
    if (r.data) setRows(r.data);
  }, [invoiceId]);
  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  if (!allowed || !rows || rows.length === 0) return null;

  const act = async (a: Attempt, body: Record<string, unknown>, ok: string) => {
    setBusy(a.id);
    setMsg(null);
    const r = await callApi(`/api/payments/upi/${a.id}`, { method: "POST", json: body });
    setBusy(null);
    setMsg(r.error ? { tone: "error", text: r.error } : { tone: "success", text: ok });
    await load();
    await refreshFinance();
    onChanged();
  };

  return (
    <section className="print:hidden mt-6 rounded-2xl border border-zinc-200 bg-white p-5 space-y-3" aria-label="UPI payments">
      <h2 className="text-base font-semibold text-zinc-950">Customer UPI payments</h2>
      <p className="text-sm text-zinc-600">A customer saying &ldquo;I paid&rdquo; is not proof. Check the amount and UTR in your bank account before confirming. Outstanding on this invoice: <strong>{formatMoney(balanceDue)}</strong>.</p>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <ul className="space-y-3">
        {rows.map((a) => {
          const open = a.status === "SUBMITTED" || a.status === "INITIATED";
          return (
            <li key={a.id} className="rounded-xl border border-zinc-200 p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">{formatMoney(a.amount)} <span className="text-zinc-500 font-normal text-sm">requested · ref {a.reference}</span></span>
                <Pill tone={TONE[a.status]}>{LABEL[a.status]}</Pill>
              </div>
              <div className="text-sm text-zinc-600 break-all">
                {a.utr ? <>UTR <span className="font-mono font-semibold text-zinc-900">{a.utr}</span> · </> : "No UTR given yet · "}
                {a.submittedAt ? `submitted ${formatDateTime(a.submittedAt)}` : `started ${formatDateTime(a.createdAt)}`}
                {a.payerNote ? ` · “${a.payerNote}”` : ""}
              </div>
              {open && (
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-end">
                  <label className="text-xs font-medium text-zinc-700 space-y-1">Amount received (₹)
                    <Input inputMode="decimal" value={amounts[a.id] ?? String(Math.min(a.amount, balanceDue))} onChange={(e) => setAmounts({ ...amounts, [a.id]: e.target.value })} aria-label="Amount received" />
                  </label>
                  <label className="text-xs font-medium text-zinc-700 space-y-1">UTR from the bank statement
                    <Input value={utrs[a.id] ?? a.utr ?? ""} onChange={(e) => setUtrs({ ...utrs, [a.id]: e.target.value })} aria-label="UTR from the bank statement" className="font-mono" />
                  </label>
                  <Button loading={busy === a.id} onClick={() => void act(a, { action: "verify", amount: Number(amounts[a.id] ?? Math.min(a.amount, balanceDue)), utr: (utrs[a.id] ?? a.utr ?? "").trim() || undefined }, "Payment confirmed and recorded on the invoice.")}><Check className="h-4 w-4" aria-hidden /> Confirm received</Button>
                  <div className="sm:col-span-3 flex gap-2">
                    <Input value={reasons[a.id] ?? ""} onChange={(e) => setReasons({ ...reasons, [a.id]: e.target.value })} placeholder="Reason if not received (shown to the customer)" aria-label="Rejection reason" />
                    <Button variant="outline" disabled={(reasons[a.id] ?? "").trim().length < 3} onClick={() => void act(a, { action: "reject", reason: (reasons[a.id] ?? "").trim() }, "Marked as not received. The customer can see your reason.")}><X className="h-4 w-4 text-red-600" aria-hidden /> Not received</Button>
                  </div>
                </div>
              )}
              {a.reviewNote && <p className="text-sm text-zinc-600">Note: {a.reviewNote}{a.reviewedByName ? ` — ${a.reviewedByName}` : ""}</p>}
              <details className="text-xs text-zinc-500"><summary className="cursor-pointer">History</summary>
                <ul className="mt-1 space-y-0.5">{a.events.map((e, i) => <li key={i}>{formatDateTime(e.at)} · {e.to}{e.by ? ` · ${e.by}` : ""}{e.note ? ` — ${e.note}` : ""}</li>)}</ul>
              </details>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
