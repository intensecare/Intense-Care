"use client";

import React, { useState } from "react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { JobStatusBadge } from "@/components/common/JobStatusBadge";
import { useApp } from "@/lib/app-context";
import { formatCurrency, formatDate, formatDateTime, timeAgo } from "@/lib/utils";
import type { JobActivityEvent } from "@/lib/types";
import {
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ArrowRight,
  Filter,
  Plus,
  Eye,
  Check,
  X,
  FileSpreadsheet,
  Loader2,
  Radio,
  Bell,
  Camera,
  KeyRound,
  Star,
  ClipboardCheck,
  RotateCcw,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PromptModal } from "@/components/common/PromptModal";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

export default function QualityManagementPage() {
  const {
    jobs,
    customers,
    properties,
    services,
    qualityChecks,
    qualityIssues,
    reworkTasks,
    users,
    submitQualityCheck,
    reinspectAndPassQC,
    refreshJobs,
    refreshQuality,
  } = useApp();

  // Jobs ready for QC inspection or rework clearance
  const qcQueueJobs = jobs.filter(
    (j) =>
      j.status === "WORK_COMPLETED" ||
      j.status === "QUALITY_CHECK" ||
      j.status === "REWORK_REQUIRED" ||
      j.status === "REWORK_COMPLETED" ||
      j.status === "REINSPECTION"
  );

  // ---- Live pipeline feed --------------------------------------------------
  // Every field-worker action (arrival, OTP, checklist tick, photo upload,
  // rework progress) is written server-side to /api/activity. This desk
  // polls it while visible, so the QC person watches work happen instead of
  // asking for status or refreshing the browser.
  const [activityEvents, setActivityEvents] = useState<JobActivityEvent[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/activity?limit=80");
        const json = await res.json().catch(() => null);
        if (!cancelled && res.ok && json?.success) {
          const events: JobActivityEvent[] = json.data ?? [];
          setActivityEvents(events);
          const lastSeen = parseInt(localStorage.getItem("qc_activity_last_seen") || "0", 10);
          setUnreadCount(events.filter((e) => new Date(e.createdAt).getTime() > lastSeen).length);
        }
      } catch {
        // Non-fatal.
      }
    };
    void load();
    const interval = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void load();
    }, 8000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Mark the feed as seen when the QC person is actually looking at it.
  React.useEffect(() => {
    if (document.visibilityState === "visible") {
      localStorage.setItem("qc_activity_last_seen", String(Date.now()));
      setUnreadCount(0);
    }
  }, []);

  // Live job/QC collection sync for the queue itself.
  React.useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      void refreshJobs();
      void refreshQuality();
    };
    const interval = setInterval(tick, 10000);
    return () => clearInterval(interval);
  }, [refreshJobs, refreshQuality]);

  const FEED_ICON: Record<string, React.ReactNode> = {
    STATUS_CHANGED: <ArrowRight className="h-3.5 w-3.5" />,
    STAFF_ASSIGNED: <Bell className="h-3.5 w-3.5" />,
    OTP_SENT: <KeyRound className="h-3.5 w-3.5" />,
    OTP_VERIFIED: <KeyRound className="h-3.5 w-3.5" />,
    CHECKLIST_UPDATED: <ClipboardCheck className="h-3.5 w-3.5" />,
    PHOTO_UPLOADED: <Camera className="h-3.5 w-3.5" />,
    QC_SUBMITTED: <ShieldCheck className="h-3.5 w-3.5" />,
    REWORK_ASSIGNED: <RotateCcw className="h-3.5 w-3.5" />,
    REWORK_COMPLETED: <CheckCircle2 className="h-3.5 w-3.5" />,
    CUSTOMER_SIGNED: <CheckCircle2 className="h-3.5 w-3.5" />,
    ATTENTION_REQUESTED: <AlertTriangle className="h-3.5 w-3.5" />,
    FEEDBACK_RECORDED: <Star className="h-3.5 w-3.5" />,
    GOOGLE_REVIEW_CLICKED: <Star className="h-3.5 w-3.5" />,
  };

  const FEED_TINT: Record<string, string> = {
    STATUS_CHANGED: "bg-slate-100 text-slate-600",
    STAFF_ASSIGNED: "bg-indigo-50 text-indigo-600",
    OTP_SENT: "bg-amber-50 text-amber-600",
    OTP_VERIFIED: "bg-emerald-50 text-emerald-600",
    CHECKLIST_UPDATED: "bg-sky-50 text-sky-600",
    PHOTO_UPLOADED: "bg-blue-50 text-blue-600",
    QC_SUBMITTED: "bg-purple-50 text-purple-600",
    REWORK_ASSIGNED: "bg-rose-50 text-rose-600",
    REWORK_COMPLETED: "bg-amber-50 text-amber-600",
    CUSTOMER_SIGNED: "bg-teal-50 text-teal-600",
    ATTENTION_REQUESTED: "bg-rose-50 text-rose-600",
    FEEDBACK_RECORDED: "bg-amber-50 text-amber-600",
    GOOGLE_REVIEW_CLICKED: "bg-emerald-50 text-emerald-600",
  };

  // First-pass quality rate — derived from actual QC audit records
  const auditedChecks = qualityChecks.filter((qc) => qc.status === "PASS" || qc.status === "REWORK_REQUIRED");
  const firstPassRate = auditedChecks.length > 0
    ? Math.round((qualityChecks.filter((qc) => qc.status === "PASS").length / auditedChecks.length) * 100)
    : 100;
  const completedJobsCount = jobs.filter(
    (j) => j.status === "COMPLETED" || j.status === "FEEDBACK_REQUESTED" || j.status === "CLOSED"
  ).length;

  const [promptConfig, setPromptConfig] = useState<{
    isOpen: boolean;
    title: string;
    description?: string;
    placeholder?: string;
    defaultValue?: string;
    onSubmit: (val: string) => void;
  }>({
    isOpen: false,
    title: "",
    onSubmit: () => {},
  });
  const [auditModalJobId, setAuditModalJobId] = useState<string | null>(null);
  const [auditScore, setAuditScore] = useState<number>(95);
  const [auditDecision, setAuditDecision] = useState<"PASS" | "REWORK_REQUIRED">("PASS");
  const [auditNotes, setAuditNotes] = useState("");
  const [isSubmittingAudit, setIsSubmittingAudit] = useState(false);
  const [isProcessingRework, setIsProcessingRework] = useState(false);
  const [issuesList, setIssuesList] = useState<
    {
      area: string;
      itemDescription: string;
      severity: "minor" | "major" | "critical";
      notes: string;
    }[]
  >([]);

  // Open audit modal for a job
  const handleOpenAuditModal = (jobId: string) => {
    setAuditModalJobId(jobId);
    setAuditScore(95);
    setAuditDecision("PASS");
    setAuditNotes("All rooms inspected against 15-point standard.");
    setIssuesList([]);
  };

  const handleAddDefect = () => {
    setIssuesList((prev) => [
      ...prev,
      {
        area: "Kitchen",
        itemDescription: "",
        severity: "major",
        notes: "",
      },
    ]);
    setAuditDecision("REWORK_REQUIRED");
    setAuditScore(75);
  };

  const handleRemoveDefect = (index: number) => {
    const updated = issuesList.filter((_, i) => i !== index);
    setIssuesList(updated);
    if (updated.length === 0) {
      setAuditDecision("PASS");
      setAuditScore(95);
    }
  };

  const handleSubmitAudit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auditModalJobId) return;
    setIsSubmittingAudit(true);

    await submitQualityCheck(
      auditModalJobId,
      auditScore,
      auditDecision,
      auditNotes,
      issuesList
    );

    setAuditModalJobId(null);
    setIsSubmittingAudit(false);
  };

  return (
    <AdminLayout>
      <PageHeader
        title="Operations Manager Quality Control & Rework Audit"
        description="Operations Manager QA inspection queue, defect categorization, field-worker rework dispatch, and final reinspections."
        breadcrumbs={[
          { label: "Operations", href: "/" },
          { label: "Quality Control" },
        ]}
      />

      {/* Live feed notification strip */}
      <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-2.5">
        <div className="flex items-center gap-2 text-xs text-emerald-900">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <strong>Live pipeline feed</strong>
          <span className="text-emerald-700">
            field-worker actions (arrival, OTP, photos, rework) stream in every 8s — no refresh needed
          </span>
        </div>
        <span
          className={`flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full ${
            unreadCount > 0 ? "bg-rose-600 text-white" : "bg-white text-slate-500 border border-slate-200"
          }`}
        >
          <Bell className="h-3.5 w-3.5" />
          {unreadCount > 0 ? `${unreadCount} new event${unreadCount === 1 ? "" : "s"}` : "All caught up"}
        </span>
      </div>

      {/* QC Summary Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Awaiting Initial Audit
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-2">
            {jobs.filter((j) => j.status === "WORK_COMPLETED").length}
          </div>
          <div className="text-xs text-slate-400 mt-1">Ready for Inspector dispatch</div>
        </div>

        <div className="rounded-lg border border-rose-200 bg-rose-50/40 p-4 shadow-xs">
          <div className="text-xs font-semibold uppercase tracking-wider text-rose-700">
            Active Rework Tasks
          </div>
          <div className="text-2xl font-bold text-rose-900 mt-2">
            {jobs.filter((j) => j.status === "REWORK_REQUIRED" || j.status === "REWORK_COMPLETED").length}
          </div>
          <div className="text-xs text-rose-600 mt-1">Assigned for correction</div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Audit Pass Rate
          </div>
          <div className="text-2xl font-bold text-emerald-700 mt-2">
            {firstPassRate}%
          </div>
          <div className="text-xs text-slate-400 mt-1">First-pass quality score</div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Total Logged Defects
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-2">
            {qualityIssues.length}
          </div>
          <div className="text-xs text-slate-400 mt-1">Across {completedJobsCount} completed job{completedJobsCount === 1 ? "" : "s"}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Live Quality Control Inspection Queue */}
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white shadow-xs overflow-hidden">
            <div className="p-4 bg-slate-50/75 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Quality Audit Inspection Queue
                </h3>
                <p className="text-xs text-slate-500">
                  Jobs requiring independent inspector review before customer sign-off
                </p>
              </div>
              <span className="text-xs font-semibold text-slate-700 px-2.5 py-1 rounded bg-slate-200">
                {qcQueueJobs.length} Jobs in Queue
              </span>
            </div>

            <div className="divide-y divide-slate-100">
              {qcQueueJobs.length === 0 ? (
                <div className="p-12 text-center text-xs text-slate-400">
                  <ShieldCheck className="h-8 w-8 mx-auto text-emerald-500 mb-2" />
                  All completed cleaning jobs have been audited and passed!
                </div>
              ) : (
                qcQueueJobs.map((job) => {
                  const customer = customers.find((c) => c.id === job.customerId);
                  const property = properties.find((p) => p.id === job.propertyId);
                  const service = services.find((s) => s.id === job.serviceId);
                  const assignedWorkers = (job.assignedStaffIds || [])
                    .map((id) => users.find((u) => u.id === id)?.name)
                    .filter(Boolean) as string[];
                  const existingQC = qualityChecks.find((q) => q.jobId === job.id);

                  return (
                    <div
                      key={job.id}
                      className="p-4 hover:bg-slate-50/70 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-slate-900 text-sm">
                            {job.id}
                          </span>
                          <JobStatusBadge status={job.status} size="sm" />
                          {existingQC && (
                            <span className="font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
                              Score: {existingQC.score}%
                            </span>
                          )}
                        </div>

                        <div className="font-medium text-slate-900">
                          {customer?.name} • <span className="text-slate-500 font-normal">{property?.title}</span>
                        </div>

                        <div className="text-slate-400 text-[11px]">
                          {service?.name} • Workers: {assignedWorkers.length > 0 ? assignedWorkers.join(", ") : "Unassigned"}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {job.status === "WORK_COMPLETED" && (
                          <Button
                            size="sm"
                            onClick={() => handleOpenAuditModal(job.id)}
                            className="bg-purple-600 hover:bg-purple-700 text-white font-medium h-8 text-xs"
                          >
                            <ShieldCheck className="h-3.5 w-3.5 mr-1" />
                            Conduct QC Audit
                          </Button>
                        )}

                        {(job.status === "REWORK_REQUIRED" || job.status === "REWORK_COMPLETED" || job.status === "REINSPECTION") && (
                          <Button
                            size="sm"
                            disabled={isProcessingRework}
                            onClick={() => {
                              setPromptConfig({
                                isOpen: true,
                                title: "Reinspect & Pass Quality Audit",
                                description: "Enter QC reinspection verification notes:",
                                placeholder: "Rework tasks verified",
                                defaultValue: "Rework tasks verified to 100% standard.",
                                onSubmit: async (note) => {
                                  setIsProcessingRework(true);
                                  await reinspectAndPassQC(job.id, note || "Rework tasks verified");
                                  setIsProcessingRework(false);
                                },
                              });
                            }}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium h-8 text-xs"
                          >
                            {isProcessingRework ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                                Processing...
                              </>
                            ) : (
                              <>
                                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                                Reinspect & Pass
                              </>
                            )}
                          </Button>
                        )}

                        <Link href={`/jobs/${job.id}`}>
                          <Button variant="outline" size="sm" className="h-8 text-xs">
                            View Job
                          </Button>
                        </Link>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Rework Defect Ledger */}
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Active Rework Tasks & Defect Traceability
            </h3>

            <div className="space-y-2">
              {qualityIssues.map((issue) => {
                const task = reworkTasks.find((r) => r.qualityIssueId === issue.id);

                return (
                  <div
                    key={issue.id}
                    className="p-3 rounded-lg border border-slate-200 bg-slate-50/60 flex items-start justify-between gap-3 text-xs"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-slate-900">{issue.jobId}</span>
                        <span className="font-semibold text-slate-800">{issue.area}</span>
                        <span
                          className={`px-1.5 py-0.2 rounded text-[10px] font-bold uppercase ${
                            issue.severity === "critical"
                              ? "bg-rose-600 text-white"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {issue.severity}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {formatDateTime(issue.createdAt)}
                        </span>
                      </div>

                      <p className="text-slate-800 font-medium">
                        {issue.itemDescription}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {issue.reworkInstructions || issue.notes}
                      </p>
                    </div>

                    <div className="shrink-0 text-right">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                          issue.status === "resolved"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-rose-100 text-rose-800"
                        }`}
                      >
                        {issue.status.replace("_", " ")}
                      </span>

                      {task && task.status !== "completed" && (
                        <div className="mt-1 text-[10px] text-slate-400 italic">
                          Awaiting field worker in Field App
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Col: Live activity feed + QC Inspector Rubric Standards */}
        <div className="space-y-6">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold uppercase tracking-wider text-slate-500 text-xs">
                Field Activity — Live
              </h3>
              <Radio className="h-4 w-4 text-emerald-500 animate-pulse" />
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              What the field crew is doing right now, newest first.
            </p>

            {activityEvents.length === 0 ? (
              <div className="py-6 text-center text-[11px] text-slate-400">
                No field activity recorded yet.
              </div>
            ) : (
              <div className="space-y-1 max-h-[420px] overflow-y-auto pr-1">
                {activityEvents.map((event) => (
                  <div key={event.id} className="flex items-start gap-2 py-1.5 border-b border-slate-50 last:border-0">
                    <span
                      className={`h-6 w-6 rounded-full flex items-center justify-center shrink-0 ${
                        FEED_TINT[event.type] || FEED_TINT.STATUS_CHANGED
                      }`}
                    >
                      {FEED_ICON[event.type] || FEED_ICON.STATUS_CHANGED}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] text-slate-800 leading-snug">{event.message}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5 truncate">
                        <span className="font-mono font-semibold text-slate-500">{event.jobId.slice(0, 14)}</span>
                        {" · "}
                        {event.actorRole === "customer" ? "Customer" : event.actorName}
                        {" · "}
                        {timeAgo(event.createdAt)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs space-y-3 text-xs">
            <h3 className="font-semibold uppercase tracking-wider text-slate-500">
              Inspection Standards Rubric
            </h3>
            <p className="text-slate-500 text-[11px] leading-relaxed">
              Every room is audited against our standardized deep cleaning criteria before customer handover.
            </p>

            <div className="space-y-2 pt-2 border-t border-slate-100">
              <div className="p-2.5 rounded bg-slate-50 border border-slate-100">
                <div className="font-bold text-slate-900">Kitchen & Appliances</div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Chimney baffle filters zero oil drip; hob brass burners cleared; inside cabinets vacuumed.
                </p>
              </div>

              <div className="p-2.5 rounded bg-slate-50 border border-slate-100">
                <div className="font-bold text-slate-900">Bathrooms & Shower Glass</div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Acid-free limescale removal on glass; commode rim disinfected; mirror polish streak-free.
                </p>
              </div>

              <div className="p-2.5 rounded bg-slate-50 border border-slate-100">
                <div className="font-bold text-slate-900">Floors & Glazing</div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Single-disc buffing with zero water puddles; sliding track rail dirt completely extracted.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* QC Audit Modal */}
      <Dialog
        open={!!auditModalJobId}
        onOpenChange={(open) => !open && setAuditModalJobId(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Conduct Independent QC Audit</DialogTitle>
            <DialogDescription>
              Record audit score, identify defects, or approve job for customer sign-off.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmitAudit} className="space-y-4 py-2 text-xs">
            {/* Score Slider */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between font-semibold">
                <span>Inspection Quality Score (0 - 100%)</span>
                <span className="text-base font-bold text-slate-900">{auditScore}%</span>
              </div>
              <input
                type="range"
                min="50"
                max="100"
                value={auditScore}
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  setAuditScore(val);
                  if (val < 85) setAuditDecision("REWORK_REQUIRED");
                  else if (issuesList.length === 0) setAuditDecision("PASS");
                }}
                className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer"
              />
            </div>

            {/* Decision */}
            <div className="space-y-1.5">
              <label className="font-semibold text-slate-700">Audit Determination</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setAuditDecision("PASS");
                    setAuditScore(96);
                    setIssuesList([]);
                  }}
                  className={`py-2.5 rounded-lg border text-xs font-bold transition-all ${
                    auditDecision === "PASS"
                      ? "bg-emerald-600 text-white border-emerald-600 shadow-sm"
                      : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  ✓ PASS (Ready for Customer)
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setAuditDecision("REWORK_REQUIRED");
                    setAuditScore(75);
                    if (issuesList.length === 0) handleAddDefect();
                  }}
                  className={`py-2.5 rounded-lg border text-xs font-bold transition-all ${
                    auditDecision === "REWORK_REQUIRED"
                      ? "bg-rose-600 text-white border-rose-600 shadow-sm"
                      : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  ✗ REWORK REQUIRED
                </button>
              </div>
            </div>

            {/* Inspector Notes */}
            <div className="space-y-1.5">
              <label className="font-semibold text-slate-700">Inspector Remarks</label>
              <textarea
                value={auditNotes}
                onChange={(e) => setAuditNotes(e.target.value)}
                rows={2}
                className="w-full p-2 rounded-md border border-slate-200 text-xs focus:ring-1 focus:ring-slate-900"
                placeholder="Overall inspection observations..."
              />
            </div>

            {/* Defect items if Rework */}
            {auditDecision === "REWORK_REQUIRED" && (
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700">
                    Defects & Corrective Directives ({issuesList.length})
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleAddDefect}
                    className="h-6 text-[10px]"
                  >
                    + Add Defect
                  </Button>
                </div>

                {issuesList.map((issue, idx) => (
                  <div
                    key={idx}
                    className="p-2.5 rounded bg-rose-50 border border-rose-200 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <input
                        type="text"
                        value={issue.area}
                        onChange={(e) => {
                          const updated = [...issuesList];
                          updated[idx].area = e.target.value;
                          setIssuesList(updated);
                        }}
                        className="font-semibold bg-transparent border-b border-rose-200 pb-0.5 text-xs text-rose-900 focus:outline-none flex-1"
                        placeholder="Area (e.g. Kitchen, Master Bathroom)"
                      />
                      <select
                        value={issue.severity}
                        onChange={(e) => {
                          const updated = [...issuesList];
                          updated[idx].severity = e.target.value as any;
                          setIssuesList(updated);
                        }}
                        className="text-[10px] bg-white border border-rose-200 rounded px-1 py-0.5 font-medium text-slate-700"
                      >
                        <option value="minor">Minor</option>
                        <option value="major">Major</option>
                        <option value="critical">Critical</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => handleRemoveDefect(idx)}
                        className="text-rose-500 hover:text-rose-700"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <input
                      type="text"
                      value={issue.itemDescription}
                      onChange={(e) => {
                        const updated = [...issuesList];
                        updated[idx].itemDescription = e.target.value;
                        setIssuesList(updated);
                      }}
                      className="w-full p-1.5 rounded bg-white border border-rose-200 text-xs text-slate-800"
                      placeholder="Defect description (e.g. Grease residue near chimney)"
                    />

                    <input
                      type="text"
                      value={issue.notes}
                      onChange={(e) => {
                        const updated = [...issuesList];
                        updated[idx].notes = e.target.value;
                        setIssuesList(updated);
                      }}
                      className="w-full p-1.5 rounded bg-white border border-rose-200 text-[11px] text-slate-600"
                      placeholder="Rework instructions for technician..."
                    />
                  </div>
                ))}
              </div>
            )}

            <DialogFooter className="pt-3 border-t border-slate-100">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAuditModalJobId(null)}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" className="bg-slate-900 text-white font-medium" disabled={isSubmittingAudit}>
                {isSubmittingAudit ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  "Save & Submit Quality Audit"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Reusable Prompt Modal */}
      <PromptModal
        isOpen={promptConfig.isOpen}
        onClose={() => setPromptConfig((prev) => ({ ...prev, isOpen: false }))}
        title={promptConfig.title}
        description={promptConfig.description}
        placeholder={promptConfig.placeholder}
        defaultValue={promptConfig.defaultValue}
        onSubmit={promptConfig.onSubmit}
      />
    </AdminLayout>
  );
}
