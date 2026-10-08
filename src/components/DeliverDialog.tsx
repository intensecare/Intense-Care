"use client";

import { useState } from "react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { Modal, ErrorText } from "@/components/Modal";
import { useAction } from "@/lib/client/api";
import { money, toPaise } from "@/lib/format";

/**
 * "Delivered" confirmation, shared by the field app and the admin order screen.
 * When money is due it asks whether it was collected at the door and records
 * the payment in the same backend transaction as the delivery.
 */
export function DeliverDialog({ orderId, orderNumber, amountDue, open, onClose }: { orderId: string; orderNumber: string; amountDue: number; open: boolean; onClose: () => void }) {
  const { run, pending, error } = useAction();
  const [collected, setCollected] = useState(amountDue > 0 ? "yes" : "no");
  const [amount, setAmount] = useState(String(amountDue / 100));
  const [method, setMethod] = useState("CASH");
  const [notes, setNotes] = useState("");
  const [key] = useState(() => crypto.randomUUID());

  const submit = async () => {
    const pay = amountDue > 0 && collected === "yes" ? { amount: toPaise(Number(amount) || 0), method, idempotencyKey: key } : undefined;
    const r = await run(`/api/orders/${orderId}/transition`, { to: "DELIVERED", notes: notes || undefined, payment: pay });
    if (r.ok) onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={`Deliver ${orderNumber}`}>
      <div className="space-y-4">
        {amountDue > 0 ? (
          <>
            <div className="rounded-xl bg-amber-50 p-3 text-amber-900">
              Amount due: <span className="font-bold">{money(amountDue)}</span>
            </div>
            <Field label="Payment collected?">
              <Select value={collected} onChange={(e) => setCollected(e.target.value)}>
                <option value="yes">Yes, collected now</option>
                <option value="no">No, customer will pay later</option>
              </Select>
            </Field>
            {collected === "yes" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Amount (₹)">
                  <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </Field>
                <Field label="Method">
                  <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                    <option value="CASH">Cash</option>
                    <option value="UPI">UPI</option>
                    <option value="CARD">Card</option>
                  </Select>
                </Field>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-slate-600">Nothing is due on this order.</p>
        )}
        <Field label="Note (optional)">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Handed to security" />
        </Field>
        <ErrorText error={error} />
        <Button size="lg" className="w-full" onClick={submit} disabled={pending}>
          {pending ? "Saving…" : "Confirm Delivered"}
        </Button>
      </div>
    </Modal>
  );
}
