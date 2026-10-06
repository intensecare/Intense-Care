"use client";

import React, { useState } from "react";
import { useApp } from "@/lib/app-context";
import { JobStatusBadge } from "@/components/common/JobStatusBadge";
import { formatDateTime, cn } from "@/lib/utils";
import {
  Smartphone,
  MapPin,
  Phone,
  Navigation,
  Check,
  CheckCircle2,
  Clock,
  Play,
  Camera,
  Layers,
  ArrowRight,
  AlertTriangle,
  ChevronLeft,
  X,
  Upload,
  Loader2,
  Eye,
} from "lucide-react";
import Link from "next/link";
import { ImageLightboxModal } from "@/components/common/ImageLightboxModal";
import { Button } from "@/components/ui/button";
import { compressImageForUpload } from "@/lib/image-compress";

export default function FieldStaffPage() {
  const {
    jobs,
    customers,
    properties,
    services,
    checklistItems,
    photos,
    users,
    qualityIssues,
    reworkTasks,
    currentUser,
    transitionJobStatus,
    transitionError,
    refreshJobs,
    refreshQuality,
    refreshPhotos,
    updateChecklistItem,
    addJobPhoto,
    completeReworkTask,
  } = useApp();

  // Direct-assignment isolation: a field worker sees ONLY jobs explicitly
  // assigned to them (assignedStaffIds contains their id). Managers/admins
  // see everything. There is deliberately no team/squad fallback that could
  // leak another worker's jobs.
  const isManager = currentUser.role === "super_admin" || currentUser.role === "ops_manager";

  const assignedJobs = jobs.filter((j) => {
    if (isManager) return true;
    if (j.assignedManagerId === currentUser.id) return true;
    if (j.assignedStaffIds?.includes(currentUser.id)) return true;
    return false;
  });

  const [selectedJobId, setSelectedJobId] = useState<string>(
    assignedJobs[0]?.id || ""
  );
  const [photoArea, setPhotoArea] = useState("Kitchen");
  const [photoType, setPhotoType] = useState<"before" | "after">("before");
  const [photoDataUrl, setPhotoDataUrl] = useState("");
  const [photoCaption, setPhotoCaption] = useState("");
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [showPhotoModal, setShowPhotoModal] = useState(false);
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [lightboxPhoto, setLightboxPhoto] = useState<{ url: string; title: string; notes?: string } | null>(null);
  const [isProcessingAction, setIsProcessingAction] = useState(false);

  const cameraInputRef = React.useRef<HTMLInputElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setPhotoDataUrl(event.target.result as string);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // Live sync: workers and supervisors see status, checklist, rework and
  // evidence changes land within seconds — no pull-to-refresh guessing.
  React.useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      void refreshJobs();
      void refreshQuality();
      void refreshPhotos();
    };
    const interval = setInterval(tick, 8000);
    return () => clearInterval(interval);
  }, [refreshJobs, refreshQuality, refreshPhotos]);

  const currentJob = jobs.find((j) => j.id === selectedJobId) || assignedJobs[0];
  const customer = customers.find((c) => c.id === currentJob?.customerId);
  const property = properties.find((p) => p.id === currentJob?.propertyId);
  const service = services.find((s) => s.id === currentJob?.serviceId);
  const currentChecklist = checklistItems.filter((i) => i.jobId === currentJob?.id);
  const currentPhotos = photos.filter((p) => p.jobId === currentJob?.id);
  const jobIssues = qualityIssues.filter((i) => i.jobId === currentJob?.id && i.status !== "resolved" && i.status !== "reinspected_pass");
  const jobRework = reworkTasks.filter((r) => r.jobId === currentJob?.id && r.status !== "completed");

  // Server-rejected transition on the job currently open (e.g. confirmation gate).
  const currentTransitionError =
    transitionError && currentJob && transitionError.jobId === currentJob.id ? transitionError.message : null;

  // Lead-worker context: the FIRST entry of assignedStaffIds is the lead.
  // Confirmation itself is performed by the CUSTOMER on their secure link —
  // the lead worker simply waits for it (the desk can mint/share that link).
  const isLeadForJob =
    currentUser.role === "super_admin" ||
    currentJob?.assignedManagerId === currentUser.id ||
    currentJob?.assignedStaffIds?.[0] === currentUser.id;

  // Role separation: field EXECUTION (arrival, checklist, photos,
  // completing work) belongs to the assigned field worker; the owner may
  // override from the desk. The ops_manager (QC) gets a read-only supervisor
  // view — dispatch and quality audits are theirs, physical work is not.
  const canExecuteFieldWork = currentUser.role === "staff" || currentUser.role === "super_admin";
  const isSupervisor = currentUser.role === "ops_manager";

  // Co-assigned workers visible on the job card (dynamic — no hardcoded ids).
  // Server-resolved names first: staff cannot read the user directory, so a
  // users-store lookup alone renders empty team cards. Identity (isMe) stays
  // id-based — names are zipped positionally only when counts align.
  const assignedIds = currentJob?.assignedStaffIds || [];
  const serverNames = currentJob?.assignedStaffNames;
  const nameById = new Map<string, string>();
  assignedIds.forEach((id, idx) => {
    const viaServer = serverNames && serverNames.length === assignedIds.length ? serverNames[idx] : undefined;
    const name = viaServer ?? users.find((u) => u.id === id)?.name;
    if (name) nameById.set(id, name);
  });
  const coWorkers = assignedIds
    .map((id, idx) => ({ id, name: nameById.get(id) ?? `Worker ${idx + 1}`, lead: idx === 0 }))
    .map((w) => ({ ...w, isMe: w.id === currentUser.id }));

  const showToast = (msg: string) => {
    setSuccessToast(msg);
    setTimeout(() => setSuccessToast(null), 3500);
  };

  const handleMarkArrived = async () => {
    if (!currentJob) return;
    setIsProcessingAction(true);
    const res = transitionJobStatus(currentJob.id, "ARRIVED");
    setIsProcessingAction(false);
    if (!res.success) {
      showToast(res.message);
      return;
    }
    showToast("Arrival confirmed!");
    if (isLeadForJob) {
      // The desk/manager mints the customer-verification link on arrival;
      // the crew waits for the customer to confirm on that secure link.
      await refreshJobs();
    }
  };

  const handleStartJob = async () => {
    if (!currentJob) return;
    if (!currentJob.customerConfirmedAt) {
      showToast("Waiting for the customer to confirm arrival on their secure link.");
      return;
    }
    setIsProcessingAction(true);
    const res = transitionJobStatus(currentJob.id, "IN_PROGRESS");
    setIsProcessingAction(false);
    showToast(res.success ? "Cleaning timer started! Checklists active." : res.message);
  };

  const handleCompleteWork = async () => {
    if (!currentJob) return;
    const pendingCritical = currentChecklist.filter(
      (i) => i.critical && i.status !== "completed" && i.status !== "skipped"
    );
    if (pendingCritical.length > 0) {
      showToast(
        `${pendingCritical.length} mandatory checklist item${pendingCritical.length === 1 ? "" : "s"} still open — complete them before submitting.`
      );
      return;
    }
    setIsProcessingAction(true);
    const res = transitionJobStatus(currentJob.id, "WORK_COMPLETED");
    setIsProcessingAction(false);
    showToast(res.success ? "Work marked complete! Submitted to Quality Control." : res.message);
  };

  // Rework completion: the server closes the task, resolves the linked QC
  // defect, and — when it is the last open task — moves the job to
  // REWORK_COMPLETED for reinspection. The client simply re-syncs.
  const handleReworkDone = async (taskId: string) => {
    if (!currentJob) return;
    setIsProcessingAction(true);
    const res = await completeReworkTask(taskId, "Corrective work completed on site.");
    if (!res.success) {
      setIsProcessingAction(false);
      showToast(res.message);
      return;
    }
    await refreshJobs();
    await refreshQuality();
    setIsProcessingAction(false);
    showToast("Rework done — the QC desk has been notified for reinspection.");
  };

  const handleAddPhotoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!photoDataUrl || !currentJob) return;

    setPhotoUploading(true);
    setPhotoError(null);
    // Shrink the photo in the browser first: raw camera files exceed the
    // platform's request-size limit and were the cause of intermittent
    // failed uploads.
    const prepared = await compressImageForUpload(photoDataUrl);
    const res = await addJobPhoto({
      jobId: currentJob.id,
      area: photoArea,
      photoType,
      imageDataUrl: prepared.dataUrl,
      caption: photoCaption || undefined,
    });
    setPhotoUploading(false);

    if (res.success) {
      setShowPhotoModal(false);
      setPhotoDataUrl("");
      setPhotoCaption("");
      const sizeNote = prepared.compressed
        ? ` (${(prepared.originalBytes / 1024 / 1024).toFixed(1)} MB → ${Math.max(1, Math.round(prepared.finalBytes / 1024))} KB)`
        : "";
      showToast(`${photoType.toUpperCase()} photo uploaded for ${photoArea}!${sizeNote}`);
    } else {
      setPhotoError(res.message);
    }
  };

  // §10 Sticky primary action — the ONE next step, always within thumb reach.
  const fieldPrimaryAction = (() => {
    if (!currentJob || !canExecuteFieldWork) return null;
    switch (currentJob.status) {
      case "ASSIGNED":
        return { label: "Mark Arrived at Property", run: handleMarkArrived, tone: "coral" as const };
      case "ARRIVED":
        return isLeadForJob
          ? { label: "Wait for Customer Confirmation (Secure Link)", run: async () => {
              await refreshJobs();
              showToast("The customer confirms on their secure link — the desk can re-share it from the job file.");
            }, tone: "amber" as const }
          : null;
      case "CUSTOMER_VERIFIED":
        return { label: "Start Job & Begin Cleaning", run: handleStartJob, tone: "coral" as const };
      case "IN_PROGRESS":
        return { label: "Complete Cleaning Work (Submit for QC)", run: handleCompleteWork, tone: "coral" as const };
      default:
        return null;
    }
  })();

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-start pb-44">
      {/* Mobile Top Header — light, matching the cream field */}
      <header className="w-full max-w-md bg-white/95 backdrop-blur border-b border-slate-200 p-4 sticky top-0 z-30 shadow-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {(currentUser.role === "super_admin" || currentUser.role === "ops_manager") && (
              <Link href="/" className="p-1 rounded bg-slate-100 text-slate-500 hover:text-slate-900 hover:bg-slate-200">
                <ChevronLeft className="h-4 w-4" />
              </Link>
            )}
            <div>
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                {isSupervisor ? "Field Supervisor (Read-Only)" : "Field Technician Portal"}
              </div>
              <div className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                {currentUser.name}
              </div>
            </div>
          </div>

          {(currentUser.role === "super_admin" || currentUser.role === "ops_manager") && (
            <Link href="/">
              <Button size="sm" variant="outline" className="h-7 text-[11px]">
                Admin Web
              </Button>
            </Link>
          )}
        </div>

        {/* Job Selector Tab Bar — Today's assigned jobs */}
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {assignedJobs.map((j) => (
            <button
              key={j.id}
              onClick={() => setSelectedJobId(j.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all border ${
                j.id === currentJob?.id
                  ? "bg-rose-500 text-white border-rose-500 shadow-sm font-semibold"
                  : "bg-white text-slate-600 border-slate-200 hover:border-rose-300"
              }`}
            >
              {j.id} • {j.status.replace("_", " ")}
            </button>
          ))}
        </div>
      </header>

      {/* Success Notification Banner */}
      {successToast && (
        <div className="w-full max-w-md p-3 bg-emerald-600 text-white text-xs font-semibold shadow-md flex items-center justify-between animate-in fade-in slide-in-from-top-2">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4" />
            {successToast}
          </span>
          <button onClick={() => setSuccessToast(null)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Server-rejected transition banner (authoritative error, not a fake success) */}
      {currentTransitionError && (
        <div className="w-full max-w-md p-3 bg-red-600 text-white text-xs font-semibold shadow-md flex items-center justify-between animate-in fade-in slide-in-from-top-2">
          <span className="flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4" />
            {currentTransitionError}
          </span>
        </div>
      )}

      {/* Mobile Main Body */}
      {!currentJob ? (
        <main className="w-full max-w-md p-6 text-center space-y-4 mt-8">
          <div className="h-14 w-14 rounded-lg bg-white border border-slate-200 text-slate-400 flex items-center justify-center mx-auto shadow-xs">
            <Smartphone className="h-7 w-7 text-blue-600" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-slate-900">No Assigned Jobs</h3>
            <p className="text-xs text-slate-500 max-w-xs mx-auto leading-relaxed">
              You currently have no assigned field appointments. Once operations assigns a job to you directly, it will automatically appear here with address directions and your workflow controls.
            </p>
          </div>
          {(currentUser.role === "super_admin" || currentUser.role === "ops_manager") && (
            <div className="pt-2">
              <Link href="/dispatcher">
                <Button size="sm" className="bg-rose-500 text-white text-xs h-9">
                  View Dispatch Queue
                </Button>
              </Link>
            </div>
          )}
        </main>
      ) : (
        <main className="w-full max-w-md p-4 space-y-4">
          {/* Active Job Card */}
          <div id="field-job" className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3 scroll-mt-24">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-semibold text-slate-900 bg-slate-100 px-2 py-0.5 rounded">
                {currentJob.id}
              </span>
              <JobStatusBadge status={currentJob.status} size="sm" />
            </div>

            <div className="space-y-1">
              <h2 className="text-base font-semibold text-slate-900 leading-tight">
                {customer?.name}
              </h2>
              <p className="text-xs text-slate-600 font-medium">
                {service?.name}
              </p>
              <div className="flex items-start gap-1.5 text-xs text-slate-500 pt-1">
                <MapPin className="h-3.5 w-3.5 text-zinc-400 shrink-0 mt-0.5" />
                <span>{property?.address}</span>
              </div>
            </div>

            {/* Assigned workers on this job (dynamic roster) */}
            {coWorkers.length > 0 && (
              <div className="pt-1 border-t border-slate-100">
                <span className="text-[10px] font-semibold text-slate-400">
                  Assigned Field Workers
                </span>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {coWorkers.map((w, i) => (
                    <span
                      key={i}
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                        w.isMe
                          ? "bg-blue-50 border-blue-200 text-blue-800"
                          : "bg-slate-50 border-slate-200 text-slate-700"
                      }`}
                    >
                      {w.name}
                      {w.lead && " • Lead"}
                      {w.isMe && " (You)"}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Quick Contact & Navigation Buttons */}
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100">
              <a
                href={`tel:${customer?.phone}`}
                className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-800 hover:bg-slate-100 transition-colors"
              >
                <Phone className="h-3.5 w-3.5 text-emerald-600" />
                Call Customer
              </a>
              <a
                href={`https://maps.google.com/?q=${encodeURIComponent(property?.address || "")}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-800 hover:bg-slate-100 transition-colors"
              >
                <Navigation className="h-3.5 w-3.5 text-blue-600" />
                GPS Map
              </a>
            </div>
          </div>

          {/* PRIMARY WORKFLOW ACTION BUTTON (Large Touch Target) */}
          <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm space-y-3">
            <div className="text-xs font-semibold text-slate-400">
              Next Required Step
            </div>

            {/* Supervisor view: ops_manager observes without executing */}
            {isSupervisor && !["WORK_COMPLETED", "QUALITY_CHECK", "REWORK_REQUIRED", "REWORK_COMPLETED", "REINSPECTION", "CUSTOMER_APPROVAL", "COMPLETED", "CLOSED", "CANCELLED"].includes(currentJob.status) && (
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-slate-600 text-xs space-y-1">
                <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                  <Eye className="h-4 w-4" />
                  Supervisor View — read-only
                </div>
                Arrival, customer confirmation, checklist and evidence uploads are performed by the assigned field worker on their device. Your desk controls dispatch (Jobs) and quality audits (Quality Control).
              </div>
            )}

            {/* Step 1: ASSIGNED -> Mark Arrived (field worker / owner) */}
            {currentJob.status === "ASSIGNED" && canExecuteFieldWork && (
              <Button
                onClick={handleMarkArrived}
                disabled={isProcessingAction}
                className="w-full h-12 text-sm font-semibold bg-rose-500 text-white hover:bg-rose-600 rounded-lg shadow-sm"
              >
                {isProcessingAction ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <MapPin className="h-4 w-4 mr-2" />
                    Mark Arrived at Property
                  </>
                )}
              </Button>
            )}

            {/* Step 2: ARRIVED -> wait for customer confirmation (secure link) */}
            {currentJob.status === "ARRIVED" && canExecuteFieldWork && (
              <div className="space-y-2">
                {isLeadForJob ? (
                  <>
                    <div className="w-full h-12 flex items-center justify-center text-sm font-semibold bg-amber-100 text-amber-900 rounded-lg border border-amber-300">
                      <Clock className="h-4 w-4 mr-2" />
                      Waiting for Customer Confirmation
                    </div>
                    <div className="p-2.5 rounded bg-amber-50 border border-amber-200 text-amber-900 text-xs">
                      <strong>Notice:</strong> Work unlocks only after the customer confirms team arrival on their secure link. The desk can share that link from the job file (QR &amp; Links panel).
                    </div>
                  </>
                ) : (
                  <div className="p-3 rounded bg-slate-50 border border-slate-200 text-slate-700 text-xs">
                    <strong>Lead worker step:</strong> the customer must confirm team arrival on their secure link before work starts. You can begin your assigned tasks once confirmation completes.
                  </div>
                )}
              </div>
            )}

            {/* Step 3: CUSTOMER_VERIFIED -> Start Job (field worker / owner) */}
            {currentJob.status === "CUSTOMER_VERIFIED" && canExecuteFieldWork && (
              <Button
                onClick={handleStartJob}
                disabled={isProcessingAction}
                className="w-full h-12 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow-sm"
              >
                {isProcessingAction ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Start Job & Begin Cleaning
                  </>
                )}
              </Button>
            )}

            {/* Step 4: IN_PROGRESS -> Work execution active */}
            {currentJob.status === "IN_PROGRESS" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between p-2.5 rounded bg-blue-50 border border-blue-200 text-blue-900 text-xs font-semibold">
                  <span className="flex items-center gap-1.5">
                    <Clock className="h-4 w-4 text-blue-600 animate-spin" />
                    Deep Cleaning in Progress
                  </span>
                  <span>Started {new Date(currentJob.startedAt || "").toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>

                {canExecuteFieldWork ? (
                  <Button
                    onClick={handleCompleteWork}
                    disabled={isProcessingAction}
                    className="w-full h-12 text-sm font-semibold bg-rose-500 text-white hover:bg-rose-600 rounded-lg shadow-sm"
                  >
                    {isProcessingAction ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                        Complete Cleaning Work (Submit for QC)
                      </>
                    )}
                  </Button>
                ) : (
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-slate-600 text-xs">
                    The field worker is executing the checklist. Live progress streams to your Quality Control desk.
                  </div>
                )}
              </div>
            )}

            {/* Step 5: WORK_COMPLETED / QUALITY_CHECK / REWORK */}
            {(currentJob.status === "WORK_COMPLETED" || currentJob.status === "QUALITY_CHECK") && (
              <div className="p-4 rounded-lg bg-purple-50 border border-purple-200 text-purple-900 text-xs text-center space-y-1">
                <div className="font-semibold text-sm">Awaiting Operations Manager QC Audit</div>
                <p className="text-purple-700 text-[11px]">
                  Operations Manager is reviewing room standards.
                </p>
              </div>
            )}

            {/* Step 5: REWORK loop — QC's instructions are shown verbatim with
                a one-tap “done” action; the server advances the pipeline. */}
            {(currentJob.status === "REWORK_REQUIRED" || currentJob.status === "REWORK_COMPLETED") && (
              <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-900 text-xs space-y-2">
                <div className="font-semibold flex items-center gap-1.5 text-red-700">
                  <AlertTriangle className="h-4 w-4" />
                  Rework Required — QC Instructions
                </div>
                <p className="text-[11px] text-red-800">
                  The Quality Control desk flagged the items below. Fix each one on site, then mark it done — the desk is notified instantly for reinspection.
                </p>
                {jobRework.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    {jobRework.map((task) => {
                      const linkedIssue = jobIssues.find((i) => i.reworkTaskId === task.id);
                      return (
                        <div key={task.id} className="p-2.5 rounded bg-white border border-red-200 space-y-1.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {linkedIssue?.area && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-slate-100 text-slate-700">
                                {linkedIssue.area}
                              </span>
                            )}
                            {linkedIssue?.severity && (
                              <span
                                className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                                  linkedIssue.severity === "critical"
                                    ? "bg-red-600 text-white"
                                    : linkedIssue.severity === "major"
                                    ? "bg-amber-100 text-amber-800"
                                    : "bg-slate-200 text-slate-700"
                                }`}
                              >
                                {linkedIssue.severity}
                              </span>
                            )}
                          </div>
                          <p className="font-medium text-rose-900">{task.instructions}</p>
                          {canExecuteFieldWork ? (
                            <Button
                              size="sm"
                              disabled={isProcessingAction}
                              onClick={() => handleReworkDone(task.id)}
                              className="h-8 text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white"
                            >
                              {isProcessingAction ? (
                                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                              ) : (
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                              )}
                              Mark This Rework Done
                            </Button>
                          ) : (
                            <p className="text-[10px] text-slate-400 italic">
                              The assigned field worker completes this task.
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {jobRework.length === 0 && (
                  <p className="text-[11px] text-red-800 italic">
                    Syncing rework instructions from the QC desk…
                  </p>
                )}
              </div>
            )}

            {currentJob.status === "CUSTOMER_APPROVAL" && (
              <div className="p-4 rounded-lg bg-teal-50 border border-teal-200 text-teal-900 text-xs text-center space-y-1">
                <div className="font-semibold text-sm">QC Passed! With Customer for Sign-Off</div>
                <p className="text-teal-700 text-[11px]">
                  Customer has received their digital sign-off link.
                </p>
              </div>
            )}

            {currentJob.status === "COMPLETED" && (
              <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs text-center space-y-1">
                <div className="font-semibold text-sm">Job Successfully Completed</div>
                <p className="text-emerald-700 text-[11px]">
                  Digital record archived and customer invoice paid.
                </p>
              </div>
            )}
          </div>

          {/* Area Checklist Card */}
          <div id="field-checklist" className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3 scroll-mt-24">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <span className="text-xs font-semibold text-slate-500">
                Service Checklist
              </span>
              <span className="text-xs font-semibold text-slate-800">
                {currentChecklist.filter((i) => i.status === "completed").length} / {currentChecklist.length} Done
              </span>
            </div>

            <div className="space-y-2">
              {currentChecklist.map((item) => (
                <div
                  key={item.id}
                  onClick={() => {
                    if (!canExecuteFieldWork) return; // read-only for supervisors
                    const newStatus = item.status === "completed" ? "pending" : "completed";
                    updateChecklistItem(item.id, newStatus);
                  }}
                  className={`p-3 rounded-lg border flex items-start gap-3 ${
                    canExecuteFieldWork ? "cursor-pointer transition-all" : "opacity-90"
                  } ${
                    item.status === "completed"
                      ? "bg-emerald-50/50 border-emerald-200 text-slate-900"
                      : canExecuteFieldWork
                      ? "bg-slate-50 border-slate-200 hover:bg-slate-100/70"
                      : "bg-slate-50 border-slate-200"
                  }`}
                >
                  <div
                    className={`h-6 w-6 rounded-md flex items-center justify-center shrink-0 mt-0.5 border ${
                      item.status === "completed"
                        ? "bg-emerald-600 border-emerald-600 text-white"
                        : "bg-white border-slate-300"
                    }`}
                  >
                    {item.status === "completed" && <Check className="h-4 w-4 stroke-[3]" />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-slate-200/80 text-slate-700">
                        {item.area}
                      </span>
                      {item.critical && (
                        <span className="text-[9px] font-semibold text-red-600">
                          *Mandatory
                        </span>
                      )}
                    </div>
                    <p className={`text-xs mt-1 font-medium ${item.status === "completed" ? "line-through text-slate-500" : "text-slate-800"}`}>
                      {item.task}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Photo Evidence Section */}
          <div id="field-photos" className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3 scroll-mt-24">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <span className="text-xs font-semibold text-slate-500">
                Photo Proof ({currentPhotos.length})
              </span>
              {canExecuteFieldWork && (
                <Button
                  size="sm"
                  onClick={() => setShowPhotoModal(true)}
                  className="h-7 text-xs bg-rose-500 text-white px-2.5 font-medium"
                >
                  <Camera className="h-3.5 w-3.5 mr-1" />
                  Add Photo
                </Button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              {currentPhotos.map((p) => (
                <div 
                  key={p.id} 
                  className="rounded-lg border border-slate-200 overflow-hidden text-xs bg-slate-50 cursor-pointer group"
                  onClick={() => setLightboxPhoto({ url: p.photoUrl, title: `${p.area} — ${p.photoType.toUpperCase()}`, notes: p.caption })}
                >
                  <div className="aspect-video relative bg-slate-200">
                    <img src={p.photoUrl} alt={p.area} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
                    <span
                      className={`absolute top-1 left-1 px-1 py-0.2 rounded text-[9px] font-semibold text-white ${
                        p.photoType === "before" ? "bg-amber-600" : "bg-emerald-600"
                      }`}
                    >
                      {p.photoType}
                    </span>
                  </div>
                  <div className="p-1.5">
                    <div className="font-semibold truncate text-[11px] text-slate-900">{p.area}</div>
                    {p.caption && <p className="text-[10px] text-slate-500 truncate">{p.caption}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </main>
      )}


      {/* Add Photo Modal */}
      {showPhotoModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-lg max-w-sm w-full p-4 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-900">Upload Evidence Photo</h3>
              <button onClick={() => setShowPhotoModal(false)}>
                <X className="h-4 w-4 text-slate-400" />
              </button>
            </div>

            <form onSubmit={handleAddPhotoSubmit} className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Area</label>
                <select
                  value={photoArea}
                  onChange={(e) => setPhotoArea(e.target.value)}
                  className="w-full h-9 rounded-md border border-slate-200 px-2 bg-white"
                >
                  {/* §7 canonical areas — matches the gallery grouping */}
                  <option value="Living Room">Living Room</option>
                  <option value="Bedroom">Bedroom</option>
                  <option value="Kitchen">Kitchen</option>
                  <option value="Bathroom">Bathroom</option>
                  <option value="Balcony">Balcony</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Photo Condition Type</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      checked={photoType === "before"}
                      onChange={() => setPhotoType("before")}
                    />
                    Before Cleaning
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      checked={photoType === "after"}
                      onChange={() => setPhotoType("after")}
                    />
                    After Cleaning
                  </label>
                </div>
              </div>

              {/* Camera Capture / File Upload UI */}
              <div className="space-y-2">
                <label className="font-semibold text-slate-700 block">Capture or Select Photo</label>

                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  ref={cameraInputRef}
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <input
                  type="file"
                  accept="image/*"
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  className="hidden"
                />

                {photoDataUrl ? (
                  <div className="relative rounded-lg overflow-hidden border border-slate-200 bg-slate-900 group">
                    <img src={photoDataUrl} alt="Evidence Preview" className="w-full h-36 object-cover" />
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-8 text-xs bg-white text-slate-900 font-semibold"
                        onClick={() => cameraInputRef.current?.click()}
                      >
                        <Camera className="h-3.5 w-3.5 mr-1 text-slate-700" />
                        Retake
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        className="h-8 text-xs bg-red-600 hover:bg-red-700 text-white font-medium"
                        onClick={() => setPhotoDataUrl("")}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => cameraInputRef.current?.click()}
                      className="p-3.5 rounded-lg border-2 border-dashed border-blue-300 bg-blue-50/60 hover:bg-blue-100/70 transition-all flex flex-col items-center justify-center text-center group"
                    >
                      <div className="h-9 w-9 rounded-full bg-blue-600 text-white flex items-center justify-center mb-1 shadow-xs group-hover:scale-105 transition-transform">
                        <Camera className="h-4 w-4" />
                      </div>
                      <span className="text-xs font-semibold text-blue-950">Camera</span>
                      <span className="text-[10px] text-blue-600">Snap on-site photo</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="p-3.5 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 transition-all flex flex-col items-center justify-center text-center group"
                    >
                      <div className="h-9 w-9 rounded-full bg-slate-800 text-white flex items-center justify-center mb-1 shadow-xs group-hover:scale-105 transition-transform">
                        <Upload className="h-4 w-4" />
                      </div>
                      <span className="text-xs font-semibold text-slate-900">Gallery / Files</span>
                      <span className="text-[10px] text-slate-500">Upload device photo</span>
                    </button>
                  </div>
                )}

                {photoError && (
                  <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2.5 py-1.5">{photoError}</p>
                )}
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Remarks / Caption</label>
                <input
                  type="text"
                  value={photoCaption}
                  onChange={(e) => setPhotoCaption(e.target.value)}
                  placeholder="E.g., Acid-free limescale treatment applied"
                  className="w-full h-9 rounded-md border border-slate-200 px-3 bg-white"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowPhotoModal(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={photoUploading} className="">
                  {photoUploading ? "Uploading…" : "Save Photo"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Lightbox Pop-up Modal */}
      {lightboxPhoto && (
        <ImageLightboxModal
          isOpen={!!lightboxPhoto}
          onClose={() => setLightboxPhoto(null)}
          imageUrl={lightboxPhoto.url}
          title={lightboxPhoto.title}
          notes={lightboxPhoto.notes}
        />
      )}

      {/* §10 Sticky primary action — one obvious button, always in thumb reach */}
      {currentJob && fieldPrimaryAction && (
        <div className="fixed bottom-16 inset-x-0 z-40 px-4">
          <div className="mx-auto max-w-md">
            <Button
              onClick={fieldPrimaryAction.run}
              disabled={isProcessingAction}
              className={cn(
                "w-full h-12 text-sm font-semibold rounded-xl shadow-lg",
                fieldPrimaryAction.tone === "amber"
                  ? "bg-amber-500 hover:bg-amber-600 text-slate-950"
                  : "bg-rose-500 hover:bg-rose-600 text-white"
              )}
            >
              {isProcessingAction ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  {fieldPrimaryAction.tone === "amber" && <Clock className="h-4 w-4 mr-2" />}
                  {fieldPrimaryAction.label}
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* §10 Bottom navigation — the field flow sections */}
      {currentJob && (
        <nav className="fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-slate-200">
          <div className="mx-auto max-w-md grid grid-cols-3">
            {[
              { id: "field-job", label: "Job", icon: Smartphone },
              { id: "field-checklist", label: "Checklist", icon: Layers },
              { id: "field-photos", label: "Photos", icon: Camera },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => scrollToSection(tab.id)}
                className="flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-semibold text-slate-500 hover:text-rose-600 active:text-rose-600 transition-colors"
              >
                <tab.icon className="h-5 w-5" />
                {tab.label}
              </button>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}
