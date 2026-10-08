"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Navigation,
  Phone,
  MapPin,
  CheckCircle2,
  Circle,
  ChevronRight,
  Camera,
  AlertTriangle,
  Check,
  Loader2,
  ShieldCheck,
  Clock,
  Play,
  Send,
  ImagePlus,
} from "lucide-react";
import { useApp } from "@/lib/app-context";
import { MobileLayout } from "@/components/common/MobileLayout";
import { PrimaryAction } from "@/components/workspace/WorkspaceWidgets";
import { PromptModal } from "@/components/common/PromptModal";
import { compressImageForUpload } from "@/lib/image-compress";
import { formatTimeSlot, formatDate, cn } from "@/lib/utils";
import { getNextAction } from "@/lib/rbac";
import type { Job, JobPhoto } from "@/lib/types";

type FieldJob = Job & { customerName?: string; customerPhone?: string; propertyTitle?: string; service?: { name: string } };

/** The five steps the Field Manager sees at the top of every job. */
const STEPS = ["Arrive", "Customer", "Work", "QC", "Done"] as const;

function stepOf(status: string): number {
  switch (status) {
    case "DRAFT":
    case "SCHEDULED":
    case "ASSIGNED":
      return 0;
    case "ARRIVED":
      return 1;
    case "CUSTOMER_VERIFIED":
    case "IN_PROGRESS":
    case "REWORK_REQUIRED":
    case "REWORK_ASSIGNED":
    case "REWORK_IN_PROGRESS":
      return 2;
    case "WORK_COMPLETED":
    case "QUALITY_CHECK":
    case "REWORK_COMPLETED":
    case "REINSPECTION":
      return 3;
    default:
      return 4;
  }
}

const REWORK = ["REWORK_REQUIRED", "REWORK_ASSIGNED", "REWORK_IN_PROGRESS"];

/**
 * MY JOBS — one job, one screen, ONE primary action (sticky at the bottom).
 *
 *   I'M HERE (GPS) → waiting for customer → START SERVICE → checklist by area
 *   → [CONTINUE] → before/after photos + notes → [COMPLETE WORK] → waiting
 *   for QC → (rework → fix → [SUBMIT FOR QC]) → done.
 *
 * Every action is re-validated by the server (state machine + assigned scope).
 */
export function FieldJobFlow({ jobId }: { jobId: string }) {
  const { jobs, checklistItems, photos, reworkTasks, qualityIssues, currentUser, refreshJobs, refreshQuality, refreshPhotos, updateChecklistItem, addJobPhoto, completeReworkTask } = useApp();
  const job = jobs.find((j) => j.id === jobId) as FieldJob | undefined;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [gps, setGps] = useState<"ready" | "searching" | "unavailable" | "verified">("ready");
  const [bypassOpen, setBypassOpen] = useState(false);
  const [screen, setScreen] = useState<"checklist" | "photos">("checklist");
  const [photoArea, setPhotoArea] = useState("");
  const [photoType, setPhotoType] = useState<JobPhoto["photoType"]>("before");
  const [uploading, setUploading] = useState(false);
  const [notes, setNotes] = useState<string | null>(null);
  const [fixed, setFixed] = useState<Record<string, boolean>>({});
  const cameraRef = useRef<HTMLInputElement>(null);

  // Live sync — the customer confirming or QC deciding shows up within seconds.
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
  const areas = useMemo(() => {
    const list = Array.from(new Set(checklist.map((c) => c.area)));
    return list.length ? list : ["General"];
  }, [checklist]);

  useEffect(() => {
    if (!photoArea && areas.length) setPhotoArea(areas[0]);
  }, [areas, photoArea]);
  useEffect(() => {
    if (job && notes === null) setNotes(job.notes ?? "");
  }, [job, notes]);

  const mandatory = checklist.filter((c) => c.critical);
  const tracked = mandatory.length ? mandatory : checklist;
  const isDone = (s: string) => s === "completed" || s === "skipped";
  const checklistDone = tracked.filter((c) => isDone(c.status)).length;
  const checklistComplete = checklistDone >= tracked.length;
  const before = jobPhotos.filter((p) => p.photoType === "before").length;
  const after = jobPhotos.filter((p) => p.photoType === "after").length;

  const showToast = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3500);
  };

  const patch = async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
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

  const arrive = async (bypassReason?: string) => {
    setBusy(true);
    setError(null);
    const coords = bypassReason ? null : await locate();
    const r = await patch({ status: "ARRIVED", arrival: { ...(coords ?? {}), ...(bypassReason ? { bypassReason } : {}) } });
    setBusy(false);
    if (!r.ok) {
      if (r.status === 409 && !bypassReason) {
        setError(r.error ?? "We couldn't verify your location.");
        setBypassOpen(true);
        return;
      }
      setError(r.error ?? "Could not record arrival.");
      return;
    }
    setGps(coords ? "verified" : "ready");
    showToast("Arrival verified ✓ The customer has been sent the link.");
    await refreshJobs();
  };

  const transition = async (status: string, okMessage: string) => {
    setBusy(true);
    setError(null);
    const r = await patch({ status });
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? "That didn't go through. Try again.");
      return;
    }
    showToast(okMessage);
    setScreen("checklist");
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

  const onPhotoPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !job) return;
    setUploading(true);
    setError(null);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const prepared = await compressImageForUpload(String(ev.target?.result ?? ""));
      const r = await addJobPhoto({ jobId: job.id, area: photoArea || "General", photoType, imageDataUrl: prepared.dataUrl });
      setUploading(false);
      if (!r.success) setError(r.message);
      else showToast(`${photoType === "before" ? "Before" : photoType === "after" ? "After" : "Rework"} photo saved — ${photoArea}.`);
    };
    reader.readAsDataURL(file);
  };

  const camera = (type: JobPhoto["photoType"], area: string) => {
    setPhotoType(type);
    setPhotoArea(area);
    cameraRef.current?.click();
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
    showToast("Rework submitted ✓ Waiting for QC.");
    await refreshJobs();
    await refreshQuality();
  };

  if (!job) {
    return (
      <MobileLayout title="Job" backHref="/my-jobs">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          This job is not assigned to you or no longer exists.
        </div>
      </MobileLayout>
    );
  }

  const next = getNextAction(currentUser.role, {
    status: job.status,
    assignedManagerId: job.assignedManagerId,
    assignedStaffIds: job.assignedStaffIds,
    customerConfirmedAt: job.customerConfirmedAt ?? null,
    checklistTotal: tracked.length,
    checklistDone,
    photosBefore: before,
    photosAfter: after,
    openRework: openRework.length,
  });
  const step = stepOf(job.status);
  const inRework = REWORK.includes(job.status) && openRework.length > 0;
  const allFixed = openRework.length > 0 && openRework.every((t) => fixed[t.id]);
  const address = (job.propertyTitle ?? "").split(" - ").slice(1).join(" - ") || job.propertyTitle || "";
  const gpsStatus: typeof gps = job.arrivedAt && step > 0 ? "verified" : gps;

  /* ---------------------------------------------------------- sticky CTA */
  const cta = (() => {
    if (job.status === "SCHEDULED" || job.status === "ASSIGNED") {
      return <PrimaryAction label="I'M HERE" busy={busy} onClick={() => void arrive()} icon={<MapPin className="h-5 w-5" />} />;
    }
    if ((job.status === "ARRIVED" && job.customerConfirmedAt) || job.status === "CUSTOMER_VERIFIED") {
      return <PrimaryAction label="START SERVICE" busy={busy} onClick={() => void transition("IN_PROGRESS", "Service started. Checklist is open.")} icon={<Play className="h-5 w-5" />} />;
    }
    if (job.status === "IN_PROGRESS") {
      if (screen === "checklist") {
        return (
          <PrimaryAction
            label={checklistComplete ? "CONTINUE" : `CONTINUE (${checklistDone}/${tracked.length})`}
            disabled={!checklistComplete}
            onClick={() => {
              setScreen("photos");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            icon={<ChevronRight className="h-5 w-5" />}
          />
        );
      }
      const photosOk = before > 0 && after > 0;
      return <PrimaryAction label={photosOk ? "COMPLETE WORK" : "Add before & after photos"} tone="success" disabled={!photosOk} busy={busy} onClick={() => void completeWork()} icon={<CheckCircle2 className="h-5 w-5" />} />;
    }
    if (inRework) {
      return <PrimaryAction label={allFixed ? "SUBMIT FOR QC" : `Mark each item fixed (${Object.values(fixed).filter(Boolean).length}/${openRework.length})`} tone="warning" disabled={!allFixed} busy={busy} onClick={() => void submitRework()} icon={<Send className="h-5 w-5" />} />;
    }
    return null;
  })();

  return (
    <MobileLayout title={job.customerName ?? "Job"} subtitle="My Jobs" backHref="/my-jobs" gps={step === 0 ? gpsStatus : undefined} action={cta}>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPhotoPicked} />

      {toast && (
        <div className="rounded-2xl bg-emerald-600 text-white text-sm font-semibold px-4 py-3 flex items-center gap-2 shadow-sm animate-in fade-in slide-in-from-top-2">
          <CheckCircle2 className="h-5 w-5 shrink-0" /> {toast}
        </div>
      )}
      {error && (
        <div className="rounded-2xl bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> <span>{error}</span>
        </div>
      )}

      {/* Journey */}
      <ol className="flex items-center gap-1">
        {STEPS.map((label, i) => (
          <li key={label} className="flex-1">
            <div className={cn("h-1.5 rounded-full transition-colors", i < step ? "bg-emerald-500" : i === step ? (inRework ? "bg-amber-500" : "bg-rose-500") : "bg-slate-200")} />
            <div className={cn("mt-1 text-[11px] font-semibold text-center", i === step ? "text-slate-900" : "text-slate-400")}>{label}</div>
          </li>
        ))}
      </ol>

      {/* Job card — who, what, where, when */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-3xl font-semibold text-slate-900 leading-none">{formatTimeSlot(job.scheduledTimeSlot).split(" - ")[0]}</div>
            <div className="text-sm text-slate-500 mt-1">{formatDate(job.scheduledDate)}</div>
          </div>
          <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 font-mono">{job.jobNumber ?? job.id}</span>
        </div>
        <div>
          <div className="text-lg font-semibold text-slate-900">{job.service?.name ?? "Service"}</div>
          <div className="text-sm text-slate-600 flex items-start gap-1.5 mt-1">
            <MapPin className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
            <span>{job.propertyTitle ?? "Property"}</span>
          </div>
        </div>
        {step < 4 && (
          <div className="grid grid-cols-2 gap-2 pt-1">
            <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`} target="_blank" rel="noreferrer" className="h-12 rounded-xl bg-slate-900 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 active:scale-[0.98] transition-transform">
              <Navigation className="h-4 w-4" /> NAVIGATE
            </a>
            {job.customerPhone ? (
              <a href={`tel:${job.customerPhone}`} className="h-12 rounded-xl bg-white border border-slate-300 text-slate-800 text-sm font-semibold inline-flex items-center justify-center gap-2 active:scale-[0.98] transition-transform">
                <Phone className="h-4 w-4 text-emerald-600" /> CALL
              </a>
            ) : (
              <div className="h-12 rounded-xl bg-slate-50 border border-slate-200 text-slate-400 text-sm inline-flex items-center justify-center">No phone</div>
            )}
          </div>
        )}
      </div>

      {/* WHAT HAPPENED / WHAT HAPPENS NEXT */}
      {job.status === "ARRIVED" && (
        <StatusCard tone="success" icon={<ShieldCheck className="h-6 w-6" />} title="ARRIVAL VERIFIED ✓">
          {job.customerConfirmedAt ? (
            <span className="font-semibold">CUSTOMER VERIFIED ✓ — tap Start Service.</span>
          ) : (
            <span className="flex items-center gap-2">
              <Clock className="h-4 w-4 shrink-0 animate-pulse" /> WAITING FOR CUSTOMER CONFIRMATION. The customer has the link on their phone.
            </span>
          )}
        </StatusCard>
      )}
      {job.status === "CUSTOMER_VERIFIED" && <StatusCard tone="success" icon={<ShieldCheck className="h-6 w-6" />} title="CUSTOMER VERIFIED ✓">Tap Start Service to begin.</StatusCard>}
      {(job.status === "SCHEDULED" || job.status === "ASSIGNED") && (
        <StatusCard tone="neutral" icon={<Navigation className="h-6 w-6" />} title="Next: go to the property">
          Use Navigate, then tap <strong>I&apos;M HERE</strong> when you arrive. We check your location.
        </StatusCard>
      )}
      {["WORK_COMPLETED", "QUALITY_CHECK"].includes(job.status) && <StatusCard tone="success" icon={<CheckCircle2 className="h-6 w-6" />} title="WORK COMPLETED ✓">WAITING FOR QC. You will be notified if anything needs fixing.</StatusCard>}
      {["REWORK_COMPLETED", "REINSPECTION"].includes(job.status) && <StatusCard tone="success" icon={<CheckCircle2 className="h-6 w-6" />} title="REWORK SUBMITTED ✓">WAITING FOR QC to reinspect.</StatusCard>}
      {["PASS", "CUSTOMER_APPROVAL"].includes(job.status) && <StatusCard tone="success" icon={<CheckCircle2 className="h-6 w-6" />} title="QC PASSED ✓">Waiting for the customer to approve.</StatusCard>}
      {["COMPLETED", "FEEDBACK_REQUESTED", "CLOSED"].includes(job.status) && <StatusCard tone="success" icon={<CheckCircle2 className="h-6 w-6" />} title="JOB COMPLETED ✓">The customer approved the service. Great work.</StatusCard>}
      {job.status === "CANCELLED" && <StatusCard tone="neutral" icon={<AlertTriangle className="h-6 w-6" />} title="Job cancelled">Nothing to do here.</StatusCard>}
      {REWORK.includes(job.status) && openRework.length === 0 && <StatusCard tone="success" icon={<CheckCircle2 className="h-6 w-6" />} title="REWORK SUBMITTED ✓">WAITING FOR QC.</StatusCard>}

      {/* Step 1 — checklist grouped by area */}
      {job.status === "IN_PROGRESS" && screen === "checklist" && (
        <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Step 1 of 2</div>
              <div className="text-lg font-semibold text-slate-900">Checklist</div>
            </div>
            <div className="text-sm font-semibold text-slate-600">{checklistDone}/{tracked.length}</div>
          </div>
          <div className="h-1.5 bg-slate-100">
            <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${tracked.length ? (checklistDone / tracked.length) * 100 : 100}%` }} />
          </div>
          {checklist.length === 0 && <div className="p-6 text-center text-sm text-slate-500">No checklist on this service — tap Continue.</div>}
          {Array.from(new Set(checklist.map((c) => c.area))).map((area) => (
            <div key={area}>
              <div className="px-5 py-2 bg-slate-50 text-xs font-semibold text-slate-600 uppercase tracking-wide">{area}</div>
              <ul className="divide-y divide-slate-100">
                {checklist
                  .filter((c) => c.area === area)
                  .map((item) => {
                    const done = isDone(item.status);
                    return (
                      <li key={item.id}>
                        <button onClick={() => void toggleItem(item.id, done)} className="w-full flex items-center gap-3 px-5 py-3 min-h-[60px] text-left active:bg-slate-50">
                          <span className={cn("h-10 w-10 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors", done ? "bg-emerald-500 border-emerald-500 text-white" : "border-slate-300 text-slate-300")}>
                            {done ? <Check className="h-6 w-6" /> : <Circle className="h-4 w-4" />}
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className={cn("block text-base", done ? "text-slate-400 line-through" : "text-slate-900")}>{item.task}</span>
                            {item.critical && !done && <span className="text-[11px] text-rose-600 font-semibold">Required</span>}
                          </span>
                        </button>
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}
        </section>
      )}

      {/* Step 2 — camera-first photos + notes */}
      {job.status === "IN_PROGRESS" && screen === "photos" && (
        <section className="space-y-3">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Step 2 of 2</div>
                <div className="text-lg font-semibold text-slate-900">Before / After photos</div>
              </div>
              <button onClick={() => setScreen("checklist")} className="text-sm font-semibold text-rose-600">Checklist</button>
            </div>
            <ul className="divide-y divide-slate-100">
              {areas.map((a) => {
                const b = jobPhotos.filter((p) => p.area === a && p.photoType === "before");
                const af = jobPhotos.filter((p) => p.area === a && p.photoType === "after");
                return (
                  <li key={a} className="px-5 py-4 space-y-2">
                    <div className="text-sm font-semibold text-slate-900">{a}</div>
                    <div className="grid grid-cols-2 gap-2">
                      {(["before", "after"] as const).map((t) => {
                        const list = t === "before" ? b : af;
                        const last = list[0];
                        return (
                          <button
                            key={t}
                            disabled={uploading}
                            onClick={() => camera(t, a)}
                            className={cn("relative h-24 rounded-xl overflow-hidden border text-sm font-semibold flex flex-col items-center justify-center gap-1 active:scale-[0.98] transition-transform", list.length ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-dashed border-slate-300 bg-slate-50 text-slate-600")}
                          >
                            {last && <img src={last.thumbnailUrl || last.photoUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" />}
                            <span className="relative inline-flex items-center gap-1.5">
                              {uploading && photoType === t && photoArea === a ? <Loader2 className="h-4 w-4 animate-spin" /> : list.length ? <Check className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
                              {t.toUpperCase()}
                            </span>
                            <span className="relative text-[11px] font-medium">{list.length ? `${list.length} saved · add more` : "Tap to take photo"}</span>
                          </button>
                        );
                      })}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-2">
            <label htmlFor="work-notes" className="text-sm font-semibold text-slate-900">Notes (optional)</label>
            <textarea
              id="work-notes"
              value={notes ?? ""}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Anything QC or the office should know…"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-rose-500"
            />
          </div>
        </section>
      )}

      {/* Rework — arrives inside My Jobs, same job ID */}
      {inRework && (
        <section className="rounded-2xl border border-amber-300 bg-white overflow-hidden shadow-sm">
          <div className="px-5 py-4 bg-amber-50 border-b border-amber-200">
            <div className="text-lg font-semibold text-amber-900 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" /> REWORK REQUIRED
            </div>
            <p className="text-sm text-amber-800">QC found {openRework.length} thing{openRework.length === 1 ? "" : "s"} to fix. Fix each one, then submit for QC.</p>
          </div>
          <ul className="divide-y divide-slate-100">
            {openRework.map((t) => {
              const issue = jobIssues.find((i) => i.reworkTaskId === t.id);
              const area = issue?.area || "General";
              const qcPhotos = jobPhotos.filter((p) => p.photoType === "qc" && p.area === area);
              const reworkPhotos = jobPhotos.filter((p) => p.photoType === "rework" && p.area === area);
              const done = !!fixed[t.id];
              return (
                <li key={t.id} className="p-5 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-lg bg-slate-100 text-xs font-semibold text-slate-700">{area}</span>
                  </div>
                  <div className="text-base font-semibold text-slate-900">{issue?.itemDescription || t.instructions}</div>
                  {issue?.notes && issue.notes !== issue.itemDescription && <div className="text-sm text-slate-600">{issue.notes}</div>}
                  {qcPhotos.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto">
                      {qcPhotos.map((p) => (
                        <a key={p.id} href={p.photoUrl} target="_blank" rel="noreferrer" className="shrink-0">
                          <img src={p.thumbnailUrl || p.photoUrl} alt="QC photo" className="h-20 w-20 rounded-xl object-cover border border-amber-200" />
                        </a>
                      ))}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => camera("rework", area)} disabled={uploading} className="h-12 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 inline-flex items-center justify-center gap-2">
                      {uploading && photoType === "rework" && photoArea === area ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                      {reworkPhotos.length ? `Photo ✓ (${reworkPhotos.length})` : "ADD PHOTO"}
                    </button>
                    <button
                      onClick={() => setFixed((f) => ({ ...f, [t.id]: !f[t.id] }))}
                      className={cn("h-12 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors", done ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-700 border border-slate-200")}
                    >
                      <Check className="h-4 w-4" /> {done ? "FIXED ✓" : "MARK FIXED"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {next && next.waiting && !inRework && step < 4 && job.status !== "ARRIVED" && !["WORK_COMPLETED", "QUALITY_CHECK", "REWORK_COMPLETED", "REINSPECTION", "PASS", "CUSTOMER_APPROVAL"].includes(job.status) && !REWORK.includes(job.status) && (
        <StatusCard tone="neutral" icon={<Clock className="h-6 w-6" />} title={next.label}>{next.hint}</StatusCard>
      )}

      <Link href="/my-jobs" className="block text-center text-sm text-slate-400 py-2">
        Back to My Jobs
      </Link>

      <PromptModal
        isOpen={bypassOpen}
        onClose={() => setBypassOpen(false)}
        title="We couldn't confirm your location"
        description="Move closer to the property and try again — or tell the office why (e.g. basement parking, no signal). This is recorded on the job."
        placeholder="Reason"
        confirmText="I'm here — record arrival"
        onSubmit={(reason) => {
          setBypassOpen(false);
          void arrive(reason);
        }}
      />
    </MobileLayout>
  );
}

function StatusCard({ tone, icon, title, children }: { tone: "success" | "neutral"; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className={cn("rounded-2xl border p-5 shadow-sm animate-in fade-in", tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-slate-200 bg-white text-slate-800")}>
      <div className="flex items-center gap-2 text-lg font-semibold">
        {icon} {title}
      </div>
      <div className={cn("text-sm mt-1.5", tone === "success" ? "text-emerald-800" : "text-slate-600")}>{children}</div>
    </div>
  );
}

/** MY JOBS — only the jobs assigned to this Field Manager (server-scoped). */
export function FieldJobList() {
  const { jobs, checklistItems, photos, reworkTasks, currentUser, loading } = useApp();
  const today = new Date().toISOString().slice(0, 10);
  const active = (jobs as FieldJob[]).filter((j) => !["CLOSED", "CANCELLED"].includes(j.status));
  const sorted = [...active].sort((a, b) => (a.scheduledDate === b.scheduledDate ? a.scheduledTimeSlot.localeCompare(b.scheduledTimeSlot) : a.scheduledDate.localeCompare(b.scheduledDate)));
  const done = (s: string) => ["COMPLETED", "FEEDBACK_REQUESTED"].includes(s);
  const rework = sorted.filter((j) => REWORK.includes(j.status) && reworkTasks.some((t) => t.jobId === j.id && t.status !== "completed"));
  const todays = sorted.filter((j) => j.scheduledDate === today && !done(j.status) && !rework.includes(j));
  const upcoming = sorted.filter((j) => j.scheduledDate > today && !done(j.status) && !rework.includes(j));
  const recent = sorted.filter((j) => (j.scheduledDate < today || done(j.status)) && !todays.includes(j) && !rework.includes(j) && !upcoming.includes(j)).slice(-10).reverse();

  const card = (j: FieldJob) => {
    const cl = checklistItems.filter((c) => c.jobId === j.id);
    const mandatory = cl.filter((c) => c.critical);
    const tracked = mandatory.length ? mandatory : cl;
    const next = getNextAction(currentUser.role, {
      status: j.status,
      assignedManagerId: j.assignedManagerId,
      assignedStaffIds: j.assignedStaffIds,
      customerConfirmedAt: j.customerConfirmedAt ?? null,
      checklistTotal: tracked.length,
      checklistDone: tracked.filter((c) => c.status === "completed" || c.status === "skipped").length,
      photosBefore: photos.filter((p) => p.jobId === j.id && p.photoType === "before").length,
      photosAfter: photos.filter((p) => p.jobId === j.id && p.photoType === "after").length,
      openRework: reworkTasks.filter((t) => t.jobId === j.id && t.status !== "completed").length,
    });
    const actionable = next && !next.waiting && next.kind !== "wait" && next.kind !== "view";
    return (
      <Link key={j.id} href={`/my-jobs/${j.id}`} className={cn("block rounded-2xl border bg-white p-5 shadow-sm active:scale-[0.99] transition-transform", actionable ? (next?.tone === "warning" ? "border-amber-300" : "border-rose-200") : "border-slate-200")}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-2xl font-semibold text-slate-900 leading-none">{formatTimeSlot(j.scheduledTimeSlot).split(" - ")[0]}</div>
            <div className="text-sm text-slate-500 mt-1">{j.scheduledDate === today ? "Today" : formatDate(j.scheduledDate)}</div>
          </div>
          {next && (
            <span className={cn("px-3 py-1.5 rounded-xl text-xs font-semibold text-right", actionable ? (next.tone === "warning" ? "bg-amber-500 text-white" : "bg-rose-500 text-white") : "bg-slate-100 text-slate-600")}>{next.label}</span>
          )}
        </div>
        <div className="mt-3 text-base font-semibold text-slate-900">{j.customerName ?? "Customer"}</div>
        <div className="text-sm text-slate-600">{j.service?.name ?? "Service"}</div>
        <div className="text-sm text-slate-500 flex items-start gap-1 mt-1">
          <MapPin className="h-4 w-4 mt-0.5 shrink-0" /> <span className="line-clamp-2">{j.propertyTitle ?? "Property"}</span>
        </div>
      </Link>
    );
  };

  const section = (title: string, list: FieldJob[], tone?: "warning") =>
    list.length > 0 && (
      <section className="space-y-2">
        <h2 className={cn("text-xs font-semibold uppercase tracking-wide px-1", tone === "warning" ? "text-amber-700" : "text-slate-500")}>{title}</h2>
        {list.map(card)}
      </section>
    );

  return (
    <MobileLayout title="My Jobs" subtitle={currentUser.name}>
      {loading && sorted.length === 0 && (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="h-36 rounded-2xl bg-white border border-slate-200 animate-pulse" />
          ))}
        </div>
      )}
      {!loading && todays.length + upcoming.length + rework.length + recent.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center space-y-2 shadow-sm">
          <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto" />
          <div className="text-lg font-semibold text-slate-900">No jobs assigned</div>
          <p className="text-sm text-slate-500">New jobs appear here as soon as the office assigns you.</p>
        </div>
      )}
      {section("Rework to fix", rework, "warning")}
      {section(`Today · ${todays.length} ${todays.length === 1 ? "job" : "jobs"}`, todays)}
      {section("Upcoming", upcoming)}
      {section("Recent", recent)}
    </MobileLayout>
  );
}
