"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Notice } from "@/components/ui/states";
import { SelectField, textareaCls, callApi } from "@/components/biz/Bits";
import { useApp } from "@/lib/app-context";
import { CALL_OUTCOMES, CALL_OUTCOME_LABEL, LEAD_SOURCES, LEAD_SOURCE_LABEL, todayIST, type LeadRow, type LeadSource, type CallOutcome } from "@/lib/leads";

type Dupe = { id: string; leadNumber: string; status: string; customerName?: string };

/** Create or edit a lead. On create, an open lead with the same phone is shown before saving a second one. */
export function LeadFormDialog({ open, onOpenChange, editing, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; editing?: LeadRow | null; onSaved: (lead: LeadRow) => void }) {
  const { services, users } = useApp();
  const admins = users.filter((u) => u.role === "admin" && u.active !== false);
  const blank = { customerName: "", phone: "", email: "", source: "PHONE_CALL" as LeadSource, sourceDetails: "", serviceId: "", serviceInterest: "", propertyAddress: "", locality: "", city: "", postalCode: "", preferredDate: "", estimatedValue: "", assignedUserId: "", nextFollowUpDate: "", notes: "" };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dupes, setDupes] = useState<Dupe[] | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setDupes(null);
    setF(
      editing
        ? {
            customerName: editing.customerName,
            phone: editing.phone,
            email: editing.email ?? "",
            source: editing.source,
            sourceDetails: editing.sourceDetails ?? "",
            serviceId: editing.serviceId ?? "",
            serviceInterest: editing.serviceInterest ?? "",
            propertyAddress: editing.propertyAddress ?? "",
            locality: editing.locality ?? "",
            city: editing.city ?? "",
            postalCode: editing.postalCode ?? "",
            preferredDate: editing.preferredDate ?? "",
            estimatedValue: editing.estimatedValue?.toString() ?? "",
            assignedUserId: editing.assignedUserId ?? "",
            nextFollowUpDate: editing.nextFollowUpDate ?? "",
            notes: editing.notes ?? "",
          }
        : blank
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const value = f.estimatedValue.trim() === "" ? null : Number(f.estimatedValue);

  const save = async (allowDuplicate = false) => {
    if (value !== null && (!Number.isFinite(value) || value < 0)) return setError("Estimated value must be a positive number.");
    setBusy(true);
    setError(null);
    const svc = services.find((s) => s.id === f.serviceId);
    const payload = {
      customerName: f.customerName,
      phone: f.phone,
      email: f.email || null,
      source: f.source,
      sourceDetails: f.sourceDetails || null,
      serviceId: f.serviceId || null,
      serviceInterest: f.serviceInterest || svc?.name || null,
      propertyAddress: f.propertyAddress || null,
      locality: f.locality || null,
      city: f.city || null,
      postalCode: f.postalCode || null,
      preferredDate: f.preferredDate || null,
      estimatedValue: value,
      assignedUserId: f.assignedUserId || null,
      nextFollowUpDate: f.nextFollowUpDate || null,
      notes: f.notes || null,
      ...(editing ? { expectedUpdatedAt: editing.updatedAt } : { allowDuplicate }),
    };
    const r = editing
      ? await callApi<{ lead: LeadRow }>(`/api/leads/${editing.id}`, { method: "PATCH", json: payload })
      : await callApi<LeadRow>("/api/leads", { method: "POST", json: payload });
    setBusy(false);
    if (r.error) {
      if (r.status === 409 && Array.isArray(r.extra?.duplicates)) setDupes(r.extra!.duplicates as Dupe[]);
      return setError(r.error);
    }
    onSaved(editing ? (r.data as { lead: LeadRow }).lead : (r.data as LeadRow));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.leadNumber}` : "New lead"}</DialogTitle>
            <DialogDescription>Who enquired, where they came from and what they need.</DialogDescription>
          </DialogHeader>
          {error && <Notice tone="error">{error}</Notice>}
          {dupes && dupes.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 space-y-2">
              <p>Open lead{dupes.length > 1 ? "s" : ""} for this phone:</p>
              <ul className="list-disc pl-5">{dupes.map((d) => <li key={d.id}><Link className="font-semibold underline" href={`/leads/${d.id}`}>{d.leadNumber}</Link>{d.customerName ? ` — ${d.customerName}` : ""}</li>)}</ul>
              <Button type="button" size="sm" variant="outline" loading={busy} onClick={() => void save(true)}>Save as a separate lead anyway</Button>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Customer name" required htmlFor="ld-name"><Input id="ld-name" value={f.customerName} onChange={set("customerName")} required autoComplete="name" /></Field>
            <Field label="Phone" required htmlFor="ld-phone"><Input id="ld-phone" type="tel" inputMode="tel" value={f.phone} onChange={set("phone")} required placeholder="+91 98450 12345" /></Field>
            <Field label="Email" htmlFor="ld-email"><Input id="ld-email" type="email" value={f.email} onChange={set("email")} /></Field>
            <SelectField label="Lead source" id="ld-source" value={f.source} onChange={(v) => setF((x) => ({ ...x, source: v as LeadSource }))} required>
              {LEAD_SOURCES.map((s) => <option key={s} value={s}>{LEAD_SOURCE_LABEL[s]}</option>)}
            </SelectField>
          </div>
          <Field label="Source details" htmlFor="ld-srcd" hint="e.g. referred by Mr. Rao, saw the van, Google Ads campaign name"><Input id="ld-srcd" value={f.sourceDetails} onChange={set("sourceDetails")} /></Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <SelectField label="Service" id="ld-svc" value={f.serviceId} onChange={(v) => setF((x) => ({ ...x, serviceId: v }))}>
              <option value="">— Not decided —</option>
              {services.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </SelectField>
            <Field label="Or describe what they need" htmlFor="ld-int"><Input id="ld-int" value={f.serviceInterest} onChange={set("serviceInterest")} placeholder="Sofa + carpet cleaning" /></Field>
          </div>
          <Field label="Property location" htmlFor="ld-addr"><Input id="ld-addr" value={f.propertyAddress} onChange={set("propertyAddress")} placeholder="Flat / building / street" /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Area" htmlFor="ld-loc"><Input id="ld-loc" value={f.locality} onChange={set("locality")} /></Field>
            <Field label="City" htmlFor="ld-city"><Input id="ld-city" value={f.city} onChange={set("city")} /></Field>
            <Field label="PIN" htmlFor="ld-pin"><Input id="ld-pin" inputMode="numeric" value={f.postalCode} onChange={set("postalCode")} /></Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Preferred service date" htmlFor="ld-pref"><Input id="ld-pref" type="date" value={f.preferredDate} onChange={set("preferredDate")} /></Field>
            <Field label="Estimated value (₹)" htmlFor="ld-val"><Input id="ld-val" inputMode="decimal" value={f.estimatedValue} onChange={set("estimatedValue")} /></Field>
            <Field label="Next follow-up" htmlFor="ld-fu"><Input id="ld-fu" type="date" value={f.nextFollowUpDate} onChange={set("nextFollowUpDate")} /></Field>
          </div>
          <SelectField label="Assigned to" id="ld-assign" value={f.assignedUserId} onChange={(v) => setF((x) => ({ ...x, assignedUserId: v }))}>
            <option value="">— Unassigned —</option>
            {admins.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </SelectField>
          <Field label="Notes" htmlFor="ld-notes"><textarea id="ld-notes" rows={3} value={f.notes} onChange={set("notes")} className={textareaCls} /></Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={busy} disabled={!f.customerName.trim() || !f.phone.trim()}>{editing ? "Save changes" : "Add lead"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Log a call made or received on the office's normal mobile SIM. Calls are
 * recorded by hand — there is no automatic call detection without a telephony provider.
 */
export function LogCallDialog({ open, onOpenChange, lead, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; lead?: LeadRow | null; onSaved: (r: { lead: LeadRow; created: boolean }) => void }) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [direction, setDirection] = useState<"INCOMING" | "OUTGOING">("INCOMING");
  const [outcome, setOutcome] = useState<CallOutcome>("INTERESTED");
  const [notes, setNotes] = useState("");
  const [service, setService] = useState("");
  const [follow, setFollow] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPhone(lead?.phone ?? "");
    setName(lead?.customerName ?? "");
    setDirection(lead ? "OUTGOING" : "INCOMING");
    setOutcome("INTERESTED");
    setNotes("");
    setService("");
    setFollow("");
    setError(null);
  }, [open, lead]);

  const save = async () => {
    setBusy(true);
    setError(null);
    const r = await callApi<{ lead: LeadRow; created: boolean }>("/api/leads/log-call", { method: "POST", json: { phone, callerName: name || undefined, direction, outcome, notes: notes || undefined, serviceInterest: service || undefined, nextFollowUpDate: follow || null, leadId: lead?.id } });
    setBusy(false);
    if (r.error) return setError(r.error);
    onSaved(r.data!);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Log call</DialogTitle>
            <DialogDescription>Record a call on the office mobile. Calls aren&apos;t detected automatically — log each one here.</DialogDescription>
          </DialogHeader>
          {error && <Notice tone="error">{error}</Notice>}
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Call direction">
            {(["INCOMING", "OUTGOING"] as const).map((d) => (
              <button key={d} type="button" role="radio" aria-checked={direction === d} onClick={() => setDirection(d)} className={`min-h-11 rounded-xl border-2 text-sm font-semibold ${direction === d ? "border-rose-500 bg-rose-50 text-rose-700" : "border-zinc-200 text-zinc-700"}`}>{d === "INCOMING" ? "Incoming" : "Outgoing"}</button>
            ))}
          </div>
          <Field label="Caller's phone" required htmlFor="lc-phone"><Input id="lc-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={!!lead} required /></Field>
          {!lead && <Field label="Caller's name" htmlFor="lc-name"><Input id="lc-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>}
          <SelectField label="Outcome" id="lc-outcome" value={outcome} onChange={(v) => setOutcome(v as CallOutcome)} required>
            {CALL_OUTCOMES.map((o) => <option key={o} value={o}>{CALL_OUTCOME_LABEL[o]}</option>)}
          </SelectField>
          {!lead && <Field label="Service asked about" htmlFor="lc-svc"><Input id="lc-svc" value={service} onChange={(e) => setService(e.target.value)} /></Field>}
          <Field label="Notes" htmlFor="lc-notes"><textarea id="lc-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className={textareaCls} /></Field>
          <Field label="Follow up on" htmlFor="lc-fu"><Input id="lc-fu" type="date" min={todayIST()} value={follow} onChange={(e) => setFollow(e.target.value)} /></Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={busy} disabled={!phone.trim()}>Save call</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
