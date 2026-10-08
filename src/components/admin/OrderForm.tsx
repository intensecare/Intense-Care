"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardHeader, Field, Input, Select, Textarea } from "@/components/ui";
import { ErrorText } from "@/components/Modal";
import { ItemsEditor, newItem, toItemPayload, type ItemDraft, type ServiceOption } from "./ItemsEditor";
import { apiCall } from "@/lib/client/api";
import { computeTotals } from "@/lib/pricing";
import { money, toPaise, displayPhone } from "@/lib/format";

interface CustomerHit {
  id: string;
  name: string;
  phone: string;
  address: string;
}

/** New order: customer → items → pickup. The pickup is auto-assigned unless a field manager is chosen. */
export function OrderForm({
  services,
  fieldManagers,
  taxPercent,
  initialCustomer,
}: {
  services: ServiceOption[];
  fieldManagers: { id: string; name: string }[];
  taxPercent: number;
  initialCustomer: CustomerHit | null;
}) {
  const router = useRouter();
  const [customer, setCustomer] = useState<CustomerHit | null>(initialCustomer);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [newCustomer, setNewCustomer] = useState({ name: "", phone: "", address: "" });
  const [items, setItems] = useState<ItemDraft[]>(services.length ? [newItem(services)] : []);
  const [instructions, setInstructions] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [pickupAt, setPickupAt] = useState("");
  const [assignToId, setAssignToId] = useState("");
  const [discount, setDiscount] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (customer || query.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      const r = await apiCall<CustomerHit[]>(`/api/customers?q=${encodeURIComponent(query.trim())}`, "GET");
      if (r.ok) setHits(r.data);
    }, 250);
    return () => clearTimeout(t);
  }, [query, customer]);

  const byId = new Map(services.map((s) => [s.id, s]));
  const lines = toItemPayload(items).map((i) => ({ quantity: i.quantity, unitPrice: byId.get(i.serviceId)?.price ?? 0 }));
  const totals = computeTotals(lines, toPaise(Number(discount) || 0), taxPercent);

  const submit = async () => {
    setError(null);
    if (!customer && (!newCustomer.name.trim() || !newCustomer.phone.trim() || !newCustomer.address.trim())) {
      return setError("Pick an existing customer or enter name, phone and address.");
    }
    setPending(true);
    const r = await apiCall<{ id: string }>("/api/orders", "POST", {
      ...(customer ? { customerId: customer.id } : { customer: newCustomer }),
      items: toItemPayload(items),
      specialInstructions: instructions || undefined,
      deliveryAddress: deliveryAddress || undefined,
      pickupAt: pickupAt ? new Date(pickupAt).toISOString() : null,
      assignToId: assignToId || null,
      discount: toPaise(Number(discount) || 0),
    });
    setPending(false);
    if (!r.ok) return setError(r.error);
    router.push(`/admin/orders/${r.data.id}`);
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="1. Customer" />
        <div className="space-y-3 p-4">
          {customer ? (
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-brand-50 p-3">
              <div className="min-w-0">
                <div className="font-semibold text-slate-900">{customer.name}</div>
                <div className="text-sm text-slate-600">{displayPhone(customer.phone)}</div>
                <div className="text-sm text-slate-600 break-words">{customer.address}</div>
              </div>
              <Button variant="secondary" onClick={() => setCustomer(null)}>
                Change
              </Button>
            </div>
          ) : (
            <>
              <Field label="Find existing customer">
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or phone" />
              </Field>
              {hits.length > 0 && (
                <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                  {hits.map((h) => (
                    <button key={h.id} onClick={() => setCustomer(h)} className="block w-full px-3 py-3 text-left hover:bg-slate-50">
                      <div className="font-medium text-slate-900">{h.name}</div>
                      <div className="text-sm text-slate-500">
                        {displayPhone(h.phone)} · {h.address}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              <p className="pt-1 text-sm font-medium text-slate-700">Or add a new customer</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Name">
                  <Input value={newCustomer.name} onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })} />
                </Field>
                <Field label="Phone (WhatsApp)">
                  <Input type="tel" inputMode="tel" value={newCustomer.phone} onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })} />
                </Field>
              </div>
              <Field label="Pickup address">
                <Textarea value={newCustomer.address} onChange={(e) => setNewCustomer({ ...newCustomer, address: e.target.value })} />
              </Field>
            </>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="2. Items & services" />
        <div className="p-4">
          <ItemsEditor services={services} items={items} onChange={setItems} />
          <p className="mt-2 text-xs text-slate-500">Not counted yet? Leave items empty and add them after pickup.</p>
        </div>
      </Card>

      <Card>
        <CardHeader title="3. Pickup" />
        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
          <Field label="Pickup time (optional)">
            <Input type="datetime-local" value={pickupAt} onChange={(e) => setPickupAt(e.target.value)} />
          </Field>
          <Field label="Field manager" hint="Leave on automatic to assign the least busy field manager.">
            <Select value={assignToId} onChange={(e) => setAssignToId(e.target.value)}>
              <option value="">Automatic</option>
              {fieldManagers.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Special instructions (optional)">
              <Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="e.g. Silk saree — dry clean only, light starch on shirts" />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Delivery address (optional)" hint="Leave empty to deliver to the pickup address.">
              <Input value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} />
            </Field>
          </div>
        </div>
      </Card>

      <Card>
        <div className="space-y-2 p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-slate-600">Discount (₹)</span>
            <Input className="w-32 text-right" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" />
          </div>
          <div className="flex justify-between text-sm text-slate-600">
            <span>Subtotal</span>
            <span>{money(totals.subtotal)}</span>
          </div>
          {totals.tax > 0 && (
            <div className="flex justify-between text-sm text-slate-600">
              <span>Tax ({taxPercent}%)</span>
              <span>{money(totals.tax)}</span>
            </div>
          )}
          <div className="flex justify-between text-lg font-bold text-slate-900">
            <span>Total</span>
            <span>{money(totals.total)}</span>
          </div>
          <ErrorText error={error} />
          <Button size="lg" className="w-full" onClick={submit} disabled={pending}>
            {pending ? "Creating…" : "Create Order"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
