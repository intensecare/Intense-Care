"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { SkeletonList, ErrorState } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { formatMoney, cn } from "@/lib/utils";
import type { BankAccount, Invoice, Payment } from "@/lib/types";

interface Detail {
  account: BankAccount;
  invoicedTotal: number;
  collectedTotal: number;
  openingBalance: number | null;
  unmatchedTransactionCount: number;
  invoices: Invoice[];
  payments: Payment[];
}

interface Txn {
  id: string;
  txnDate: string;
  description: string;
  amount: number;
  reference?: string;
  status: string;
  reconciliation: { id: string; paymentId: string; matchedAmount: number; status: string; payment: { id: string; invoiceId: string; amount: number; paymentMethod: string } } | null;
}
interface UnmatchedPayment {
  id: string;
  invoiceId: string;
  invoiceNumber?: string;
  amount: number;
  paymentMethod: string;
  transactionReference: string;
  paidAt: string;
}

export default function BankAccountDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [detail, setDetail] = useState<Detail | null>(null);
  const [txns, setTxns] = useState<Txn[] | null>(null);
  const [candidates, setCandidates] = useState<UnmatchedPayment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [csv, setCsv] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const [dRes, tRes] = await Promise.all([
        fetch(`/api/bank-accounts/${id}`, { cache: "no-store" }),
        fetch(`/api/bank-transactions?bankAccountId=${id}`, { cache: "no-store" }),
      ]);
      const dJson = await dRes.json().catch(() => null);
      const tJson = await tRes.json().catch(() => null);
      if (!dRes.ok || !dJson?.success) { setError(dJson?.error || "Couldn't load this account."); return; }
      setDetail(dJson.data);
      if (tRes.ok && tJson?.success) { setTxns(tJson.data.transactions); setCandidates(tJson.data.unmatchedPayments); }
      setError(null);
    } catch {
      setError("You're offline. Check your connection and try again.");
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const doImport = async (e: React.FormEvent) => {
    e.preventDefault();
    setImportBusy(true);
    setImportMsg(null);
    const res = await fetch(`/api/bank-accounts/${id}/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csv }) });
    const json = await res.json().catch(() => null);
    setImportBusy(false);
    if (!res.ok || !json?.success) { setImportMsg(json?.error || "Import failed."); return; }
    setImportMsg(`Imported ${json.data.imported} transaction(s)${json.data.skippedDuplicate ? `, ${json.data.skippedDuplicate} already present` : ""}.`);
    setCsv("");
    void load();
  };

  const match = async (txnId: string) => {
    const paymentId = picks[txnId];
    if (!paymentId) return;
    await fetch(`/api/bank-transactions/${txnId}/match`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paymentId }) });
    void load();
  };
  const unmatch = async (txnId: string) => {
    await fetch(`/api/bank-transactions/${txnId}/match`, { method: "DELETE" });
    void load();
  };

  if (error) return <AdminLayout><ErrorState message={error} onRetry={() => void load()} /></AdminLayout>;
  if (!detail) return <AdminLayout><SkeletonList rows={4} /></AdminLayout>;

  const a = detail.account;
  return (
    <AdminLayout>
      <PageHeader title={a.displayName} description={`${a.bankName} · ${a.accountNumber ?? a.accountNumberMasked} · IFSC ${a.ifsc}`} breadcrumbs={[{ label: "Bank Accounts", href: "/bank-accounts" }]} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat label="Invoiced via this account" value={formatMoney(detail.invoicedTotal)} hint="Sum of invoice totals assigned to it" />
        <Stat label="Collected into this account" value={formatMoney(detail.collectedTotal)} hint="Sum of payments recorded as received here" />
        <Stat label="Opening balance (as entered)" value={detail.openingBalance != null ? formatMoney(detail.openingBalance) : "—"} hint="Not a live bank balance" />
        <Stat label="Unmatched transactions" value={String(detail.unmatchedTransactionCount)} hint="Imported lines waiting to be reconciled" tone={detail.unmatchedTransactionCount > 0 ? "warn" : undefined} />
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4 mb-6">
        <h2 className="font-semibold text-zinc-950 mb-1">Import a bank statement (CSV)</h2>
        <p className="text-sm text-zinc-500 mb-3">There is no live bank-feed connection. Paste the CSV your bank exported — columns for Date, Description, Amount (or Credit/Debit) and optionally Reference. Re-importing the same file is safe; duplicate rows are skipped.</p>
        <form onSubmit={doImport} className="space-y-2">
          <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={5} placeholder="Date,Description,Amount,Reference" className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm font-mono" />
          {importMsg && <div className="text-sm text-zinc-700">{importMsg}</div>}
          <Button type="submit" size="sm" loading={importBusy} disabled={!csv.trim()}>{importBusy ? "Importing…" : "Import"}</Button>
        </form>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <h2 className="font-semibold text-zinc-950 mb-3">Imported transactions</h2>
        {!txns || txns.length === 0 ? (
          <p className="text-sm text-zinc-500">No transactions imported yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-500 border-b border-zinc-200">
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Description</th>
                  <th className="py-2 pr-3 text-right">Amount</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Match</th>
                </tr>
              </thead>
              <tbody>
                {txns.map((t) => (
                  <tr key={t.id} className="border-b border-zinc-100">
                    <td className="py-2 pr-3 whitespace-nowrap">{t.txnDate}</td>
                    <td className="py-2 pr-3 max-w-xs truncate" title={t.description}>{t.description}</td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">{formatMoney(t.amount)}</td>
                    <td className="py-2 pr-3">
                      <span className={cn("text-xs font-medium rounded-full px-2 py-0.5", t.status === "UNMATCHED" ? "bg-zinc-100 text-zinc-600" : t.status === "MATCHED" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-amber-50 text-amber-700 border border-amber-200")}>{t.status}</span>
                    </td>
                    <td className="py-2 pr-3">
                      {t.reconciliation ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-zinc-500">Payment {t.reconciliation.paymentId.slice(-6)} · {formatMoney(t.reconciliation.matchedAmount)}</span>
                          <Button type="button" variant="outline" size="sm" onClick={() => unmatch(t.id)}>Reverse</Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <select value={picks[t.id] ?? ""} onChange={(e) => setPicks((p) => ({ ...p, [t.id]: e.target.value }))} className="h-9 rounded-lg border border-zinc-300 px-2 text-xs bg-white">
                            <option value="">Pick a payment…</option>
                            {candidates.map((p) => (
                              <option key={p.id} value={p.id}>{p.invoiceNumber ?? p.invoiceId.slice(-6)} · {formatMoney(p.amount)} · {p.transactionReference}</option>
                            ))}
                          </select>
                          <Button type="button" size="sm" disabled={!picks[t.id]} onClick={() => match(t.id)}>Match</Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "warn" }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="text-sm text-zinc-500">{label}</div>
      <div className={cn("text-2xl font-semibold mt-1", tone === "warn" ? "text-amber-700" : "text-zinc-950")}>{value}</div>
      {hint && <div className="text-xs text-zinc-400 mt-0.5">{hint}</div>}
    </div>
  );
}
