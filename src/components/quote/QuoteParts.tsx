"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { useApp } from "@/lib/app-context";
import { ASSIGNABLE_ROLES } from "@/lib/rbac";
import { cn, toLocalDateString } from "@/lib/utils";
import type { Quote, QuoteStatus } from "@/lib/types";

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  declined: "Declined",
  converted_to_job: "Converted to job",
  expired: "Expired",
};
const TONE: Record<QuoteStatus, string> = {
  draft: "border-zinc-200 bg-zinc-100 text-zinc-700",
  sent: "border-info-200 bg-info-50 text-info-700",
  accepted: "border-emerald-200 bg-emerald-50 text-emerald-800",
  declined: "border-red-200 bg-red-50 text-red-700",
  converted_to_job: "border-violet-200 bg-violet-50 text-violet-800",
  expired: "border-amber-200 bg-amber-50 text-amber-800",
};

export function QuoteStatusBadge({ status, className }: { status: QuoteStatus; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold whitespace-nowrap", TONE[status], className)}>{QUOTE_STATUS_LABEL[status]}</span>;
}

/** JSON helper for the quotation API — returns { data } or { error }. */
export async function quoteApi<T = unknown>(url: string, init?: RequestInit): Promise<{ data?: T; error?: string }> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) return { error: json?.error || (res.status === 404 ? "Quotation not found." : "Something went wrong. Please try again.") };
    return { data: json.data as T };
  } catch {
    return { error: "You're offline. Check your connection and try again." };
  }
}

export function useQuotes() {
  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    const r = await quoteApi<Quote[]>("/api/quotations");
    if (r.error) setError(r.error);
    else setQuotes(r.data ?? []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return { quotes, error, reload: load };
}

/**
 * Convert to Job / Invoice: when, who, and (if the quotation has none) where.
 * The server creates the job and its draft invoice from the quotation lines.
 */
export function ConvertDialog({
  quote,
  mode,
  open,
  onClose,
  onDone,
}: {
  quote: Quote;
  mode: "convert-job" | "convert-invoice";
  open: boolean;
  onClose: () => void;
  onDone: (r: { jobId: string; invoiceId?: string }) => void;
}) {
  const { properties, users, refreshJobs, refreshFinance } = useApp();
  const customerProps = useMemo(() => properties.filter((p) => p.customerId === quote.customerId), [properties, quote.customerId]);
  const managers = users.filter((u) => ASSIGNABLE_ROLES.includes(u.role) && u.active !== false);
  const [propertyId, setPropertyId] = useState(quote.propertyId ?? "");
  const [date, setDate] = useState(toLocalDateString());
  const [from, setFrom] = useState("09:00");
  const [to, setTo] = useState("13:00");
  const [managerId, setManagerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alreadyJob = Boolean(quote.jobId);

  useEffect(() => {
    if (!propertyId && customerProps.length === 1) setPropertyId(customerProps[0].id);
  }, [customerProps, propertyId]);

  const submit = async () => {
    if (!alreadyJob) {
      if (!propertyId) return setError("Pick the property for this job.");
      if (!date) return setError("Pick a date.");
      if (from >= to) return setError("The end time must be after the start time.");
    }
    setBusy(true);
    setError(null);
    const r = await quoteApi<{ jobId: string; invoiceId?: string }>(`/api/quotations/${encodeURIComponent(quote.id)}`, {
      method: "POST",
      body: JSON.stringify({ action: mode, propertyId: propertyId || undefined, scheduledDate: date, scheduledTimeSlot: `${from} - ${to}`, assignedManagerId: managerId || undefined }),
    });
    setBusy(false);
    if (r.error || !r.data) return setError(r.error ?? "Could not convert.");
    await Promise.all([refreshJobs(), refreshFinance()]);
    onDone(r.data);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "convert-job" ? "Convert to Job" : "Convert to Invoice"}</DialogTitle>
          <DialogDescription>
            {alreadyJob
              ? "This quotation is already a job. Its draft invoice will be updated from the quotation lines."
              : mode === "convert-job"
                ? "Creates the job with a draft invoice built from these quotation lines."
                : "Creates the job and its invoice from these quotation lines. Schedule when the work will be done."}
          </DialogDescription>
        </DialogHeader>
        {!alreadyJob && (
          <div className="space-y-4">
            {!quote.propertyId && (
              <Field label="Property" required htmlFor="cv-prop" hint={customerProps.length ? undefined : "This customer has no property yet — add one from the customer's page."}>
                <select id="cv-prop" value={propertyId} onChange={(e) => setPropertyId(e.target.value)} className="w-full h-12 rounded-xl border border-zinc-300 bg-white px-3 text-base">
                  <option value="">Select a property</option>
                  {customerProps.map((p) => (
                    <option key={p.id} value={p.id}>{p.title} — {p.address}</option>
                  ))}
                </select>
              </Field>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Date" required htmlFor="cv-date"><Input id="cv-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              <Field label="From" required htmlFor="cv-from"><Input id="cv-from" type="time" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
              <Field label="To" required htmlFor="cv-to"><Input id="cv-to" type="time" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
            </div>
            <Field label="Field Manager" htmlFor="cv-fm" hint="Optional — you can assign later.">
              <select id="cv-fm" value={managerId} onChange={(e) => setManagerId(e.target.value)} className="w-full h-12 rounded-xl border border-zinc-300 bg-white px-3 text-base">
                <option value="">Assign later</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </Field>
          </div>
        )}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void submit()} loading={busy}>{mode === "convert-job" ? "Create job" : alreadyJob ? "Update invoice" : "Create invoice"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
