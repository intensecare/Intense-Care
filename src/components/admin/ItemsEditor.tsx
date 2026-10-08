"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button, Input, Select } from "@/components/ui";
import { money, UNIT_LABEL } from "@/lib/format";
import { lineTotal } from "@/lib/pricing";

export interface ServiceOption {
  id: string;
  name: string;
  unit: string;
  price: number;
}

export interface ItemDraft {
  key: string;
  serviceId: string;
  itemName: string;
  quantity: string;
}

export function newItem(services: ServiceOption[]): ItemDraft {
  return { key: Math.random().toString(36).slice(2), serviceId: services[0]?.id ?? "", itemName: "", quantity: "1" };
}

/** Item lines: service + what it is + quantity, with live line totals. Used by create and edit. */
export function ItemsEditor({ services, items, onChange }: { services: ServiceOption[]; items: ItemDraft[]; onChange: (items: ItemDraft[]) => void }) {
  const byId = new Map(services.map((s) => [s.id, s]));
  const update = (key: string, patch: Partial<ItemDraft>) => onChange(items.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const s = byId.get(item.serviceId);
        const qty = Number(item.quantity) || 0;
        return (
          <div key={item.key} className="rounded-xl border border-slate-200 p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.3fr_1.3fr_0.7fr_auto]">
              <Select value={item.serviceId} onChange={(e) => update(item.key, { serviceId: e.target.value })} aria-label="Service">
                {services.map((sv) => (
                  <option key={sv.id} value={sv.id}>
                    {sv.name} — {money(sv.price)}/{UNIT_LABEL[sv.unit]}
                  </option>
                ))}
              </Select>
              <Input value={item.itemName} onChange={(e) => update(item.key, { itemName: e.target.value })} placeholder="Item (e.g. Shirts)" aria-label="Item" />
              <Input
                value={item.quantity}
                onChange={(e) => update(item.key, { quantity: e.target.value })}
                inputMode="decimal"
                placeholder={s ? UNIT_LABEL[s.unit] : "Qty"}
                aria-label="Quantity"
              />
              <Button variant="ghost" onClick={() => onChange(items.filter((i) => i.key !== item.key))} aria-label="Remove item" className="px-3">
                <Trash2 className="h-5 w-5" />
              </Button>
            </div>
            {s && (
              <div className="mt-1.5 text-right text-sm text-slate-500">
                {qty} {UNIT_LABEL[s.unit]} × {money(s.price)} = <span className="font-semibold text-slate-900">{money(lineTotal({ quantity: qty, unitPrice: s.price }))}</span>
              </div>
            )}
          </div>
        );
      })}
      <Button variant="secondary" onClick={() => onChange([...items, newItem(services)])} disabled={services.length === 0}>
        <Plus className="h-5 w-5" /> Add item
      </Button>
      {services.length === 0 && <p className="text-sm text-amber-700">Add a service with a price first (Admin → Services).</p>}
    </div>
  );
}

export function toItemPayload(items: ItemDraft[]) {
  return items
    .filter((i) => i.serviceId && Number(i.quantity) > 0)
    .map((i) => ({ serviceId: i.serviceId, itemName: i.itemName.trim(), quantity: Number(i.quantity) }));
}
