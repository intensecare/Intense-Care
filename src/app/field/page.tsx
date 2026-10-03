"use client";

import React, { useState } from "react";
import { useApp } from "@/lib/app-context";
import { JobStatusBadge } from "@/components/common/JobStatusBadge";
import { OTPModal } from "@/components/common/OTPModal";
import { formatDateTime } from "@/lib/utils";
import {
  Smartphone,
  MapPin,
  Phone,
  Navigation,
  Check,
  CheckCircle2,
  Clock,
  KeyRound,
  Play,
  Camera,
  Layers,
  ArrowRight,
  AlertTriangle,
  ChevronLeft,
  X,
  Upload,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import { ImageLightboxModal } from "@/components/common/ImageLightboxModal";
import { Button } from "@/components/ui/button";

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
    sendJobArrivalOTP,
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
  const [isOtpOpen, setIsOtpOpen] = useState(false);
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

  const currentJob = jobs.find((j) => j.id === selectedJobId) || assignedJobs[0];
  const customer = customers.find((c) => c.id === currentJob?.customerId);
  const property = properties.find((p) => p.id === currentJob?.propertyId);
  const service = services.find((s) => s.id === currentJob?.serviceId);
  const currentChecklist = checklistItems.filter((i) => i.jobId === currentJob?.id);
  const currentPhotos = photos.filter((p) => p.jobId === currentJob?.id);
  const jobIssues = qualityIssues.filter((i) => i.jobId === currentJob?.id && i.status !== "resolved" && i.status !== "reinspected_pass");
  const jobRework = reworkTasks.filter((r) => r.jobId === currentJob?.id && r.status !== "completed");

  // Server-rejected transition on the job currently open (e.g. OTP gate).
  const currentTransitionError =
    transitionError && currentJob && transitionError.jobId === currentJob.id ? transitionError.message : null;

  // Lead-worker gate: the FIRST entry of assignedStaffIds controls the
  // customer OTP flow (receive via SMS, enter/verify, unlock work). Support
  // workers on the same job execute it without OTP control. Managers/admins
  // retain oversight access.
  const isLeadForJob = isManager
    ? true
    : currentJob?.assignedManagerId === currentUser.id ||
      currentJob?.assignedStaffIds?.[0] === currentUser.id;

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
      // Wait for the server to confirm ARRIVED, then open the OTP modal —
      // opening it triggers the real SMS dispatch (2Factor AUTOGEN).
      await refreshJobs();
      setIsOtpOpen(true);
    }
  };

  const handleStartJob = async () => {
    if (!currentJob) return;
    if (currentJob.otpVerification.status !== "verified") {
      if (isLeadForJob) {
        setIsOtpOpen(true);
      } else {
        showToast("Waiting for the lead worker to verify the customer OTP.");
      }
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

  const handleAddPhotoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!photoDataUrl || !currentJob) return;

    setPhotoUploading(true);
    setPhotoError(null);
    const res = await addJobPhoto({
      jobId: currentJob.id,
      area: photoArea,
      photoType,
      imageDataUrl: photoDataUrl,
      caption: photoCaption || undefined,
    });
    setPhotoUploading(false);

    if (res.success) {
      setShowPhotoModal(false);
      setPhotoDataUrl("");
      setPhotoCaption("");
      showToast(`${photoType.toUpperCase()} photo uploaded for ${photoArea}!`);
    } else {
      setPhotoError(res.message);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-start pb-16">
      {/* Mobile Top Header */}
      <header className="w-full max-w-md bg-slate-900 text-white p-4 sticky top-0 z-30 shadow-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {(currentUser.role === "super_admin" || currentUser.role === "ops_manager") && (
              <Link href="/" className="p-1 rounded bg-slate-800 text-slate-300 hover:text-white">
                <ChevronLeft className="h-4 w-4" />
              </Link>
            )}
            <div>
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Field Technician Portal
              </div>
              <div className="text-sm font-bold text-white flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                {currentUser.name}
              </div>
            </div>
          </div>

          {(currentUser.role === "super_admin" || currentUser.role === "ops_manager") && (
            <Link href="/">
              <Button size="sm" variant="outline" className="h-7 text-[11px] bg-slate-800 text-slate-200 border-slate-700">
                Admin Web
              </Button>
            </Link>
          )}
        </div>

        {/* Job Selector Tab Bar */}
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {assignedJobs.map((j) => (
            <button
              key={j.id}
              onClick={() => setSelectedJobId(j.id)}
              className={`px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap transition-all ${
                j.id === currentJob?.id
                  ? "bg-white text-slate-900 shadow-sm font-bold"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              {j.id} • {j.status}
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
        <div className="w-full max-w-md p-3 bg-rose-600 text-white text-xs font-semibold shadow-md flex items-center justify-between animate-in fade-in slide-in-from-top-2">
          <span className="flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4" />
            {currentTransitionError}
          </span>
        </div>
      )}

      {/* Mobile Main Body */}
      {!currentJob ? (
        <main className="w-full max-w-md p-6 text-center space-y-4 mt-8">
          <div className="h-14 w-14 rounded-2xl bg-white border border-slate-200 text-slate-400 flex items-center justify-center mx-auto shadow-xs">
            <Smartphone className="h-7 w-7 text-blue-600" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-slate-900">No Assigned Jobs</h3>
            <p className="text-xs text-slate-500 max-w-xs mx-auto leading-relaxed">
              You currently have no assigned field appointments. Once operations assigns a job to you directly, it will automatically appear here with address directions and your workflow controls.
            </p>
          </div>
          {(currentUser.role === "super_admin" || currentUser.role === "ops_manager") && (
            <div className="pt-2">
              <Link href="/dispatcher">
                <Button size="sm" className="bg-slate-900 text-white text-xs h-9">
                  View Dispatch Queue
                </Button>
              </Link>
            </div>
          )}
        </main>
      ) : (
        <main className="w-full max-w-md p-4 space-y-4">
          {/* Active Job Card */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded">
                {currentJob.id}
              </span>
              <JobStatusBadge status={currentJob.status} size="sm" />
            </div>

            <div className="space-y-1">
              <h2 className="text-base font-bold text-slate-900 leading-tight">
                {customer?.name}
              </h2>
              <p className="text-xs text-slate-600 font-medium">
                {service?.name}
              </p>
              <div className="flex items-start gap-1.5 text-xs text-slate-500 pt-1">
                <MapPin className="h-3.5 w-3.5 text-rose-500 shrink-0 mt-0.5" />
                <span>{property?.address}</span>
              </div>
            </div>

            {/* Assigned workers on this job (dynamic roster) */}
            {coWorkers.length > 0 && (
              <div className="pt-1 border-t border-slate-100">
                <span className="text-[10px] uppercase font-bold text-slate-400">
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
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Next Required Step
            </div>

            {/* Step 1: ASSIGNED -> Mark Arrived */}
            {currentJob.status === "ASSIGNED" && (
              <Button
                onClick={handleMarkArrived}
                disabled={isProcessingAction}
                className="w-full h-12 text-sm font-bold bg-slate-900 hover:bg-slate-800 text-white rounded-lg shadow-sm"
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

            {/* Step 2: ARRIVED -> Verify Customer OTP (lead worker only) */}
            {currentJob.status === "ARRIVED" && (
              <div className="space-y-2">
                {isLeadForJob ? (
                  <>
                    <Button
                      onClick={() => setIsOtpOpen(true)}
                      className="w-full h-12 text-sm font-bold bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-lg shadow-sm"
                    >
                      <KeyRound className="h-4 w-4 mr-2" />
                      Enter Customer OTP to Unlock Entry
                    </Button>
                    <div className="p-2.5 rounded bg-amber-50 border border-amber-200 text-amber-900 text-xs">
                      <strong>Notice:</strong> Cleaning equipment cannot be unloaded until the customer shares their 6-digit OTP (sent by SMS to their registered number) and it is verified.
                    </div>
                  </>
                ) : (
                  <div className="p-3 rounded bg-slate-50 border border-slate-200 text-slate-700 text-xs">
                    <strong>Lead worker step:</strong> the lead worker assigned to this job must enter the customer OTP to unlock entry. You can begin your assigned tasks once verification completes.
                  </div>
                )}
              </div>
            )}

            {/* Step 3: CUSTOMER_VERIFIED -> Start Job */}
            {currentJob.status === "CUSTOMER_VERIFIED" && (
              <Button
                onClick={handleStartJob}
                disabled={isProcessingAction}
                className="w-full h-12 text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow-sm"
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

                <Button
                  onClick={handleCompleteWork}
                  disabled={isProcessingAction}
                  className="w-full h-12 text-sm font-bold bg-slate-900 hover:bg-slate-800 text-white rounded-lg shadow-sm"
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
              </div>
            )}

            {/* Step 5: WORK_COMPLETED / QUALITY_CHECK / REWORK */}
            {(currentJob.status === "WORK_COMPLETED" || currentJob.status === "QUALITY_CHECK") && (
              <div className="p-4 rounded-lg bg-purple-50 border border-purple-200 text-purple-900 text-xs text-center space-y-1">
                <div className="font-bold text-sm">Awaiting Operations Manager QC Audit</div>
                <p className="text-purple-700 text-[11px]">
                  Operations Manager is reviewing room standards.
                </p>
              </div>
            )}

            {(currentJob.status === "REWORK_REQUIRED" || currentJob.status === "REWORK_COMPLETED") && (
              <div className="p-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-900 text-xs space-y-2">
                <div className="font-bold flex items-center gap-1.5 text-rose-700">
                  <AlertTriangle className="h-4 w-4" />
                  Rework Tasks Flagged by Operations Manager
                </div>
                <p className="text-[11px] text-rose-800">
                  Please review the defects below, perform corrections, and submit for reinspection.
                </p>
                {jobRework.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    {jobRework.map((task) => (
                      <div key={task.id} className="p-2.5 rounded bg-white border border-rose-200 space-y-1.5">
                        <p className="font-medium text-rose-900">{task.instructions}</p>
                        <Button
                          size="sm"
                          onClick={async () => {
                            const res = await completeReworkTask(task.id, "Corrective work completed on site.");
                            showToast(res.success ? "Rework task completed — awaiting reinspection." : res.message);
                            if (res.success) {
                              void refreshJobs();
                              const cur = transitionJobStatus(currentJob.id, "REWORK_COMPLETED");
                              if (cur.success) void refreshJobs();
                            }
                          }}
                          className="h-7 text-[11px] bg-rose-600 hover:bg-rose-700 text-white"
                        >
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Mark This Rework Done
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {currentJob.status === "CUSTOMER_APPROVAL" && (
              <div className="p-4 rounded-lg bg-teal-50 border border-teal-200 text-teal-900 text-xs text-center space-y-1">
                <div className="font-bold text-sm">QC Passed! With Customer for Sign-Off</div>
                <p className="text-teal-700 text-[11px]">
                  Customer has received their digital sign-off link.
                </p>
              </div>
            )}

            {currentJob.status === "COMPLETED" && (
              <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs text-center space-y-1">
                <div className="font-bold text-sm">Job Successfully Completed</div>
                <p className="text-emerald-700 text-[11px]">
                  Digital record archived and customer invoice paid.
                </p>
              </div>
            )}
          </div>

          {/* Area Checklist Card */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
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
                    const newStatus = item.status === "completed" ? "pending" : "completed";
                    updateChecklistItem(item.id, newStatus);
                  }}
                  className={`p-3 rounded-lg border transition-all cursor-pointer flex items-start gap-3 ${
                    item.status === "completed"
                      ? "bg-emerald-50/50 border-emerald-200 text-slate-900"
                      : "bg-slate-50 border-slate-200 hover:bg-slate-100/70"
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
                      <span className="text-[10px] font-bold uppercase px-1.5 py-0.2 rounded bg-slate-200/80 text-slate-700">
                        {item.area}
                      </span>
                      {item.critical && (
                        <span className="text-[9px] font-semibold text-rose-600">
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
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Photo Proof ({currentPhotos.length})
              </span>
              <Button
                size="sm"
                onClick={() => setShowPhotoModal(true)}
                className="h-7 text-xs bg-slate-900 text-white px-2.5 font-medium"
              >
                <Camera className="h-3.5 w-3.5 mr-1" />
                Add Photo
              </Button>
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
                      className={`absolute top-1 left-1 px-1 py-0.2 rounded text-[9px] font-bold uppercase text-white ${
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

      {/* OTP Modal — mounted ONLY for the lead worker of the current job */}
      {currentJob && isLeadForJob && (
        <OTPModal
          job={currentJob}
          isOpen={isOtpOpen}
          onClose={() => setIsOtpOpen(false)}
          onSuccess={() => {
            showToast("Customer OTP verified! Work unlocked.");
          }}
        />
      )}

      {/* Add Photo Modal */}
      {showPhotoModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-sm w-full p-4 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900">Upload Evidence Photo</h3>
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
                  <option value="Kitchen Chimney & Baffle">Kitchen Chimney & Baffle</option>
                  <option value="Master Bathroom Shower Glass">Master Bathroom Shower Glass</option>
                  <option value="Kitchen Gas Hob & Granite">Kitchen Gas Hob & Granite</option>
                  <option value="Living Room French Windows">Living Room French Windows</option>
                  <option value="Balcony Floor Buffing">Balcony Floor Buffing</option>
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
                        className="h-8 text-xs bg-rose-600 text-white font-semibold"
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
                      className="p-3.5 rounded-xl border-2 border-dashed border-blue-300 bg-blue-50/60 hover:bg-blue-100/70 transition-all flex flex-col items-center justify-center text-center group"
                    >
                      <div className="h-9 w-9 rounded-full bg-blue-600 text-white flex items-center justify-center mb-1 shadow-xs group-hover:scale-105 transition-transform">
                        <Camera className="h-4 w-4" />
                      </div>
                      <span className="text-xs font-bold text-blue-950">Camera</span>
                      <span className="text-[10px] text-blue-600">Snap on-site photo</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="p-3.5 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 transition-all flex flex-col items-center justify-center text-center group"
                    >
                      <div className="h-9 w-9 rounded-full bg-slate-800 text-white flex items-center justify-center mb-1 shadow-xs group-hover:scale-105 transition-transform">
                        <Upload className="h-4 w-4" />
                      </div>
                      <span className="text-xs font-bold text-slate-900">Gallery / Files</span>
                      <span className="text-[10px] text-slate-500">Upload device photo</span>
                    </button>
                  </div>
                )}

                {photoError && (
                  <p className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-2.5 py-1.5">{photoError}</p>
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
                <Button type="submit" size="sm" disabled={photoUploading} className="bg-slate-900 text-white">
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
    </div>
  );
}
