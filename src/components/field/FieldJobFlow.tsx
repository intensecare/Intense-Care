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
} from "lucide-react";
import { useApp } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import { MobileLayout } from "@/components/common/MobileLayout";
import { PrimaryAction, WaitingCard } from "@/components/workspace/WorkspaceWidgets";
import { PromptModal } from "@/components/common/PromptModal";
import { compressImageForUpload } from "@/lib/image-compress";
import { formatTimeSlot, formatDate, cn } from "@/lib/utils";
import { getNextAction, type NextAction } from "@/lib/rbac";
import type { Job } from "@/lib/types";

type FieldJob = Job & { customerName?: string; customerPhone?: string; propertyTitle?: string; service?: { name: string } };

/**
 * The on-site job flow (§8 / §9 / §19 / §21): ONE screen that follows the
 * job's state and shows exactly ONE primary action. Field Managers run the
 * whole journey (arrive → GPS → wait for customer → start → checklist →
 * photos → complete); Field Staff see the same screen but their primary
 * action never leaves their lane (checklist, photos, rework). Every action
 * is re-validated by the server through the permission matrix.
 */
export function FieldJobFlow({ jobId, mode }: { jobId: string; mode: "manager" | "staff" }) {
  const { jobs, checklistItems, photos, reworkTasks, qualityIssues, qualityChecks, currentUser, refreshJobs, refreshQuality, refreshPhotos, updateChecklistItem, addJobPhoto, completeReworkTask } = useApp();
  const { can } = useAuth();
  const backHref = mode === "staff" ? "/my-tasks" : "/my-jobs";
  const job = jobs.find((j) => j.id === jobId) as FieldJob | undefined;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [gps, setGps] = useState<"ready" | "searching" | "unavailable" | "verified">("ready");
  const [bypassOpen, setBypassOpen] = useState(false);
  const [screen, setScreen] = useState<"status" | "checklist" | "photos" | "rework">("status");
  const [photoArea, setPhotoArea] = useState<string>("");
  const [photoType, setPhotoType] = useState<"before" | "after">("before");
  const [uploading, setUploading] = useState(false);
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
  const lastQc = useMemo(() => qualityChecks.filter((q) => q.jobId === jobId).sort((a, b) => (b.inspectedAt ?? "").localeCompare(a.inspectedAt ?? ""))[0], [qualityChecks, jobId]);

  const areas = useMemo(() => Array.from(new Set(checklist.map((c) => c.area))), [checklist]);
  useEffect(() => {
    if (!photoArea && areas.length) setPhotoArea(areas[0]);
  }, [areas, photoArea]);

  const mandatory = checklist.filter((c) => c.critical);
  const tracked = mandatory.length ? mandatory : checklist;
  const checklistDone = tracked.filter((c) => c.status === "completed" || c.status === "skipped").length;
  const before = jobPhotos.filter((p) => p.photoType === "before").length;
  const after = jobPhotos.filter((p) => p.photoType === "after").length;

  const next: NextAction | null = job
    ? getNextAction(currentUser.role, {
        status: job.status,
        assignedManagerId: job.assignedManagerId,
        assignedStaffIds: job.assignedStaffIds,
        customerConfirmedAt: job.customerConfirmedAt ?? null,
        checklistTotal: tracked.length,
        checklistDone,
        photosBefore: before,
        photosAfter: after,
        openRework: openRework.length,
      })
    : null;

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
        setError(r.error ?? "GPS could not be verified.");
        setBypassOpen(true);
        return;
      }
      setError(r.error ?? "Could not record arrival.");
      return;
    }
    setGps(coords ? "verified" : "ready");
    showToast("Arrival recorded. Customer notified.");
    await refreshJobs();
  };

  const transition = async (status: string, okMessage: string) => {
    setBusy(true);
    setError(null);
    const r = await patch({ status });
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? "Action was rejected.");
      return;
    }
    showToast(okMessage);
    setScreen("status");
    await refreshJobs();
  };

  const runNext = async () => {
    if (!next || !job) return;
    switch (next.kind) {
      case "transition":
        if (next.target === "ARRIVED") return arrive();
        if (next.target === "IN_PROGRESS") return transition("IN_PROGRESS", "Service started. Checklist is open.");
        if (next.target === "WORK_COMPLETED") return transition("WORK_COMPLETED", "Work completed. Waiting for QC.");
        return;
      case "checklist":
        setScreen("checklist");
        return;
      case "photos":
        setScreen("photos");
        return;
      case "rework":
        setScreen("rework");
        return;
      default:
        return;
    }
  };

  const toggleItem = async (id: string, done: boolean) => {
    const r = await updateChecklistItem(id, done ? "pending" : "completed");
    if (!r.success) setError(r.message);
  };

  const flagItem = async (id: string, notes: string) => {
    const r = await updateChecklistItem(id, "issue", undefined, notes);
    if (!r.success) setError(r.message);
  };

  const onPhotoPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !job) return;
    setUploading(true);
    setError(null);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = String(ev.target?.result ?? "");
      const prepared = await compressImageForUpload(dataUrl);
      const r = await addJobPhoto({ jobId: job.id, area: photoArea || "General", photoType, imageDataUrl: prepared.dataUrl });
      setUploading(false);
      if (!r.success) setError(r.message);
      else showToast(`${photoType === "before" ? "Before" : "After"} photo saved for ${photoArea}.`);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const doneRework = async (taskId: string) => {
    setBusy(true);
    const r = await completeReworkTask(taskId, "Corrected on site.");
    setBusy(false);
    if (!r.success) setError(r.message);
    else {
      showToast("Rework item done.");
      await refreshJobs();
      await refreshQuality();
    }
  };

  if (!job) {
    return (
      <MobileLayout title="Job" backHref={backHref}>
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          This job is not assigned to you or no longer exists.
        </div>
      </MobileLayout>
    );
  }

  const statusLabel = (() => {
    switch (job.status) {
      case "ASSIGNED":
      case "SCHEDULED":
        return "Scheduled";
      case "ARRIVED":
        return job.customerConfirmedAt ? "Customer verified" : "Arrived — waiting for customer";
      case "CUSTOMER_VERIFIED":
        return "Customer verified";
      case "IN_PROGRESS":
        return "Service in progress";
      case "WORK_COMPLETED":
      case "QUALITY_CHECK":
        return "Work completed — QC";
      case "REWORK_REQUIRED":
      case "REWORK_ASSIGNED":
      case "REWORK_IN_PROGRESS":
        return "Rework required";
      case "REWORK_COMPLETED":
      case "REINSPECTION":
        return "Rework done — reinspection";
      case "PASS":
      case "CUSTOMER_APPROVAL":
        return "QC passed — customer approval";
      case "COMPLETED":
      case "FEEDBACK_REQUESTED":
      case "CLOSED":
        return "Completed";
      default:
        return job.status;
    }
  })();

  const gpsStatus: typeof gps = job.arrivedAt && job.status !== "ASSIGNED" ? "verified" : gps;

  /* ------------------------------------------------------------ sticky CTA */
  const cta = (() => {
    if (!next) return null;
    if (screen === "checklist") {
      const allDone = checklistDone >= tracked.length;
      return <PrimaryAction label={allDone ? "Continue to Photos" : `Continue (${checklistDone}/${tracked.length})`} tone={allDone ? "success" : "primary"} onClick={() => setScreen(allDone ? "photos" : "status")} icon={<ChevronRight className="h-5 w-5" />} />;
    }
    if (screen === "photos") {
      const complete = before > 0 && after > 0;
      if (complete && can("jobs.complete") && job.status === "IN_PROGRESS") {
        return <PrimaryAction label="Complete Work" tone="success" busy={busy} onClick={() => transition("WORK_COMPLETED", "Work completed. Waiting for QC.")} icon={<CheckCircle2 className="h-5 w-5" />} />;
      }
      return <PrimaryAction label={complete ? "Done" : "Back"} tone="neutral" onClick={() => setScreen("status")} />;
    }
    if (screen === "rework") {
      return <PrimaryAction label="Back" tone="neutral" onClick={() => setScreen("status")} />;
    }
    if (next.waiting || next.kind === "view" || next.kind === "wait") return null;
    return <PrimaryAction label={next.label} tone={next.tone === "success" ? "success" : next.tone === "warning" ? "warning" : "primary"} busy={busy} onClick={runNext} icon={next.target === "ARRIVED" ? <MapPin className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />} />;
  })();

  return (
    <MobileLayout title={job.id} subtitle={mode === "staff" ? "My Tasks" : "My Jobs"} backHref={backHref} gps={gpsStatus} action={cta}>
      {toast && (
        <div className="rounded-xl bg-emerald-600 text-white text-sm font-semibold px-4 py-3 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" /> {toast}
        </div>
      )}
      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> <span>{error}</span>
        </div>
      )}

      {/* Job card — who, what, where, when. */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-2xl font-semibold text-slate-900 leading-none">{formatTimeSlot(job.scheduledTimeSlot).split(" - ")[0]}</div>
            <div className="text-xs text-slate-500 mt-1">{formatDate(job.scheduledDate)}</div>
          </div>
          <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700">{statusLabel}</span>
        </div>
        <div>
          <div className="text-base font-semibold text-slate-900">{job.service?.name ?? "Service"}</div>
          <div className="text-sm text-slate-600 mt-1">
            <span className="text-slate-400">Customer:</span> {job.customerName ?? "Customer"}
          </div>
          <div className="text-sm text-slate-600 flex items-start gap-1.5">
            <MapPin className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
            <span>{job.propertyTitle ?? "Property"}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 pt-1">
          <a
            href={`https://maps.google.com/?q=${encodeURIComponent(job.propertyTitle ?? "")}`}
            target="_blank"
            rel="noreferrer"
            className="h-12 rounded-xl bg-slate-900 text-white text-sm font-semibold inline-flex items-center justify-center gap-2"
          >
            <Navigation className="h-4 w-4" /> Navigate
          </a>
          {job.customerPhone ? (
            <a href={`tel:${job.customerPhone}`} className="h-12 rounded-xl bg-white border border-slate-300 text-slate-800 text-sm font-semibold inline-flex items-center justify-center gap-2">
              <Phone className="h-4 w-4 text-emerald-600" /> Call
            </a>
          ) : (
            <div className="h-12 rounded-xl bg-slate-50 border border-slate-200 text-slate-400 text-sm inline-flex items-center justify-center">No phone</div>
          )}
        </div>
      </div>

      {/* Current step + next action */}
      {screen === "status" && (
        <div className="space-y-3">
          {job.status === "ARRIVED" && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900 space-y-1">
              <div className="font-semibold flex items-center gap-2">
                <ShieldCheck className="h-5 w-5" /> GPS verified ✓
              </div>
              {!job.customerConfirmedAt ? (
                <p className="text-sm">Waiting for customer confirmation. The customer has been notified on their secure link.</p>
              ) : (
                <p className="text-sm">Customer verified ✓</p>
              )}
            </div>
          )}
          {next && (next.waiting || next.kind === "wait") && <WaitingCard title={next.label} hint={next.hint} />}
          {next && !next.waiting && next.kind !== "wait" && (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Next action</div>
              <div className="text-lg font-semibold text-slate-900 mt-0.5">{next.label}</div>
              <div className="text-sm text-slate-500">{next.hint}</div>
            </div>
          )}

          {["WORK_COMPLETED", "QUALITY_CHECK", "PASS", "CUSTOMER_APPROVAL", "COMPLETED", "FEEDBACK_REQUESTED", "CLOSED"].includes(job.status) && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
              <div className="font-semibold text-slate-900 flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" /> Work completed ✓
              </div>
              {lastQc && (
                <div className="text-sm text-slate-600">
                  QC result: <strong className={lastQc.status === "PASS" ? "text-emerald-700" : "text-red-700"}>{lastQc.status === "PASS" ? "Passed" : "Rework required"}</strong> ({lastQc.score}%)
                </div>
              )}
              {job.approvedAt && <div className="text-sm text-emerald-700">Customer approved ✓</div>}
            </div>
          )}

          {/* Progress summary tiles */}
          {["IN_PROGRESS", "REWORK_ASSIGNED", "REWORK_IN_PROGRESS", "REWORK_REQUIRED"].includes(job.status) && (
            <div className="grid grid-cols-3 gap-2">
              <button onClick={() => setScreen("checklist")} className="rounded-xl border border-slate-200 bg-white p-3 text-left active:bg-slate-50">
                <div className="text-[11px] text-slate-400 font-semibold">Checklist</div>
                <div className="text-lg font-semibold text-slate-900">{checklistDone}/{tracked.length}</div>
              </button>
              <button onClick={() => setScreen("photos")} className="rounded-xl border border-slate-200 bg-white p-3 text-left active:bg-slate-50">
                <div className="text-[11px] text-slate-400 font-semibold">Photos</div>
                <div className="text-lg font-semibold text-slate-900">{before}+{after}</div>
              </button>
              <button onClick={() => setScreen("rework")} className={cn("rounded-xl border p-3 text-left active:bg-slate-50", openRework.length ? "border-red-200 bg-red-50" : "border-slate-200 bg-white")}>
                <div className="text-[11px] text-slate-400 font-semibold">Rework</div>
                <div className={cn("text-lg font-semibold", openRework.length ? "text-red-700" : "text-slate-900")}>{openRework.length}</div>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Checklist screen */}
      {screen === "checklist" && (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <div className="font-semibold text-slate-900">Service checklist</div>
            <div className="text-xs text-slate-500">{checklistDone}/{tracked.length} done</div>
          </div>
          {areas.map((area) => (
            <div key={area}>
              <div className="px-4 py-2 bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{area}</div>
              <ul className="divide-y divide-slate-100">
                {checklist
                  .filter((c) => c.area === area)
                  .map((item) => {
                    const done = item.status === "completed" || item.status === "skipped";
                    const issue = item.status === "issue";
                    return (
                      <li key={item.id} className="flex items-center gap-3 px-4 py-3 min-h-[56px]">
                        <button
                          onClick={() => toggleItem(item.id, done)}
                          className={cn("h-11 w-11 rounded-full border-2 flex items-center justify-center shrink-0", done ? "bg-emerald-500 border-emerald-500 text-white" : issue ? "border-amber-400 text-amber-500" : "border-slate-300 text-slate-300")}
                          aria-label={done ? "Mark pending" : "Mark done"}
                        >
                          {done ? <Check className="h-6 w-6" /> : issue ? <AlertTriangle className="h-5 w-5" /> : <Circle className="h-5 w-5" />}
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className={cn("text-sm font-medium", done ? "text-slate-400 line-through" : "text-slate-900")}>{item.task}</div>
                          {item.critical && !done && <div className="text-[10px] text-rose-600 font-semibold">Mandatory</div>}
                          {issue && item.issueNotes && <div className="text-[11px] text-amber-700">{item.issueNotes}</div>}
                        </div>
                        {!done && !issue && (
                          <button onClick={() => flagItem(item.id, "Could not complete — flagged on site")} className="h-11 px-3 rounded-lg text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200">
                            Issue
                          </button>
                        )}
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}
          {checklist.length === 0 && <div className="p-6 text-center text-sm text-slate-500">No checklist items on this service.</div>}
        </div>
      )}

      {/* Photos screen — camera-first */}
      {screen === "photos" && (
        <div className="space-y-3">
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPhotoPicked} />
          <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="font-semibold text-slate-900">Before / after photos</div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {(areas.length ? areas : ["General"]).map((a) => (
                <button key={a} onClick={() => setPhotoArea(a)} className={cn("h-10 px-3 rounded-full text-xs font-semibold whitespace-nowrap border", photoArea === a ? "bg-rose-500 text-white border-rose-500" : "bg-white text-slate-600 border-slate-200")}>
                  {a}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(["before", "after"] as const).map((t) => {
                const count = jobPhotos.filter((p) => p.photoType === t && p.area === photoArea).length;
                return (
                  <button
                    key={t}
                    disabled={uploading}
                    onClick={() => {
                      setPhotoType(t);
                      cameraRef.current?.click();
                    }}
                    className={cn("h-16 rounded-xl text-sm font-semibold inline-flex flex-col items-center justify-center gap-0.5 border", t === "before" ? "bg-slate-900 text-white border-slate-900" : "bg-emerald-600 text-white border-emerald-600")}
                  >
                    <span className="inline-flex items-center gap-1.5">{uploading && photoType === t ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />} {t.toUpperCase()}</span>
                    <span className="text-[10px] opacity-80">{count} saved</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">
            {(areas.length ? areas : ["General"]).map((a) => {
              const b = jobPhotos.filter((p) => p.area === a && p.photoType === "before").length;
              const af = jobPhotos.filter((p) => p.area === a && p.photoType === "after").length;
              return (
                <div key={a} className="px-4 py-3 flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-800">{a}</span>
                  <span className="flex items-center gap-3 text-xs">
                    <span className={b ? "text-emerald-700 font-semibold" : "text-slate-400"}>Before {b ? "✓" : "○"}</span>
                    <span className={af ? "text-emerald-700 font-semibold" : "text-slate-400"}>After {af ? "✓" : "○"}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Rework screen */}
      {screen === "rework" && (
        <div className="rounded-2xl border border-red-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-red-100 bg-red-50 text-red-800 font-semibold flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> Rework items from QC
          </div>
          {openRework.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500">No open rework items.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {openRework.map((t) => {
                const issue = jobIssues.find((i) => i.reworkTaskId === t.id);
                return (
                  <li key={t.id} className="p-4 space-y-2">
                    <div className="flex items-center gap-2 text-[11px] font-semibold">
                      {issue?.area && <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">{issue.area}</span>}
                      {issue?.severity && <span className={cn("px-1.5 py-0.5 rounded", issue.severity === "critical" ? "bg-red-600 text-white" : issue.severity === "major" ? "bg-amber-100 text-amber-800" : "bg-slate-200 text-slate-700")}>{issue.severity}</span>}
                    </div>
                    <div className="text-sm font-medium text-slate-900">{issue?.itemDescription || t.instructions}</div>
                    {issue?.reworkInstructions && issue.reworkInstructions !== issue.itemDescription && <div className="text-xs text-slate-600">{issue.reworkInstructions}</div>}
                    <button disabled={busy} onClick={() => doneRework(t.id)} className="h-12 w-full rounded-xl bg-emerald-600 text-white text-sm font-semibold inline-flex items-center justify-center gap-2">
                      <Check className="h-4 w-4" /> Fixed
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <Link href={backHref} className="block text-center text-xs text-slate-400 py-2">
        Back to {mode === "staff" ? "My Tasks" : "My Jobs"}
      </Link>

      <PromptModal
        isOpen={bypassOpen}
        onClose={() => setBypassOpen(false)}
        title="GPS could not verify your location"
        description="Tell operations why you are proceeding without GPS verification (for example: indoor parking, no signal). This is recorded on the job."
        placeholder="Reason"
        confirmText="Record arrival"
        onSubmit={(reason) => {
          setBypassOpen(false);
          void arrive(reason);
        }}
      />
    </MobileLayout>
  );
}

/** List of the user's jobs for the field home (today first, then upcoming). */
export function FieldJobList({ mode }: { mode: "manager" | "staff" }) {
  const { jobs, checklistItems, photos, reworkTasks, currentUser, loading } = useApp();
  const base = mode === "staff" ? "/my-tasks" : "/my-jobs";
  const today = new Date().toISOString().slice(0, 10);
  const active = (jobs as FieldJob[]).filter((j) => !["CLOSED", "CANCELLED"].includes(j.status));
  const sorted = [...active].sort((a, b) => (a.scheduledDate === b.scheduledDate ? a.scheduledTimeSlot.localeCompare(b.scheduledTimeSlot) : a.scheduledDate.localeCompare(b.scheduledDate)));
  const todays = sorted.filter((j) => j.scheduledDate === today);
  const others = sorted.filter((j) => j.scheduledDate !== today);

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
      <Link key={j.id} href={`${base}/${j.id}`} className={cn("block rounded-2xl border bg-white p-4 shadow-sm active:bg-slate-50", actionable ? "border-rose-200" : "border-slate-200")}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-xl font-semibold text-slate-900 leading-none">{formatTimeSlot(j.scheduledTimeSlot).split(" - ")[0]}</div>
            <div className="text-xs text-slate-500 mt-1">{j.scheduledDate === today ? "Today" : formatDate(j.scheduledDate)}</div>
          </div>
          {next && (
            <span className={cn("px-2.5 py-1 rounded-lg text-xs font-semibold", actionable ? "bg-rose-500 text-white" : "bg-slate-100 text-slate-600")}>{next.label}</span>
          )}
        </div>
        <div className="mt-2 text-sm font-semibold text-slate-900">{j.service?.name ?? "Service"}</div>
        <div className="text-sm text-slate-600">{j.customerName ?? "Customer"}</div>
        <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
          <MapPin className="h-3.5 w-3.5" /> {j.propertyTitle ?? "Property"}
        </div>
      </Link>
    );
  };

  return (
    <MobileLayout title={mode === "staff" ? "My Tasks" : "My Jobs"} subtitle={currentUser.name}>
      {loading && sorted.length === 0 && <div className="text-center text-xs text-slate-400 py-6">Loading your jobs…</div>}
      {!loading && sorted.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center space-y-1">
          <div className="text-base font-semibold text-slate-900">No jobs assigned</div>
          <p className="text-sm text-slate-500">Jobs appear here the moment operations assigns you.</p>
        </div>
      )}
      {todays.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide px-1">Today&apos;s {todays.length === 1 ? "job" : "jobs"}</h2>
          {todays.map(card)}
        </section>
      )}
      {others.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide px-1">Upcoming &amp; recent</h2>
          {others.map(card)}
        </section>
      )}
    </MobileLayout>
  );
}
