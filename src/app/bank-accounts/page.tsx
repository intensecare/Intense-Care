"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { SkeletonList, ErrorState } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Landmark, Plus, Star, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BankAccount } from "@/lib/types";

const KIND_LABEL: Record<BankAccount["kind"], string> = {
  COMPANY_ACCOUNT: "Company account",
  VIRTUAL_ACCOUNT: "Virtual account (future integration)",
  LEDGER_ACCOUNT: "Internal ledger account",
};

const emptyForm = {
  displayName: "",
  holderName: "",
  bankName: "",
  accountNumber: "",
  ifsc: "",
  branch: "",
  accountType: "CURRENT" as "CURRENT" | "SAVINGS",
  upiId: "",
  kind: "COMPANY_ACCOUNT" as BankAccount["kind"],
  openingBalance: "",
  notes: "",
};

/** Admin → Finance → Bank Accounts: the company's own configured receiving accounts. */
export default function BankAccountsPage() {
  const [accounts, setAccounts] = useState<BankAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/bank-accounts", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) setError(json?.error || "Couldn't load bank accounts.");
      else { setAccounts(json.data); setError(null); }
    } catch {
      setError("You're offline. Check your connection and try again.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    const res = await fetch("/api/bank-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, openingBalance: form.openingBalance === "" ? null : Number(form.openingBalance) }),
    });
    const json = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok || !json?.success) { setFormError(json?.error || "Could not create the account."); return; }
    setCreateOpen(false);
    setForm(emptyForm);
    void load();
  };

  const setDefault = async (id: string) => {
    await fetch(`/api/bank-accounts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set-default" }) });
    void load();
  };
  const setStatus = async (id: string, status: "ACTIVE" | "INACTIVE") => {
    await fetch(`/api/bank-accounts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set-status", status }) });
    void load();
  };

  return (
    <AdminLayout>
      <PageHeader
        title="Bank Accounts"
        description="Accounts configured to receive customer payments. Every number here was typed in from a real bank document — nothing is generated."
        actions={<Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4 mr-1" />Add account</Button>}
      />

      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : !accounts ? (
        <SkeletonList rows={3} />
      ) : accounts.length === 0 ? (
        <EmptyState icon={Landmark} title="No bank accounts configured" description="Add one so invoices and quotations can show the customer where to pay." actionLabel="Add account" onAction={() => setCreateOpen(true)} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {accounts.map((a) => (
            <div key={a.id} className={cn("rounded-2xl border bg-white p-4", a.status === "INACTIVE" ? "border-zinc-200 opacity-60" : "border-zinc-200")}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <Link href={`/bank-accounts/${a.id}`} className="font-semibold text-zinc-950 hover:underline">{a.displayName}</Link>
                  <div className="text-sm text-zinc-500">{a.bankName} · {a.accountNumberMasked}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">{KIND_LABEL[a.kind]} · {a.accountType}</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {a.isDefault && <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5"><Star className="h-3 w-3" /> Default</span>}
                  <span className={cn("text-xs font-medium rounded-full px-2 py-0.5", a.status === "ACTIVE" ? "text-emerald-700 bg-emerald-50 border border-emerald-200" : "text-zinc-600 bg-zinc-100 border border-zinc-200")}>{a.status}</span>
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <Link href={`/bank-accounts/${a.id}`}><Button variant="outline" size="sm"><ShieldCheck className="h-3.5 w-3.5 mr-1" />Manage</Button></Link>
                {a.status === "ACTIVE" && !a.isDefault && <Button variant="outline" size="sm" onClick={() => setDefault(a.id)}>Make default</Button>}
                {a.status === "ACTIVE" ? (
                  <Button variant="outline" size="sm" onClick={() => setStatus(a.id, "INACTIVE")}>Deactivate</Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setStatus(a.id, "ACTIVE")}>Activate</Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={(o) => !o && setCreateOpen(false)}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Add a bank account</DialogTitle>
              <DialogDescription>Enter the details exactly as they appear on the bank's own document (passbook, cheque, or statement).</DialogDescription>
            </DialogHeader>
            {formError && <div role="alert" className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800">{formError}</div>}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Display name" required htmlFor="ba-display" hint="Shown in pickers, e.g. HDFC Current — Operations">
                <Input id="ba-display" value={form.displayName} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} required />
              </Field>
              <Field label="Account type" htmlFor="ba-type">
                <select id="ba-type" value={form.accountType} onChange={(e) => setForm((f) => ({ ...f, accountType: e.target.value as "CURRENT" | "SAVINGS" }))} className="w-full h-11 rounded-xl border border-zinc-300 px-3 bg-white text-sm">
                  <option value="CURRENT">Current</option>
                  <option value="SAVINGS">Savings</option>
                </select>
              </Field>
              <Field label="Account holder name" required htmlFor="ba-holder">
                <Input id="ba-holder" value={form.holderName} onChange={(e) => setForm((f) => ({ ...f, holderName: e.target.value }))} required />
              </Field>
              <Field label="Bank name" required htmlFor="ba-bank">
                <Input id="ba-bank" value={form.bankName} onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))} required />
              </Field>
              <Field label="Account number" required htmlFor="ba-accno">
                <Input id="ba-accno" value={form.accountNumber} onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value.replace(/\s/g, "") }))} required />
              </Field>
              <Field label="IFSC" required htmlFor="ba-ifsc">
                <Input id="ba-ifsc" value={form.ifsc} onChange={(e) => setForm((f) => ({ ...f, ifsc: e.target.value.toUpperCase() }))} required />
              </Field>
              <Field label="Branch" htmlFor="ba-branch">
                <Input id="ba-branch" value={form.branch} onChange={(e) => setForm((f) => ({ ...f, branch: e.target.value }))} />
              </Field>
              <Field label="UPI ID (optional)" htmlFor="ba-upi">
                <Input id="ba-upi" value={form.upiId} onChange={(e) => setForm((f) => ({ ...f, upiId: e.target.value }))} placeholder="name@bank" />
              </Field>
              <Field label="Opening balance (optional)" htmlFor="ba-opening" hint="As entered — informational only, never a live balance.">
                <Input id="ba-opening" type="number" step="0.01" value={form.openingBalance} onChange={(e) => setForm((f) => ({ ...f, openingBalance: e.target.value }))} />
              </Field>
              <Field label="Kind" htmlFor="ba-kind">
                <select id="ba-kind" value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as BankAccount["kind"] }))} className="w-full h-11 rounded-xl border border-zinc-300 px-3 bg-white text-sm">
                  <option value="COMPANY_ACCOUNT">Company account (real)</option>
                  <option value="VIRTUAL_ACCOUNT">Virtual account (future integration)</option>
                  <option value="LEDGER_ACCOUNT">Internal ledger (not a real bank account)</option>
                </select>
              </Field>
            </div>
            <Field label="Notes (optional)" htmlFor="ba-notes">
              <Input id="ba-notes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" loading={busy}>{busy ? "Saving…" : "Add account"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
