"use client";

import { useRef, useState } from "react";
import { Phone, MapPin, Clock, Camera, CheckCircle2, Truck, PackageCheck } from "lucide-react";
import { Badge, Button, Field, Textarea } from "@/components/ui";
import { Modal, ErrorText } from "@/components/Modal";
import { DeliverDialog } from "@/components/DeliverDialog";
import { apiCall, useAction } from "@/lib/client/api";
import { compressImageForUpload } from "@/lib/client/image-compress";
import { displayPhone, formatDateTime, mapsUrl, money, UNIT_LABEL } from "@/lib/format";

export interface TaskOrder {
  id: string;
  orderNumber: string;
  status: string;
  pickupAddress: string;
  deliveryAddress: string;
  specialInstructions: string | null;
  total: number;
  amountPaid: number;
  customer: { name: string; phone: string };
  items: { itemName: string; serviceName: string; quantity: number; unit: string }[];
}

function ContactRow({ phone, address }: { phone: string; address: string }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <a href={`tel:+${phone}`} className="flex h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 text-sm font-semibold text-slate-800 active:bg-slate-100">
        <Phone className="h-5 w-5 text-brand-700" /> Call
      </a>
      <a href={mapsUrl(address)} target="_blank" rel="noreferrer" className="flex h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 text-sm font-semibold text-slate-800 active:bg-slate-100">
        <MapPin className="h-5 w-5 text-brand-700" /> Directions
      </a>
    </div>
  );
}

function ItemsSummary({ items }: { items: TaskOrder["items"] }) {
  if (items.length === 0) return <p className="text-sm text-slate-500">Items will be counted at pickup.</p>;
  return (
    <ul className="space-y-0.5 text-sm text-slate-700">
      {items.map((i, n) => (
        <li key={n}>
          {i.quantity} {UNIT_LABEL[i.unit]} · {i.itemName} <span className="text-slate-400">({i.serviceName})</span>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* PICKUP                                                                     */
/* -------------------------------------------------------------------------- */

export function PickupCard({ order, scheduledAt, done, photosEnabled }: { order: TaskOrder; scheduledAt: string | null; done: boolean; photosEnabled: boolean }) {
  const { run, pending, error, setError } = useAction();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setError(null);
    const dataUrl = await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.readAsDataURL(file);
    });
    const prepared = await compressImageForUpload(dataUrl);
    const res = await apiCall<{ url: string }>(`/api/orders/${order.id}/photos`, "POST", { image: prepared.dataUrl });
    setUploading(false);
    if (res.ok) setPhotos((p) => [...p, res.data.url]);
    else setError(res.error);
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-brand-700">
            <PackageCheck className="h-4 w-4" /> Pickup · {order.orderNumber}
          </div>
          <div className="mt-1 text-lg font-semibold text-slate-900">{order.customer.name}</div>
          <div className="text-sm text-slate-600">{displayPhone(order.customer.phone)}</div>
        </div>
        {done ? <Badge tone="success">Picked up</Badge> : scheduledAt ? <Badge tone="info">{formatDateTime(scheduledAt)}</Badge> : null}
      </div>
      <p className="mt-2 text-sm text-slate-700 break-words">{order.pickupAddress}</p>
      {!done && scheduledAt && (
        <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
          <Clock className="h-4 w-4" /> Pickup time {formatDateTime(scheduledAt)}
        </p>
      )}
      <div className="mt-3">
        <ItemsSummary items={order.items} />
      </div>
      {order.specialInstructions && <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{order.specialInstructions}</p>}
      {!done && (
        <div className="mt-3 space-y-2">
          <ContactRow phone={order.customer.phone} address={order.pickupAddress} />
          <Button size="lg" className="w-full" onClick={() => setOpen(true)}>
            <CheckCircle2 className="h-5 w-5" /> Mark Picked Up
          </Button>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={`Pick up ${order.orderNumber}`}>
        <div className="space-y-4">
          {photosEnabled && (
            <div>
              <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPhoto} />
              <Button variant="secondary" className="w-full" disabled={uploading} onClick={() => fileRef.current?.click()}>
                <Camera className="h-5 w-5" /> {uploading ? "Uploading…" : `Add photo (optional)${photos.length ? ` · ${photos.length} added` : ""}`}
              </Button>
              {photos.length > 0 && (
                <div className="mt-2 flex gap-2 overflow-x-auto">
                  {photos.map((p) => (
                    <img key={p} src={p} alt="" className="h-16 w-16 rounded-lg object-cover" />
                  ))}
                </div>
              )}
            </div>
          )}
          <Field label="Note (optional)">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. 2 bags, 1 stain on white shirt" />
          </Field>
          <ErrorText error={error} />
          <Button
            size="lg"
            className="w-full"
            disabled={pending || uploading}
            onClick={async () => {
              const r = await run(`/api/orders/${order.id}/transition`, { to: "PICKED_UP", notes: notes || undefined });
              if (r.ok) setOpen(false);
            }}
          >
            {pending ? "Saving…" : "Confirm Picked Up"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* DELIVERY                                                                   */
/* -------------------------------------------------------------------------- */

export function DeliveryCard({ order, scheduledAt, done }: { order: TaskOrder; scheduledAt: string | null; done: boolean }) {
  const { run, pending, error } = useAction();
  const [deliverOpen, setDeliverOpen] = useState(false);
  const due = Math.max(0, order.total - order.amountPaid);
  const started = order.status === "OUT_FOR_DELIVERY";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-sky-700">
            <Truck className="h-4 w-4" /> Delivery · {order.orderNumber}
          </div>
          <div className="mt-1 text-lg font-semibold text-slate-900">{order.customer.name}</div>
          <div className="text-sm text-slate-600">{displayPhone(order.customer.phone)}</div>
        </div>
        {done ? <Badge tone="success">Delivered</Badge> : started ? <Badge tone="info">On the way</Badge> : scheduledAt ? <Badge>{formatDateTime(scheduledAt)}</Badge> : <Badge tone="success">Ready</Badge>}
      </div>
      <p className="mt-2 text-sm text-slate-700 break-words">{order.deliveryAddress}</p>
      <div className="mt-3">
        <ItemsSummary items={order.items} />
      </div>
      <div className={`mt-3 rounded-xl px-3 py-2 text-base font-semibold ${due > 0 ? "bg-amber-50 text-amber-900" : "bg-brand-50 text-brand-800"}`}>
        {due > 0 ? `Amount due: ${money(due)}` : "Paid — nothing to collect"}
      </div>
      {!done && (
        <div className="mt-3 space-y-2">
          <ContactRow phone={order.customer.phone} address={order.deliveryAddress} />
          {started ? (
            <Button size="lg" className="w-full" onClick={() => setDeliverOpen(true)}>
              <CheckCircle2 className="h-5 w-5" /> Delivered
            </Button>
          ) : (
            <Button size="lg" className="w-full" disabled={pending} onClick={() => run(`/api/orders/${order.id}/transition`, { to: "OUT_FOR_DELIVERY" })}>
              <Truck className="h-5 w-5" /> {pending ? "Starting…" : "Start Delivery"}
            </Button>
          )}
          <ErrorText error={error} />
        </div>
      )}
      {deliverOpen && <DeliverDialog orderId={order.id} orderNumber={order.orderNumber} amountDue={due} open onClose={() => setDeliverOpen(false)} />}
    </div>
  );
}
