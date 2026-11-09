"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Search, Link2 } from "lucide-react";
import { CustomerPicker, rememberCustomer, type CustomerChoice } from "@/components/common/CustomerPicker";
import { VerificationModeCards } from "@/components/job/VerificationModeCards";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Notice } from "@/components/ui/states";
import { quoteApi } from "@/components/quote/QuoteParts";
import { useApp } from "@/lib/app-context";
import { ASSIGNABLE_ROLES } from "@/lib/rbac";
import { START_MODE_INFO, type StartMode } from "@/lib/start-verification";
import { cn, formatMoney } from "@/lib/utils";
import type { Quote } from "@/lib/types";

const today = () => new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5 space-y-3" aria-labelledby={`qj-${n}`}>
      <h2 id={`qj-${n}`} className="flex items-center gap-2.5 text-base font-semibold text-zinc-950">
        <span className="h-7 w-7 rounded-full bg-zinc-900 text-white text-sm flex items-center justify-center shrink-0" aria-hidden>{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * Quick Create Job — Customer → Service → Schedule → Verification → Assignment → Create, on ONE page, so nothing
 * typed is lost between steps. A new customer or a typed service address is created inline by the server (matched
 * on phone / address so nothing is duplicated). GPS is never required to create a job: only the GPS verification
 * modes need a saved location, and that is checked when the work starts.
 */
export function QuickJobForm({ presetCustomerId }: { presetCustomerId?: string }) {
  const router = useRouter();
  const { customers, properties, services, users, jobs, systemSettings, refreshJobs, refreshFinance, refreshCustomers, refreshProperties } = useApp();
  const [choice, setChoice] = useState<CustomerChoice>(presetCustomerId ? { kind: "existing", customerId: presetCustomerId } : { kind: "none" });
  const customerId = choice.kind === "existing" ? choice.customerId : "";
  const [propertyId, setPropertyId] = useState("");
  const [address, setAddress] = useState("");
  const [addrSearch, setAddrSearch] = useState("");
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [quoteId, setQuoteId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [date, setDate] = useState(today());
  const [from, setFrom] = useState("09:00");
  const [to, setTo] = useState("13:00");
  const [customMode, setCustomMode] = useState(false);
  const [startMode, setStartMode] = useState<StartMode>(systemSettings.jobStartVerification.defaultMode);
  const [managerId, setManagerId] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setStartMode(systemSettings.jobStartVerification.defaultMode), [systemSettings.jobStartVerification.defaultMode]);

  // Quotations that could become this job (same customer, not already a job, not declined).
  useEffect(() => {
    void quoteApi<Quote[]>("/api/quotations").then((r) => setQuotes(r.data ?? []));
  }, []);
  const customerQuotes = useMemo(() => quotes.filter((q) => q.customerId === customerId && !q.jobId && q.status !== "declined" && q.status !== "converted_to_job"), [quotes, customerId]);
  const quote = customerQuotes.find((q) => q.id === quoteId);

  // Properties of this customer, most recently used first.
  const customerProps = useMemo(() => {
    const last = new Map<string, string>();
    for (const j of jobs) if (j.customerId === customerId) last.set(j.propertyId, (last.get(j.propertyId) ?? "") > j.scheduledDate ? last.get(j.propertyId)! : j.scheduledDate);
    return properties.filter((p) => p.customerId === customerId).sort((a, b) => (last.get(b.id) ?? "").localeCompare(last.get(a.id) ?? ""));
  }, [properties, jobs, customerId]);
  useEffect(() => {
    setQuoteId("");
    setPropertyId(customerProps[0]?.id ?? "");
    setAddress("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  const propertyMatches = useMemo(() => {
    const t = addrSearch.trim().toLowerCase();
    if (t.length < 3) return [];
    const byId = new Map(customers.map((c) => [c.id, c]));
    return properties.filter((p) => `${p.title} ${p.address} ${p.city ?? ""}`.toLowerCase().includes(t)).slice(0, 5).map((p) => ({ p, c: byId.get(p.customerId) }));
  }, [addrSearch, properties, customers]);

  const managers = users.filter((u) => ASSIGNABLE_ROLES.includes(u.role) && u.active !== false);
  const slot = `${from} - ${to}`;
  const useTyped = !propertyId; // typing an address instead of picking a saved property
  const quoteHasWhere = !!(quote?.propertyId || quote?.serviceAddress);

  const missing = (): string | null => {
    if (choice.kind === "none") return "Select a customer, or add a new one.";
    if (choice.kind === "new" && choice.name.trim().length < 2) return "Enter the new customer's name.";
    if (choice.kind === "new" && choice.phone.trim().replace(/\D/g, "").length < 7) return "A new customer needs a phone number so the job can be confirmed with them.";
    if (!quote && !serviceId) return "Select a service.";
    if (!(quote && quoteHasWhere) && useTyped && address.trim().length < 5) return choice.kind === "new" ? "Enter the service address." : "Pick a saved property or enter the service address.";
    if (!date) return "Pick a date.";
    if (from >= to) return "The end time must be after the start time.";
    return null;
  };

  const submit = async () => {
    const m = missing();
    if (m) return setError(m);
    setBusy(true);
    setError(null);
    try {
      let jobId: string | undefined;
      if (quote) {
        const r = await quoteApi<{ jobId: string }>(`/api/quotations/${encodeURIComponent(quote.id)}`, {
          method: "POST",
          body: JSON.stringify({
            action: "convert-job",
            ...(quote.propertyId ? {} : propertyId ? { propertyId, useServiceAddress: false } : address.trim() ? { newProperty: { address: address.trim() } } : { useServiceAddress: true }),
            scheduledDate: date, scheduledTimeSlot: slot, assignedManagerId: managerId || undefined, startVerificationMode: customMode ? startMode : undefined, notes: notes.trim() || undefined,
          }),
        });
        if (r.error || !r.data) throw new Error(r.error ?? "Could not create the job from the quotation.");
        jobId = r.data.jobId;
      } else {
        const res = await fetch("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(choice.kind === "existing" ? { customerId: choice.customerId } : choice.kind === "new" ? { customerName: choice.name.trim(), customerPhone: choice.phone.trim(), customerEmail: choice.email.trim() || undefined } : {}),
            ...(propertyId ? { propertyId } : { propertyAddress: address.trim() }),
            serviceId, scheduledDate: date, scheduledTimeSlot: slot,
            assignedManagerId: managerId || undefined, assignedStaffIds: [],
            notes: notes.trim() || undefined,
            startVerificationMode: customMode ? startMode : undefined,
          }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) throw new Error(json?.error || "Couldn't create the job. Please try again.");
        jobId = json.data.job.id;
      }
      if (customerId) rememberCustomer(customerId);
      await Promise.all([refreshJobs(), refreshFinance(), refreshCustomers(), refreshProperties()]);
      router.push(`/jobs/${jobId}`);
    } catch (e) {
      setError(e instanceof TypeError ? "You're offline. Check your connection and try again." : e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  };

  const activeServices = services.filter((s) => s.active !== false);
  return (
    <div className="space-y-4 pb-28">
      <Step n={1} title="Customer and place">
        <CustomerPicker value={choice} onChange={setChoice} autoFocus={!presetCustomerId} />
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" aria-hidden />
          <Input aria-label="Find by property address" placeholder="Or find by property address" className="pl-10" value={addrSearch} onChange={(e) => setAddrSearch(e.target.value)} />
          {propertyMatches.length > 0 && (
            <ul className="mt-1 rounded-xl border border-zinc-200 bg-white divide-y divide-zinc-100">
              {propertyMatches.map(({ p, c }) => (
                <li key={p.id}>
                  <button type="button" className="w-full text-left px-3.5 py-2.5 min-h-12" onClick={() => { setChoice({ kind: "existing", customerId: p.customerId }); setAddrSearch(""); setTimeout(() => setPropertyId(p.id), 0); }}>
                    <span className="block text-sm font-medium text-zinc-950 truncate">{p.title} — {c?.name ?? "Customer"}</span>
                    <span className="block text-xs text-zinc-500 truncate">{p.address}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {choice.kind !== "none" && !(quote && quoteHasWhere) && (
          <div className="space-y-3">
            {customerProps.length > 0 && (
              <Field label="Saved property" htmlFor="qj-prop" hint="Most recently used first">
                <select id="qj-prop" value={propertyId} onChange={(e) => setPropertyId(e.target.value)} className="w-full h-12 rounded-xl border border-zinc-300 bg-white px-3 text-base">
                  {customerProps.map((p) => (<option key={p.id} value={p.id}>{p.title} — {p.address}</option>))}
                  <option value="">Enter a different address…</option>
                </select>
              </Field>
            )}
            {useTyped && (
              <Field label="Service address" required htmlFor="qj-addr" hint="Saved as a property without a map pin. An address this customer already has is reused.">
                <textarea id="qj-addr" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} maxLength={500} className="w-full rounded-xl border border-zinc-300 px-3.5 py-2.5 text-sm" placeholder="e.g. 12 MG Road, Indiranagar, Bengaluru" />
              </Field>
            )}
          </div>
        )}
        {customerQuotes.length > 0 && (
          <Field label="Link a quotation" htmlFor="qj-quote" hint="Optional — the job takes its services, prices and address from it">
            <select id="qj-quote" value={quoteId} onChange={(e) => setQuoteId(e.target.value)} className="w-full h-12 rounded-xl border border-zinc-300 bg-white px-3 text-base">
              <option value="">No quotation</option>
              {customerQuotes.map((q) => (<option key={q.id} value={q.id}>{q.quoteNumber} · {formatMoney(q.total)} · {q.status}</option>))}
            </select>
          </Field>
        )}
        {quote && (
          <p className="text-sm text-zinc-600 inline-flex items-start gap-2"><Link2 className="h-4 w-4 mt-0.5 shrink-0" aria-hidden /><span>Created from <strong>{quote.quoteNumber}</strong>: {quote.items.map((l) => l.description).join("; ")}{quote.serviceAddress ? ` — at ${quote.serviceAddress}` : ""}.</span></p>
        )}
      </Step>

      {!quote && (
        <Step n={2} title="Service">
          <SearchableSelect value={serviceId} onChange={setServiceId} options={activeServices.map((s) => ({ value: s.id, label: `${s.name} · ${formatMoney(s.basePrice)}` }))} placeholder="Search services" />
        </Step>
      )}

      <Step n={3} title="Date and time">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Date" required htmlFor="qj-date"><Input id="qj-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="From" required htmlFor="qj-from"><Input id="qj-from" type="time" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To" required htmlFor="qj-to"><Input id="qj-to" type="time" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
      </Step>

      <Step n={4} title="Start verification">
        {systemSettings.jobStartVerification.allowPerJobOverride ? (
          <>
            <label className="flex items-center gap-2 text-sm font-medium text-zinc-800 min-h-10"><input type="checkbox" checked={customMode} onChange={(e) => setCustomMode(e.target.checked)} /> Choose for this job <span className="text-zinc-500 font-normal">(otherwise: {START_MODE_INFO[systemSettings.jobStartVerification.defaultMode].label})</span></label>
            {customMode && <VerificationModeCards name="qj-start-mode" value={startMode} onChange={setStartMode} />}
            {customMode && (startMode === "GPS" || startMode === "GPS_QR") && <p className="text-xs text-amber-800 inline-flex items-start gap-1.5"><MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden /> This mode needs a saved map location on the job or property before work can start — you can add it later on the job.</p>}
          </>
        ) : (
          <p className="text-sm text-zinc-600">Company default: <strong className="text-zinc-900">{START_MODE_INFO[systemSettings.jobStartVerification.defaultMode].label}</strong></p>
        )}
      </Step>

      <Step n={5} title="Assignment and notes">
        <Field label="Field Operations Manager" htmlFor="qj-fm" hint="Optional — you can assign later"><select id="qj-fm" value={managerId} onChange={(e) => setManagerId(e.target.value)} className="w-full h-12 rounded-xl border border-zinc-300 bg-white px-3 text-base"><option value="">Assign later</option>{managers.map((m) => (<option key={m.id} value={m.id}>{m.name}</option>))}</select></Field>
        <Field label="Job description" htmlFor="qj-notes" hint="Optional"><textarea id="qj-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} className="w-full rounded-xl border border-zinc-300 px-3.5 py-2.5 text-sm" /></Field>
      </Step>

      {error && <Notice tone="error">{error}</Notice>}

      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] lg:bottom-0 lg:left-64 z-30 bg-white/95 backdrop-blur border-t border-zinc-200 px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <p className={cn("hidden sm:block flex-1 text-sm truncate", missing() ? "text-zinc-500" : "text-zinc-700")}>{missing() ?? `${quote ? quote.quoteNumber : activeServices.find((s) => s.id === serviceId)?.name ?? ""} · ${date} · ${slot}`}</p>
          <Button size="lg" className="w-full sm:w-auto" loading={busy} disabled={busy} onClick={() => void submit()}>{busy ? "Creating…" : "Create job"}</Button>
        </div>
      </div>
    </div>
  );
}
