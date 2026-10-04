"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/utils";
import { getTaxRate } from "@/lib/tax";
import type { SystemSettings } from "@/lib/types";
import type { Customer, Property, Service } from "@/lib/types";

export interface QuoteItemPayload {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface QuoteFormPayload {
  customerId: string;
  propertyId: string;
  serviceId: string;
  items: QuoteItemPayload[];
  validUntil: string;
}

interface QuoteFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customers: Customer[];
  properties: Property[];
  services: Service[];
  systemSettings?: SystemSettings;
  /** Lock the customer (e.g. raising a quote from the customer detail page). */
  lockedCustomerId?: string;
  /** Preselected property for the locked customer, when known. */
  defaultPropertyId?: string;
  onSubmit: (
    payload: QuoteFormPayload
  ) => Promise<{ success: boolean; message: string }>;
}

const toLocalDateOffset = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Shared "raise quotation" form used by the Finance page and the customer
 * detail page. Line items compute the totals live with the configured tax
 * rate; the server re-computes them authoritatively on submit.
 */
export function QuoteFormDialog({
  open,
  onOpenChange,
  customers,
  properties,
  services,
  systemSettings,
  lockedCustomerId,
  defaultPropertyId,
  onSubmit,
}: QuoteFormDialogProps) {
  const [customerId, setCustomerId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [items, setItems] = useState<QuoteItemPayload[]>([
    { description: "", quantity: 1, unitPrice: 0 },
  ]);
  const [validUntil, setValidUntil] = useState(toLocalDateOffset(30));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Reset the form each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setError("");
    const initialCustomer = lockedCustomerId || "";
    setCustomerId(initialCustomer);
    const customerProps = properties.filter((p) => p.customerId === initialCustomer);
    setPropertyId(defaultPropertyId && customerProps.some((p) => p.id === defaultPropertyId) ? defaultPropertyId : customerProps[0]?.id || "");
    setServiceId("");
    const service = services[0];
    setItems(
      service
        ? [{ description: service.name, quantity: 1, unitPrice: service.basePrice }]
        : [{ description: "", quantity: 1, unitPrice: 0 }]
    );
    setValidUntil(toLocalDateOffset(30));
  }, [open, lockedCustomerId, defaultPropertyId, properties, services]);

  const customerProperties = useMemo(
    () => properties.filter((p) => p.customerId === customerId),
    [properties, customerId]
  );

  const taxRate = getTaxRate(systemSettings ?? { taxRatePercent: 0 });
  const taxPct = Math.round(taxRate * 10000) / 100;
  const subtotal = items.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0);
  const tax = Math.round(subtotal * taxRate * 100) / 100;

  const setItem = (index: number, patch: Partial<QuoteItemPayload>) => {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  };

  const addRow = () => setItems((prev) => [...prev, { description: "", quantity: 1, unitPrice: 0 }]);
  const removeRow = (index: number) =>
    setItems((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));

  const pickService = (id: string) => {
    setServiceId(id);
    const service = services.find((s) => s.id === id);
    if (!service) return;
    // Prefill the first line with the selected package at its base price.
    setItems((prev) => {
      const rest = prev.slice(1);
      return [{ description: service.name, quantity: 1, unitPrice: service.basePrice }, ...rest];
    });
  };

  const canSubmit =
    !!customerId &&
    !!propertyId &&
    !!serviceId &&
    !!validUntil &&
    items.some((it) => it.description.trim().length > 0 && (Number(it.quantity) || 0) > 0 && (Number(it.unitPrice) || 0) >= 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) {
      setError("Pick a customer, property and service package, and keep at least one priced line item.");
      return;
    }
    setError("");
    setIsSubmitting(true);
    const result = await onSubmit({
      customerId,
      propertyId,
      serviceId,
      validUntil,
      items: items
        .filter((it) => it.description.trim().length > 0 && (Number(it.quantity) || 0) > 0)
        .map((it) => ({
          description: it.description.trim(),
          quantity: Number(it.quantity) || 1,
          unitPrice: Number(it.unitPrice) || 0,
        })),
    });
    setIsSubmitting(false);
    if (result.success) onOpenChange(false);
    else setError(result.message);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-base">Raise Quotation</DialogTitle>
          <DialogDescription>
            Price the work as line items — the client sees a printable quotation with the same figures.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Customer</label>
              {lockedCustomerId ? (
                <div className="h-9 px-3 flex items-center rounded-md border border-slate-200 bg-slate-50 font-semibold text-slate-700 truncate">
                  {customers.find((c) => c.id === lockedCustomerId)?.name || "—"}
                </div>
              ) : (
                <SearchableSelect
                  options={customers.map((c) => ({ value: c.id, label: `${c.name} (${c.phone})` }))}
                  value={customerId}
                  onChange={(v) => {
                    setCustomerId(v);
                    const props = properties.filter((p) => p.customerId === v);
                    setPropertyId(props[0]?.id || "");
                  }}
                  placeholder="Select customer…"
                />
              )}
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Service Property</label>
              <SearchableSelect
                options={customerProperties.map((p) => ({ value: p.id, label: `${p.title} — ${p.address}` }))}
                value={propertyId}
                onChange={setPropertyId}
                placeholder={customerId ? "Select property…" : "Pick a customer first"}
                disabled={!customerId}
              />
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Service Package</label>
              <SearchableSelect
                options={services.map((s) => ({ value: s.id, label: `${s.name} — ${formatCurrency(s.basePrice)}` }))}
                value={serviceId}
                onChange={pickService}
                placeholder="Select service package…"
              />
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Valid Until</label>
              <Input
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                className="text-xs"
              />
            </div>
          </div>

          {/* Line items */}
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center justify-between">
              <label className="font-semibold text-slate-700">Line Items</label>
              <Button type="button" variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={addRow}>
                <Plus className="h-3 w-3" />
                Add Item
              </Button>
            </div>
            <div className="space-y-1.5">
              {items.map((it, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <Input
                    type="text"
                    value={it.description}
                    onChange={(e) => setItem(i, { description: e.target.value })}
                    placeholder="Description (e.g. Full-home deep clean)"
                    className="text-xs flex-1"
                  />
                  <Input
                    type="number"
                    min={0.01}
                    step="0.01"
                    value={it.quantity}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setItem(i, { quantity: Number(e.target.value) })}
                    className="text-xs w-16"
                    title="Quantity"
                  />
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={it.unitPrice}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setItem(i, { unitPrice: Number(e.target.value) })}
                    className="text-xs w-24 font-mono"
                    title="Unit price (₹)"
                  />
                  <span className="w-20 text-right font-mono text-[11px] text-slate-600 shrink-0">
                    {formatCurrency((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0))}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 p-0 text-red-600 hover:bg-red-50 shrink-0"
                    onClick={() => removeRow(i)}
                    disabled={items.length === 1}
                    title="Remove line"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {/* Totals */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 space-y-1">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal</span>
              <span className="font-semibold text-slate-900 font-mono">{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>
                {systemSettings?.taxLabel?.trim() || "GST"} @ {taxPct}%
              </span>
              <span className="font-semibold text-slate-900 font-mono">{formatCurrency(tax)}</span>
            </div>
            <div className="flex justify-between font-semibold text-slate-900 border-t border-slate-200 pt-1">
              <span>Quotation Total</span>
              <span className="font-mono">{formatCurrency(subtotal + tax)}</span>
            </div>
          </div>

          {error && (
            <p className="text-[11px] font-medium text-red-700 bg-red-50 border border-red-200 rounded px-2.5 py-1.5">
              {error}
            </p>
          )}

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" className="" disabled={isSubmitting || !canSubmit}>
              {isSubmitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Creating…
                </>
              ) : (
                "Create Quotation"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
