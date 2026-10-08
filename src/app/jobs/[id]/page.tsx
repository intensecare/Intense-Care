"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AdminLayout } from "@/components/common/AdminLayout";
import { JobStatusBadge } from "@/components/common/JobStatusBadge";
import { CustomerLinkCard } from "@/components/common/CustomerLinkCard";
import { JobQrButton } from "@/components/common/JobQr";
import { JobHubCards } from "@/components/job/JobHubCards";
import { InvoiceTypeBadge } from "@/components/invoice/InvoiceDocument";
import { JobJourney } from "@/components/job/JobJourney";
import { NextActionCard } from "@/components/job/NextAction";
import { Skeleton } from "@/components/ui/states";
import { PromptModal } from "@/components/common/PromptModal";
import { useApp } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import { JOB_STATUS_CONFIG } from "@/lib/state-machine";
import { getNextAction } from "@/lib/rbac";
import { cn, formatCurrency, formatMoney, formatDate, formatDateTime, formatTimeSlot, timeAgo } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  MapPin,
  Phone,
  User,
  Sparkles,
  UserPlus,
  AlertTriangle,
  RotateCcw,
  Star,
  Loader2,
  ChevronRight,
  XCircle,
} from "lucide-react";
import type { Job, JobActivityEvent, JobPhoto } from "@/lib/types";

type DeskJob = Job & { customerName?: string; customerPhone?: string; propertyTitle?: string; service?: { name: string } };

const REWORK = ["REWORK_REQUIRED", "REWORK_ASSIGNED", "REWORK_IN_PROGRESS"];

export default function JobPage() {
  const params = useParams();
  const jobId = String(params?.id ?? "");
  const { loading, jobs, customers, properties, users, checklistItems, photos, qualityChecks, qualityIssues, reworkTasks, complaints, invoices, currentUser, refreshJobs, refreshPhotos, refreshQuality } = useApp();
  const { can } = useAuth();

  const job = jobs.find((j) => j.id === jobId) as DeskJob | undefined;
  const customer = customers.find((c) => c.id === job?.customerId);
  const property = properties.find((p) => p.id === job?.propertyId);
  const manager = users.find((u) => u.id === (job?.assignedManagerId ?? job?.assignedStaffIds?.[0]));
  const checklist = useMemo(() => checklistItems.filter((c) => c.jobId === jobId), [checklistItems, jobId]);
  const jobPhotos = useMemo(() => photos.filter((p) => p.jobId === jobId), [photos, jobId]);
  const lastQc = useMemo(() => qualityChecks.filter((q) => q.jobId === jobId).sort((a, b) => (b.inspectedAt ?? "").localeCompare(a.inspectedAt ?? ""))[0], [qualityChecks, jobId]);
  const openRework = useMemo(() => reworkTasks.filter((t) => t.jobId === jobId && t.status !== "completed"), [reworkTasks, jobId]);
  const issues = useMemo(() => qualityIssues.filter((i) => i.jobId === jobId), [qualityIssues, jobId]);
  const jobComplaints = useMemo(() => complaints.filter((c) => c.jobId === jobId), [complaints, jobId]);
  const invoice = invoices.find((i) => i.jobId === jobId);

  const [events, setEvents] = useState<JobActivityEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [pickedManager, setPickedManager] = useState("");
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [newSlot, setNewSlot] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);

  // Live: the job page follows the field, QC and the customer.
  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    const load = async () => {
      const res = await fetch(`/api/activity?jobId=${encodeURIComponent(jobId)}&limit=60`).catch(() => null);
      const json = res ? await res.json().catch(() => null) : null;
      if (!cancelled && res?.ok && json?.success) setEvents(json.data ?? []);
    };
    void load();
    const t = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void load();
      void refreshJobs();
      void refreshPhotos();
      void refreshQuality();
    }, 10000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [jobId, refreshJobs, refreshPhotos, refreshQuality]);

  if (!job && loading) {
    return (
      <AdminLayout>
        <div className="max-w-5xl mx-auto space-y-4" role="status" aria-label="Loading job">
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-36 rounded-2xl" />
        </div>
      </AdminLayout>
    );
  }

  if (!job) {
    return (
      <AdminLayout>
        <div className="max-w-xl mx-auto mt-10 rounded-2xl border border-zinc-200 bg-white p-10 text-center shadow-sm space-y-3">
          <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto" />
          <h1 className="text-lg font-semibold text-zinc-900">Job not found</h1>
          <Link href="/jobs" className="text-sm font-semibold text-rose-600">Back to jobs</Link>
        </div>
      </AdminLayout>
    );
  }

  const patch = async (body: Record<string, unknown>, ok?: () => void) => {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/jobs/${encodeURIComponent(job.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok || !json?.success) {
      setError(json?.error || "That didn't go through. Try again.");
      return false;
    }
    ok?.();
    await refreshJobs();
    return true;
  };

  const tracked = checklist.filter((c) => c.critical).length ? checklist.filter((c) => c.critical) : checklist;
  const done = (s: string) => s === "completed" || s === "skipped";
  const next = getNextAction(currentUser.role, {
    status: job.status,
    assignedManagerId: job.assignedManagerId,
    assignedStaffIds: job.assignedStaffIds,
    customerConfirmedAt: job.customerConfirmedAt ?? null,
    checklistTotal: tracked.length,
    checklistDone: tracked.filter((c) => done(c.status)).length,
    photosBefore: jobPhotos.filter((p) => p.photoType === "before").length,
    photosAfter: jobPhotos.filter((p) => p.photoType === "after").length,
    openRework: openRework.length,
    approvedAt: job.approvedAt ?? null,
    feedbackAt: job.customerFeedbackAt ?? null,
  });

  const cancelled = job.status === "CANCELLED";
  const terminal = ["COMPLETED", "FEEDBACK_REQUESTED", "CLOSED", "CANCELLED"].includes(job.status);
  const managers = users.filter((u) => u.role === "field_manager" && u.active).sort((a, b) => a.name.localeCompare(b.name));
  const config = JOB_STATUS_CONFIG[job.status];
  const openComplaints = jobComplaints.filter((c) => c.status !== "resolved" && c.status !== "closed");
  const areas = Array.from(new Set([...checklist.map((c) => c.area), ...jobPhotos.map((p) => p.area)]));

  const openAssign = () => {
    setPickedManager(job.assignedManagerId ?? job.assignedStaffIds[0] ?? "");
    setError(null);
    setAssignOpen(true);
  };
  const openReschedule = () => {
    setNewDate(job.scheduledDate);
    setNewSlot(job.scheduledTimeSlot);
    setError(null);
    setRescheduleOpen(true);
  };

  /* -------------------------------------------- the ONE primary action */
  const primary = (() => {
    if (!next || next.waiting || next.kind === "wait" || next.kind === "view") return null;
    switch (next.kind) {
      case "assign":
        return { label: next.label, onClick: openAssign };
      case "schedule":
        return { label: next.label, onClick: openReschedule };
      case "handover":
        return { label: next.label, onClick: () => document.getElementById("customer-link")?.scrollIntoView({ behavior: "smooth", block: "center" }) };
      case "transition":
        return next.target ? { label: next.label, onClick: () => void patch({ status: next.target }) } : null;
      default:
        return null;
    }
  })();

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto space-y-6 pb-10">
        <Link href="/jobs" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900">
          <ArrowLeft className="h-4 w-4" /> Jobs
        </Link>

        {/* HEADER — customer, property, service, date, status */}
        <header className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-mono font-semibold text-zinc-500 break-all">{job.jobNumber ?? job.id}</div>
              <h1 className="text-2xl sm:text-3xl font-semibold text-zinc-950 mt-1">{customer?.name ?? job.customerName ?? "Customer"}</h1>
            </div>
            <JobStatusBadge status={job.status} />
          </div>
          <dl className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <HeaderItem icon={<Sparkles className="h-4 w-4" />} label="Service" value={job.service?.name ?? "Service"} />
            <HeaderItem icon={<MapPin className="h-4 w-4" />} label="Property" value={property ? `${property.title}${property.address ? ` — ${property.address}` : ""}` : job.propertyTitle ?? "—"} />
            <HeaderItem icon={<CalendarDays className="h-4 w-4" />} label="Date" value={`${formatDate(job.scheduledDate)} · ${formatTimeSlot(job.scheduledTimeSlot)}`} />
          </dl>
          {!cancelled && can("links.manage") && (
            <div className="mt-5">
              <JobQrButton jobId={job.id} jobNumber={job.jobNumber} customerName={customer?.name ?? job.customerName} className="w-full sm:w-auto" />
            </div>
          )}
        </header>

        {/* JOB JOURNEY */}
        <section className="rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-4">Job journey</h2>
          <JobJourney status={job.status} />
        </section>

        {/* CURRENT STATUS + NEXT ACTION */}
        <section className="rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Current status</div>
              <div className="mt-1.5"><JobStatusBadge status={job.status} /></div>
              <p className="text-sm text-zinc-600 mt-2">{config?.shortDescription}</p>
            </div>
          </div>
          <NextActionCard action={next} onAction={primary?.onClick} busy={busy} />
          {error && <div className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</div>}
          {!terminal && can("jobs.assign") && (
            <div className="mt-4 pt-4 border-t border-zinc-100 flex flex-wrap gap-2 text-sm">
              {["DRAFT", "SCHEDULED", "ASSIGNED"].includes(job.status) && (
                <>
                  <SmallButton onClick={openAssign} icon={<UserPlus className="h-4 w-4" />}>{manager ? "Change Field Manager" : "Assign Field Manager"}</SmallButton>
                  <SmallButton onClick={openReschedule} icon={<CalendarDays className="h-4 w-4" />}>Reschedule</SmallButton>
                </>
              )}
              {["DRAFT", "SCHEDULED", "ASSIGNED", "ARRIVED"].includes(job.status) && can("jobs.cancel") && (
                <SmallButton onClick={() => setCancelOpen(true)} icon={<XCircle className="h-4 w-4" />} danger>Cancel job</SmallButton>
              )}
            </div>
          )}
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3 space-y-6">
            {/* Customer issues */}
            {openComplaints.length > 0 && (
              <section className="rounded-2xl border border-red-200 bg-white p-6 shadow-sm space-y-3">
                <h2 className="text-base font-semibold text-red-800 flex items-center gap-2"><AlertTriangle className="h-5 w-5" /> Customer issue</h2>
                {openComplaints.map((c) => (
                  <div key={c.id} className="rounded-2xl bg-red-50 p-4 space-y-2">
                    <div className="text-sm text-red-900">{c.description}</div>
                    <div className="text-xs text-red-700">{formatDateTime(c.createdAt)}</div>
                    {can("complaints.manage") && (
                      <button onClick={() => setResolving(c.id)} className="h-9 px-3 rounded-lg bg-white border border-red-200 text-sm font-semibold text-red-700">Mark resolved</button>
                    )}
                  </div>
                ))}
              </section>
            )}

            {/* Quality */}
            {(lastQc || openRework.length > 0) && (
              <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm space-y-3">
                <h2 className="text-base font-semibold text-zinc-900">Quality</h2>
                {lastQc && (
                  <div className={cn("text-sm font-semibold inline-flex items-center gap-1.5", lastQc.status === "PASS" ? "text-emerald-700" : "text-amber-800")}>
                    {lastQc.status === "PASS" ? <CheckCircle2 className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
                    {lastQc.status === "PASS" ? "QC passed" : "Rework required"} · {lastQc.inspectedAt ? timeAgo(lastQc.inspectedAt) : ""}
                  </div>
                )}
                {issues.length > 0 && (
                  <ul className="space-y-1.5">
                    {issues.map((i) => (
                      <li key={i.id} className="flex items-start justify-between gap-2 text-sm">
                        <span><strong>{i.area}:</strong> {i.itemDescription}{i.notes && i.notes !== i.itemDescription ? ` — ${i.notes}` : ""}</span>
                        <span className={cn("shrink-0 px-2 py-0.5 rounded-lg text-xs font-semibold", i.status === "resolved" || i.status === "reinspected_pass" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800")}>
                          {i.status === "resolved" ? "Fixed" : i.status === "reinspected_pass" ? "Passed" : "Open"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {can("qc.inspect") && ["WORK_COMPLETED", "QUALITY_CHECK", "REWORK_COMPLETED", "REINSPECTION"].includes(job.status) && (
                  <Link href={`/quality-queue/${job.id}`} className="inline-flex items-center gap-1 text-sm font-semibold text-rose-600">Open quality check <ChevronRight className="h-4 w-4" /></Link>
                )}
              </section>
            )}

            {/* Photos / evidence */}
            <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm space-y-4">
              <h2 className="text-base font-semibold text-zinc-900">Photos</h2>
              {jobPhotos.length === 0 ? (
                <p className="text-sm text-zinc-500">No photos yet. The Field Manager adds before / after photos on site.</p>
              ) : (
                areas.map((a) => {
                  const list = jobPhotos.filter((p) => p.area === a);
                  if (list.length === 0) return null;
                  return (
                    <div key={a} className="space-y-2">
                      <div className="text-sm font-semibold text-zinc-700">{a}</div>
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {list.map((p) => <PhotoThumb key={p.id} photo={p} />)}
                      </div>
                    </div>
                  );
                })
              )}
            </section>

            {/* Activity timeline */}
            <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
              <h2 className="text-base font-semibold text-zinc-900 mb-4">Activity</h2>
              {events.length === 0 ? (
                <p className="text-sm text-zinc-500">No activity yet.</p>
              ) : (
                <ol className="relative border-l border-zinc-200 ml-2 space-y-4">
                  {events.map((e) => (
                    <li key={e.id} className="pl-5 relative">
                      <span className={cn("absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full", e.type === "REWORK_ASSIGNED" || e.type === "ATTENTION_REQUESTED" ? "bg-amber-500" : e.type === "CUSTOMER_SIGNED" || e.type === "QC_SUBMITTED" ? "bg-emerald-500" : "bg-zinc-300")} />
                      <div className="text-sm text-zinc-800">{e.message}</div>
                      <div className="text-xs text-zinc-400 mt-0.5">
                        {e.actorRole === "customer" ? "Customer" : e.actorName} · {formatDateTime(e.createdAt)}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>

          {/* DETAILS */}
          <aside className="lg:col-span-2 space-y-6">
            {!cancelled && can("links.manage") && (
              <div id="customer-link">
                <CustomerLinkCard jobId={job.id} highlight={next?.kind === "handover"} />
              </div>
            )}

            <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm space-y-4">
              <h2 className="text-base font-semibold text-zinc-900">Details</h2>
              <Detail icon={<User className="h-4 w-4" />} label="Customer" value={customer?.name ?? job.customerName ?? "—"} href={customer ? `/customers/${customer.id}` : undefined} />
              {(customer?.phone || job.customerPhone) && <Detail icon={<Phone className="h-4 w-4" />} label="Phone" value={customer?.phone ?? job.customerPhone ?? ""} href={`tel:${customer?.phone ?? job.customerPhone}`} />}
              <Detail icon={<UserPlus className="h-4 w-4" />} label="Field Manager" value={manager?.name ?? "Not assigned"} />
              {property?.accessNotes && <Detail icon={<MapPin className="h-4 w-4" />} label="Access notes" value={property.accessNotes} />}
              <Detail icon={<CheckCircle2 className="h-4 w-4" />} label="Checklist" value={checklist.length ? `${checklist.filter((c) => done(c.status)).length} of ${checklist.length} done` : "No checklist"} />
              {job.notes && <Detail icon={<Sparkles className="h-4 w-4" />} label="Work notes" value={job.notes} />}
              {job.arrivedAt && <Detail icon={<MapPin className="h-4 w-4" />} label="Arrived" value={formatDateTime(job.arrivedAt)} />}
              {job.approvedAt && <Detail icon={<CheckCircle2 className="h-4 w-4" />} label="Customer approved" value={formatDateTime(job.approvedAt)} />}
              {job.customerFeedbackRating ? (
                <Detail icon={<Star className="h-4 w-4" />} label="Rating" value={`${"★".repeat(job.customerFeedbackRating)}${"☆".repeat(5 - job.customerFeedbackRating)}${job.googleReviewClicked ? " · Google review opened" : ""}`} />
              ) : null}
            </section>

            <JobHubCards job={job} property={property} canEdit={!cancelled && can("jobs.assign")} />

            {can("finance.view") && (
              <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-zinc-900">Invoice</h2>
                  {invoice && <InvoiceTypeBadge type={invoice.invoiceType} />}
                </div>
                <div className="text-2xl font-semibold text-zinc-950">{formatMoney(invoice?.total ?? job.amount ?? 0)}</div>
                {invoice ? (
                  <div className="text-sm text-zinc-600 break-words">
                    <span className="font-mono">{invoice.invoiceNumber}</span> · {invoice.balanceDue > 0 ? <span className="text-amber-700 font-semibold">{formatMoney(invoice.balanceDue)} due</span> : <span className="text-emerald-700 font-semibold">Paid</span>}
                  </div>
                ) : (
                  <div className="text-sm text-zinc-500">No invoice yet.</div>
                )}
                <Link href={invoice ? `/invoices/${invoice.id}` : "/invoices"} className="inline-flex items-center gap-1 text-sm font-semibold text-rose-600 min-h-10">{invoice ? "Open invoice" : "Invoices"} <ChevronRight className="h-4 w-4" /></Link>
              </section>
            )}
          </aside>
        </div>
      </div>

      {/* Assign Field Manager */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="sm:rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Assign Field Manager</DialogTitle>
          </DialogHeader>
          {managers.length === 0 ? (
            <p className="text-sm text-zinc-500">No active Field Managers. Add one on the Users page.</p>
          ) : (
            <div className="space-y-2">
              {managers.map((m) => {
                const busyThen = jobs.some((j) => j.id !== job.id && j.scheduledDate === job.scheduledDate && j.scheduledTimeSlot === job.scheduledTimeSlot && !["COMPLETED", "CLOSED", "CANCELLED", "FEEDBACK_REQUESTED"].includes(j.status) && (j.assignedManagerId === m.id || j.assignedStaffIds.includes(m.id)));
                return (
                  <button key={m.id} type="button" onClick={() => setPickedManager(m.id)} className={cn("w-full h-14 px-4 rounded-xl border flex items-center justify-between text-left", pickedManager === m.id ? "border-rose-500 bg-rose-50" : "border-zinc-200 hover:bg-zinc-50")}>
                    <span className="text-sm font-semibold text-zinc-900">{m.name}</span>
                    <span className={cn("text-xs font-semibold", busyThen ? "text-amber-700" : "text-emerald-700")}>{busyThen ? "Busy at this time" : "Free"}</span>
                  </button>
                );
              })}
            </div>
          )}
          {error && <div className="text-sm text-red-700">{error}</div>}
          <div className="flex gap-2 pt-2">
            {(job.assignedManagerId || job.assignedStaffIds.length > 0) && (
              <button disabled={busy} onClick={() => void patch({ assignedManagerId: null, assignedStaffIds: [] }, () => setAssignOpen(false))} className="h-12 px-4 rounded-xl border border-zinc-200 text-sm font-semibold text-zinc-600">Unassign</button>
            )}
            <button disabled={busy || !pickedManager} onClick={() => void patch({ assignedManagerId: pickedManager, assignedStaffIds: [] }, () => setAssignOpen(false))} className="flex-1 h-12 rounded-xl bg-rose-500 text-white text-sm font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Assign
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reschedule */}
      <Dialog open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
        <DialogContent className="sm:rounded-2xl">
          <DialogHeader>
            <DialogTitle>{job.status === "DRAFT" ? "Schedule job" : "Reschedule"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-zinc-700">Date</span>
              <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="w-full h-11 rounded-xl border border-zinc-200 px-3 text-sm" />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-zinc-700">Time window</span>
              <input value={newSlot} onChange={(e) => setNewSlot(e.target.value)} placeholder="09:00 - 13:00" className="w-full h-11 rounded-xl border border-zinc-200 px-3 text-sm" />
            </label>
            {error && <div className="text-sm text-red-700">{error}</div>}
            <button
              disabled={busy || !newDate || !newSlot}
              onClick={async () => {
                const ok = await patch({ scheduledDate: newDate, scheduledTimeSlot: newSlot });
                if (ok && job.status === "DRAFT") await patch({ status: "SCHEDULED" });
                if (ok) setRescheduleOpen(false);
              }}
              className="w-full h-12 rounded-xl bg-rose-500 text-white text-sm font-semibold disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <PromptModal
        isOpen={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel this job?"
        description="The Field Manager and customer link stop working for this job. Tell us why (saved on the job)."
        placeholder="Reason"
        confirmText="Cancel job"
        onSubmit={(reason) => {
          setCancelOpen(false);
          void patch({ status: "CANCELLED", reason });
        }}
      />

      <PromptModal
        isOpen={!!resolving}
        onClose={() => setResolving(null)}
        title="Mark customer issue resolved"
        description="What was done? (optional, saved on the job)"
        placeholder="e.g. Re-cleaned the balcony, customer happy"
        confirmText="Mark resolved"
        onSubmit={async (notes) => {
          const id = resolving;
          setResolving(null);
          if (!id) return;
          const res = await fetch("/api/quality", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "resolve-complaint", complaintId: id, notes }) });
          if (!res.ok) setError("Could not mark the issue resolved.");
          await refreshQuality();
        }}
      />
    </AdminLayout>
  );
}

function HeaderItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 min-w-0">
      <span className="h-9 w-9 rounded-xl bg-zinc-100 text-zinc-500 flex items-center justify-center shrink-0">{icon}</span>
      <div className="min-w-0">
        <dt className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">{label}</dt>
        <dd className="text-sm font-medium text-zinc-900 break-words">{value}</dd>
      </div>
    </div>
  );
}

function Detail({ icon, label, value, href }: { icon: React.ReactNode; label: string; value: string; href?: string }) {
  const body = <span className="text-sm text-zinc-900 break-words">{value}</span>;
  return (
    <div className="flex items-start gap-3">
      <span className="h-8 w-8 rounded-lg bg-zinc-100 text-zinc-500 flex items-center justify-center shrink-0">{icon}</span>
      <div className="min-w-0">
        <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">{label}</div>
        {href ? <a href={href} className="text-sm font-medium text-rose-600 break-words">{value}</a> : body}
      </div>
    </div>
  );
}

function SmallButton({ children, onClick, icon, danger }: { children: React.ReactNode; onClick: () => void; icon: React.ReactNode; danger?: boolean }) {
  return (
    <button onClick={onClick} className={cn("h-10 px-3.5 rounded-xl border text-sm font-semibold inline-flex items-center gap-2 transition-colors", danger ? "border-red-200 text-red-700 hover:bg-red-50" : "border-zinc-200 text-zinc-700 hover:bg-zinc-50")}>
      {icon} {children}
    </button>
  );
}

const PHOTO_LABEL: Record<JobPhoto["photoType"], string> = { before: "Before", after: "After", qc: "QC", rework: "Rework" };

function PhotoThumb({ photo }: { photo: JobPhoto }) {
  return (
    <a href={photo.photoUrl} target="_blank" rel="noreferrer" className="relative shrink-0 group">
      <img src={photo.thumbnailUrl || photo.photoUrl} alt={`${photo.area} ${photo.photoType}`} className="h-28 w-28 rounded-xl object-cover group-hover:opacity-90" loading="lazy" />
      <span className={cn("absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md text-xs font-bold text-white", photo.photoType === "before" ? "bg-zinc-900/80" : photo.photoType === "after" ? "bg-emerald-600" : photo.photoType === "qc" ? "bg-amber-600" : "bg-rose-500")}>
        {PHOTO_LABEL[photo.photoType]}
      </span>
    </a>
  );
}
