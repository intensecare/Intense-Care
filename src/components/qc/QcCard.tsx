"use client";

import { useState } from "react";
import { CheckCircle2, XCircle, RotateCcw } from "lucide-react";
import { Badge, Button, Field, Textarea } from "@/components/ui";
import { Modal, ErrorText } from "@/components/Modal";
import { useAction } from "@/lib/client/api";
import { UNIT_LABEL } from "@/lib/format";

export interface QcCardOrder {
  id: string;
  orderNumber: string;
  status: string;
  customerName: string;
  specialInstructions: string | null;
  pickupNote: string | null;
  photoUrls: string[];
  items: { itemName: string; serviceName: string; quantity: number; unit: string }[];
  history: { result: string; reason: string | null; inspector: string; at: string }[];
}

/** One order to inspect: items, services, photos, instructions → PASS / FAIL / NEEDS REWORK. */
export function QcCard({ order, canAct }: { order: QcCardOrder; canAct: boolean }) {
  const { run, pending, error } = useAction();
  const [decision, setDecision] = useState<"QC_FAILED" | "REWORK" | null>(null);
  const [reason, setReason] = useState("");
  const services = Array.from(new Set(order.items.map((i) => i.serviceName)));

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{order.orderNumber}</div>
          <div className="text-lg font-semibold text-slate-900">{order.customerName}</div>
        </div>
        {order.status === "REWORK" ? <Badge tone="danger">In rework</Badge> : order.history.length > 0 ? <Badge tone="warning">Re-check</Badge> : <Badge tone="warning">Pending</Badge>}
      </div>

      {services.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {services.map((s) => (
            <Badge key={s} tone="info">{s}</Badge>
          ))}
        </div>
      )}

      <ul className="mt-3 space-y-1 text-sm text-slate-800">
        {order.items.length === 0 ? (
          <li className="text-slate-500">No items listed.</li>
        ) : (
          order.items.map((i, n) => (
            <li key={n} className="flex justify-between gap-2">
              <span>{i.itemName}</span>
              <span className="shrink-0 text-slate-500">
                {i.quantity} {UNIT_LABEL[i.unit]}
              </span>
            </li>
          ))
        )}
      </ul>

      {order.specialInstructions && <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900"><strong>Instructions:</strong> {order.specialInstructions}</p>}
      {order.pickupNote && <p className="mt-2 text-sm text-slate-600"><strong>Pickup note:</strong> {order.pickupNote}</p>}

      {order.photoUrls.length > 0 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {order.photoUrls.map((u) => (
            <a key={u} href={u} target="_blank" rel="noreferrer" className="shrink-0">
              <img src={u} alt="Pickup photo" className="h-24 w-24 rounded-xl object-cover" />
            </a>
          ))}
        </div>
      )}

      {order.history.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {order.history.map((h, n) => (
            <div key={n} className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">
              <strong>{h.result === "FAILED" ? "Failed" : h.result === "REWORK" ? "Rework" : "Passed"}</strong>
              {h.reason ? `: ${h.reason}` : ""}
              <div className="text-xs text-red-700/70">
                {h.inspector} · {h.at}
              </div>
            </div>
          ))}
        </div>
      )}

      {canAct && (
        <div className="mt-4 space-y-2">
          <Button size="lg" className="w-full" disabled={pending} onClick={() => run(`/api/orders/${order.id}/transition`, { to: "QC_PASSED" })}>
            <CheckCircle2 className="h-5 w-5" /> PASS
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button size="lg" variant="danger" disabled={pending} onClick={() => { setReason(""); setDecision("QC_FAILED"); }}>
              <XCircle className="h-5 w-5" /> FAIL
            </Button>
            <Button size="lg" variant="secondary" disabled={pending} onClick={() => { setReason(""); setDecision("REWORK"); }}>
              <RotateCcw className="h-5 w-5" /> REWORK
            </Button>
          </div>
          <ErrorText error={decision ? null : error} />
        </div>
      )}

      <Modal open={!!decision} onClose={() => setDecision(null)} title={decision === "QC_FAILED" ? `Fail ${order.orderNumber}` : `Rework ${order.orderNumber}`}>
        <div className="space-y-4">
          <Field label={decision === "QC_FAILED" ? "Why did it fail? (required)" : "What needs rework? (required)"}>
            <Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Collar stain still visible on 2 white shirts" />
          </Field>
          <ErrorText error={error} />
          <Button
            size="lg"
            variant={decision === "QC_FAILED" ? "danger" : "primary"}
            className="w-full"
            disabled={pending || reason.trim().length < 3}
            onClick={async () => {
              const r = await run(`/api/orders/${order.id}/transition`, { to: decision, reason: reason.trim() });
              if (r.ok) setDecision(null);
            }}
          >
            {decision === "QC_FAILED" ? "Mark QC Failed" : "Send to Rework"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
