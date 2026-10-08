"use client";

import React, { useMemo, useState } from "react";
import { Check, Plus, Sparkles, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { computeDocumentFigures, formatDuration } from "@/lib/documents";
import { cn, formatMoney } from "@/lib/utils";
import type { Service } from "@/lib/types";

/**
 * §3 CUSTOM SERVICES — choose one or many services for a job or quotation.
 *
 * Catalog services are one tap. A custom service (a post-construction clean,
 * a one-off scope) is typed in right here with its own name, description,
 * price, duration and tax treatment, and is kept in the catalog so it can be
 * quoted, invoiced and reported on like any other service.
 *
 * Prices shown here are a preview. The server re-prices every line from the
 * catalog and recomputes the GST, so nothing depends on this arithmetic.
 */

export interface ServiceDraft {
  /** Catalog service id; absent for a custom one-off. */
  serviceId?: string;
  name: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  durationHours: number;
  taxTreatment: "GST" | "EXEMPT";
  /** Custom lines only: keep it in the catalog for re-use. */
  saveToCatalog?: boolean;
  /** Marks the row as typed in by hand rather than taken from the catalog. */
  custom?: boolean;
}

export function draftFromService(s: Service): ServiceDraft {
  return {
    serviceId: s.id,
    name: s.name,
    description: s.description,
    quantity: 1,
    unitPrice: s.basePrice,
    discount: 0,
    durationHours: s.estimatedDurationHours,
    taxTreatment: s.taxTreatment === "EXEMPT" ? "EXEMPT" : "GST",
  };
}

/** The payload POST /api/jobs and POST /api/quotes expect. */
export function toServicePayload(drafts: ServiceDraft[]) {
  return drafts.map((d) => ({
    ...(d.serviceId ? { serviceId: d.serviceId } : { name: d.name }),
    description: d.description || undefined,
    quantity: d.quantity,
    unitPrice: d.unitPrice,
    discount: d.discount || 0,
    durationHours: d.durationHours || undefined,
    taxTreatment: d.taxTreatment,
    saveToCatalog: d.serviceId ? undefined : d.saveToCatalog !== false,
  }));
}

const money = (v: string) => Math.max(0, Number.parseFloat(v) || 0);

export function ServiceSelector({
  services,
  value,
  onChange,
  gst,
  taxRatePercent,
  interState,
  documentDiscount = 0,
  disabled,
  className,
}: {
  services: Service[];
  value: ServiceDraft[];
  onChange: (next: ServiceDraft[]) => void;
  gst: boolean;
  taxRatePercent: number;
  interState?: boolean;
  documentDiscount?: number;
  disabled?: boolean;
  className?: string;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const [custom, setCustom] = useState<ServiceDraft>({
    name: "",
    description: "",
    quantity: 1,
    unitPrice: 0,
    discount: 0,
    durationHours: 4,
    taxTreatment: "GST",
    saveToCatalog: true,
    custom: true,
  });

  const active = useMemo(() => services.filter((s) => s.active), [services]);
  const chosen = useMemo(() => new Set(value.map((v) => v.serviceId).filter(Boolean)), [value]);

  const figures = useMemo(
    () =>
      computeDocumentFigures({
        invoiceType: gst ? "GST" : "NON_GST",
        lines: value.map((v) => ({
          name: v.name,
          quantity: v.quantity,
          unitPrice: v.unitPrice,
          discount: v.discount,
          taxable: v.taxTreatment !== "EXEMPT",
          durationHours: v.durationHours,
        })),
        gstRatePercent: taxRatePercent,
        interState,
        documentDiscount,
      }),
    [value, gst, taxRatePercent, interState, documentDiscount]
  );

  const toggleCatalog = (s: Service) => {
    if (disabled) return;
    onChange(
      chosen.has(s.id) ? value.filter((v) => v.serviceId !== s.id) : [...value, draftFromService(s)]
    );
  };

  const patchLine = (index: number, patch: Partial<ServiceDraft>) =>
    onChange(value.map((v, i) => (i === index ? { ...v, ...patch } : v)));

  const addCustom = () => {
    if (!custom.name.trim()) return;
    onChange([...value, { ...custom, name: custom.name.trim() }]);
    setCustom({
      name: "",
      description: "",
      quantity: 1,
      unitPrice: 0,
      discount: 0,
      durationHours: 4,
      taxTreatment: "GST",
      saveToCatalog: true,
      custom: true,
    });
    setCustomOpen(false);
  };

  return (
    <div className={cn("space-y-4", className)}>
      {/* ------------------------------------------------- the catalog */}
      <div>
        <h3 className="text-sm font-medium text-zinc-800 mb-2">Services</h3>
        {active.length === 0 ? (
          <p className="text-sm text-zinc-500 rounded-xl border border-dashed border-zinc-300 px-3.5 py-3">
            No services in the catalog yet. Add a custom service below, or create them on the Services page.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {active.map((s) => {
              const on = chosen.has(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggleCatalog(s)}
                  aria-pressed={on}
                  disabled={disabled}
                  className={cn(
                    "text-left rounded-xl border-2 px-3.5 py-3 min-h-[60px] transition-colors",
                    on ? "border-rose-500 bg-rose-50" : "border-zinc-200 bg-white hover:border-zinc-300"
                  )}
                >
                  <span className="flex items-start gap-2">
                    <span
                      className={cn(
                        "mt-0.5 h-5 w-5 rounded-md border-2 flex items-center justify-center shrink-0",
                        on ? "border-rose-500 bg-rose-500 text-white" : "border-zinc-300"
                      )}
                      aria-hidden
                    >
                      {on && <Check className="h-3.5 w-3.5" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-zinc-950 break-words">
                        {s.name}
                        {s.isCustom && (
                          <span className="ml-1.5 inline-flex items-center gap-0.5 text-[11px] font-semibold text-rose-600">
                            <Sparkles className="h-3 w-3" aria-hidden /> custom
                          </span>
                        )}
                      </span>
                      <span className="block text-xs text-zinc-600 mt-0.5">
                        {formatMoney(s.basePrice)} · {formatDuration(s.estimatedDurationHours)}
                        {s.taxTreatment === "EXEMPT" ? " · GST exempt" : ""}
                      </span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* --------------------------------------------- custom service */}
      {customOpen ? (
        <div className="rounded-xl border-2 border-rose-200 bg-rose-50/40 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-rose-600" aria-hidden />
            <h4 className="text-sm font-semibold text-zinc-950">Custom service</h4>
          </div>
          <Field label="Service name" required>
            <Input
              value={custom.name}
              onChange={(e) => setCustom({ ...custom, name: e.target.value })}
              placeholder="e.g. Post Construction Deep Cleaning"
              autoFocus
            />
          </Field>
          <Field label="Description" hint="What the price covers. Printed on the quotation and invoice.">
            <Input
              value={custom.description ?? ""}
              onChange={(e) => setCustom({ ...custom, description: e.target.value })}
              placeholder="e.g. Complete cleaning of newly constructed property"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Price" required>
              <Input
                type="number"
                min={0}
                inputMode="decimal"
                value={custom.unitPrice || ""}
                onChange={(e) => setCustom({ ...custom, unitPrice: money(e.target.value) })}
                placeholder="25000"
              />
            </Field>
            <Field label="Duration (hours)" hint={formatDuration(custom.durationHours)}>
              <Input
                type="number"
                min={0.5}
                step={0.5}
                inputMode="decimal"
                value={custom.durationHours || ""}
                onChange={(e) => setCustom({ ...custom, durationHours: money(e.target.value) })}
                placeholder="48"
              />
            </Field>
          </div>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium text-zinc-800">Tax treatment</legend>
            <div className="grid grid-cols-2 gap-2">
              {(["GST", "EXEMPT"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={custom.taxTreatment === t}
                  onClick={() => setCustom({ ...custom, taxTreatment: t })}
                  className={cn(
                    "min-h-11 rounded-xl border px-3 text-sm font-medium",
                    custom.taxTreatment === t
                      ? "border-zinc-900 bg-zinc-900 text-white"
                      : "border-zinc-300 bg-white text-zinc-700"
                  )}
                >
                  {t === "GST" ? "Taxable (GST)" : "GST exempt"}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="flex items-start gap-2.5 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={custom.saveToCatalog !== false}
              onChange={(e) => setCustom({ ...custom, saveToCatalog: e.target.checked })}
              className="mt-0.5 h-5 w-5 accent-rose-500"
            />
            <span>
              Keep in the catalog
              <span className="block text-xs text-zinc-500">So it can be booked again and shows up in reports.</span>
            </span>
          </label>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="ghost" onClick={() => setCustomOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={addCustom} disabled={!custom.name.trim()}>
              <Plus className="h-4 w-4" aria-hidden /> Add service
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="outline" onClick={() => setCustomOpen(true)} disabled={disabled}>
          <Wand2 className="h-4 w-4" aria-hidden /> Add a custom service
        </Button>
      )}

      {/* ------------------------------------------- the chosen lines */}
      {value.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-zinc-800">
            Selected · {value.length} service{value.length === 1 ? "" : "s"}
          </h3>
          {value.map((line, i) => (
            <div key={`${line.serviceId ?? line.name}-${i}`} className="rounded-xl border border-zinc-200 bg-white p-3.5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-950 break-words">{line.name}</div>
                  {line.description && <div className="text-xs text-zinc-500 break-words mt-0.5">{line.description}</div>}
                  <div className="text-xs text-zinc-500 mt-0.5">
                    {formatDuration(line.durationHours * line.quantity)}
                    {line.taxTreatment === "EXEMPT" ? " · GST exempt" : ""}
                    {line.custom ? " · custom" : ""}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onChange(value.filter((_, idx) => idx !== i))}
                  disabled={disabled}
                  className="h-9 w-9 rounded-lg text-zinc-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center shrink-0"
                  aria-label={`Remove ${line.name}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Qty">
                  <Input
                    type="number"
                    min={1}
                    inputMode="numeric"
                    value={line.quantity}
                    onChange={(e) => patchLine(i, { quantity: Math.max(1, Number.parseInt(e.target.value, 10) || 1) })}
                    disabled={disabled}
                  />
                </Field>
                <Field label="Unit price">
                  <Input
                    type="number"
                    min={0}
                    inputMode="decimal"
                    value={line.unitPrice}
                    onChange={(e) => patchLine(i, { unitPrice: money(e.target.value) })}
                    disabled={disabled}
                  />
                </Field>
                <Field label="Discount">
                  <Input
                    type="number"
                    min={0}
                    inputMode="decimal"
                    value={line.discount}
                    onChange={(e) => patchLine(i, { discount: money(e.target.value) })}
                    disabled={disabled}
                  />
                </Field>
              </div>
              <div className="text-right text-sm font-semibold text-zinc-950 tabular-nums">
                {formatMoney(Math.max(0, line.quantity * line.unitPrice - line.discount))}
              </div>
            </div>
          ))}

          {/* Running total — the same ladder the document will print. */}
          <dl className="rounded-xl bg-zinc-50 border border-zinc-200 divide-y divide-zinc-200 overflow-hidden">
            <Row label="Subtotal" value={formatMoney(figures.subtotal)} />
            {figures.discount > 0 && <Row label="Discount" value={`− ${formatMoney(figures.discount)}`} />}
            {gst && figures.exempt > 0 && <Row label="GST-exempt services" value={formatMoney(figures.exempt)} />}
            {gst && (
              <Row
                label={`GST ${figures.gstRate}%${interState ? " (IGST)" : " (CGST + SGST)"}`}
                value={formatMoney(figures.tax)}
              />
            )}
            <Row label="Grand total" value={formatMoney(figures.total)} strong />
          </dl>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3.5 py-2">
      <dt className={cn("text-sm", strong ? "font-semibold text-zinc-950" : "text-zinc-600")}>{label}</dt>
      <dd className={cn("tabular-nums text-right", strong ? "text-base font-semibold text-zinc-950" : "text-sm text-zinc-900")}>
        {value}
      </dd>
    </div>
  );
}
