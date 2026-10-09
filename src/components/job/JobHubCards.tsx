"use client";

import React, { useState } from "react";
import Link from "next/link";
import { MapPin, Eye, FileSignature, Star, ShieldCheck, Pencil, ChevronRight } from "lucide-react";
import { LocationPicker, type LocationValue } from "@/components/common/LocationPicker";
import { VisibilityEditor } from "@/components/common/VisibilityEditor";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { useApp } from "@/lib/app-context";
import { CUSTOMER_VISIBILITY_KEYS, CUSTOMER_VISIBILITY_LABELS, type CustomerVisibility, type Job, type Property } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";
import { arrivalMethodLabel } from "@/lib/start-verification";
import { resolveServiceLocation } from "@/lib/location";

async function patchJob(id: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/jobs/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  return res.ok && json?.success ? null : json?.error || "Couldn't save. Please try again.";
}

/**
 * The rest of the job's story on its Details page: where (map + Navigate),
 * what the customer sees, the quotation it came from, how arrival was
 * verified, and the customer's feedback.
 */
export function JobHubCards({ job, property, canEdit }: { job: Job; property?: Property; canEdit: boolean }) {
  const { systemSettings, refreshJobs } = useApp();
  // The server resolves it (job pin, else the property's); recompute only for an older payload.
  const where = job.serviceLocation ?? resolveServiceLocation(job, property);
  const loc: LocationValue = { lat: where.lat, lng: where.lng, address: where.address };
  const effective: CustomerVisibility = { ...systemSettings.customerVisibility, ...(job.customerVisibility ?? {}) };
  const hidden = CUSTOMER_VISIBILITY_KEYS.filter((k) => !effective[k]);

  const [editLoc, setEditLoc] = useState(false);
  const [draftLoc, setDraftLoc] = useState<LocationValue>(loc);
  const [editVis, setEditVis] = useState(false);
  const [draftVis, setDraftVis] = useState<CustomerVisibility>(effective);
  const [draftNotes, setDraftNotes] = useState(job.customerNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (body: Record<string, unknown>, close: () => void) => {
    setSaving(true);
    setError(null);
    const err = await patchJob(job.id, body);
    setSaving(false);
    if (err) return setError(err);
    await refreshJobs();
    close();
  };

  return (
    <>
      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-zinc-900 flex items-center gap-2"><MapPin className="h-4 w-4 text-rose-500" aria-hidden /> Location</h2>
          {canEdit && (
            <Button size="sm" variant="ghost" onClick={() => { setDraftLoc(loc); setError(null); setEditLoc(true); }}><Pencil className="h-4 w-4" aria-hidden /> Edit</Button>
          )}
        </div>
        {property && <p className="text-sm font-semibold text-zinc-900 break-words">{property.title}</p>}
        {loc.address && <p className="text-sm text-zinc-700 break-words">{loc.address}</p>}
        {property?.locationNotes && <p className="text-sm text-zinc-600 break-words">Note: {property.locationNotes}</p>}
        <LocationPicker key={`${loc.lat},${loc.lng}`} value={loc} readOnly height={180} />
        {where.source && (
          <p className="text-xs text-zinc-500">{where.source === "JOB" ? "Pin set for this job only (the property's saved pin is different)." : "Using the property's saved pin."}</p>
        )}
        {job.arrivalVerification && (
          <p className="text-sm text-zinc-600 flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden /> Arrival: {arrivalMethodLabel(job.arrivalVerification)}
            {job.arrivedAt ? ` · ${formatDateTime(job.arrivedAt)}` : ""}
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-zinc-900 flex items-center gap-2"><Eye className="h-4 w-4 text-rose-500" aria-hidden /> Customer view</h2>
          {canEdit && (
            <Button size="sm" variant="ghost" onClick={() => { setDraftVis(effective); setDraftNotes(job.customerNotes ?? ""); setError(null); setEditVis(true); }}><Pencil className="h-4 w-4" aria-hidden /> Edit</Button>
          )}
        </div>
        <p className="text-sm text-zinc-600">
          {hidden.length === 0 ? "The customer sees everything customer-facing." : `Hidden from the customer: ${hidden.map((k) => CUSTOMER_VISIBILITY_LABELS[k]).join(", ")}.`}
          {job.customerVisibility ? " (custom for this job)" : " (company default)"}
        </p>
        {job.customerNotes && <p className="rounded-xl bg-zinc-50 px-3 py-2 text-sm text-zinc-700 break-words"><span className="font-semibold">Note for the customer:</span> {job.customerNotes}</p>}
      </section>

      {job.quoteId && (
        <Link href={`/quotations/${job.quoteId}`} className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow">
          <FileSignature className="h-5 w-5 text-rose-500 shrink-0" aria-hidden />
          <span className="flex-1 text-sm font-semibold text-zinc-900">Quotation for this job</span>
          <ChevronRight className="h-4 w-4 text-zinc-400" aria-hidden />
        </Link>
      )}

      {(job.customerFeedbackRating || job.customerFeedbackComment) && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm space-y-2">
          <h2 className="text-base font-semibold text-zinc-900 flex items-center gap-2"><Star className="h-4 w-4 text-amber-500" aria-hidden /> Customer feedback</h2>
          {job.customerFeedbackRating ? <p className="text-lg text-amber-500" aria-label={`${job.customerFeedbackRating} of 5 stars`}>{"★".repeat(job.customerFeedbackRating)}<span className="text-zinc-300">{"★".repeat(5 - job.customerFeedbackRating)}</span></p> : null}
          {job.customerFeedbackComment && <p className="text-sm text-zinc-700 break-words">“{job.customerFeedbackComment}”</p>}
          <p className="text-xs text-zinc-500">{job.googleReviewClicked ? "Customer opened the Google review page." : "Not sent to Google yet."}</p>
        </section>
      )}

      <Dialog open={editLoc} onOpenChange={setEditLoc}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Job location</DialogTitle>
            <DialogDescription>Used for Navigate and for the Field Manager&apos;s arrival check.</DialogDescription>
          </DialogHeader>
          {editLoc && <LocationPicker idPrefix="job-loc" value={draftLoc} onChange={setDraftLoc} height={240} />}
          <p className="text-xs text-zinc-500">To move the property itself (for every future job), edit the property instead.</p>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditLoc(false)}>Cancel</Button>
            {where.source === "JOB" && (
              <Button variant="outline" loading={saving} onClick={() => void save({ location: { lat: null, lng: null, address: null, followProperty: true } }, () => setEditLoc(false))}>Use property&apos;s pin</Button>
            )}
            <Button loading={saving} onClick={() => void save({ location: { lat: draftLoc.lat, lng: draftLoc.lng, address: draftLoc.address || null } }, () => setEditLoc(false))}>Save location</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editVis} onOpenChange={setEditVis}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Customer view</DialogTitle>
            <DialogDescription>What this customer sees when they scan the QR. Hidden items are never sent to them.</DialogDescription>
          </DialogHeader>
          <Field label="Note for the customer" htmlFor="cv-notes" hint="Shown only if “Service notes” is on">
            <textarea id="cv-notes" value={draftNotes} onChange={(e) => setDraftNotes(e.target.value)} rows={2} className="w-full rounded-xl border border-zinc-300 px-3.5 py-2.5 text-sm" />
          </Field>
          <VisibilityEditor value={draftVis} defaults={systemSettings.customerVisibility} onChange={setDraftVis} />
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => void save({ customerVisibility: null, customerNotes: draftNotes }, () => setEditVis(false))}>Use company default</Button>
            <Button loading={saving} onClick={() => void save({ customerVisibility: draftVis, customerNotes: draftNotes }, () => setEditVis(false))}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
