"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, PenLine, Package, FileText } from "lucide-react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Notice } from "@/components/ui/states";
import { quoteApi } from "@/components/quote/QuoteParts";
import { CustomerPicker, rememberCustomer, type CustomerChoice } from "@/components/common/CustomerPicker";
import { useApp } from "@/lib/app-context";
import { computeInvoiceFigures, isValidGstin } from "@/lib/tax";
import { cn, formatMoney, toLocalDateOffset } from "@/lib/utils";
import type { Quote } from "@/lib/types";

interface Line {
  key: number;
  serviceId: string | null;
  description: string;
  quantity: string;
  rate: string;
}

let seq = 0;
const blank = (custom: boolean): Line => ({ key: ++seq, serviceId: custom ? null : "", description: "", quantity: "1", rate: "" });
const num = (v: string) => (v.trim() === "" ? NaN : Number(v));
const area = "w-full rounded-xl border border-zinc-300 px-3.5 py-2.5 text-sm";

/**
 * Create or edit a quotation: customer and property, catalogue services and
 * one-off custom lines, discount, GST / Non-GST, validity and terms — with
 * live totals worked out by the same maths the server uses.
 */
export function QuoteEditor({ initial, presetCustomerId }: { initial?: Quote; presetCustomerId?: string }) {
  const router = useRouter();
  const { customers, properties, services, systemSettings, refreshCustomers } = useApp();
  const [choice, setChoice] = useState<CustomerChoice>(() => {
    const id = initial?.customerId ?? presetCustomerId;
    return id ? { kind: "existing", customerId: id } : { kind: "none" };
  });
  const customerId = choice.kind === "existing" ? choice.customerId : "";
  const [propertyId, setPropertyId] = useState(initial?.propertyId ?? "");
  const [serviceAddress, setServiceAddress] = useState(initial?.serviceAddress ?? "");
  const [requirements, setRequirements] = useState(initial?.requirements ?? "");
  const [internalNotes, setInternalNotes] = useState(initial?.internalNotes ?? "");
  const [advance, setAdvance] = useState(initial?.advanceAmount ? String(initial.advanceAmount) : "");
  const [lines, setLines] = useState<Line[]>(() =>
    initial?.items.length
      ? initial.items.map((l) => ({ key: ++seq, serviceId: l.serviceId ?? null, description: l.description, quantity: String(l.quantity), rate: String(l.rate) }))
      : [blank(false)]
  );
  const [discount, setDiscount] = useState(initial ? String(initial.discount || "") : "");
  const [quoteType, setQuoteType] = useState<"GST" | "NON_GST">(initial?.quoteType ?? "GST");
  const [interState, setInterState] = useState(initial?.interState ?? false);
  const [gstin, setGstin] = useState(initial?.customerGstin ?? "");
  const [validUntil, setValidUntil] = useState(initial?.validUntil ?? toLocalDateOffset(systemSettings.quotationValidityDays || 15));
  const [terms, setTerms] = useState(initial?.terms ?? systemSettings.quotationTerms ?? "");
  const [paymentTerms, setPaymentTerms] = useState(initial?.paymentTerms ?? systemSettings.quotationPaymentTerms ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [busy, setBusy] = useState<"draft" | "sent" | "pdf" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const customer = customers.find((c) => c.id === customerId);
  const customerProps = useMemo(() => properties.filter((p) => p.customerId === customerId), [properties, customerId]);
  const activeServices = services.filter((s) => s.active !== false);

  // New customer → their only property, and their GSTIN for a GST quotation.
  useEffect(() => {
    if (!customerId) return;
    if (!customerProps.some((p) => p.id === propertyId)) setPropertyId(customerProps.length === 1 && !initial ? customerProps[0].id : "");
    if (!initial && customer?.gstin) setGstin(customer.gstin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  // Choosing a property fills in its address; the address stays editable (it is what prints on the quotation).
  const pickProperty = (id: string) => {
    const prev = customerProps.find((p) => p.id === propertyId);
    setPropertyId(id);
    const p = customerProps.find((x) => x.id === id);
    if (p && (!serviceAddress.trim() || serviceAddress === prev?.address)) setServiceAddress([p.address, p.city].filter(Boolean).join(", "));
    if (!id && prev && serviceAddress === prev.address) setServiceAddress("");
  };
  useEffect(() => {
    // A property picked automatically (their only one) also brings its address along.
    const p = customerProps.find((x) => x.id === propertyId);
    if (p && !serviceAddress.trim() && !initial) setServiceAddress([p.address, p.city].filter(Boolean).join(", "));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId]);

  const setLine = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const pickService = (key: number, id: string) => {
    const s = services.find((x) => x.id === id);
    setLine(key, { serviceId: id, description: s?.name ?? "", rate: s ? String(s.basePrice) : "" });
    // A Non-GST service sets the quotation type when it is the first line.
    if (s?.gstTreatment === "NON_GST" && lines.length === 1) setQuoteType("NON_GST");
  };

  const amounts = lines.map((l) => {
    const q = num(l.quantity);
    const r = num(l.rate);
    return Number.isFinite(q) && Number.isFinite(r) ? Math.round(q * r * 100) / 100 : 0;
  });
  const subtotal = Math.round(amounts.reduce((a, b) => a + b, 0) * 100) / 100;
  const disc = num(discount) || 0;
  const fig = computeInvoiceFigures({ invoiceType: quoteType, subtotal, discount: Math.min(disc, subtotal), gstRatePercent: systemSettings.taxRatePercent, interState });
  const gstinError = quoteType === "GST" && gstin.trim() && !isValidGstin(gstin) ? "GSTIN must be 15 characters, e.g. 29ABCDE1234F1Z5." : null;

  const problem = (): string | null => {
    if (choice.kind === "none") return "Select a customer, or add a new one.";
    if (choice.kind === "new" && choice.name.trim().length < 2) return "Enter the new customer's name.";
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const n = i + 1;
      if (l.serviceId === "") return `Line ${n}: pick a service, or switch it to a custom line.`;
      if (l.serviceId === null && !l.description.trim()) return `Line ${n}: describe the custom work.`;
      if (!(num(l.quantity) > 0)) return `Line ${n}: quantity must be more than 0.`;
      if (!(num(l.rate) >= 0)) return `Line ${n}: enter a rate.`;
    }
    if (disc < 0 || disc > subtotal) return "The discount can't be more than the subtotal.";
    if (advance.trim() && !(num(advance) >= 0 && num(advance) <= fig.total)) return "The advance can't be more than the total.";
    if (!validUntil) return "Pick a valid-until date.";
    if (gstinError) return gstinError;
    return null;
  };

  const save = async (status: "draft" | "sent", thenPdf = false) => {
    const p = problem();
    if (p) return setError(p);
    setBusy(thenPdf ? "pdf" : status);
    setError(null);
    const body = {
      ...(choice.kind === "existing"
        ? { customerId: choice.customerId }
        : choice.kind === "new"
          ? { newCustomer: { name: choice.name.trim(), phone: choice.phone.trim() || undefined, email: choice.email.trim() || undefined, address: choice.address.trim() || undefined } }
          : {}),
      propertyId: propertyId || null,
      serviceAddress: serviceAddress.trim() || undefined,
      requirements: requirements.trim() || undefined,
      internalNotes: internalNotes.trim() || undefined,
      advanceAmount: advance.trim() ? num(advance) : null,
      items: lines.map((l) => ({ serviceId: l.serviceId || null, description: l.description.trim(), quantity: num(l.quantity), rate: num(l.rate) })),
      discount: disc,
      quoteType,
      interState: quoteType === "GST" && interState,
      customerGstin: quoteType === "GST" ? gstin.trim().toUpperCase() : "",
      validUntil,
      terms,
      paymentTerms,
      notes,
      status,
    };
    const r = initial
      ? await quoteApi<Quote>(`/api/quotations/${encodeURIComponent(initial.id)}`, { method: "PATCH", body: JSON.stringify(body) })
      : await quoteApi<Quote>("/api/quotations", { method: "POST", body: JSON.stringify(body) });
    setBusy(null);
    if (r.error || !r.data) return setError(r.error ?? "Could not save the quotation.");
    rememberCustomer(r.data.customerId);
    if (choice.kind === "new") await refreshCustomers();
    router.push(`/quotations/${r.data.id}${thenPdf ? "?view=pdf" : ""}`);
  };

  return (
    <div className="space-y-5 pb-28">
      <section className="rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6 space-y-4">
        <h2 className="text-base font-semibold text-zinc-950">Customer</h2>
        <CustomerPicker value={choice} onChange={setChoice} autoFocus={!initial && !presetCustomerId} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Service address" htmlFor="qe-addr" hint="Optional — where the work will be done. No property record needed.">
            <textarea id="qe-addr" value={serviceAddress} onChange={(e) => setServiceAddress(e.target.value)} rows={2} className={area} maxLength={500} placeholder="e.g. 12 MG Road, Indiranagar, Bengaluru" />
          </Field>
          <Field label="Saved property" htmlFor="qe-prop" hint={customerId ? (customerProps.length ? "Optional — fills in the address" : "This customer has no saved property — that is fine.") : "Optional — for existing customers"}>
            <select id="qe-prop" value={propertyId} onChange={(e) => pickProperty(e.target.value)} disabled={!customerId || !customerProps.length} className="w-full h-12 rounded-xl border border-zinc-300 bg-white px-3 text-base disabled:bg-zinc-50">
              <option value="">No property</option>
              {customerProps.map((p) => (
                <option key={p.id} value={p.id}>{p.title} — {p.address}</option>
              ))}
            </select>
          </Field>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6 space-y-4">
        <h2 className="text-base font-semibold text-zinc-950">Services</h2>
        <ul className="space-y-3">
          {lines.map((l, i) => (
            <li key={l.key} className="rounded-xl border border-zinc-200 p-3 sm:p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-zinc-700">
                  {i + 1}. {l.serviceId === null ? "Custom line" : "Catalogue service"}
                </span>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setLine(l.key, l.serviceId === null ? { serviceId: "", description: "" } : { serviceId: null })}>
                    {l.serviceId === null ? <><Package className="h-4 w-4" aria-hidden /> Use catalogue</> : <><PenLine className="h-4 w-4" aria-hidden /> Make custom</>}
                  </Button>
                  {lines.length > 1 && (
                    <Button size="sm" variant="ghost" aria-label={`Remove line ${i + 1}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                      <Trash2 className="h-4 w-4 text-red-600" aria-hidden />
                    </Button>
                  )}
                </div>
              </div>
              {l.serviceId === null ? (
                <Input value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} placeholder="Describe the work, e.g. Balcony glass deep clean" aria-label={`Line ${i + 1} description`} maxLength={300} />
              ) : (
                <SearchableSelect value={l.serviceId} onChange={(v) => pickService(l.key, v)} options={activeServices.map((s) => ({ value: s.id, label: `${s.name}${s.isCustom ? " (custom)" : ""}` }))} placeholder="Select a service" />
              )}
              <div className="grid grid-cols-3 gap-3 items-end">
                <Field label="Qty" htmlFor={`ql-q-${l.key}`}><Input id={`ql-q-${l.key}`} inputMode="decimal" value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} /></Field>
                <Field label="Rate (₹)" htmlFor={`ql-r-${l.key}`}><Input id={`ql-r-${l.key}`} inputMode="decimal" value={l.rate} onChange={(e) => setLine(l.key, { rate: e.target.value })} placeholder="0" onKeyDown={(e) => { if (e.key === "Enter" && i === lines.length - 1) { e.preventDefault(); setLines((ls) => [...ls, blank(false)]); } }} /></Field>
                <div className="pb-3 text-right text-sm font-semibold tabular-nums text-zinc-900">{formatMoney(amounts[i])}</div>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setLines((ls) => [...ls, blank(false)])}><Plus className="h-4 w-4" aria-hidden /> Add service</Button>
          <Button variant="outline" onClick={() => setLines((ls) => [...ls, blank(true)])}><PenLine className="h-4 w-4" aria-hidden /> Add custom line</Button>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6 space-y-4">
        <h2 className="text-base font-semibold text-zinc-950">Tax and totals</h2>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Quotation type">
          {(["GST", "NON_GST"] as const).map((t) => (
            <button key={t} type="button" role="radio" aria-checked={quoteType === t} onClick={() => setQuoteType(t)} className={cn("min-h-12 rounded-xl border-2 px-3 text-base font-semibold", quoteType === t ? "border-rose-500 bg-rose-50 text-rose-700" : "border-zinc-200 bg-white text-zinc-700")}>
              {t === "GST" ? "GST" : "Non-GST"}
            </button>
          ))}
        </div>
        {quoteType === "GST" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Customer GSTIN" htmlFor="qe-gstin" hint="Leave empty for an unregistered customer" error={gstinError}>
              <Input id="qe-gstin" value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} placeholder="29ABCDE1234F1Z5" maxLength={15} />
            </Field>
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium text-zinc-800">Place of supply</legend>
              <div className="grid grid-cols-2 gap-2">
                {[false, true].map((v) => (
                  <button key={String(v)} type="button" aria-pressed={interState === v} onClick={() => setInterState(v)} className={cn("min-h-11 rounded-xl border px-3 text-sm font-medium", interState === v ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-700")}>
                    {v ? "Other state (IGST)" : "Same state"}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Discount (₹)" htmlFor="qe-disc"><Input id="qe-disc" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" /></Field>
          <Field label="Valid until" required htmlFor="qe-valid"><Input id="qe-valid" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></Field>
          <Field label="Advance (₹)" htmlFor="qe-adv" hint="Optional"><Input id="qe-adv" inputMode="decimal" value={advance} onChange={(e) => setAdvance(e.target.value)} placeholder="0" /></Field>
        </div>
        <dl className="rounded-xl bg-zinc-50 divide-y divide-zinc-200/70 text-sm">
          <div className="flex justify-between px-4 py-2"><dt className="text-zinc-600">Subtotal</dt><dd className="tabular-nums">{formatMoney(fig.subtotal)}</dd></div>
          {fig.discount > 0 && <div className="flex justify-between px-4 py-2"><dt className="text-zinc-600">Discount</dt><dd className="tabular-nums">− {formatMoney(fig.discount)}</dd></div>}
          {fig.invoiceType === "GST" && (
            <div className="flex justify-between px-4 py-2"><dt className="text-zinc-600">{interState ? `IGST ${fig.gstRate}%` : `CGST + SGST ${fig.gstRate}%`}</dt><dd className="tabular-nums">{formatMoney(fig.tax)}</dd></div>
          )}
          <div className="flex justify-between px-4 py-2.5 font-semibold text-zinc-950"><dt>Total</dt><dd className="tabular-nums text-base">{formatMoney(fig.total)}</dd></div>
          {num(advance) > 0 && <div className="flex justify-between px-4 py-2"><dt className="text-zinc-600">Advance</dt><dd className="tabular-nums">{formatMoney(num(advance))}</dd></div>}
          {num(advance) > 0 && <div className="flex justify-between px-4 py-2"><dt className="text-zinc-600">Balance</dt><dd className="tabular-nums">{formatMoney(Math.max(0, fig.total - num(advance)))}</dd></div>}
        </dl>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6 space-y-4">
        <h2 className="text-base font-semibold text-zinc-950">Terms</h2>
        <Field label="Payment terms" htmlFor="qe-pay"><textarea id="qe-pay" value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} rows={2} className={area} maxLength={1000} /></Field>
        <Field label="Terms & conditions" htmlFor="qe-terms"><textarea id="qe-terms" value={terms} onChange={(e) => setTerms(e.target.value)} rows={4} className={area} maxLength={4000} /></Field>
        <Field label="Notes for the customer" htmlFor="qe-notes" hint="Printed on the quotation"><textarea id="qe-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={area} maxLength={2000} /></Field>
        <Field label="Additional requirements" htmlFor="qe-req" hint="Optional — printed under the service scope"><textarea id="qe-req" value={requirements} onChange={(e) => setRequirements(e.target.value)} rows={2} className={area} maxLength={2000} /></Field>
        <Field label="Internal notes" htmlFor="qe-int" hint="For the office only — never printed or shown to the customer"><textarea id="qe-int" value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} rows={2} className={area} maxLength={2000} /></Field>
      </section>

      {error && <Notice tone="error">{error}</Notice>}

      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] lg:bottom-0 lg:left-64 z-30 border-t border-zinc-200 bg-white/95 backdrop-blur px-4 py-3 print:hidden">
        <div className="mx-auto max-w-5xl flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-zinc-500">Total</div>
            <div className="text-lg font-semibold tabular-nums text-zinc-950">{formatMoney(fig.total)}</div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void save("draft")} loading={busy === "draft"} disabled={!!busy}>Save draft</Button>
            <Button variant="outline" onClick={() => void save("sent", true)} loading={busy === "pdf"} disabled={!!busy}><FileText className="h-4 w-4" aria-hidden /> Generate PDF</Button>
            <Button onClick={() => void save("sent")} loading={busy === "sent"} disabled={!!busy}>{initial ? "Save" : "Create"}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
