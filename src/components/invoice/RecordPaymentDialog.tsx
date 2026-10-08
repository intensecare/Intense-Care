"use client";

import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { useApp } from "@/lib/app-context";
import { formatMoney } from "@/lib/utils";
import type { Payment } from "@/lib/types";

/** Record a payment against an invoice (Admin). */
export function RecordPaymentDialog({
  invoice,
  onClose,
  onDone,
}: {
  invoice: { id: string; invoiceNumber: string; balanceDue: number } | null;
  onClose: () => void;
  onDone?: () => void;
}) {
  const { recordPayment } = useApp();
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState<Payment["paymentMethod"]>("upi");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!invoice) return;
    setAmount(invoice.balanceDue);
    setMethod("upi");
    setReference(`TXN-${Date.now().toString().slice(-6)}`);
    setError(null);
  }, [invoice]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoice) return;
    if (!(amount > 0)) return setError("Enter an amount greater than zero.");
    if (amount > invoice.balanceDue + 0.001) return setError(`The balance due is ${formatMoney(invoice.balanceDue)}.`);
    setBusy(true);
    const r = await recordPayment(invoice.id, amount, method, reference.trim());
    setBusy(false);
    if (!r.success) return setError(r.message);
    onDone?.();
    onClose();
  };

  return (
    <Dialog open={!!invoice} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Record payment</DialogTitle>
            <DialogDescription>{invoice ? `Invoice ${invoice.invoiceNumber} · balance ${formatMoney(invoice.balanceDue)}` : ""}</DialogDescription>
          </DialogHeader>
          {error && <div role="alert" className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800">{error}</div>}
          <Field label="Amount (₹)" required htmlFor="pay-amount">
            <Input id="pay-amount" type="number" inputMode="decimal" step="0.01" min={0.01} value={amount} onFocus={(e) => e.target.select()} onChange={(e) => setAmount(e.target.value === "" ? 0 : Number(e.target.value))} required />
          </Field>
          <Field label="Paid by" htmlFor="pay-method">
            <select id="pay-method" value={method} onChange={(e) => setMethod(e.target.value as Payment["paymentMethod"])} className="w-full h-11 rounded-xl border border-zinc-300 px-3 bg-white text-sm">
              <option value="upi">UPI</option>
              <option value="card">Card</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="cash">Cash</option>
            </select>
          </Field>
          <Field label="Reference" required htmlFor="pay-ref" hint="UPI / bank reference or receipt number">
            <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} required />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={busy}>{busy ? "Saving…" : "Record payment"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
