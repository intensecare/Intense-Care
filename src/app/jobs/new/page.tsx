"use client";

import React, { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, Plus, Building2, Check } from "lucide-react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { CustomerFormDialog, type CustomerFormPayload } from "@/components/common/CustomerFormDialog";
import { PropertyFormDialog, type PropertyFormPayload } from "@/components/common/PropertyFormDialog";
import { LocationPicker, type LocationValue } from "@/components/common/LocationPicker";
import { VisibilityEditor } from "@/components/common/VisibilityEditor";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { useApp } from "@/lib/app-context";
import { ASSIGNABLE_ROLES } from "@/lib/rbac";
import { onDutyWorkerIds } from "@/lib/staff-availability";
import { cn, formatCurrency } from "@/lib/utils";
import type { CustomerVisibility } from "@/lib/types";

const today = () => new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);

function Step({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-6 space-y-4" aria-labelledby={`step-${n}`}>
      <div className="flex items-start gap-3">
        <span className="h-8 w-8 rounded-full bg-zinc-900 text-white text-sm font-semibold flex items-center justify-center shrink-0" aria-hidden>{n}</span>
        <div className="min-w-0">
          <h2 id={`step-${n}`} className="text-base font-semibold text-zinc-950">{title}</h2>
          {hint && <p className="text-sm text-zinc-500">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

/** New job — Customer → Property → Location → Service → Date & time → Field Manager → Notes → Customer visibility → Create. */
function NewJobPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { customers, properties, services, users, jobs, systemSettings, createCustomer, createProperty, refreshJobs, refreshFinance } = useApp();

  const [customerId, setCustomerId] = useState(params.get("customerId") ?? "");
  const [propertyId, setPropertyId] = useState(params.get("propertyId") ?? "");
  const [location, setLocation] = useState<LocationValue>({ lat: null, lng: null, address: "" });
  const [serviceId, setServiceId] = useState("");
  const [invoiceType, setInvoiceType] = useState<"GST" | "NON_GST">("GST");
  const [interState, setInterState] = useState(false);
  const [date, setDate] = useState(today());
  const [from, setFrom] = useState("09:00");
  const [to, setTo] = useState("13:00");
  const [managerId, setManagerId] = useState("");
  const [notes, setNotes] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [visibility, setVisibility] = useState<CustomerVisibility>(systemSettings.customerVisibility);
  const [customVis, setCustomVis] = useState(false);
  const [customerDialog, setCustomerDialog] = useState(false);
  const [propertyDialog, setPropertyDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setVisibility(systemSettings.customerVisibility), [systemSettings.customerVisibility]);

  const customerProps = useMemo(() => properties.filter((p) => p.customerId === customerId), [properties, customerId]);
  const property = customerProps.find((p) => p.id === propertyId);
  const service = services.find((s) => s.id === serviceId);
  const managers = users.filter((u) => ASSIGNABLE_ROLES.includes(u.role) && u.active !== false);
  const slot = `${from} - ${to}`;
  const busyIds = useMemo(() => {
    const s = new Set<string>();
    for (const j of jobs) if (j.scheduledDate === date && j.scheduledTimeSlot === slot && !["COMPLETED", "CANCELLED", "CLOSED"].includes(j.status)) [j.assignedManagerId, ...(j.assignedStaffIds ?? [])].forEach((x) => x && s.add(x));
    return s;
  }, [jobs, date, slot]);
  const onDuty = useMemo(() => onDutyWorkerIds(jobs), [jobs]);

  // Pick the customer's only property automatically; reset when the customer changes.
  useEffect(() => {
    if (!customerId) return setPropertyId("");
    if (!customerProps.some((p) => p.id === propertyId)) setPropertyId(customerProps.length === 1 ? customerProps[0].id : "");
  }, [customerId, customerProps, propertyId]);
  // Location starts at the property's pin and address.
  useEffect(() => {
    if (property) setLocation({ lat: property.lat ?? null, lng: property.lng ?? null, address: [property.address, property.city].filter(Boolean).join(", ") });
    // Only when a different property is picked — not on every data refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [property?.id]);
  // Invoice type follows the service's GST setting.
  useEffect(() => {
    if (service?.gstTreatment === "NON_GST") setInvoiceType("NON_GST");
    else if (service?.gstTreatment === "GST") setInvoiceType("GST");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service?.id]);

  const missing = !customerId ? "Select a customer." : !propertyId ? "Select a property." : !serviceId ? "Select a service." : !date ? "Pick a date." : from >= to ? "The end time must be after the start time." : null;

  const submit = async () => {
    if (missing) return setError(missing);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          propertyId,
          serviceId,
          scheduledDate: date,
          scheduledTimeSlot: slot,
          assignedManagerId: managerId || undefined,
          assignedStaffIds: [],
          notes: notes.trim() || undefined,
          customerNotes: customerNotes.trim() || undefined,
          locationLat: location.lat,
          locationLng: location.lng,
          locationAddress: location.address.trim() || undefined,
          customerVisibility: customVis ? visibility : undefined,
          invoiceType,
          interState: invoiceType === "GST" ? interState : false,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setError(json?.error || "Couldn't create the job. Please try again.");
        setBusy(false);
        return;
      }
      await Promise.all([refreshJobs(), refreshFinance()]);
      router.push(`/jobs/${json.data.job.id}`);
    } catch {
      setError("You're offline. Check your connection and try again.");
      setBusy(false);
    }
  };

  const customerOptions = customers.filter((c) => c.status !== "inactive").map((c) => ({ value: c.id, label: `${c.name} · ${c.phone}` }));
  const serviceOptions = [
    ...services.filter((s) => s.active && !s.isCustom).map((s) => ({ value: s.id, label: `${s.name} · ${formatCurrency(s.basePrice)}` })),
    ...services.filter((s) => s.active && s.isCustom).map((s) => ({ value: s.id, label: `Custom: ${s.name} · ${formatCurrency(s.basePrice)}` })),
  ];

  return (
    <AdminLayout>
      <div className="max-w-3xl mx-auto space-y-4 pb-28">
        <Link href="/jobs" className="inline-flex items-center gap-1 text-sm font-semibold text-zinc-600 hover:text-zinc-950 min-h-10">
          <ChevronLeft className="h-4 w-4" aria-hidden /> Jobs
        </Link>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-950">New job</h1>

        <Step n={1} title="Customer">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1 min-w-0">
              <SearchableSelect value={customerId} onChange={setCustomerId} options={customerOptions} placeholder="Search customer by name or phone" />
            </div>
            <Button type="button" variant="outline" onClick={() => setCustomerDialog(true)}><Plus className="h-4 w-4" aria-hidden /> New customer</Button>
          </div>
        </Step>

        <Step n={2} title="Property" hint="A customer can have several — home, office, rental…">
          {!customerId ? (
            <p className="text-sm text-zinc-500">Select a customer first.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {customerProps.map((p) => (
                <button key={p.id} type="button" role="radio" aria-checked={propertyId === p.id} onClick={() => setPropertyId(p.id)} className={cn("min-h-16 rounded-xl border-2 p-3 text-left flex items-start gap-3", propertyId === p.id ? "border-rose-500 bg-rose-50" : "border-zinc-200 bg-white")}>
                  <Building2 className="h-5 w-5 text-zinc-500 shrink-0 mt-0.5" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-zinc-950 break-words">{p.title}</span>
                    <span className="block text-sm text-zinc-500 break-words">{p.address}</span>
                  </span>
                  {propertyId === p.id && <Check className="h-5 w-5 text-rose-600 shrink-0" aria-hidden />}
                </button>
              ))}
              <button type="button" onClick={() => setPropertyDialog(true)} className="min-h-16 rounded-xl border-2 border-dashed border-zinc-300 p-3 text-sm font-semibold text-zinc-700 inline-flex items-center justify-center gap-2">
                <Plus className="h-4 w-4" aria-hidden /> Add property
              </button>
            </div>
          )}
        </Step>

        <Step n={3} title="Location" hint="Where the team goes. Starts at the property's pin — adjust it for this job if needed.">
          {propertyId ? <LocationPicker key={propertyId} idPrefix="nj-loc" value={location} onChange={setLocation} /> : <p className="text-sm text-zinc-500">Select a property first.</p>}
        </Step>

        <Step n={4} title="Service">
          <SearchableSelect value={serviceId} onChange={setServiceId} options={serviceOptions} placeholder="Select a service" />
          {service && <p className="text-sm text-zinc-600">{service.estimatedDurationHours} h · {formatCurrency(service.basePrice)}{service.checklistTemplate.length ? ` · ${service.checklistTemplate.length} checklist items` : ""}</p>}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-zinc-800">Invoice</legend>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Invoice type">
              {(["GST", "NON_GST"] as const).map((t) => (
                <button key={t} type="button" role="radio" aria-checked={invoiceType === t} onClick={() => setInvoiceType(t)} className={cn("min-h-12 rounded-xl border-2 px-3 text-sm sm:text-base font-semibold", invoiceType === t ? "border-rose-500 bg-rose-50 text-rose-700" : "border-zinc-200 bg-white text-zinc-700")}>
                  {t === "GST" ? "GST Invoice" : "Non-GST Invoice"}
                </button>
              ))}
            </div>
            {invoiceType === "GST" && (
              <label className="flex items-center gap-3 text-sm text-zinc-700 min-h-11">
                <input type="checkbox" checked={interState} onChange={(e) => setInterState(e.target.checked)} className="h-5 w-5 accent-rose-500" />
                Customer is in another state (IGST)
              </label>
            )}
          </fieldset>
        </Step>

        <Step n={5} title="Date & time">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Date" required htmlFor="nj-date"><Input id="nj-date" type="date" value={date} min={today()} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="From" required htmlFor="nj-from"><Input id="nj-from" type="time" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="To" required htmlFor="nj-to"><Input id="nj-to" type="time" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          </div>
        </Step>

        <Step n={6} title="Field Manager" hint="Optional — you can assign later from Schedule.">
          {managers.length === 0 ? (
            <p className="text-sm text-zinc-500">No Field Managers yet — add one under Users.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {managers.map((m) => {
                const sel = managerId === m.id;
                const clash = busyIds.has(m.id);
                return (
                  <button key={m.id} type="button" aria-pressed={sel} disabled={clash && !sel} onClick={() => setManagerId(sel ? "" : m.id)} className={cn("min-h-12 px-4 py-2 rounded-xl border text-left text-sm font-medium disabled:opacity-50", sel ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-800")}>
                    {m.name}
                    <span className={cn("block text-xs", sel ? "text-zinc-300" : clash ? "text-red-700" : onDuty.has(m.id) ? "text-amber-700" : "text-zinc-500")}>{clash ? "Busy at this time" : onDuty.has(m.id) ? "On another job" : "Free"}</span>
                  </button>
                );
              })}
            </div>
          )}
        </Step>

        <Step n={7} title="Notes">
          <Field label="Internal notes" hint="For your team only — never shown to the customer" htmlFor="nj-notes">
            <textarea id="nj-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full rounded-xl border border-zinc-300 px-3.5 py-2.5 text-sm" />
          </Field>
          <Field label="Notes for the customer" hint="Shown on the customer's QR page if allowed below" htmlFor="nj-cnotes">
            <textarea id="nj-cnotes" value={customerNotes} onChange={(e) => setCustomerNotes(e.target.value)} rows={2} className="w-full rounded-xl border border-zinc-300 px-3.5 py-2.5 text-sm" />
          </Field>
        </Step>

        <Step n={8} title="Customer visibility" hint="What the customer sees when they scan the QR.">
          <label className="flex items-center gap-3 text-sm text-zinc-800 min-h-11">
            <input type="checkbox" checked={customVis} onChange={(e) => { setCustomVis(e.target.checked); if (!e.target.checked) setVisibility(systemSettings.customerVisibility); }} className="h-5 w-5 accent-rose-500" />
            Customise for this job <span className="text-zinc-500">(otherwise the company default from Settings)</span>
          </label>
          {customVis && <VisibilityEditor value={visibility} defaults={systemSettings.customerVisibility} onChange={setVisibility} />}
        </Step>

        {error && <div role="alert" className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">{error}</div>}
      </div>

      {/* Step 9 — the one primary action, always in reach */}
      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] lg:bottom-0 lg:left-64 z-30 bg-white/95 backdrop-blur border-t border-zinc-200 px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <p className="hidden sm:block flex-1 text-sm text-zinc-500 truncate">{missing ?? `${service?.name ?? ""} · ${date} · ${slot}`}</p>
          <Button size="lg" className="w-full sm:w-auto" loading={busy} onClick={() => void submit()}>{busy ? "Creating…" : "Create Job"}</Button>
        </div>
      </div>

      <CustomerFormDialog
        open={customerDialog}
        onOpenChange={setCustomerDialog}
        partners={[]}
        onSubmit={async (payload: CustomerFormPayload) => {
          const r = await createCustomer({ ...payload, referralPartnerId: undefined });
          if (r.success && r.customer) setCustomerId(r.customer.id);
          return { success: r.success, message: r.message };
        }}
      />
      <PropertyFormDialog
        open={propertyDialog}
        onOpenChange={setPropertyDialog}
        customers={customers}
        defaultCustomerId={customerId}
        onSubmit={async (payload: PropertyFormPayload) => {
          const r = await createProperty(payload);
          if (r.success && r.property) setPropertyId(r.property.id);
          return { success: r.success, message: r.message };
        }}
      />
    </AdminLayout>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <NewJobPage />
    </Suspense>
  );
}
