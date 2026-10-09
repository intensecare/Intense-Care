"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Navigation,
  Phone,
  MapPin,
  CheckCircle2,
  Circle,
  ChevronDown,
  ChevronRight,
  Camera,
  AlertTriangle,
  Check,
  Loader2,
  ShieldCheck,
  Clock,
  Play,
  Send,
  Plus,
  Trash2,
  Briefcase,
  ListChecks,
  Sparkles,
  User,
  ScanLine,
} from "lucide-react";
import { useApp } from "@/lib/app-context";
import { MobileLayout, ProfilePanel } from "@/components/common/MobileLayout";
import { StatusBadge } from "@/components/common/JobStatusBadge";
import { PromptModal } from "@/components/common/PromptModal";
import { TeamCard } from "@/components/job/TeamCard";
import { FieldExpense } from "@/components/field/FieldExpense";
import { QrScanner } from "@/components/common/QrScanner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/button";
import { Notice, SkeletonList, Skeleton } from "@/components/ui/states";
import { compressImageForUpload } from "@/lib/image-compress";
import { formatTimeSlot, formatDate, cn } from "@/lib/utils";
import { getNextAction } from "@/lib/rbac";
import { REWORK_STATUSES } from "@/lib/status";
import type { Job, JobPhoto } from "@/lib/types";

type FieldJob = Job & { customerName?: string; customerPhone?: string; propertyTitle?: string; service?: { name: string } };

const DONE = ["COMPLETED", "FEEDBACK_REQUESTED", "CLOSED"];
const startTime = (slot: string) => formatTimeSlot(slot).split(" - ")[0];
const addressOf = (j: FieldJob) => (j.propertyTitle ?? "").split(" - ").slice(1).join(" - ") || j.propertyTitle || "";
const mapsUrl = (j: FieldJob) =>
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(typeof j.locationLat === "number" && typeof j.locationLng === "number" ? `${j.locationLat},${j.locationLng}` : addressOf(j))}`;

/* ========================================================================= */
/* Field Manager job steps                                                    */
/* ========================================================================= */

const FM_STEPS = ["Scheduled", "Arrived", "Confirmed", "In Progress", "Completed", "QC"] as const;

function fmStep(status: string): number {
  if (["DRAFT", "SCHEDULED", "ASSIGNED"].includes(status)) return 0;
  if (status === "ARRIVED") return 1;
  if (status === "CUSTOMER_VERIFIED") return 2;
  if (status === "IN_PROGRESS" || REWORK_STATUSES.includes(status)) return 3;
  if (status === "WORK_COMPLETED") return 4;
  if (["QUALITY_CHECK", "REWORK_COMPLETED", "REINSPECTION"].includes(status)) return 5;
  return 6; // passed / approval / completed
}

function MiniJourney({ status }: { status: string }) {
  const at = fmStep(status);
  const rework = REWORK_STATUSES.includes(status);
  const done = at >= FM_STEPS.length;
  const label = done ? "Done ✓" : rework ? "Rework" : FM_STEPS[at];
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <span className="text-sm font-semibold text-zinc-950">{label}</span>
        <span className="text-xs text-zinc-500">{done ? `${FM_STEPS.length} of ${FM_STEPS.length}` : `Step ${at + 1} of ${FM_STEPS.length}`}</span>
      </div>
      <ol className="grid grid-cols-6 gap-1" aria-label="Job progress">
        {FM_STEPS.map((l, i) => (
          <li key={l} className={cn("h-2 rounded-full transition-colors duration-500", i < at ? "bg-emerald-500" : i === at ? (rework ? "bg-amber-500" : "bg-rose-500") : "bg-zinc-200")}>
            <span className="sr-only">{l}{i < at ? " — done" : i === at ? " — current" : ""}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ========================================================================= */
/* Job screen                                                                 */
/* ========================================================================= */

export function FieldJobFlow({ jobId }: { jobId: string }) {
  const { jobs, checklistItems, photos, reworkTasks, qualityIssues, currentUser, loading, refreshJobs, refreshQuality, refreshPhotos, updateChecklistItem, addJobPhoto, deleteJobPhoto, completeReworkTask } = useApp();
  const job = jobs.find((j) => j.id === jobId) as FieldJob | undefined;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [gps, setGps] = useState<"ready" | "searching" | "unavailable" | "verified">("ready");
  const [bypassOpen, setBypassOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [screen, setScreen] = useState<"checklist" | "photos">("checklist");
  const [openArea, setOpenArea] = useState<string | null>(null);
  const [target, setTarget] = useState<{ area: string; type: JobPhoto["photoType"] } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [removePhoto, setRemovePhoto] = useState<JobPhoto | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [fixed, setFixed] = useState<Record<string, boolean>>({});
  const cameraRef = useRef<HTMLInputElement>(null);

  // Live: the customer confirming or QC deciding shows up within seconds.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      void refreshJobs();
      void refreshQuality();
      void refreshPhotos();
    };
    const i = setInterval(tick, 8000);
    return () => clearInterval(i);
  }, [refreshJobs, refreshQuality, refreshPhotos]);

  const checklist = useMemo(() => checklistItems.filter((c) => c.jobId === jobId), [checklistItems, jobId]);
  const jobPhotos = useMemo(() => photos.filter((p) => p.jobId === jobId), [photos, jobId]);
  const openRework = useMemo(() => reworkTasks.filter((t) => t.jobId === jobId && t.status !== "completed"), [reworkTasks, jobId]);
  const jobIssues = useMemo(() => qualityIssues.filter((i) => i.jobId === jobId), [qualityIssues, jobId]);
  const areas = useMemo(() => [...Array.from(new Set(checklist.map((c) => c.area))), "Other"], [checklist]);

  useEffect(() => {
    if (job && notes === null) setNotes(job.notes ?? "");
  }, [job, notes]);

  const isDone = (s: string) => s === "completed" || s === "skipped";
  const mandatory = checklist.filter((c) => c.critical);
  const tracked = mandatory.length ? mandatory : checklist;
  const doneCount = checklist.filter((c) => isDone(c.status)).length;
  const checklistComplete = tracked.every((c) => isDone(c.status));
  const before = jobPhotos.filter((p) => p.photoType === "before").length;
  const after = jobPhotos.filter((p) => p.photoType === "after").length;

  // Open the first unfinished room automatically.
  useEffect(() => {
    if (openArea !== null || checklist.length === 0) return;
    const first = checklist.find((c) => c.status !== "completed" && c.status !== "skipped");
    setOpenArea(first?.area ?? checklist[0].area);
  }, [checklist, openArea]);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3500);
  };

  const patch = async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    if (!res) return { ok: false, status: 0, error: "You're offline. Try again when the connection returns." };
    const json = await res.json().catch(() => null);
    return { ok: res.ok && json?.success, status: res.status, error: json?.error as string | undefined };
  };

  const locate = (): Promise<{ lat: number; lng: number; accuracy: number } | null> =>
    new Promise((resolve) => {
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        setGps("unavailable");
        resolve(null);
        return;
      }
      setGps("searching");
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setGps("ready");
          resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
        },
        () => {
          setGps("unavailable");
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
      );
    });

  /**
   * Arrival: GPS first. If GPS can't confirm it, the Field Manager scans the
   * customer's secure QR; if that's impossible too, they continue with a
   * reason. The method (GPS / QR / reason) is saved in the job's activity log.
   */
  const arrive = async (opts: { bypassReason?: string; qrToken?: string } = {}) => {
    setBusy(true);
    setError(null);
    const coords = opts.bypassReason || opts.qrToken ? null : await locate();
    const r = await patch({ status: "ARRIVED", arrival: { ...(coords ?? {}), ...(opts.bypassReason ? { bypassReason: opts.bypassReason } : {}), ...(opts.qrToken ? { qrToken: opts.qrToken } : {}) } });
    setBusy(false);
    if (!r.ok) {
      if (r.status === 409 && !opts.bypassReason) {
        setError(r.error ?? "We couldn't confirm your location.");
        setVerifyOpen(true);
        return;
      }
      setError(r.error ?? "Could not record your arrival.");
      return;
    }
    setGps(coords || opts.qrToken ? "verified" : "ready");
    flash(opts.qrToken ? "Location verified by QR ✓ Arrival recorded." : "Arrival recorded ✓ The customer has been sent the link.");
    await refreshJobs();
  };

  const transition = async (status: string, ok: string) => {
    setBusy(true);
    setError(null);
    const r = await patch({ status });
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? "That didn't go through. Try again.");
      return;
    }
    flash(ok);
    setScreen("checklist");
    window.scrollTo({ top: 0, behavior: "smooth" });
    await refreshJobs();
  };

  const completeWork = async () => {
    if (notes !== null && notes !== (job?.notes ?? "")) {
      const saved = await patch({ notes });
      if (!saved.ok) {
        setError(saved.error ?? "Could not save your notes.");
        return;
      }
    }
    await transition("WORK_COMPLETED", "Work completed ✓ Waiting for QC.");
  };

  const toggleItem = async (id: string, done: boolean) => {
    const r = await updateChecklistItem(id, done ? "pending" : "completed");
    if (!r.success) setError(r.message);
  };

  const camera = (area: string, type: JobPhoto["photoType"]) => {
    setTarget({ area, type });
    cameraRef.current?.click();
  };

  const onPhotoPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !job || !target) return;
    setUploading(true);
    setError(null);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const prepared = await compressImageForUpload(String(ev.target?.result ?? ""));
      const r = await addJobPhoto({ jobId: job.id, area: target.area, photoType: target.type, imageDataUrl: prepared.dataUrl });
      setUploading(false);
      if (!r.success) setError(r.message);
      else flash(`Photo saved ✓ ${target.area}`);
    };
    reader.readAsDataURL(file);
  };

  const submitRework = async () => {
    setBusy(true);
    setError(null);
    for (const t of openRework) {
      const r = await completeReworkTask(t.id, "Fixed on site.");
      if (!r.success) {
        setBusy(false);
        setError(r.message);
        return;
      }
    }
    setBusy(false);
    setFixed({});
    flash("Rework submitted ✓ Waiting for QC.");
    await refreshJobs();
    await refreshQuality();
  };

  if (!job) {
    return (
      <MobileLayout title="Job" subtitle="My Jobs" backHref="/my-jobs">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-48 rounded-2xl" />
            <Skeleton className="h-20 rounded-2xl" />
            <Skeleton className="h-28 rounded-2xl" />
          </div>
        ) : (
          <EmptyState icon={Briefcase} title="Job not found" description="This job isn't assigned to you or no longer exists." />
        )}
      </MobileLayout>
    );
  }

  const inRework = REWORK_STATUSES.includes(job.status) && openRework.length > 0;
  const fixedCount = openRework.filter((t) => fixed[t.id]).length;
  const canEditPhotos = job.status === "IN_PROGRESS" || inRework;
  const confirmed = job.status === "CUSTOMER_VERIFIED" || (job.status === "ARRIVED" && !!job.customerConfirmedAt);
  const step = fmStep(job.status);

  /* ------------------------------------------------ the ONE sticky action */
  const cta = (() => {
    if (job.status === "SCHEDULED" || job.status === "ASSIGNED") {
      return <Button size="lg" className="w-full" loading={busy} onClick={() => void arrive()}><MapPin className="h-5 w-5" aria-hidden /> I&apos;M HERE</Button>;
    }
    if (job.status === "ARRIVED" && !job.customerConfirmedAt) {
      return <Button size="lg" variant="secondary" className="w-full" disabled><Clock className="h-5 w-5 animate-pulse" aria-hidden /> WAITING FOR CUSTOMER</Button>;
    }
    if (confirmed) {
      return <Button size="lg" className="w-full" loading={busy} onClick={() => void transition("IN_PROGRESS", "Service started ✓")}><Play className="h-5 w-5" aria-hidden /> START SERVICE</Button>;
    }
    if (job.status === "IN_PROGRESS") {
      if (screen === "checklist") {
        return checklistComplete ? (
          <Button size="lg" className="w-full" onClick={() => { setScreen("photos"); window.scrollTo({ top: 0, behavior: "smooth" }); }}><Camera className="h-5 w-5" aria-hidden /> TAKE PHOTOS</Button>
        ) : (
          <Button size="lg" className="w-full" onClick={() => document.getElementById("checklist")?.scrollIntoView({ behavior: "smooth" })}>
            CONTINUE CHECKLIST · {tracked.filter((c) => isDone(c.status)).length}/{tracked.length}
          </Button>
        );
      }
      return before > 0 && after > 0 ? (
        <Button size="lg" variant="success" className="w-full" loading={busy} onClick={() => void completeWork()}><CheckCircle2 className="h-5 w-5" aria-hidden /> COMPLETE WORK</Button>
      ) : (
        <Button size="lg" variant="secondary" className="w-full" disabled>Add a before and an after photo</Button>
      );
    }
    if (inRework) {
      return (
        <Button size="lg" className="w-full bg-amber-500 hover:bg-amber-600" disabled={fixedCount < openRework.length} loading={busy} onClick={() => void submitRework()}>
          <Send className="h-5 w-5" aria-hidden /> {fixedCount < openRework.length ? `MARK ITEMS FIXED · ${fixedCount}/${openRework.length}` : "SUBMIT FOR QC"}
        </Button>
      );
    }
    return undefined;
  })();

  /* ------------------------------------------------------- current step */
  const current = (() => {
    if (job.status === "SCHEDULED" || job.status === "ASSIGNED")
      return { tone: "neutral", icon: <Navigation className="h-6 w-6" aria-hidden />, title: "Go to the property", body: "Tap Navigate. When you arrive, tap I'M HERE — we check your GPS location." };
    if (job.status === "ARRIVED" && !job.customerConfirmedAt)
      return { tone: "waiting", icon: <Clock className="h-6 w-6 animate-pulse" aria-hidden />, title: "Customer confirmation", body: "GPS verified ✓ Waiting for the customer to confirm on their phone…" };
    if (confirmed) return { tone: "success", icon: <ShieldCheck className="h-6 w-6" aria-hidden />, title: "Customer confirmed ✓", body: "You can start the service now." };
    if (["WORK_COMPLETED", "QUALITY_CHECK"].includes(job.status)) return { tone: "success", icon: <CheckCircle2 className="h-6 w-6" aria-hidden />, title: "Work completed ✓", body: "Waiting for QC. You'll be notified if anything needs fixing." };
    if (["REWORK_COMPLETED", "REINSPECTION"].includes(job.status) || (REWORK_STATUSES.includes(job.status) && openRework.length === 0))
      return { tone: "success", icon: <CheckCircle2 className="h-6 w-6" aria-hidden />, title: "Rework submitted ✓", body: "Waiting for QC to check again." };
    if (["PASS", "CUSTOMER_APPROVAL"].includes(job.status)) return { tone: "success", icon: <CheckCircle2 className="h-6 w-6" aria-hidden />, title: "QC passed ✓", body: "Waiting for the customer to approve." };
    if (DONE.includes(job.status)) return { tone: "success", icon: <CheckCircle2 className="h-6 w-6" aria-hidden />, title: "Job completed ✓", body: "The customer approved the service. Great work!" };
    if (job.status === "CANCELLED") return { tone: "neutral", icon: <AlertTriangle className="h-6 w-6" aria-hidden />, title: "Job cancelled", body: "Nothing to do here." };
    return null;
  })();

  return (
    <MobileLayout title={job.jobNumber ?? "Job"} subtitle="My Jobs" backHref="/my-jobs" gps={step === 0 ? gps : step === 1 ? "verified" : undefined} action={cta}>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPhotoPicked} aria-hidden tabIndex={-1} />

      {toast && <Notice tone="success">{toast}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      {/* Header — who, where, what, when */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-3xl font-semibold text-zinc-950 leading-none">{startTime(job.scheduledTimeSlot)}</div>
            <div className="text-sm text-zinc-500 mt-1.5">{formatDate(job.scheduledDate)}</div>
          </div>
          <StatusBadge status={job.status} />
        </div>
        <dl className="space-y-2">
          <Row icon={<Sparkles className="h-5 w-5" aria-hidden />} label="Service" value={job.service?.name ?? "Service"} strong />
          <Row icon={<User className="h-5 w-5" aria-hidden />} label="Customer" value={job.customerName ?? "Customer"} />
          <Row icon={<MapPin className="h-5 w-5" aria-hidden />} label="Property" value={job.propertyTitle ?? "Property"} />
        </dl>
        {!DONE.includes(job.status) && job.status !== "CANCELLED" && (
          <div className="grid grid-cols-2 gap-2">
            <a href={mapsUrl(job)} target="_blank" rel="noreferrer" className="h-12 rounded-xl bg-zinc-900 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 active:scale-[0.98] transition-transform">
              <Navigation className="h-5 w-5" aria-hidden /> NAVIGATE
            </a>
            {job.customerPhone ? (
              <a href={`tel:${job.customerPhone}`} className="h-12 rounded-xl border border-zinc-300 bg-white text-zinc-900 text-sm font-semibold inline-flex items-center justify-center gap-2 active:scale-[0.98] transition-transform">
                <Phone className="h-5 w-5 text-emerald-600" aria-hidden /> CALL
              </a>
            ) : (
              <span className="h-12 rounded-xl bg-zinc-50 border border-zinc-200 text-zinc-400 text-sm inline-flex items-center justify-center">No phone</span>
            )}
          </div>
        )}
      </section>

      {job.status !== "CANCELLED" && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-4">
          <MiniJourney status={job.status} />
        </section>
      )}

      {job.status !== "CANCELLED" && <TeamCard jobId={job.id} jobDate={job.scheduledDate} mode="field" />}
      {job.status !== "CANCELLED" && <FieldExpense jobId={job.id} jobDate={job.scheduledDate} />}

      {/* CURRENT STEP */}
      {current && job.status !== "IN_PROGRESS" && !inRework && (
        <section className={cn("rounded-2xl border p-5 animate-in fade-in", current.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : current.tone === "waiting" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-zinc-200 bg-white text-zinc-900")}>
          <div className="text-xs font-semibold uppercase tracking-wide opacity-70">Current step</div>
          <div className="mt-1 flex items-center gap-2 text-lg font-semibold">{current.icon} {current.title}</div>
          <p className="mt-1 text-base opacity-90">{current.body}</p>
        </section>
      )}

      {/* IN PROGRESS — two steps */}
      {job.status === "IN_PROGRESS" && (
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-zinc-100 p-1" role="tablist" aria-label="Work steps">
          {(["checklist", "photos"] as const).map((s) => (
            <button key={s} role="tab" aria-selected={screen === s} onClick={() => setScreen(s)} className={cn("h-11 rounded-lg text-sm font-semibold transition-colors", screen === s ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-600")}>
              {s === "checklist" ? `1. Checklist ${doneCount}/${checklist.length}` : `2. Photos · ${before + after}`}
            </button>
          ))}
        </div>
      )}

      {/* CHECKLIST — collapsible rooms, big rows */}
      {job.status === "IN_PROGRESS" && screen === "checklist" && (
        <section id="checklist" className="space-y-3">
          <div className="rounded-2xl border border-zinc-200 bg-white p-4">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-base font-semibold text-zinc-950">Checklist</span>
              <span className="text-sm text-zinc-600"><strong className="text-zinc-950">{doneCount}</strong> / {checklist.length} completed</span>
            </div>
            <div className="mt-3 h-2 rounded-full bg-zinc-100 overflow-hidden" role="progressbar" aria-label="Checklist progress" aria-valuemin={0} aria-valuemax={checklist.length} aria-valuenow={doneCount}>
              <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${checklist.length ? (doneCount / checklist.length) * 100 : 100}%` }} />
            </div>
          </div>
          {checklist.length === 0 && <EmptyState icon={ListChecks} title="No checklist" description="This service has no checklist. Go straight to photos." />}
          {Array.from(new Set(checklist.map((c) => c.area))).map((area) => {
            const items = checklist.filter((c) => c.area === area);
            const done = items.filter((c) => isDone(c.status)).length;
            const open = openArea === area;
            return (
              <div key={area} className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
                <button onClick={() => setOpenArea(open ? "" : area)} aria-expanded={open} className="w-full min-h-[56px] px-4 flex items-center gap-3 text-left">
                  <span className={cn("h-8 w-8 rounded-full flex items-center justify-center shrink-0", done === items.length ? "bg-emerald-500 text-white" : "bg-zinc-100 text-zinc-600")}>
                    {done === items.length ? <Check className="h-5 w-5" aria-hidden /> : <span className="text-xs font-semibold">{done}</span>}
                  </span>
                  <span className="flex-1 text-sm font-semibold text-zinc-950 uppercase tracking-wide">{area}</span>
                  <span className="text-sm text-zinc-500">{done}/{items.length}</span>
                  <ChevronDown className={cn("h-5 w-5 text-zinc-400 transition-transform", open && "rotate-180")} aria-hidden />
                </button>
                {open && (
                  <ul className="border-t border-zinc-100 divide-y divide-zinc-100">
                    {items.map((item) => {
                      const d = isDone(item.status);
                      return (
                        <li key={item.id}>
                          <button onClick={() => void toggleItem(item.id, d)} role="checkbox" aria-checked={d} className="w-full min-h-[56px] px-4 py-2 flex items-center gap-3 text-left active:bg-zinc-50">
                            <span className={cn("h-8 w-8 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors", d ? "bg-emerald-500 border-emerald-500 text-white" : "border-zinc-300 text-transparent")}>
                              {d ? <Check className="h-5 w-5" aria-hidden /> : <Circle className="h-3 w-3" aria-hidden />}
                            </span>
                            <span className="flex-1">
                              <span className={cn("block text-base", d ? "text-zinc-500 line-through" : "text-zinc-900")}>{item.task}</span>
                              {item.critical && !d && <span className="text-xs font-semibold text-rose-600">Required</span>}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </section>
      )}

      {/* PHOTOS — camera first, by room */}
      {job.status === "IN_PROGRESS" && screen === "photos" && (
        <section className="space-y-3">
          {areas.map((area) => (
            <div key={area} className="rounded-2xl border border-zinc-200 bg-white p-4 space-y-3">
              <div className="text-sm font-semibold text-zinc-950 uppercase tracking-wide">{area}</div>
              {(["before", "after"] as const).map((type) => (
                <PhotoRow
                  key={type}
                  label={type === "before" ? "Before" : "After"}
                  photos={jobPhotos.filter((p) => p.area === area && p.photoType === type)}
                  busy={uploading && target?.area === area && target?.type === type}
                  onTake={() => camera(area, type)}
                  onRemove={canEditPhotos ? (p) => setRemovePhoto(p) : undefined}
                  mine={(p) => p.uploadedBy === currentUser.name}
                />
              ))}
            </div>
          ))}
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 space-y-2">
            <label htmlFor="work-notes" className="text-sm font-semibold text-zinc-950">Notes for QC <span className="font-normal text-zinc-500">(optional)</span></label>
            <textarea id="work-notes" value={notes ?? ""} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Anything QC or the office should know…" className="w-full rounded-xl border border-zinc-300 px-3.5 py-3 text-base" />
          </div>
        </section>
      )}

      {/* REWORK — inside My Jobs, same Job ID */}
      {inRework && (
        <section className="space-y-3">
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-amber-800">Current step</div>
            <div className="mt-1 text-lg font-semibold text-amber-950 flex items-center gap-2"><AlertTriangle className="h-5 w-5" aria-hidden /> Rework required</div>
            <p className="text-base text-amber-900 mt-1">QC found {openRework.length} thing{openRework.length === 1 ? "" : "s"} to fix. Fix each one, mark it fixed, then submit for QC.</p>
          </div>
          {openRework.map((t) => {
            const issue = jobIssues.find((i) => i.reworkTaskId === t.id);
            const area = issue?.area || "Other";
            const qcPhotos = jobPhotos.filter((p) => p.photoType === "qc" && p.area === area);
            const done = !!fixed[t.id];
            return (
              <div key={t.id} className={cn("rounded-2xl border bg-white p-4 space-y-3 transition-colors", done ? "border-emerald-300" : "border-zinc-200")}>
                <div className="flex items-center justify-between gap-2">
                  <span className="px-2.5 py-1 rounded-full bg-zinc-100 text-xs font-semibold text-zinc-700 uppercase tracking-wide">{area}</span>
                  {issue?.severity && <span className={cn("px-2.5 py-1 rounded-full text-xs font-semibold", issue.severity === "critical" ? "bg-red-50 text-red-700" : issue.severity === "major" ? "bg-amber-50 text-amber-800" : "bg-zinc-100 text-zinc-600")}>{issue.severity === "critical" ? "Critical" : issue.severity === "major" ? "Major" : "Minor"}</span>}
                </div>
                <div className="text-base font-semibold text-zinc-950">{issue?.itemDescription || t.instructions}</div>
                {issue?.notes && issue.notes !== issue.itemDescription && <p className="text-sm text-zinc-600">{issue.notes}</p>}
                {qcPhotos.length > 0 && (
                  <div className="flex gap-2 overflow-x-auto">
                    {qcPhotos.map((p) => (
                      <a key={p.id} href={p.photoUrl} target="_blank" rel="noreferrer" className="shrink-0">
                        <img src={p.thumbnailUrl || p.photoUrl} alt={`QC photo, ${area}`} loading="lazy" className="h-20 w-20 rounded-xl object-cover border border-amber-200" />
                      </a>
                    ))}
                  </div>
                )}
                <PhotoRow label="Fixed photo" photos={jobPhotos.filter((p) => p.photoType === "rework" && p.area === area)} busy={uploading && target?.area === area && target?.type === "rework"} onTake={() => camera(area, "rework")} onRemove={(p) => setRemovePhoto(p)} mine={(p) => p.uploadedBy === currentUser.name} />
                <button onClick={() => setFixed((f) => ({ ...f, [t.id]: !f[t.id] }))} role="checkbox" aria-checked={done} className={cn("w-full h-12 rounded-xl text-base font-semibold inline-flex items-center justify-center gap-2 transition-colors", done ? "bg-emerald-600 text-white" : "bg-zinc-100 text-zinc-800")}>
                  <Check className="h-5 w-5" aria-hidden /> {done ? "Fixed ✓" : "Mark as fixed"}
                </button>
              </div>
            );
          })}
        </section>
      )}

      <Dialog open={verifyOpen} onOpenChange={setVerifyOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Verify your location</DialogTitle>
            <DialogDescription>{error ?? "GPS couldn't confirm you're at the property."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Button size="lg" className="w-full" onClick={() => { setVerifyOpen(false); setScanOpen(true); }}>
              <ScanLine className="h-5 w-5" aria-hidden /> Scan QR to Verify Location
            </Button>
            <Button size="lg" variant="outline" className="w-full" loading={busy} onClick={() => { setVerifyOpen(false); void arrive(); }}>
              <MapPin className="h-5 w-5" aria-hidden /> Try GPS again
            </Button>
            <button type="button" onClick={() => { setVerifyOpen(false); setBypassOpen(true); }} className="w-full min-h-11 text-sm font-semibold text-zinc-600 underline underline-offset-4">
              Can&apos;t scan? Continue with a reason
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <QrScanner
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        description="Ask the customer to show their service QR (on their phone or the printed card), then point the camera at it."
        onToken={(token) => {
          setScanOpen(false);
          void arrive({ qrToken: token });
        }}
      />
      <PromptModal
        isOpen={bypassOpen}
        onClose={() => setBypassOpen(false)}
        title="We couldn't confirm your location"
        description="Move closer to the property and try again — or tell the office why (for example: basement parking, no signal). This is saved on the job."
        placeholder="Reason (at least 5 characters)"
        confirmText="Record arrival"
        onSubmit={(reason) => {
          if (reason.length < 5) return;
          setBypassOpen(false);
          void arrive({ bypassReason: reason });
        }}
      />
      <ConfirmModal
        isOpen={!!removePhoto}
        onClose={() => setRemovePhoto(null)}
        title="Delete this photo?"
        description="You can take it again afterwards."
        confirmText="Delete"
        onConfirm={async () => {
          if (!removePhoto) return;
          const r = await deleteJobPhoto(removePhoto.id);
          if (!r.success) setError(r.message);
        }}
      />
    </MobileLayout>
  );
}

function Row({ icon, label, value, strong }: { icon: React.ReactNode; label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <dt className="sr-only">{label}</dt>
      <span className="text-zinc-400 shrink-0">{icon}</span>
      <dd className={cn("text-base min-w-0 break-words", strong ? "font-semibold text-zinc-950" : "text-zinc-800")}>{value}</dd>
    </div>
  );
}

/** One "BEFORE / AFTER" row: big camera button + thumbnails. */
function PhotoRow({ label, photos, busy, onTake, onRemove, mine }: { label: string; photos: JobPhoto[]; busy: boolean; onTake: () => void; onRemove?: (p: JobPhoto) => void; mine: (p: JobPhoto) => boolean }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</span>
        {photos.length > 0 && <span className="text-xs font-semibold text-emerald-700 inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" aria-hidden /> {photos.length} saved</span>}
      </div>
      <div className="flex gap-2 overflow-x-auto pt-2 -mt-2 pb-1 pr-2">
        <button onClick={onTake} disabled={busy} className="h-20 min-w-[5.5rem] px-3 rounded-xl border-2 border-dashed border-zinc-300 bg-zinc-50 text-zinc-700 text-xs font-semibold flex flex-col items-center justify-center gap-1 shrink-0 active:scale-[0.97] transition-transform" aria-label={`Take ${label.toLowerCase()} photo`}>
          {busy ? <Loader2 className="h-6 w-6 animate-spin" aria-hidden /> : <><Plus className="h-6 w-6" aria-hidden />{photos.length ? "Add" : "Take photo"}</>}
        </button>
        {photos.map((p) => (
          <div key={p.id} className="relative shrink-0">
            <a href={p.photoUrl} target="_blank" rel="noreferrer">
              <img src={p.thumbnailUrl || p.photoUrl} alt={`${label} photo`} loading="lazy" className="h-20 w-20 rounded-xl object-cover border border-zinc-200 bg-zinc-100" />
            </a>
            {onRemove && mine(p) && (
              <button onClick={() => onRemove(p)} className="absolute -top-2 -right-2 h-8 w-8 rounded-full bg-white border border-zinc-200 shadow-sm inline-flex items-center justify-center text-zinc-600" aria-label="Delete photo">
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ========================================================================= */
/* My Jobs — Home · Jobs · Tasks · Profile                                    */
/* ========================================================================= */

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function FieldJobList({ tab }: { tab: string }) {
  const { jobs, checklistItems, photos, reworkTasks, qualityIssues, currentUser, loading } = useApp();
  const today = new Date().toISOString().slice(0, 10);
  const mine = (jobs as FieldJob[]).filter((j) => !["CLOSED", "CANCELLED"].includes(j.status));
  const sorted = [...mine].sort((a, b) => (a.scheduledDate === b.scheduledDate ? a.scheduledTimeSlot.localeCompare(b.scheduledTimeSlot) : a.scheduledDate.localeCompare(b.scheduledDate)));
  const openTasks = reworkTasks.filter((t) => t.status !== "completed" && sorted.some((j) => j.id === t.jobId && REWORK_STATUSES.includes(j.status)));
  const reworkJobs = sorted.filter((j) => openTasks.some((t) => t.jobId === j.id));
  const todays = sorted.filter((j) => j.scheduledDate === today && !DONE.includes(j.status));
  const upcoming = sorted.filter((j) => j.scheduledDate > today && !DONE.includes(j.status));
  const recent = sorted.filter((j) => !todays.includes(j) && !upcoming.includes(j)).slice(-10).reverse();

  const card = (j: FieldJob) => {
    const cl = checklistItems.filter((c) => c.jobId === j.id);
    const tr = cl.filter((c) => c.critical).length ? cl.filter((c) => c.critical) : cl;
    const next = getNextAction(currentUser.role, {
      status: j.status,
      assignedManagerId: j.assignedManagerId,
      assignedStaffIds: j.assignedStaffIds,
      customerConfirmedAt: j.customerConfirmedAt ?? null,
      checklistTotal: tr.length,
      checklistDone: tr.filter((c) => c.status === "completed" || c.status === "skipped").length,
      photosBefore: photos.filter((p) => p.jobId === j.id && p.photoType === "before").length,
      photosAfter: photos.filter((p) => p.jobId === j.id && p.photoType === "after").length,
      openRework: reworkTasks.filter((t) => t.jobId === j.id && t.status !== "completed").length,
    });
    const actionable = next && !next.waiting && next.kind !== "wait" && next.kind !== "view";
    const showNavigate = ["SCHEDULED", "ASSIGNED"].includes(j.status);
    return (
      <article key={j.id} className={cn("rounded-2xl border bg-white shadow-sm overflow-hidden", actionable ? (next?.tone === "warning" ? "border-amber-300" : "border-rose-200") : "border-zinc-200")}>
        <Link href={`/my-jobs/${j.id}`} className="block p-5 active:bg-zinc-50">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-2xl font-semibold text-zinc-950 leading-none">{startTime(j.scheduledTimeSlot)}</div>
              <div className="text-sm text-zinc-500 mt-1">{j.scheduledDate === today ? "Today" : formatDate(j.scheduledDate)}</div>
            </div>
            <StatusBadge status={j.status} size="sm" />
          </div>
          <div className="mt-3 text-base font-semibold text-zinc-950">{j.service?.name ?? "Service"}</div>
          <div className="text-base text-zinc-700">{j.customerName ?? "Customer"}</div>
          <div className="text-sm text-zinc-500 flex items-start gap-1 mt-1">
            <MapPin className="h-4 w-4 mt-0.5 shrink-0" aria-hidden /> <span className="line-clamp-2">{addressOf(j) || j.propertyTitle}</span>
          </div>
          {next && (
            <div className={cn("mt-3 text-sm font-semibold inline-flex items-center gap-1", actionable ? (next.tone === "warning" ? "text-amber-700" : "text-rose-600") : "text-zinc-500")}>
              {actionable ? <ChevronRight className="h-4 w-4" aria-hidden /> : <Clock className="h-4 w-4" aria-hidden />} {next.label}
            </div>
          )}
        </Link>
        {showNavigate && (
          <div className="px-5 pb-5">
            <a href={mapsUrl(j)} target="_blank" rel="noreferrer" className="h-12 w-full rounded-xl bg-zinc-900 text-white text-sm font-semibold inline-flex items-center justify-center gap-2">
              <Navigation className="h-5 w-5" aria-hidden /> NAVIGATE
            </a>
          </div>
        )}
      </article>
    );
  };

  const section = (title: string, list: FieldJob[]) =>
    list.length > 0 && (
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide px-1">{title}</h2>
        {list.map(card)}
      </section>
    );

  const titles: Record<string, string> = { home: "Home", jobs: "My Jobs", tasks: "Tasks", profile: "Profile" };

  return (
    <MobileLayout title={titles[tab] ?? "Home"} subtitle={tab === "home" ? "My Jobs" : undefined}>
      {tab === "profile" && <ProfilePanel />}

      {tab === "home" && (
        <>
          <div className="pt-1">
            <p className="text-base text-zinc-500">{greeting()},</p>
            <p className="text-2xl font-semibold text-zinc-950">{currentUser.name.split(" ")[0]}</p>
          </div>
          {reworkJobs.length > 0 && (
            <Link href="/my-jobs?tab=tasks" className="flex items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4">
              <AlertTriangle className="h-6 w-6 text-amber-600 shrink-0" aria-hidden />
              <span className="flex-1">
                <span className="block text-base font-semibold text-amber-950">Rework to fix</span>
                <span className="block text-sm text-amber-800">{openTasks.length} item{openTasks.length === 1 ? "" : "s"} on {reworkJobs.length} job{reworkJobs.length === 1 ? "" : "s"}</span>
              </span>
              <ChevronRight className="h-5 w-5 text-amber-700" aria-hidden />
            </Link>
          )}
          <h2 className="text-lg font-semibold text-zinc-950 pt-1">Today&apos;s jobs <span className="text-zinc-400 font-normal">· {todays.length}</span></h2>
          {loading && todays.length === 0 ? (
            <SkeletonList rows={2} />
          ) : todays.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="No jobs today" description={upcoming.length ? `Your next job is on ${formatDate(upcoming[0].scheduledDate)}.` : "New jobs appear here as soon as the office assigns you."} />
          ) : (
            <div className="space-y-3">{todays.map(card)}</div>
          )}
        </>
      )}

      {tab === "jobs" && (
        <>
          {loading && sorted.length === 0 && <SkeletonList rows={3} />}
          {!loading && sorted.length === 0 && <EmptyState icon={Briefcase} title="No jobs yet" description="Jobs appear here as soon as the office assigns you." />}
          {section("Today", todays)}
          {section("Upcoming", upcoming)}
          {section("Recent", recent)}
        </>
      )}

      {tab === "tasks" && (
        <>
          {openTasks.length === 0 ? (
            <EmptyState icon={ListChecks} title="No rework to fix" description="When QC asks for something to be fixed, it shows up here." />
          ) : (
            reworkJobs.map((j) => (
              <Link key={j.id} href={`/my-jobs/${j.id}`} className="block rounded-2xl border border-amber-300 bg-white p-5 shadow-sm space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-base font-semibold text-zinc-950">{j.customerName}</div>
                    <div className="text-sm text-zinc-500">{j.jobNumber} · {j.service?.name}</div>
                  </div>
                  <StatusBadge status={j.status} size="sm" />
                </div>
                <ul className="space-y-1.5">
                  {openTasks
                    .filter((t) => t.jobId === j.id)
                    .map((t) => {
                      const issue = qualityIssues.find((i) => i.reworkTaskId === t.id);
                      return (
                        <li key={t.id} className="text-base text-zinc-800 flex items-start gap-2">
                          <Circle className="h-4 w-4 text-amber-500 mt-1 shrink-0" aria-hidden />
                          <span><strong>{issue?.area ?? "Other"}:</strong> {issue?.itemDescription ?? t.instructions}</span>
                        </li>
                      );
                    })}
                </ul>
                <span className="text-sm font-semibold text-amber-700 inline-flex items-center gap-1">Fix rework <ChevronRight className="h-4 w-4" aria-hidden /></span>
              </Link>
            ))
          )}
        </>
      )}
    </MobileLayout>
  );
}
