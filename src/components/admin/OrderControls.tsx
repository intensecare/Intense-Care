"use client";

import { useState } from "react";
import { Copy, Check, ExternalLink, MessageCircle, RefreshCw, Send } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { Modal, ErrorText } from "@/components/Modal";
import { DeliverDialog } from "@/components/DeliverDialog";
import { ItemsEditor, toItemPayload, type ItemDraft, type ServiceOption } from "./ItemsEditor";
import { useAction } from "@/lib/client/api";
import { money, toPaise, whatsappUrl } from "@/lib/format";
import type { OrderStatus } from "@/lib/workflow";

type ActionDef = { to: OrderStatus; label: string; requiresReason?: boolean; tone?: "primary" | "danger" | "secondary" };

function toLocalInput(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* -------------------------------------------------------------------------- */
/* Next step: only the actions valid for the current status                   */
/* -------------------------------------------------------------------------- */

export function OrderActions({
  orderId,
  orderNumber,
  status,
  actions,
  amountDue,
  fieldManagers,
  pickupAssigneeId,
  deliveryAssigneeId,
}: {
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
  actions: ActionDef[];
  amountDue: number;
  fieldManagers: { id: string; name: string }[];
  pickupAssigneeId: string | null;
  deliveryAssigneeId: string | null;
}) {
  const { run, pending, error } = useAction();
  const [reasonFor, setReasonFor] = useState<ActionDef | null>(null);
  const [reason, setReason] = useState("");
  const [deliverOpen, setDeliverOpen] = useState(false);

  const main = actions.filter((a) => a.to !== "CANCELLED" && a.to !== "PICKUP_ASSIGNED");
  const cancel = actions.find((a) => a.to === "CANCELLED");

  const press = async (a: ActionDef) => {
    if (a.to === "DELIVERED") return setDeliverOpen(true);
    if (a.requiresReason) {
      setReason("");
      return setReasonFor(a);
    }
    await run(`/api/orders/${orderId}/transition`, { to: a.to });
  };

  const needsPickup = status === "CREATED";
  const needsDelivery = status === "READY" && !deliveryAssigneeId;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {needsPickup && (
          <AssignButton orderId={orderId} kind="pickup" fieldManagers={fieldManagers} currentId={pickupAssigneeId} label="Assign Pickup" variant="primary" />
        )}
        {needsDelivery && (
          <AssignButton orderId={orderId} kind="delivery" fieldManagers={fieldManagers} currentId={null} label="Assign Delivery" variant="primary" />
        )}
        {main.map((a) => (
          <Button
            key={a.to}
            variant={a.tone === "danger" ? "danger" : a.tone === "secondary" || needsDelivery ? "secondary" : "primary"}
            disabled={pending || (a.to === "OUT_FOR_DELIVERY" && !deliveryAssigneeId)}
            onClick={() => press(a)}
          >
            {a.label}
          </Button>
        ))}
        {main.length === 0 && !needsPickup && !needsDelivery && (
          <p className="text-sm text-slate-500">
            {status === "PICKUP_ASSIGNED"
              ? "Waiting for the field manager to pick up."
              : status === "QC_PENDING"
              ? "Waiting for QC."
              : status === "DELIVERED"
              ? "Order completed."
              : status === "CANCELLED"
              ? "Order cancelled."
              : "No action needed."}
          </p>
        )}
      </div>
      {cancel && (
        <button onClick={() => press(cancel)} className="text-sm font-medium text-red-600 hover:underline">
          Cancel order
        </button>
      )}
      <ErrorText error={error} />

      <Modal open={!!reasonFor} onClose={() => setReasonFor(null)} title={reasonFor?.label ?? ""}>
        <div className="space-y-4">
          <Field label="Reason (required)">
            <Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <ErrorText error={error} />
          <Button
            size="lg"
            variant={reasonFor?.tone === "danger" ? "danger" : "primary"}
            className="w-full"
            disabled={pending || reason.trim().length < 3}
            onClick={async () => {
              if (!reasonFor) return;
              const r = await run(`/api/orders/${orderId}/transition`, { to: reasonFor.to, reason: reason.trim() });
              if (r.ok) setReasonFor(null);
            }}
          >
            {reasonFor?.label}
          </Button>
        </div>
      </Modal>
      {deliverOpen && <DeliverDialog orderId={orderId} orderNumber={orderNumber} amountDue={amountDue} open onClose={() => setDeliverOpen(false)} />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Assign / reassign pickup or delivery                                        */
/* -------------------------------------------------------------------------- */

export function AssignButton({
  orderId,
  kind,
  fieldManagers,
  currentId,
  currentScheduledAt,
  label,
  variant = "secondary",
}: {
  orderId: string;
  kind: "pickup" | "delivery";
  fieldManagers: { id: string; name: string }[];
  currentId: string | null;
  currentScheduledAt?: string | null;
  label: string;
  variant?: "primary" | "secondary";
}) {
  const { run, pending, error } = useAction();
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState(currentId ?? fieldManagers[0]?.id ?? "");
  const [when, setWhen] = useState(toLocalInput(currentScheduledAt));

  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={label}>
        <div className="space-y-4">
          {fieldManagers.length === 0 ? (
            <p className="text-sm text-amber-700">No active field managers. Add one on Users first.</p>
          ) : (
            <>
              <Field label="Field manager">
                <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
                  {fieldManagers.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={`${kind === "pickup" ? "Pickup" : "Delivery"} time (optional)`}>
                <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
              </Field>
            </>
          )}
          <ErrorText error={error} />
          <Button
            size="lg"
            className="w-full"
            disabled={pending || !userId}
            onClick={async () => {
              const r = await run(`/api/orders/${orderId}/assign`, { kind, userId, scheduledAt: when ? new Date(when).toISOString() : null });
              if (r.ok) setOpen(false);
            }}
          >
            Save
          </Button>
        </div>
      </Modal>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Items & discount                                                           */
/* -------------------------------------------------------------------------- */

export function EditItemsButton({
  orderId,
  services,
  items,
  discount,
}: {
  orderId: string;
  services: ServiceOption[];
  items: { serviceId: string; itemName: string; quantity: number }[];
  discount: number;
}) {
  const { run, pending, error } = useAction();
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<ItemDraft[]>([]);
  const [disc, setDisc] = useState("");

  const start = () => {
    setDrafts(items.map((i, n) => ({ key: String(n), serviceId: i.serviceId, itemName: i.itemName, quantity: String(i.quantity) })));
    setDisc(discount ? String(discount / 100) : "");
    setOpen(true);
  };

  return (
    <>
      <Button variant="secondary" onClick={start}>
        Edit items
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Items & services">
        <div className="space-y-4">
          <ItemsEditor services={services} items={drafts} onChange={setDrafts} />
          <Field label="Discount (₹)">
            <Input inputMode="decimal" value={disc} onChange={(e) => setDisc(e.target.value)} placeholder="0" />
          </Field>
          <ErrorText error={error} />
          <Button
            size="lg"
            className="w-full"
            disabled={pending}
            onClick={async () => {
              const r = await run(`/api/orders/${orderId}`, { items: toItemPayload(drafts), discount: toPaise(Number(disc) || 0) }, "PATCH");
              if (r.ok) setOpen(false);
            }}
          >
            Save items
          </Button>
        </div>
      </Modal>
    </>
  );
}

export function EditDetailsButton({
  orderId,
  pickupAddress,
  deliveryAddress,
  specialInstructions,
}: {
  orderId: string;
  pickupAddress: string;
  deliveryAddress: string;
  specialInstructions: string | null;
}) {
  const { run, pending, error } = useAction();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ pickupAddress, deliveryAddress, specialInstructions: specialInstructions ?? "" });
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Edit
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Addresses & instructions">
        <div className="space-y-4">
          <Field label="Pickup address">
            <Textarea value={form.pickupAddress} onChange={(e) => setForm({ ...form, pickupAddress: e.target.value })} />
          </Field>
          <Field label="Delivery address">
            <Textarea value={form.deliveryAddress} onChange={(e) => setForm({ ...form, deliveryAddress: e.target.value })} />
          </Field>
          <Field label="Special instructions">
            <Textarea value={form.specialInstructions} onChange={(e) => setForm({ ...form, specialInstructions: e.target.value })} />
          </Field>
          <ErrorText error={error} />
          <Button
            size="lg"
            className="w-full"
            disabled={pending}
            onClick={async () => {
              const r = await run(`/api/orders/${orderId}`, form, "PATCH");
              if (r.ok) setOpen(false);
            }}
          >
            Save
          </Button>
        </div>
      </Modal>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Payment                                                                    */
/* -------------------------------------------------------------------------- */

export function RecordPaymentButton({ orderId, balance, label = "Record payment" }: { orderId: string; balance: number; label?: string }) {
  const { run, pending, error } = useAction();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(balance / 100));
  const [method, setMethod] = useState("UPI");
  const [reference, setReference] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());

  return (
    <>
      <Button
        onClick={() => {
          setAmount(String(balance / 100));
          setKey(crypto.randomUUID());
          setOpen(true);
        }}
        disabled={balance <= 0}
      >
        {label}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Record payment">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Balance due: <span className="font-semibold text-slate-900">{money(balance)}</span></p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (₹)">
              <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Method">
              <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="UPI">UPI</option>
                <option value="CASH">Cash</option>
                <option value="CARD">Card</option>
                <option value="BANK_TRANSFER">Bank transfer</option>
              </Select>
            </Field>
          </div>
          <Field label="Reference (optional)">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UPI / transaction ID" />
          </Field>
          <ErrorText error={error} />
          <Button
            size="lg"
            className="w-full"
            disabled={pending}
            onClick={async () => {
              const r = await run(`/api/orders/${orderId}/payments`, {
                amount: toPaise(Number(amount) || 0),
                method,
                reference: reference || undefined,
                idempotencyKey: key,
              });
              if (r.ok) setOpen(false);
            }}
          >
            Save payment
          </Button>
        </div>
      </Modal>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Customer secure link                                                       */
/* -------------------------------------------------------------------------- */

export function CustomerLinkCard({ orderId, orderNumber, link, phone, businessName }: { orderId: string; orderNumber: string; link: string; phone: string; businessName: string }) {
  const { run, pending, error } = useAction();
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the link is visible to copy by hand */
    }
  };

  return (
    <div className="space-y-3">
      <div className="break-all rounded-xl bg-slate-50 px-3 py-2 font-mono text-xs text-slate-600">{link}</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Button variant="secondary" onClick={copy}>
          {copied ? <Check className="h-4 w-4 text-brand-700" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy"}
        </Button>
        <a href={link} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 text-sm font-semibold text-slate-800 hover:bg-slate-50">
          <ExternalLink className="h-4 w-4" /> Open
        </a>
        <a
          href={whatsappUrl(phone, `${businessName}: Track your order ${orderNumber} here: ${link}`)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 text-sm font-semibold text-slate-800 hover:bg-slate-50"
        >
          <MessageCircle className="h-4 w-4" /> Share
        </a>
        <Button
          variant="secondary"
          disabled={pending}
          onClick={async () => {
            const r = await run<{ whatsapp: string }>(`/api/orders/${orderId}/link`, { action: "send" });
            if (r.ok) setSent(r.data.whatsapp === "SENT" ? "Sent on WhatsApp." : "WhatsApp is not configured — use Share instead.");
          }}
        >
          <Send className="h-4 w-4" /> Send
        </Button>
      </div>
      <button
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-red-600"
        disabled={pending}
        onClick={async () => {
          if (!confirm("Revoke the current link and create a new one? The old link will stop working.")) return;
          const r = await run(`/api/orders/${orderId}/link`, { action: "reset" });
          if (r.ok) setSent("New link created. The old link no longer works.");
        }}
      >
        <RefreshCw className="h-3.5 w-3.5" /> Revoke & create new link
      </button>
      {sent && <p className="text-sm text-slate-600">{sent}</p>}
      <ErrorText error={error} />
    </div>
  );
}
