"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronLeft, Phone, MessageCircle, Mail, Pencil, PhoneCall, CalendarClock, CheckCircle2, Briefcase, FileSignature, UserPlus, AlertTriangle } from "lucide-react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Notice, SkeletonList, ErrorState } from "@/components/ui/states";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { SelectField, Pill, useApiList, callApi, inr, textareaCls } from "@/components/biz/Bits";
import { LeadFormDialog, LogCallDialog } from "@/components/leads/LeadDialogs";
import { useApp } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import { ASSIGNABLE_ROLES } from "@/lib/rbac";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import { LEAD_SOURCE_LABEL, LEAD_STATUSES, LEAD_STATUS_LABEL, LEAD_STATUS_TONE, LOST_REASONS, todayIST, type LeadActivityRow, type LeadRow, type LeadStatus } from "@/lib/leads";

interface Detail { lead: LeadRow; activity: LeadActivityRow[]; matchingCustomers: { id: string; name: string; phone: string }[] }
interface QuoteLite { id: string; quoteNumber: string; customerId: string; total: number; status: string }

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const manage = can("leads.manage");
  const { services, users, properties, customers, refreshJobs, refreshCustomers, refreshProperties } = useApp();
  const d = useApiList<Detail>(() => `/api/leads/${encodeURIComponent(id)}`, [id]);
  const lead = d.data?.lead;

  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(false);
  const [call, setCall] = useState(false);
  const [note, setNote] = useState("");
  const [follow, setFollow] = useState("");
  const [lostOpen, setLostOpen] = useState(false);
  const [lostReason, setLostReason] = useState<string>(LOST_REASONS[0]);
  const [lostNote, setLostNote] = useState("");
  const [convertOpen, setConvertOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [quotes, setQuotes] = useState<QuoteLite[] | null>(null);

  useEffect(() => setFollow(lead?.nextFollowUpDate ?? ""), [lead?.nextFollowUpDate]);
  useEffect(() => {
    if (!lead?.convertedCustomerId || !can("quotes.manage")) return;
    void callApi<QuoteLite[]>("/api/quotations").then((r) => setQuotes((r.data ?? []).filter((q) => q.customerId === lead.convertedCustomerId)));
  }, [lead?.convertedCustomerId, can]);

  const act = async (body: Record<string, unknown>, ok: string, method: "POST" | "PATCH" = "POST") => {
    setBusy(true);
    setError(null);
    const r = await callApi<Detail>(`/api/leads/${encodeURIComponent(id)}`, { method, json: body });
    setBusy(false);
    if (r.error) {
      setError(r.error);
      return false;
    }
    setFlash(ok);
    await d.reload();
    return true;
  };

  if (d.error) return <AdminLayout><ErrorState message={d.error} onRetry={() => void d.reload()} /></AdminLayout>;
  if (!lead) return <AdminLayout><SkeletonList rows={4} /></AdminLayout>;

  const closed = lead.status === "WON" || lead.status === "LOST";
  const today = todayIST();
  const fuTone = lead.nextFollowUpDate && !closed ? (lead.nextFollowUpDate < today ? "overdue" : lead.nextFollowUpDate === today ? "today" : null) : null;
  const custName = lead.convertedCustomerId ? customers.find((c) => c.id === lead.convertedCustomerId)?.name ?? "Customer" : null;
  const digits = lead.phone.replace(/\D/g, "");
  const waNumber = digits.length === 10 ? `91${digits}` : digits;

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto space-y-4 pb-10">
        <Link href="/leads" className="inline-flex items-center gap-1 text-sm font-semibold text-zinc-600 hover:text-zinc-950 min-h-10"><ChevronLeft className="h-4 w-4" aria-hidden /> Leads</Link>

        <header className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold text-zinc-950 break-words">{lead.customerName}</h1>
              <p className="text-sm text-zinc-500">{lead.leadNumber} · {LEAD_SOURCE_LABEL[lead.source]} · created {formatDateTime(lead.createdAt)}</p>
            </div>
            <Pill tone={LEAD_STATUS_TONE[lead.status]}>{LEAD_STATUS_LABEL[lead.status]}</Pill>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={`tel:${lead.phone}`} className="h-11 px-4 rounded-xl border border-zinc-300 bg-white text-sm font-semibold inline-flex items-center gap-2"><Phone className="h-4 w-4 text-emerald-600" aria-hidden /> {lead.phone}</a>
            <a href={`https://wa.me/${waNumber}`} target="_blank" rel="noreferrer" className="h-11 px-4 rounded-xl border border-zinc-300 bg-white text-sm font-semibold inline-flex items-center gap-2"><MessageCircle className="h-4 w-4 text-emerald-600" aria-hidden /> WhatsApp</a>
            {lead.email && <a href={`mailto:${lead.email}`} className="h-11 px-4 rounded-xl border border-zinc-300 bg-white text-sm font-semibold inline-flex items-center gap-2 min-w-0"><Mail className="h-4 w-4" aria-hidden /> <span className="truncate">{lead.email}</span></a>}
            {manage && <Button variant="outline" onClick={() => setCall(true)}><PhoneCall className="h-4 w-4" aria-hidden /> Log call</Button>}
            {manage && <Button variant="outline" onClick={() => setEdit(true)}><Pencil className="h-4 w-4" aria-hidden /> Edit</Button>}
          </div>
          {lead.duplicates && lead.duplicates.length > 0 && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Same phone on {lead.duplicates.map((x, i) => <React.Fragment key={x.id}>{i ? ", " : ""}<Link className="font-semibold underline" href={`/leads/${x.id}`}>{x.leadNumber}</Link> ({LEAD_STATUS_LABEL[x.status]})</React.Fragment>)}.
            </p>
          )}
        </header>

        {flash && <Notice tone="success">{flash}</Notice>}
        {error && <Notice tone="error">{error}</Notice>}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            {/* Status */}
            {manage && (
              <section className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-3" aria-labelledby="ls-h">
                <h2 id="ls-h" className="text-base font-semibold text-zinc-900">Status</h2>
                {lead.convertedJobId ? (
                  <p className="text-sm text-emerald-800">Converted to a job — the status is final.</p>
                ) : (
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Move the lead">
                    {LEAD_STATUSES.map((s) => (
                      <button key={s} type="button" disabled={busy} aria-pressed={lead.status === s} onClick={() => (s === "LOST" ? (setLostReason(LOST_REASONS[0]), setLostNote(""), setLostOpen(true)) : s !== lead.status && void act({ status: s, expectedUpdatedAt: lead.updatedAt }, `Moved to ${LEAD_STATUS_LABEL[s]}.`, "PATCH"))} className={cn("min-h-11 px-3 rounded-xl border text-sm font-semibold", lead.status === s ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50")}>
                        {LEAD_STATUS_LABEL[s]}
                      </button>
                    ))}
                  </div>
                )}
                {lead.status === "LOST" && lead.lostReason && <p className="text-sm text-red-700">Lost: {lead.lostReason}</p>}
              </section>
            )}

            {/* Conversion */}
            <section className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-3" aria-labelledby="lc-h">
              <h2 id="lc-h" className="text-base font-semibold text-zinc-900">Customer, quotation &amp; job</h2>
              {lead.convertedJobId ? (
                <div className="space-y-2 text-sm">
                  <p className="text-emerald-800 font-semibold flex items-center gap-2"><CheckCircle2 className="h-4 w-4" aria-hidden /> Converted {lead.convertedAt ? formatDateTime(lead.convertedAt) : ""}</p>
                  <div className="flex flex-wrap gap-2">
                    {lead.convertedCustomerId && <Link href={`/customers/${lead.convertedCustomerId}`} className="h-11 px-4 rounded-xl border border-zinc-300 inline-flex items-center gap-2 font-semibold">Customer: {custName}</Link>}
                    <Link href={`/jobs/${lead.convertedJobId}`} className="h-11 px-4 rounded-xl bg-zinc-900 text-white inline-flex items-center gap-2 font-semibold"><Briefcase className="h-4 w-4" aria-hidden /> Job {lead.convertedJobNumber}</Link>
                  </div>
                </div>
              ) : (
                <div className="space-y-3 text-sm">
                  {lead.convertedCustomerId ? (
                    <p>Linked to customer <Link className="font-semibold text-rose-600" href={`/customers/${lead.convertedCustomerId}`}>{custName}</Link>.</p>
                  ) : d.data!.matchingCustomers.length > 0 ? (
                    <p className="text-zinc-700">Existing customer with this phone: {d.data!.matchingCustomers.map((c) => c.name).join(", ")} — they will be reused.</p>
                  ) : (
                    <p className="text-zinc-600">Not a customer yet.</p>
                  )}
                  {lead.quoteId && <p>Quotation: <Link className="font-semibold text-rose-600" href={`/quotations/${lead.quoteId}`}>{lead.quoteNumber}</Link>{lead.status === "WON" ? " — convert the quotation to a job; this lead is linked automatically." : ""}</p>}
                  {manage && (
                    <div className="flex flex-wrap gap-2">
                      {!lead.convertedCustomerId && lead.status !== "LOST" && <Button variant="outline" onClick={() => setLinkOpen(true)}><UserPlus className="h-4 w-4" aria-hidden /> Create / link customer</Button>}
                      {lead.convertedCustomerId && can("quotes.manage") && <Link href={`/quotations/new?customerId=${lead.convertedCustomerId}`} className="h-11 px-4 rounded-xl border border-zinc-300 inline-flex items-center gap-2 font-semibold"><FileSignature className="h-4 w-4" aria-hidden /> New quotation</Link>}
                      {lead.status === "WON" && !lead.quoteId && <Button onClick={() => setConvertOpen(true)}><Briefcase className="h-4 w-4" aria-hidden /> Convert to Customer &amp; Job</Button>}
                    </div>
                  )}
                  {manage && lead.convertedCustomerId && quotes && quotes.length > 0 && (
                    <SelectField label="Linked quotation" id="lq" value={lead.quoteId ?? ""} onChange={(v) => void act({ action: "link-quote", quoteId: v || null }, v ? "Quotation linked." : "Quotation unlinked.")}>
                      <option value="">— None —</option>
                      {quotes.map((q) => <option key={q.id} value={q.id}>{q.quoteNumber} · {inr(q.total)} · {q.status}</option>)}
                    </SelectField>
                  )}
                  {lead.status !== "WON" && !lead.quoteId && <p className="text-xs text-zinc-500">Mark the lead Won to convert it to a customer and job.</p>}
                </div>
              )}
            </section>

            {/* Activity */}
            <section className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-3" aria-labelledby="la-h">
              <h2 id="la-h" className="text-base font-semibold text-zinc-900">History</h2>
              {manage && (
                <form onSubmit={(e) => { e.preventDefault(); if (note.trim()) void act({ action: "note", message: note.trim() }, "Note added.").then((ok) => ok && setNote("")); }} className="space-y-2">
                  <label htmlFor="ln" className="sr-only">Add a note</label>
                  <textarea id="ln" rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={textareaCls} placeholder="Add a note…" />
                  <Button type="submit" size="sm" variant="outline" disabled={!note.trim()} loading={busy}>Add note</Button>
                </form>
              )}
              <ol className="space-y-3">
                {d.data!.activity.map((a) => (
                  <li key={a.id} className="border-l-2 border-zinc-200 pl-3">
                    <div className="text-xs text-zinc-500">{formatDateTime(a.createdAt)} · {a.actorName}</div>
                    <div className="text-sm text-zinc-900 break-words">{a.message}</div>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <aside className="space-y-4">
            {/* Follow-up */}
            <section className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-3" aria-labelledby="lf-h">
              <h2 id="lf-h" className="text-base font-semibold text-zinc-900 flex items-center gap-2"><CalendarClock className="h-4 w-4 text-rose-500" aria-hidden /> Follow-up</h2>
              {lead.nextFollowUpDate ? (
                <p className={cn("text-sm font-semibold", fuTone === "overdue" ? "text-red-700" : fuTone === "today" ? "text-amber-700" : "text-zinc-800")}>{fuTone === "overdue" ? <AlertTriangle className="inline h-4 w-4 mr-1" aria-hidden /> : null}{fuTone === "overdue" ? "Overdue — " : fuTone === "today" ? "Due today — " : "Next: "}{formatDate(lead.nextFollowUpDate)}</p>
              ) : <p className="text-sm text-zinc-500">No follow-up scheduled.</p>}
              {lead.lastContactedAt && <p className="text-xs text-zinc-500">Last contacted {formatDateTime(lead.lastContactedAt)}</p>}
              {manage && !closed && (
                <div className="space-y-2">
                  <Field label="Follow up on" htmlFor="lfd"><Input id="lfd" type="date" min={today} value={follow} onChange={(e) => setFollow(e.target.value)} /></Field>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={busy || follow === (lead.nextFollowUpDate ?? "")} onClick={() => void act({ action: "follow-up", date: follow || null }, follow ? "Follow-up scheduled." : "Follow-up cleared.")}>Save date</Button>
                    {lead.nextFollowUpDate && <Button size="sm" disabled={busy} onClick={() => void act({ action: "follow-up-done", nextDate: follow && follow !== lead.nextFollowUpDate ? follow : null }, "Follow-up marked done.")}>Mark done</Button>}
                  </div>
                </div>
              )}
            </section>

            {/* Details */}
            <section className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-2 text-sm" aria-labelledby="ld-h">
              <h2 id="ld-h" className="text-base font-semibold text-zinc-900">Details</h2>
              <dl className="space-y-1.5">
                {[
                  ["Service", lead.serviceName ?? lead.serviceInterest],
                  ["Location", [lead.propertyAddress, lead.locality, lead.city, lead.postalCode].filter(Boolean).join(", ")],
                  ["Preferred date", lead.preferredDate ? formatDate(lead.preferredDate) : null],
                  ["Estimated value", lead.estimatedValue ? inr(lead.estimatedValue) : null],
                  ["Assigned to", lead.assignedUserName],
                  ["Source details", lead.sourceDetails],
                  ["Notes", lead.notes],
                ].map(([k, v]) => (
                  <div key={String(k)} className="grid grid-cols-[7rem_1fr] gap-2"><dt className="text-zinc-500">{k}</dt><dd className="text-zinc-900 break-words">{v || "—"}</dd></div>
                ))}
              </dl>
              {(lead.utmSource || lead.utmCampaign || lead.gclid || lead.landingPage || lead.referrerUrl) && (
                <details className="pt-2">
                  <summary className="cursor-pointer text-sm font-semibold text-zinc-700 min-h-10">Website attribution</summary>
                  <dl className="space-y-1 text-xs mt-1">
                    {[["utm_source", lead.utmSource], ["utm_medium", lead.utmMedium], ["utm_campaign", lead.utmCampaign], ["utm_term", lead.utmTerm], ["utm_content", lead.utmContent], ["Google Ads click id", lead.gclid ? `${lead.gclid.slice(0, 12)}…` : null], ["Landing page", lead.landingPage], ["Referrer", lead.referrerUrl]].filter(([, v]) => v).map(([k, v]) => (
                      <div key={String(k)} className="grid grid-cols-[7rem_1fr] gap-2"><dt className="text-zinc-500">{k}</dt><dd className="text-zinc-800 break-all">{v}</dd></div>
                    ))}
                  </dl>
                </details>
              )}
            </section>
          </aside>
        </div>
      </div>

      <LeadFormDialog open={edit} onOpenChange={setEdit} editing={lead} onSaved={() => { setFlash("Lead updated."); void d.reload(); }} />
      <LogCallDialog open={call} onOpenChange={setCall} lead={lead} onSaved={() => { setFlash("Call logged."); void d.reload(); }} />

      <Dialog open={lostOpen} onOpenChange={setLostOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark as lost</DialogTitle>
            <DialogDescription>The reason is kept with the lead.</DialogDescription>
          </DialogHeader>
          <SelectField label="Reason" id="lr" value={lostReason} onChange={setLostReason}>{LOST_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}</SelectField>
          <Field label="Details (optional)" htmlFor="lrn"><textarea id="lrn" rows={2} value={lostNote} onChange={(e) => setLostNote(e.target.value)} className={textareaCls} /></Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLostOpen(false)}>Cancel</Button>
            <Button loading={busy} onClick={() => void act({ status: "LOST", lostReason: lostNote.trim() ? `${lostReason} — ${lostNote.trim()}` : lostReason, expectedUpdatedAt: lead.updatedAt }, "Marked as lost.", "PATCH").then((ok) => ok && setLostOpen(false))}>Mark lost</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CustomerStep
        open={linkOpen || convertOpen}
        mode={convertOpen ? "convert" : "link"}
        lead={lead}
        matching={d.data!.matchingCustomers}
        properties={properties}
        services={services.filter((s) => s.active)}
        managers={users.filter((u) => ASSIGNABLE_ROLES.includes(u.role) && u.active !== false)}
        onClose={() => { setLinkOpen(false); setConvertOpen(false); }}
        onSubmit={async (body) => {
          const ok = await act(body, convertOpen ? "Converted to customer and job ✓" : "Customer linked.");
          if (ok) {
            setLinkOpen(false);
            setConvertOpen(false);
            await Promise.all([refreshCustomers(), refreshProperties(), refreshJobs()]);
          }
          return ok;
        }}
        busy={busy}
        error={error}
      />
    </AdminLayout>
  );
}

/** Choose / create the customer and property (and, when converting, the job details). */
function CustomerStep({ open, mode, lead, matching, properties, services, managers, onClose, onSubmit, busy, error }: {
  open: boolean;
  mode: "link" | "convert";
  lead: LeadRow;
  matching: { id: string; name: string; phone: string }[];
  properties: { id: string; customerId: string; title: string; address: string }[];
  services: { id: string; name: string }[];
  managers: { id: string; name: string }[];
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => Promise<boolean>;
  busy: boolean;
  error: string | null;
}) {
  const [customerChoice, setCustomerChoice] = useState<string>("");
  const [propertyChoice, setPropertyChoice] = useState<string>("new");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [date, setDate] = useState(todayIST());
  const [from, setFrom] = useState("09:00");
  const [to, setTo] = useState("13:00");
  const [managerId, setManagerId] = useState("");
  const [invoiceType, setInvoiceType] = useState<"GST" | "NON_GST">("GST");

  useEffect(() => {
    if (!open) return;
    setCustomerChoice(lead.convertedCustomerId ?? matching[0]?.id ?? "new");
    setAddress([lead.propertyAddress, lead.locality].filter(Boolean).join(", "));
    setCity(lead.city ?? "");
    setServiceId(lead.serviceId ?? "");
    setDate(lead.preferredDate && lead.preferredDate >= todayIST() ? lead.preferredDate : todayIST());
  }, [open, lead, matching]);

  const customerId = customerChoice === "new" ? null : customerChoice;
  const theirProps = customerId ? properties.filter((p) => p.customerId === customerId) : [];
  useEffect(() => {
    setPropertyChoice(lead.convertedPropertyId && theirProps.some((p) => p.id === lead.convertedPropertyId) ? lead.convertedPropertyId : theirProps.length === 1 && !lead.propertyAddress ? theirProps[0].id : "new");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerChoice, open]);

  const submit = () => {
    const base: Record<string, unknown> = {
      action: mode === "convert" ? "convert" : "link-customer",
      ...(customerId ? { customerId } : { forceNewCustomer: true }),
      ...(propertyChoice !== "new" ? { propertyId: propertyChoice } : { property: { address: address.trim(), city: city.trim() || null, locality: lead.locality, postalCode: lead.postalCode, lat: lead.lat, lng: lead.lng } }),
    };
    if (mode === "convert") Object.assign(base, { serviceId, scheduledDate: date, scheduledTimeSlot: `${from} - ${to}`, assignedManagerId: managerId || undefined, invoiceType });
    void onSubmit(base);
  };
  const invalid = (propertyChoice === "new" && address.trim().length < 3) || (mode === "convert" && (!serviceId || !date || from >= to));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "convert" ? "Convert to customer & job" : "Create / link customer"}</DialogTitle>
          <DialogDescription>{mode === "convert" ? "Reuses the existing customer and property where possible; the lead keeps its full history." : "Needed before making a quotation for this lead."}</DialogDescription>
        </DialogHeader>
        {error && <Notice tone="error">{error}</Notice>}
        <SelectField label="Customer" id="cs-c" value={customerChoice} onChange={setCustomerChoice} disabled={!!lead.convertedCustomerId}>
          {lead.convertedCustomerId && !matching.some((m) => m.id === lead.convertedCustomerId) && <option value={lead.convertedCustomerId}>Linked customer</option>}
          {matching.map((m) => <option key={m.id} value={m.id}>Existing: {m.name} ({m.phone})</option>)}
          <option value="new">New customer: {lead.customerName}</option>
        </SelectField>
        <SelectField label="Property" id="cs-p" value={propertyChoice} onChange={setPropertyChoice}>
          {theirProps.map((p) => <option key={p.id} value={p.id}>{p.title} — {p.address}</option>)}
          <option value="new">New property from the lead&apos;s address</option>
        </SelectField>
        {propertyChoice === "new" && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Address" required htmlFor="cs-a" className="sm:col-span-2"><Input id="cs-a" value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
            <Field label="City" htmlFor="cs-city"><Input id="cs-city" value={city} onChange={(e) => setCity(e.target.value)} /></Field>
            <p className="sm:col-span-3 text-xs text-zinc-500">Set the exact map pin on the property afterwards (Properties → Edit) so the team can navigate and GPS start checks work.</p>
          </div>
        )}
        {mode === "convert" && (
          <>
            <SelectField label="Service" id="cs-s" value={serviceId} onChange={setServiceId} required>
              <option value="">Choose a service</option>
              {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </SelectField>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Date" required htmlFor="cs-d"><Input id="cs-d" type="date" min={todayIST()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              <Field label="From" htmlFor="cs-f"><Input id="cs-f" type="time" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
              <Field label="To" htmlFor="cs-t"><Input id="cs-t" type="time" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <SelectField label="Field Manager" id="cs-m" value={managerId} onChange={setManagerId}>
                <option value="">Assign later</option>
                {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </SelectField>
              <SelectField label="Invoice" id="cs-i" value={invoiceType} onChange={(v) => setInvoiceType(v as "GST" | "NON_GST")}>
                <option value="GST">GST invoice</option>
                <option value="NON_GST">Non-GST invoice</option>
              </SelectField>
            </div>
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={busy} disabled={invalid} onClick={submit}>{mode === "convert" ? "Convert" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
