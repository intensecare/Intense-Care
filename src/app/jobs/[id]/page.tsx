"use client";

import React, { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { JobStatusBadge, PaymentStatusBadge } from "@/components/common/JobStatusBadge";
import { JobTimeline } from "@/components/common/JobTimeline";
import { BeforeAfterGallery } from "@/components/common/BeforeAfterGallery";
import { OTPModal } from "@/components/common/OTPModal";
import { PrintableInvoiceModal } from "@/components/common/PrintableInvoiceModal";
import { ImageLightboxModal } from "@/components/common/ImageLightboxModal";
import { PromptModal } from "@/components/common/PromptModal";
import { useApp } from "@/lib/app-context";
import { getOpsDateVisibility } from "@/lib/ops-visibility";
import { Link2, Copy, Check, Loader2, MessageCircle } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { getAllowedTransitions, JOB_STATUS_CONFIG } from "@/lib/state-machine";
import { formatCurrency, formatDate, formatDateTime, timeAgo, formatTimeSlot, buildWhatsAppShareUrl, cn } from "@/lib/utils";
import type { JobActivityEvent } from "@/lib/types";
import {
  Calendar,
  Clock,
  MapPin,
  Phone,
  Mail,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Share2,
  DollarSign,
  FileText,
  Smartphone,
  ExternalLink,
  ChevronRight,
  Plus,
  ArrowRight,
  Sparkles,
  Layers,
  Camera,
  Upload,
  History,
  KeyRound,
  Users,
  UserCheck,
  Radio,
  Star,
  Camera as CameraIcon,
  ClipboardCheck,
  RotateCcw,
  PenLine,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { compressImageForUpload } from "@/lib/image-compress";

/**
 * Pipeline stage → the display section that matters at that stage (PDF §4).
 * The job file follows the job: Draft/Scheduled opens Overview, execution
 * states open Work Details (checklist + before/after photos), QC states open
 * Quality, and the customer-facing stages open Customer Handover.
 */
const STAGE_TAB_MAP: Record<string, string> = {
  DRAFT: "overview",
  SCHEDULED: "overview",
  ASSIGNED: "work",
  ARRIVED: "work",
  CUSTOMER_VERIFIED: "work",
  IN_PROGRESS: "work",
  WORK_COMPLETED: "qc",
  QUALITY_CHECK: "qc",
  REWORK_REQUIRED: "qc",
  REWORK_COMPLETED: "qc",
  REINSPECTION: "qc",
  PASS: "approval",
  CUSTOMER_APPROVAL: "approval",
  COMPLETED: "financials",
  FEEDBACK_REQUESTED: "approval",
  CLOSED: "overview",
  CANCELLED: "overview",
};

function stageTabFor(status: string, role: string): string | null {
  const tab = STAGE_TAB_MAP[status] || null;
  // Non-super_admin roles have no Finance tab — fall back to sign-off.
  if (tab === "financials" && role !== "super_admin") return "approval";
  return tab;
}

const ACTIVITY_ICON: Record<string, { icon: React.ReactNode; tint: string }> = {
  STATUS_CHANGED: { icon: <ArrowRight className="h-3.5 w-3.5" />, tint: "bg-slate-100 text-slate-600" },
  STAFF_ASSIGNED: { icon: <UserPlus className="h-3.5 w-3.5" />, tint: "bg-indigo-50 text-indigo-600" },
  OTP_SENT: { icon: <KeyRound className="h-3.5 w-3.5" />, tint: "bg-amber-50 text-amber-600" },
  OTP_VERIFIED: { icon: <KeyRound className="h-3.5 w-3.5" />, tint: "bg-emerald-50 text-emerald-600" },
  CHECKLIST_UPDATED: { icon: <ClipboardCheck className="h-3.5 w-3.5" />, tint: "bg-sky-50 text-sky-600" },
  PHOTO_UPLOADED: { icon: <CameraIcon className="h-3.5 w-3.5" />, tint: "bg-blue-50 text-blue-600" },
  QC_SUBMITTED: { icon: <ShieldCheck className="h-3.5 w-3.5" />, tint: "bg-purple-50 text-purple-600" },
  REWORK_ASSIGNED: { icon: <RotateCcw className="h-3.5 w-3.5" />, tint: "bg-red-50 text-red-600" },
  REWORK_COMPLETED: { icon: <CheckCircle2 className="h-3.5 w-3.5" />, tint: "bg-amber-50 text-amber-600" },
  CUSTOMER_SIGNED: { icon: <PenLine className="h-3.5 w-3.5" />, tint: "bg-teal-50 text-teal-600" },
  ATTENTION_REQUESTED: { icon: <AlertTriangle className="h-3.5 w-3.5" />, tint: "bg-red-50 text-red-600" },
  FEEDBACK_RECORDED: { icon: <Star className="h-3.5 w-3.5" />, tint: "bg-amber-50 text-amber-600" },
  GOOGLE_REVIEW_CLICKED: { icon: <Star className="h-3.5 w-3.5" />, tint: "bg-emerald-50 text-emerald-600" },
};

/* --------------------------------------------------------------------------
 * §5 Next-Action engine — ONE obvious primary action per lifecycle state.
 * Purely presentational: every action still routes through the strict state
 * machine (handleExecuteTransition / role-filtered allowedTransitions), so
 * backend semantics are untouched. Staff never hunt through tabs.
 * ------------------------------------------------------------------------ */
type NextAction = {
  kind: "transition" | "otp" | "assign" | "tab" | "open-link";
  target?: string;
  label: string;
  hint: string;
  tone?: "coral" | "amber";
};

export default function JobDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { currentUser } = useAuth();
  const jobId = (params?.id as string) || "";

  const {
    jobs,
    customers,
    properties,
    services,
    users,
    checklistItems,
    photos,
    qualityChecks,
    qualityIssues,
    reworkTasks,
    complaints,
    invoices,
    payments,
    currentRole,
    transitionJobStatus,
    assignStaffToJob,
    fetchStaffDirectory,
    refreshJobs,
    refreshPhotos,
    refreshQuality,
    systemSettings,
    sendCompletionLink,
    updateChecklistItem,
    addJobPhoto,
    completeReworkTask,
    reinspectAndPassQC,
    recordPayment,
  } = useApp();

  // Sign-off & feedback live server-side on the completion invite.
  const [signOff, setSignOff] = useState<{
    signStatus: string;
    signedAt: string | null;
    signatoryName: string | null;
    feedbackRating: number | null;
    feedbackTags: string[];
    feedbackComment: string | null;
    googleReviewClicked: boolean;
  } | null>(null);

  const [activeTab, setActiveTab] = useState("overview");

  // Live pipeline activity feed for this job (also rendered in the Audit
  // Log tab). Polled while the tab is visible so supervisors watch field
  // actions land in near-real time.
  const [activityEvents, setActivityEvents] = useState<JobActivityEvent[]>([]);
  React.useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/activity?jobId=${encodeURIComponent(jobId)}&limit=60`);
        const json = await res.json().catch(() => null);
        if (!cancelled && res.ok && json?.success) setActivityEvents(json.data ?? []);
      } catch {
        // Feed is non-critical; the tab shows a sync note on failure.
      }
    };
    void load();
    const interval = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void load();
    }, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [jobId]);

  // Live pipeline sync: re-pull jobs/checklist, photos and QC records while
  // this job file is open. A worker marking arrival or uploading evidence
  // becomes visible to the watching manager within one interval — no manual
  // browser refresh needed.
  React.useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      void refreshJobs();
      void refreshPhotos();
      void refreshQuality();
    };
    const interval = setInterval(tick, 10000);
    return () => clearInterval(interval);
  }, [refreshJobs, refreshPhotos, refreshQuality]);

  // Secure customer handover link (generated server-side after QC pass; the
  // ops desk copies and shares it over any channel — no messaging dependency).
  const [handoverLink, setHandoverLink] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  // Fetch the server-side sign-off/feedback state for this job (completion
  // invite) — and keep polling so a customer signing or reviewing in the
  // portal appears here the moment it happens.
  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/feedback?jobId=${encodeURIComponent(jobId)}`);
        const json = await res.json().catch(() => null);
        if (!cancelled && res.ok && json?.success) {
          setSignOff(json.data);
        }
      } catch (e) {
        // Non-fatal: the tab simply shows empty state.
      }
    };
    void load();
    const interval = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void load();
    }, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [jobId]);

  const handleGenerateHandoverLink = async () => {
    if (!job) return;
    setLinkBusy(true);
    setLinkError(null);
    const res = await sendCompletionLink(job.id);
    setLinkBusy(false);
    if (res.success && res.linkPath) {
      // Prefer the server-resolved absolute URL (APP_BASE_URL / forwarded host):
      // it stays correct even when the desk mints the link from a different
      // environment than the one customers will open it from.
      setHandoverLink(res.linkUrl || `${window.location.origin}${res.linkPath}`);
      setLinkCopied(false);
    } else {
      setLinkError(res.message);
    }
  };

  const handleCopyHandoverLink = async () => {
    if (!handoverLink) return;
    try {
      await navigator.clipboard.writeText(handoverLink);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2500);
    } catch {
      // Clipboard unavailable (e.g. insecure context) — the link stays visible
      // so the ops desk can select and copy it manually.
    }
  };
  const [isOtpModalOpen, setIsOtpModalOpen] = useState(false);
  const [photoUploadOpen, setPhotoUploadOpen] = useState(false);
  const [photoArea, setPhotoArea] = useState("Kitchen");
  const [photoType, setPhotoType] = useState<"before" | "after">("before");
  const [photoDataUrl, setPhotoDataUrl] = useState("");
  const [photoCaption, setPhotoCaption] = useState("");
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);

  // --- Staff assignment (reuses the server PATCH /api/jobs/[id] assignment
  // path — same validation, double-booking 409 and status sync as the
  // dispatcher tower). Backend flags are the source of truth; the store's
  // optimistic flip is authoritative on success.
  const canManage = currentRole === "super_admin" || currentRole === "ops_manager";
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [assignmentSaving, setAssignmentSaving] = useState(false);
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<string[]>([]);
  const [assignmentErrorMsg, setAssignmentErrorMsg] = useState<string | null>(null);

  const eligibleWorkers = users
    .filter((u) => u.role === "staff" && u.active)
    .sort((a, b) => a.name.localeCompare(b.name));

  const openAssignmentModal = () => {
    setSelectedWorkerIds(job?.assignedStaffIds || []);
    setAssignmentErrorMsg(null);
    setAssignmentOpen(true);
    void fetchStaffDirectory();
  };

  const handleAssignConfirm = async () => {
    if (!job) return;
    setAssignmentSaving(true);
    setAssignmentErrorMsg(null);
    const res = await assignStaffToJob(job.id, selectedWorkerIds);
    setAssignmentSaving(false);
    if (!res.success) {
      setAssignmentErrorMsg(res.message);
      return;
    }
    setAssignmentOpen(false);
    await refreshJobs();
  };
  const [isInvoicePrintOpen, setIsInvoicePrintOpen] = useState(false);
  const [lightboxPhoto, setLightboxPhoto] = useState<{
    url: string;
    title?: string;
    category?: string;
    uploadedBy?: string;
    uploadedAt?: string;
    notes?: string;
  } | null>(null);

  const [promptConfig, setPromptConfig] = useState<{
    isOpen: boolean;
    title: string;
    description?: string;
    placeholder?: string;
    defaultValue?: string;
    confirmText?: string;
    onSubmit: (val: string) => void;
  }>({
    isOpen: false,
    title: "",
    onSubmit: () => {},
  });

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

  // Find job
  const job = jobs.find((j) => j.id === jobId);

  // Follow the pipeline: when the job's lifecycle stage changes (or the file
  // is first opened mid-pipeline), open the section that stage is about —
  // Draft/Scheduled → Overview, Assigned/Arrived → Checklist, In Progress →
  // Evidence, QC states → Quality, customer stages → Sign-off & Feedback.
  const lastStageRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!job) return;
    if (lastStageRef.current !== job.status) {
      lastStageRef.current = job.status;
      const tab = stageTabFor(job.status, currentRole);
      if (tab) setActiveTab(tab);
    }
  }, [job?.status, job, currentRole]);

  // Role separation on this file: field-execution controls (checklist ticks,
  // evidence uploads, arrival/OTP) belong to the assigned field worker; the
  // owner may override. The ops_manager runs dispatch + QC and gets a
  // read-only execution view.
  const canExecuteFieldWork = currentRole === "super_admin" || currentRole === "staff";

  // Ops Managers cannot open jobs outside their dispatch visibility window
  // (past + today + tomorrow after the cutoff). Direct URL access to a future
  // job renders as not-found, mirroring the API's 403.
  const opsWindowBlocked =
    currentRole === "ops_manager" &&
    !!job &&
    !getOpsDateVisibility(new Date(), {
      nextDayDispatchTime: systemSettings?.nextDayDispatchTime || "20:00",
    }).isDateVisible(job.scheduledDate);

  if (!job) {
    return (
      <AdminLayout>
        <div className="p-12 text-center bg-white rounded-lg border border-slate-200">
          <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-slate-900">Job Not Found</h2>
          <p className="text-xs text-slate-500 mt-1">
            The requested job {jobId} does not exist or has been archived.
          </p>
          <Link href="/jobs">
            <Button size="sm" className="mt-4">
              Return to Jobs
            </Button>
          </Link>
        </div>
      </AdminLayout>
    );
  }

  if (opsWindowBlocked) {
    return (
      <AdminLayout>
        <div className="p-12 text-center bg-white rounded-lg border border-slate-200">
          <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-slate-900">Not Open for Dispatch Yet</h2>
          <p className="text-xs text-slate-500 mt-1">
            Job {jobId} is scheduled for <strong>{job.scheduledDate}</strong>. It will appear here as
            soon as it is assigned to you.
          </p>
          <Link href="/dispatcher">
            <Button size="sm" className="mt-4">
              Return to Dispatch Queue
            </Button>
          </Link>
        </div>
      </AdminLayout>
    );
  }

  const customer = customers.find((c) => c.id === job.customerId);
  const property = properties.find((p) => p.id === job.propertyId);
  const service = services.find((s) => s.id === job.serviceId);

  // One-tap WhatsApp share of the handover link (wa.me deep link with the
  // message prefilled; the desk just hits send).
  const handoverWhatsAppUrl = handoverLink
    ? buildWhatsAppShareUrl(
        customer?.whatsapp || customer?.phone,
        `Hello${customer?.name ? " " + customer.name : ""}, your deep cleaning service handover is ready. View the before/after photos and approve the completed work here: ${handoverLink}`
      )
    : null;

  // §6 Handover lifecycle: Not Opened → Opened → Approval Pending → Approved / Issue Raised
  const handoverStage = !handoverLink
    ? 0
    : signOff?.signStatus === "APPROVED"
    ? 3
    : signOff?.signStatus === "ATTENTION_REQUESTED"
    ? 4
    : signOff
    ? 2
    : 1;
  const HANDOVER_STAGES = ["Not Opened", "Opened", "Approval Pending", "Approved", "Issue Raised"] as const;
  const assignedWorkers = (job.assignedStaffIds || []).map((id, idx) => {
    const viaStore = users.find((u) => u.id === id);
    // Staff viewers cannot read the user directory — fall back to the
    // server-resolved names attached to the job payload.
    const viaServer =
      job.assignedStaffNames && job.assignedStaffNames.length === job.assignedStaffIds.length
        ? job.assignedStaffNames[idx]
        : undefined;
    return { id, name: viaStore?.name || viaServer || `Worker ${idx + 1}` };
  });
  const leadWorker = assignedWorkers[0];
  // The customer OTP belongs to the lead worker on site (the customer reads
  // the code to THEM). The ops desk never verifies entry on the customer's
  // behalf — only the lead worker (or the owner as override) may enter it.
  const isLeadViewer =
    currentUser?.role === "super_admin" ||
    leadWorker?.id === currentUser?.id ||
    (currentUser?.role === "staff" && job.assignedStaffIds?.[0] === currentUser?.id);
  const jobChecklist = checklistItems.filter((item) => item.jobId === job.id);
  const jobPhotos = photos.filter((p) => p.jobId === job.id);
  const qc = qualityChecks.find((q) => q.jobId === job.id);
  const jobIssues = qualityIssues.filter((i) => i.jobId === job.id);
  const jobRework = reworkTasks.filter((r) => r.jobId === job.id);
  const invoice = invoices.find((i) => i.jobId === job.id);

  // Workers already busy on ANOTHER active job with the same date + time window
  // (same conflict rule as the dispatcher tower; server still re-validates).
  const activeWorkerIds = new Set<string>();
  jobs.forEach((j) => {
    if (j.id === job.id) return;
    if (j.scheduledDate !== job.scheduledDate || j.scheduledTimeSlot !== job.scheduledTimeSlot) return;
    if (j.status === "COMPLETED" || j.status === "CANCELLED" || j.status === "CLOSED") return;
    j.assignedStaffIds.forEach((id) => activeWorkerIds.add(id));
  });

  // Allowed transitions for current user role. The bare ASSIGNED transition
  // is hidden — the dedicated “Assign Staff” button (which opens the crew
  // picker and then advances the state) is the single, unambiguous control.
  const allowedTransitions = getAllowedTransitions(job).filter(
    (action) =>
      action.status !== "ASSIGNED" &&
      (currentRole === "super_admin" || action.allowedRoles.includes(currentRole))
  );

  // --- §5 Next-Action: derive the single primary action for this state ---
  const otpStillNeeded = job.status === "ARRIVED" && job.otpVerification.status !== "verified";
  const teamUnassigned = job.assignedStaffIds.length === 0;
  const hasTransition = (target: string) => allowedTransitions.some((t) => t.status === target);

  const nextAction: NextAction | null = (() => {
    switch (job.status) {
      case "DRAFT":
        return hasTransition("SCHEDULED")
          ? { kind: "transition", target: "SCHEDULED", label: "Confirm Schedule", hint: "Lock the date & time slot with the customer." }
          : null;
      case "SCHEDULED":
        return teamUnassigned && canManage
          ? { kind: "assign", label: "Assign Field Team", hint: "Pick the crew — the first worker becomes the lead." }
          : hasTransition("ASSIGNED")
          ? { kind: "transition", target: "ASSIGNED", label: "Dispatch Field Team", hint: "Push the crew list to the field app." }
          : null;
      case "ASSIGNED":
        return hasTransition("ARRIVED")
          ? { kind: "transition", target: "ARRIVED", label: "Mark Arrival On Site", hint: "The worker taps arrived in the field app." }
          : null;
      case "ARRIVED":
        return otpStillNeeded
          ? { kind: "otp", label: "Verify Customer OTP", hint: "The customer reads the OTP to the lead worker.", tone: "amber" }
          : null;
      case "CUSTOMER_VERIFIED":
        return hasTransition("IN_PROGRESS")
          ? { kind: "transition", target: "IN_PROGRESS", label: "Start Cleaning Job", hint: "Begin the service execution checklist." }
          : null;
      case "IN_PROGRESS":
        return { kind: "tab", target: "work", label: "Continue Service Checklist", hint: "Tick tasks & upload before/after photos." };
      case "WORK_COMPLETED":
        return hasTransition("QUALITY_CHECK")
          ? { kind: "transition", target: "QUALITY_CHECK", label: "Start Quality Check", hint: "Inspect every area against the QC rubric." }
          : null;
      case "QUALITY_CHECK":
      case "REINSPECTION":
        return hasTransition("PASS")
          ? { kind: "transition", target: "PASS", label: "Pass Quality Check", hint: "Confirm the service meets the standard." }
          : hasTransition("REWORK_REQUIRED")
          ? { kind: "transition", target: "REWORK_REQUIRED", label: "Record Rework Required", hint: "Log defects and assign corrective tasks." }
          : null;
      case "REWORK_REQUIRED":
        return hasTransition("REWORK_COMPLETED")
          ? { kind: "transition", target: "REWORK_COMPLETED", label: "Mark Rework Completed", hint: "Close out every corrective task first." }
          : { kind: "tab", target: "qc", label: "Review Rework Tasks", hint: "Track the corrective work in Quality." };
      case "REWORK_COMPLETED":
        return hasTransition("REINSPECTION")
          ? { kind: "transition", target: "REINSPECTION", label: "Send For Reinspection", hint: "QC re-verifies the corrected areas." }
          : null;
      case "PASS":
        return hasTransition("CUSTOMER_APPROVAL")
          ? { kind: "transition", target: "CUSTOMER_APPROVAL", label: "Send Customer Handover", hint: "Mint & share the secure approval link." }
          : null;
      case "CUSTOMER_APPROVAL":
        return { kind: "open-link", label: "Open Customer Handover", hint: "The customer reviews photos and approves the work." };
      case "COMPLETED":
      case "FEEDBACK_REQUESTED":
        return hasTransition("CLOSED")
          ? { kind: "transition", target: "CLOSED", label: "Close Job", hint: "Archive the completed service file." }
          : null;
      default:
        return null;
    }
  })();

  const runNextAction = () => {
    if (!nextAction) return;
    if (nextAction.kind === "transition" && nextAction.target) {
      void handleExecuteTransition(nextAction.target);
    } else if (nextAction.kind === "otp") {
      setIsOtpModalOpen(true);
    } else if (nextAction.kind === "assign") {
      openAssignmentModal();
    } else if (nextAction.kind === "tab" && nextAction.target) {
      setActiveTab(nextAction.target);
    } else if (nextAction.kind === "open-link") {
      if (handoverLink) {
        window.open(handoverLink, "_blank");
      } else {
        void handleGenerateHandoverLink().then(() => {
          setActiveTab("approval");
        });
      }
    }
  };

  const handleExecuteTransition = async (targetStatus: any) => {
    setActionError(null);
    if (targetStatus === "CUSTOMER_VERIFIED" || (job.status === "ARRIVED" && targetStatus === "IN_PROGRESS")) {
      setIsOtpModalOpen(true);
      return;
    }
    // SCHEDULED/DRAFT → ASSIGNED requires worker selection: the bare status
    // PATCH used to flip the label while leaving the crew empty.
    if (targetStatus === "ASSIGNED") {
      openAssignmentModal();
      return;
    }

    setIsTransitioning(true);
    const res = transitionJobStatus(job.id, targetStatus);
    if (!res.success) {
      setActionError(res.message);
    }
    setIsTransitioning(false);
  };

  const handlePhotoUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!photoDataUrl) return;

    setPhotoUploading(true);
    setPhotoError(null);
    // Shrink the photo in the browser first: raw camera files exceed the
    // platform's request-size limit and were the cause of intermittent
    // failed uploads.
    const prepared = await compressImageForUpload(photoDataUrl);
    const res = await addJobPhoto({
      jobId: job.id,
      area: photoArea,
      photoType,
      imageDataUrl: prepared.dataUrl,
      caption: photoCaption || undefined,
    });
    setPhotoUploading(false);

    if (res.success) {
      setPhotoUploadOpen(false);
      setPhotoDataUrl("");
      setPhotoCaption("");
    } else {
      setPhotoError(res.message);
    }
  };

  return (
    <AdminLayout>
      <PageHeader
        title={`Job Record: ${job.id}`}
        description={`Comprehensive digital file for ${customer?.name || "Customer"} at ${property?.title || "Property"}`}
        breadcrumbs={[
          { label: "Operations", href: "/" },
          { label: "Jobs", href: "/jobs" },
          { label: job.id },
        ]}
        badge={<JobStatusBadge status={job.status} size="md" />}
        actions={
          <div className="flex items-center gap-2">
            {handoverLink && (
              <Link
                href={handoverLink}
                target="_blank"
                className="hidden sm:inline-flex"
              >
                <Button variant="outline" size="sm" className="h-9 text-xs gap-1.5">
                  <ExternalLink className="h-3.5 w-3.5 text-teal-600" />
                  Customer Portal Link
                </Button>
              </Link>
            )}

            <Link href="/field">
              <Button variant="outline" size="sm" className="h-9 text-xs gap-1.5">
                <Smartphone className="h-3.5 w-3.5 text-blue-600" />
                Open in Field App
              </Button>
            </Link>
          </div>
        }
      />

      {/* §4/§5 Next-Action card — Current Status · What Happened · What's Next.
          One obvious primary action per state; other legal transitions stay
          available as quiet secondary controls. Backend machine untouched. */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-6 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div
              className={cn(
                "h-11 w-11 rounded-xl flex items-center justify-center border shrink-0",
                job.status === "CANCELLED"
                  ? "bg-red-50 text-red-600 border-red-100"
                  : job.otpVerification.status === "verified" || job.status === "PASS" || job.status === "COMPLETED" || job.status === "CLOSED"
                  ? "bg-emerald-50 text-emerald-600 border-emerald-100"
                  : "bg-rose-50 text-rose-600 border-rose-100"
              )}
            >
              {job.status === "CANCELLED" ? (
                <AlertTriangle className="h-5 w-5" />
              ) : job.otpVerification.status === "verified" || job.status === "PASS" || job.status === "COMPLETED" || job.status === "CLOSED" ? (
                <CheckCircle2 className="h-5 w-5" />
              ) : (
                <Clock className="h-5 w-5" />
              )}
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                Current Status
              </div>
              <div className="text-base font-semibold text-slate-900">
                {JOB_STATUS_CONFIG[job.status]?.label || job.status}
              </div>
              <div className="text-xs text-slate-500 mt-0.5 truncate max-w-xl">
                <span className="font-medium text-slate-600">What happened: </span>
                {activityEvents[0]?.message || JOB_STATUS_CONFIG[job.status]?.shortDescription || "—"}
              </div>
            </div>
          </div>

          {/* What's Next — the ONE primary action for this state */}
          <div className="flex items-center gap-2 flex-wrap lg:justify-end">
            {nextAction && (nextAction.kind !== "otp" || isLeadViewer) && (
              <div className="w-full lg:w-auto mb-1 lg:mb-0">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide lg:text-right">
                  What's Next
                </p>
                <p className="text-[11px] text-slate-500 lg:text-right">{nextAction.hint}</p>
              </div>
            )}

            {nextAction && (
              <Button
                size="lg"
                onClick={runNextAction}
                disabled={isTransitioning || (nextAction.kind === "otp" && !isLeadViewer)}
                className={cn(
                  "font-semibold gap-1.5 h-10 text-sm shadow-sm",
                  nextAction.tone === "amber"
                    ? "bg-amber-500 hover:bg-amber-600 text-slate-950 border border-amber-500"
                    : "bg-rose-500 hover:bg-rose-600 text-white border border-rose-500"
                )}
              >
                {isTransitioning ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    {nextAction.tone === "amber" && <KeyRound className="h-4 w-4" />}
                    {nextAction.label}
                    {nextAction.tone !== "amber" && <ArrowRight className="h-4 w-4" />}
                  </>
                )}
              </Button>
            )}

            {/* Assign/manage field workers — mirrors the dispatcher's crew picker */}
            {canManage && ["DRAFT", "SCHEDULED", "ASSIGNED"].includes(job.status) && (
              <Button
                size="sm"
                onClick={openAssignmentModal}
                variant="outline"
                className="h-9 font-semibold gap-1.5"
              >
                <Users className="h-4 w-4" />
                {job.assignedStaffIds.length > 0 ? `Manage Workers (${job.assignedStaffIds.length})` : "Assign Staff"}
              </Button>
            )}

            {/* Every other legal transition stays reachable — quiet secondaries */}
            {allowedTransitions
              .filter((action) => action.status !== nextAction?.target)
              .map((action) => (
                <Button
                  key={action.status}
                  size="sm"
                  variant={action.buttonVariant === "destructive" ? "destructive" : "outline"}
                  onClick={() => handleExecuteTransition(action.status)}
                  disabled={isTransitioning}
                  className="h-8 text-[11px]"
                >
                  {action.label}
                </Button>
              ))}

            {!nextAction && allowedTransitions.length === 0 && (
              <span className="text-xs text-slate-400 italic">
                Terminal state reached — no further actions required.
              </span>
            )}
          </div>
        </div>
      </div>

      {actionError && (
        <div className="mb-4 p-3 rounded-md bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Secure Customer Handover Link (after QC pass) */}
      {(currentRole === "super_admin" || currentRole === "ops_manager") &&
        (job.status === "CUSTOMER_APPROVAL" || job.status === "COMPLETED" || job.status === "FEEDBACK_REQUESTED") && (
          <div className="mb-6 p-4 rounded-lg border border-teal-200 bg-teal-50/60 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h3 className="text-sm font-semibold text-teal-950 flex items-center gap-1.5">
                  <Link2 className="h-4 w-4 text-teal-600" />
                  Secure Customer Handover Link
                </h3>
                <p className="text-[11px] text-teal-800 mt-0.5">
                  Share this link with the customer (WhatsApp/SMS/call). It opens their handover page — before/after photos, digital sign-off, and the Google review prompt.
                </p>
              </div>

              <Button
                size="sm"
                onClick={handleGenerateHandoverLink}
                disabled={linkBusy}
                className="h-9 text-xs bg-teal-700 hover:bg-teal-800 text-white gap-1.5"
              >
                {linkBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                {handoverLink ? "Generate New Link" : "Generate Secure Link"}
              </Button>
            </div>

            {/* §6 lifecycle tracker — where this handover currently sits */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {HANDOVER_STAGES.map((stage, i) => {
                const isCurrent = handoverStage === i;
                const isDone = handoverStage > i && handoverStage !== 4;
                const isIssue = handoverStage === 4 && stage === "Issue Raised";
                return (
                  <span
                    key={stage}
                    className={cn(
                      "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border",
                      isIssue
                        ? "bg-red-100 text-red-700 border-red-200"
                        : isCurrent
                        ? "bg-teal-600 text-white border-teal-600"
                        : isDone
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-white text-slate-400 border-slate-200"
                    )}
                  >
                    {isDone && <Check className="h-2.5 w-2.5" />}
                    {stage}
                  </span>
                );
              })}
            </div>

            {linkError && (
              <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2.5 py-1.5">{linkError}</p>
            )}

            {handoverLink && (
              <div className="flex items-center gap-2 bg-white border border-teal-200 rounded-md p-2">
                <input
                  readOnly
                  value={handoverLink}
                  onFocus={(e) => e.target.select()}
                  className="flex-1 text-[11px] font-mono text-slate-700 bg-transparent outline-none"
                />
                <Button size="sm" variant="outline" onClick={handleCopyHandoverLink} className="h-7 text-[11px] gap-1">
                  {linkCopied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                  {linkCopied ? "Copied" : "Copy"}
                </Button>
                <a href={handoverWhatsAppUrl ?? "#"} target="_blank" rel="noreferrer">
                  <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1 text-emerald-700 hover:bg-emerald-50">
                    <MessageCircle className="h-3 w-3" />
                    WhatsApp
                  </Button>
                </a>
                <a
                  href={
                    handoverLink
                      ? `sms:${customer?.phone || ""}?&body=${encodeURIComponent(
                          `Intense Care: Your deep cleaning handover is ready. View photos & approve: ${handoverLink}`
                        )}`
                      : "#"
                  }
                >
                  <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1">
                    <Smartphone className="h-3 w-3" />
                    SMS
                  </Button>
                </a>
                <Link href={handoverLink.replace(window.location.origin, "")} target="_blank">
                  <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1">
                    <ExternalLink className="h-3 w-3" />
                    Open
                  </Button>
                </Link>
              </div>
            )}

            {handoverLink && (
              <p className="text-[10px] text-teal-700">
                Generating a new link keeps the older ones valid until they expire, so the customer can never be locked out mid-review. Links expire automatically after the configured window.
              </p>
            )}
          </div>
        )}

      {/* Visual State Progression Stepper */}
      <div className="mb-6">
        <JobTimeline job={job} />
      </div>

      {/* Tabbed Job Detail Content — the active tab follows the pipeline
          stage; the live dot shows the file auto-syncs while open. */}
      <div className="mb-2 flex items-center gap-1.5 text-[11px] text-slate-400">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
        Live — this file auto-syncs every 10s and follows the pipeline stage
      </div>
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="bg-slate-200/70 p-1">
          <TabsTrigger value="overview">Job Overview</TabsTrigger>
          <TabsTrigger value="work">
            Work Details ({jobChecklist.filter((c) => c.status === "completed").length}/{jobChecklist.length} tasks · {jobPhotos.length} photos)
          </TabsTrigger>
          <TabsTrigger value="qc">
            Quality {jobIssues.length > 0 && `(${jobIssues.length} issues)`}
          </TabsTrigger>
          <TabsTrigger value="approval">Customer</TabsTrigger>
          {currentRole === "super_admin" && (
            <TabsTrigger value="financials">Billing</TabsTrigger>
          )}
          <TabsTrigger value="audit">Activity</TabsTrigger>
        </TabsList>

        {/* 1. OVERVIEW TAB */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Customer & Property Card */}
            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs space-y-4">
              <h3 className="text-xs font-semibold text-slate-500">
                Customer & Property
              </h3>

              <div className="space-y-1">
                <div className="text-sm font-semibold text-slate-900">
                  {customer?.name}
                </div>
                <div className="text-xs text-slate-500 flex items-center gap-1.5 font-mono">
                  <Phone className="h-3 w-3 text-slate-400" />
                  {customer?.phone}
                </div>
                <div className="text-xs text-slate-500 flex items-center gap-1.5">
                  <Mail className="h-3 w-3 text-slate-400" />
                  {customer?.email}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 space-y-1 text-xs">
                <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-blue-600" />
                  {property?.title}
                </div>
                <p className="text-slate-500 text-[11px] leading-relaxed">
                  {property?.address}
                </p>
                <div className="text-[11px] text-slate-400 pt-1">
                  Type: <span className="capitalize text-slate-700">{property?.propertyType}</span> • {property?.bedrooms || 3} BHK • {property?.carpetAreaSqFt || 2000} sq ft
                </div>
                {property?.accessNotes && (
                  <div className="mt-2 p-2 rounded bg-slate-50 border border-slate-200 text-[11px] text-slate-600">
                    <strong>Access:</strong> {property.accessNotes}
                  </div>
                )}
              </div>
            </div>

            {/* Service & Booking Details */}
            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs space-y-4">
              <h3 className="text-xs font-semibold text-slate-500">
                Service Package
              </h3>

              <div className="space-y-1">
                <div className="text-sm font-semibold text-slate-900">
                  {service?.name}
                </div>
                <div className="text-xs text-slate-400">
                  Estimated duration: ~{service?.estimatedDurationHours || 4} hours
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Scheduled Date:</span>
                  <span className="font-semibold text-slate-900">{formatDate(job.scheduledDate)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Time Window:</span>
                  <span className="font-medium text-slate-900">{formatTimeSlot(job.scheduledTimeSlot)}</span>
                </div>
                {currentRole === "super_admin" && (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Service Fee:</span>
                      <span className="font-semibold text-slate-900">{formatCurrency(job.amount ?? 0)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Payment Status:</span>
                      <PaymentStatusBadge status={job.paymentStatus ?? "UNPAID"} />
                    </div>
                  </>
                )}
              </div>

            </div>

              {/* Worker Assignment & OTP Security Box (assignment is driven
                  by the single “Assign Staff” action in the lifecycle bar) */}
              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-slate-500">
                    Field Workers & Security Verification
                  </h3>
                </div>

              <div className="space-y-1">
                {assignedWorkers.length === 0 ? (
                  <div className="text-sm font-semibold text-slate-900">No field workers assigned yet</div>
                ) : (
                  <div className="space-y-1">
                    {assignedWorkers.map((w, idx) => (
                      <div key={w.id} className="text-sm text-slate-900 font-medium">
                        {w.name}
                        {idx === 0 && (
                          <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                            Lead • OTP holder
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* OTP Box */}
              <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 space-y-2 text-xs">
                <div className="flex items-center justify-between font-semibold">
                  <span className="flex items-center gap-1.5 text-slate-700">
                    <KeyRound className="h-3.5 w-3.5 text-slate-500" />
                    Customer Arrival OTP
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                      job.otpVerification.status === "verified"
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {job.otpVerification.status}
                  </span>
                </div>

                <div className="text-[11px] text-slate-500">
                  {job.otpVerification.status === "verified" ? (
                    <span className="text-emerald-700">
                      ✓ Verified at {formatDateTime(job.otpVerification.verifiedAt)}
                    </span>
                  ) : (
                    <span>
                      OTP sent by SMS to the registered customer number upon arrival. Verification is performed server-side.
                    </span>
                  )}
                </div>

                {job.otpVerification.status !== "verified" &&
                  (isLeadViewer ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setIsOtpModalOpen(true)}
                      className="w-full text-xs h-7 mt-1 bg-white"
                    >
                      Enter / Verify Customer OTP
                    </Button>
                  ) : (
                    <div className="text-[11px] text-slate-500 mt-1">
                      Only the lead worker ({leadWorker?.name || "first-assigned"}) can verify the customer OTP.
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </TabsContent>

        {/* 2. WORK DETAILS TAB — checklist, notes and before/after evidence
            by area (PDF §4 Work Details + §7 gallery) */}
        <TabsContent value="work" className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-xs">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Service Execution Checklist
                </h3>
                <p className="text-xs text-slate-500">
                  Auto-generated from template '{service?.name}'.
                </p>
              </div>
              <span className="text-xs font-semibold px-2.5 py-1 rounded bg-slate-100 text-slate-800">
                {jobChecklist.filter((c) => c.status === "completed").length} of {jobChecklist.length} Tasks Done
              </span>
            </div>

            <div className="divide-y divide-slate-100 mt-2">
              {jobChecklist.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400">
                  No checklist items generated for this service.
                </div>
              ) : (
                jobChecklist.map((item) => (
                  <div
                    key={item.id}
                    className="py-3 flex items-start justify-between gap-4 text-xs"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-700 px-2 py-0.5 rounded bg-slate-100 text-[10px]">
                          {item.area}
                        </span>
                        {item.critical && (
                          <span className="text-[10px] font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
                            Mandatory / Critical
                          </span>
                        )}
                        <span
                          className={`px-1.5 py-0.2 rounded text-[10px] font-semibold ${
                            item.status === "completed"
                              ? "bg-emerald-100 text-emerald-800"
                              : item.status === "issue"
                              ? "bg-red-100 text-red-800"
                              : item.status === "skipped"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {item.status}
                        </span>
                      </div>
                      <p className="text-slate-800 font-medium">{item.task}</p>
                      {item.completedBy && (
                        <p className="text-[10px] text-slate-400">
                          Completed by {item.completedBy} at {formatDateTime(item.completedAt)}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {canExecuteFieldWork ? (
                        <>
                          {item.status !== "completed" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => updateChecklistItem(item.id, "completed")}
                              className="h-7 text-[11px] px-2 text-emerald-700 hover:bg-emerald-50"
                            >
                              Mark Done
                            </Button>
                          )}
                          {item.status !== "skipped" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setPromptConfig({
                                  isOpen: true,
                                  title: "Skip Checklist Item",
                                  description: `Specify reason for skipping "${item.task}":`,
                                  placeholder: "Client requested to skip",
                                  defaultValue: "Client requested to skip",
                                  onSubmit: (reason) => {
                                    updateChecklistItem(item.id, "skipped", reason || "Client requested to skip");
                                  },
                                });
                              }}
                              className="h-7 text-[11px] px-2 text-slate-500"
                            >
                              Skip
                            </Button>
                          )}
                        </>
                      ) : (
                        <span className="text-[10px] text-slate-400 italic">Field worker execution</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Before/After evidence by area — grouped gallery with slider */}
          {canExecuteFieldWork ? (
            <BeforeAfterGallery
              photos={jobPhotos}
              allowUpload={true}
              onUploadClick={() => setPhotoUploadOpen(true)}
            />
          ) : (
            <BeforeAfterGallery
              photos={jobPhotos}
              allowUpload={false}
            />
          )}
        </TabsContent>

        {/* 4. QUALITY CHECK TAB */}
        <TabsContent value="qc" className="space-y-6">
          {/* §8 Quick visual per-area checklist — Kitchen → ✓Counter ✓Sink ✕Chimney */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Per-Area Checklist Result</h3>
                <p className="text-xs text-slate-500">Walk each room tick by tick before scoring the audit.</p>
              </div>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700">
                {jobChecklist.filter((c) => c.status === "completed").length}/{jobChecklist.length} done
              </span>
            </div>
            {jobChecklist.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-400">No checklist generated for this service yet.</p>
            ) : (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {Object.entries(
                  jobChecklist.reduce<Record<string, typeof jobChecklist>>((acc, item) => {
                    (acc[item.area] ||= []).push(item);
                    return acc;
                  }, {})
                ).map(([area, items]) => {
                  const done = items.filter((i) => i.status === "completed").length;
                  return (
                    <div key={area} className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-slate-900">{area}</span>
                        <span
                          className={cn(
                            "text-[10px] font-semibold px-1.5 py-0.5 rounded",
                            done === items.length ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"
                          )}
                        >
                          {done}/{items.length}
                        </span>
                      </div>
                      <ul className="space-y-1.5">
                        {items.map((item) => (
                          <li key={item.id} className="flex items-center gap-2 text-[11px]">
                            <span
                              className={cn(
                                "h-4 w-4 shrink-0 rounded-full flex items-center justify-center text-[9px] font-bold",
                                item.status === "completed"
                                  ? "bg-emerald-500 text-white"
                                  : item.status === "issue"
                                  ? "bg-red-500 text-white"
                                  : item.status === "skipped"
                                  ? "bg-amber-400 text-white"
                                  : "border border-slate-300 text-slate-400"
                              )}
                            >
                              {item.status === "completed" ? "✓" : item.status === "issue" ? "✕" : item.status === "skipped" ? "–" : ""}
                            </span>
                            <span className={item.status === "completed" ? "text-slate-500" : "text-slate-800 font-medium"}>
                              {item.task}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* QC Score Card */}
            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs space-y-3">
              <h3 className="text-xs font-semibold text-slate-500">
                Quality Audit Result
              </h3>

              {qc ? (
                <div className="space-y-3">
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-semibold text-slate-900">
                      {qc.score}%
                    </span>
                    <span
                      className={`text-xs font-semibold px-2 py-0.5 rounded ${
                        qc.status === "PASS"
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-red-100 text-red-800"
                      }`}
                    >
                      {qc.status}
                    </span>
                  </div>

                  <p className="text-xs text-slate-600">
                    Audited by: <strong className="text-slate-800">{qc.inspectorName}</strong>
                  </p>
                  <p className="text-xs text-slate-500 italic">
                    "{qc.notes || "Standard audit conducted"}"
                  </p>
                  <div className="text-[11px] text-slate-400">
                    Inspected: {formatDateTime(qc.inspectedAt)}
                  </div>
                </div>
              ) : (
                <div className="py-6 text-center text-xs text-slate-400">
                  <ShieldCheck className="h-8 w-8 mx-auto text-slate-300 mb-2" />
                  <p>Quality check not yet conducted.</p>
                  <p className="text-[11px] mt-1">
                    Occurs after work is marked completed.
                  </p>
                </div>
              )}
            </div>

            {/* Rework & Issues List */}
            <div className="md:col-span-2 rounded-lg border border-slate-200 bg-white p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Defects & Corrective Rework Tasks
                  </h3>
                  <p className="text-xs text-slate-500">
                    Linked defect history and corrective action tracking.
                  </p>
                </div>
                {((job.status === "REWORK_REQUIRED" || job.status === "REWORK_COMPLETED" || job.status === "REINSPECTION") && (currentRole === "super_admin" || currentRole === "ops_manager")) && (
                  <Button
                    size="sm"
                    onClick={() => {
                      setPromptConfig({
                        isOpen: true,
                        title: "Reinspect & Pass Quality Audit",
                        description: "Enter QC reinspection verification notes for customer sign-off:",
                        placeholder: "All defects verified resolved.",
                        defaultValue: "All defects verified resolved to 100% standard.",
                        onSubmit: (notes) => {
                          reinspectAndPassQC(job.id, notes || "All defects verified resolved.");
                        },
                      });
                    }}
                    className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                  >
                    <ShieldCheck className="h-3.5 w-3.5 mr-1" />
                    Reinspect & Pass QC
                  </Button>
                )}
              </div>

              {jobIssues.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400">
                  Zero defects recorded. Quality standard satisfied.
                </div>
              ) : (
                <div className="space-y-3">
                  {jobIssues.map((issue) => {
                    const task = jobRework.find((r) => r.qualityIssueId === issue.id);

                    return (
                      <div
                        key={issue.id}
                        className="p-3.5 rounded-lg border border-slate-200 bg-slate-50 space-y-2 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-900">
                              {issue.area}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                issue.severity === "critical"
                                  ? "bg-red-600 text-white"
                                  : issue.severity === "major"
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-slate-200 text-slate-700"
                              }`}
                            >
                              {issue.severity}
                            </span>
                          </div>

                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              issue.status === "resolved" || issue.status === "reinspected_pass"
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-red-100 text-red-800"
                            }`}
                          >
                            {issue.status.replace("_", " ")}
                          </span>
                        </div>

                        <p className="text-slate-800 font-medium">
                          {issue.itemDescription}
                        </p>
                        <p className="text-slate-600 text-[11px]">
                          <strong>Instructions:</strong> {issue.reworkInstructions || issue.notes}
                        </p>

                        {task && task.status !== "completed" && canExecuteFieldWork && (
                          <div className="pt-2 flex justify-end">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setPromptConfig({
                                  isOpen: true,
                                  title: "Mark Rework Task Completed",
                                  description: "Enter completion & correction notes for this rework item:",
                                  placeholder: "Rework completed to satisfaction",
                                  defaultValue: "Rework completed to satisfaction",
                                  onSubmit: (note) => {
                                    completeReworkTask(task.id, note || "Rework completed to satisfaction");
                                  },
                                });
                              }}
                              className="h-7 text-xs bg-white text-emerald-700 hover:bg-emerald-50"
                            >
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Mark Rework Task Done
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* 5. APPROVAL & FEEDBACK TAB */}
        <TabsContent value="approval" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Customer Sign-off Card */}
            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs space-y-4">
              <h3 className="text-xs font-semibold text-slate-500">
                Digital Handover Sign-Off
              </h3>

              {signOff ? (
                <div className="space-y-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Sign-off Status:</span>
                    <span
                      className={`font-semibold px-2 py-0.5 rounded ${
                        signOff.signStatus === "APPROVED"
                          ? "bg-emerald-100 text-emerald-800"
                          : signOff.signStatus === "ATTENTION_REQUESTED"
                          ? "bg-red-100 text-red-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {signOff.signStatus}
                    </span>
                  </div>

                  {signOff.signedAt && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Signed At:</span>
                      <span className="font-mono text-slate-800">{formatDateTime(signOff.signedAt)}</span>
                    </div>
                  )}

                  {signOff.signatoryName && (
                    <div className="p-2.5 rounded bg-slate-50 border border-slate-200 text-slate-700">
                      <strong>Signed By:</strong> {signOff.signatoryName}
                    </div>
                  )}

                  <div className="pt-3 border-t border-slate-100 text-[11px] text-slate-500">
                    The secure customer sign-off link is generated after QC pass and displayed in the Secure Customer Handover Link panel above. Tokens are never stored in plaintext.
                  </div>
                </div>
              ) : (
                <div className="py-6 text-center text-xs text-slate-400">
                  Customer approval link generated after QC pass.
                </div>
              )}
            </div>

            {/* Customer Feedback & Google Review */}
            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs space-y-4">
              <h3 className="text-xs font-semibold text-slate-500">
                Customer Rating & Sentiment
              </h3>

              {signOff?.feedbackRating ? (
                <div className="space-y-3 text-xs">
                  <div className="flex items-center gap-2">
                    <div className="flex text-amber-400">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <span key={i} className={i < (signOff.feedbackRating ?? 0) ? "text-amber-400" : "text-slate-200"}>
                          ★
                        </span>
                      ))}
                    </div>
                    <span className="font-semibold text-slate-900">{signOff.feedbackRating}/5.0</span>
                    <span className="capitalize font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded text-[11px]">
                      {(signOff.feedbackRating ?? 0) >= 4 ? "positive" : (signOff.feedbackRating ?? 0) === 3 ? "neutral" : "negative"}
                    </span>
                  </div>

                  {signOff.feedbackComment && (
                    <p className="text-slate-700 italic bg-slate-50 p-3 rounded border border-slate-200">
                      "{signOff.feedbackComment}"
                    </p>
                  )}

                  {signOff.feedbackTags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {signOff.feedbackTags.map((tag) => (
                        <span key={tag} className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-medium">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-slate-100">
                    <span>Google Review Triggered:</span>
                    <span className={signOff.googleReviewClicked ? "text-emerald-600 font-semibold" : "text-slate-400"}>
                      {signOff.googleReviewClicked ? "Yes (Customer Clicked Link)" : "Not Clicked"}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="py-6 text-center text-xs text-slate-400">
                  No post-service feedback submitted yet.
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* 6. FINANCIALS TAB */}
        <TabsContent value="financials" className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Billing & Invoicing File
                </h3>
                <p className="text-xs text-slate-500">
                  Official tax invoice and settlement status
                </p>
              </div>
              <PaymentStatusBadge status={job.paymentStatus ?? "UNPAID"} />
            </div>

            {invoice ? (
              <div className="space-y-4 text-xs">
                {/* §9 Human-readable money line — what the desk actually says out loud */}
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                  <p className="text-sm text-slate-800 font-medium">
                    Total Amount <span className="font-semibold text-slate-900">{formatCurrency(invoice.total)}</span>
                    <span className="text-slate-300 mx-2">·</span>
                    Paid <span className="font-semibold text-emerald-700">{formatCurrency(invoice.amountPaid)}</span>
                    <span className="text-slate-300 mx-2">·</span>
                    Balance <span className="font-semibold text-rose-600">{formatCurrency(invoice.balanceDue)}</span>
                    <span className="text-slate-300 mx-2">·</span>
                    Status: <span className="font-semibold">{
                      invoice.status === "PAID"
                        ? "Paid"
                        : invoice.status === "PARTIAL"
                        ? "Partially Paid"
                        : invoice.status === "REFUNDED"
                        ? "Refunded"
                        : invoice.status === "CANCELLED"
                        ? "Cancelled"
                        : "Payment Pending"
                    }</span>
                  </p>
                  <p className="text-[11px] text-slate-400 mt-1.5">
                    Invoice <span className="font-mono">{invoice.invoiceNumber}</span> for job {job.id}
                  </p>
                </div>

                {payments.filter((p) => p.invoiceId === invoice.id).length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Payment History</p>
                    {payments
                      .filter((p) => p.invoiceId === invoice.id)
                      .map((p) => (
                        <div key={p.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-slate-100 bg-white">
                          <span className="text-slate-700">
                            {formatCurrency(p.amount)} <span className="text-slate-400">· {p.paymentMethod?.toUpperCase()}</span>
                            {p.transactionReference && <span className="text-slate-400 font-mono"> · {p.transactionReference}</span>}
                          </span>
                          <span className="text-[10px] text-slate-400">{formatDateTime(p.paidAt)}</span>
                        </div>
                      ))}
                  </div>
                )}

                <div className="pt-1 flex items-center justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setIsInvoicePrintOpen(true)}
                    className="text-xs h-8 gap-1.5 border-slate-300"
                  >
                    <FileText className="h-3.5 w-3.5 text-rose-600" />
                    View Invoice
                  </Button>

                  {invoice.balanceDue > 0 && (
                    <Button
                      size="sm"
                      onClick={() => {
                        setPromptConfig({
                          isOpen: true,
                          title: "Record Invoice Payment Settlement",
                          description: `Enter payment transaction reference (UPI ID, Card Transaction #, or Bank Transfer Ref) to settle ${formatCurrency(invoice.balanceDue)}:`,
                          placeholder: "e.g. UPI/6692810029",
                          defaultValue: "UPI/SETTLE-" + Date.now().toString().slice(-6),
                          confirmText: "Record Settlement",
                          onSubmit: (ref) => {
                            recordPayment(invoice.id, invoice.balanceDue, "upi", ref || "MANUAL_SETTLE");
                          },
                        });
                      }}
                      className="text-xs h-8"
                    >
                      Record Payment
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div className="py-6 text-center text-xs text-slate-400">
                Invoice generation pending.
              </div>
            )}
          </div>
        </TabsContent>

        {/* 7. AUDIT LOG TAB — the real, server-recorded pipeline activity feed */}
        <TabsContent value="audit" className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="text-xs font-semibold text-slate-500">
                Live Action Log for {job.id}
              </h3>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                Auto-syncs every 10s
              </span>
            </div>

            {activityEvents.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">
                No activity recorded for this job yet — every field-worker and QC
                action (arrival, OTP, checklist ticks, photos, rework, customer
                sign-off) will appear here as it happens.
              </div>
            ) : (
              <div className="mt-3 space-y-0 divide-y divide-slate-100">
                {activityEvents.map((event) => {
                  const meta = ACTIVITY_ICON[event.type] || ACTIVITY_ICON.STATUS_CHANGED;
                  return (
                    <div key={event.id} className="py-2.5 flex items-start gap-3 text-xs">
                      <span className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 ${meta.tint}`}>
                        {meta.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-slate-800 font-medium">{event.message}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          {event.actorName}
                          {event.actorRole === "customer" ? " (customer)" : ` · ${event.actorRole.replace("_", " ")}`} · {formatDateTime(event.createdAt)} ({timeAgo(event.createdAt)})
                        </p>
                      </div>
                      <span className="text-[9px] font-semibold text-slate-300 shrink-0 pt-1">
                        {event.type.replace(/_/g, " ")}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* OTP Verification Modal */}
      <OTPModal
        job={job}
        isOpen={isOtpModalOpen}
        onClose={() => setIsOtpModalOpen(false)}
      />

      {/* Staff Assignment Modal — worker picker with availability & conflicts,
          backed by the same PATCH assignment path as the dispatcher. */}
      <Dialog open={assignmentOpen} onOpenChange={(o) => !assignmentSaving && setAssignmentOpen(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-4 w-4 text-indigo-600" />
              {job.assignedStaffIds.length > 0 ? "Manage Assigned Field Workers" : "Assign Field Workers"}
            </DialogTitle>
            <DialogDescription>
              Job {job.id} • {formatDate(job.scheduledDate)} • {formatTimeSlot(job.scheduledTimeSlot)}. The first
              selected worker becomes the lead (customer OTP holder).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-1">
            {eligibleWorkers.length === 0 ? (
              <div className="p-3 rounded-md bg-amber-50 border border-amber-200 text-[11px] text-amber-800">
                No active field workers found. Add them under Users &amp; Roles first.
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
                {eligibleWorkers.map((w) => {
                  const isSelected = selectedWorkerIds.includes(w.id);
                  const isBusy = activeWorkerIds.has(w.id) && !isSelected;
                  const isLead = isSelected && selectedWorkerIds[0] === w.id;
                  return (
                    <button
                      key={w.id}
                      type="button"
                      disabled={assignmentSaving}
                      onClick={() =>
                        setSelectedWorkerIds((prev) =>
                          prev.includes(w.id) ? prev.filter((id) => id !== w.id) : [...prev, w.id]
                        )
                      }
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-md border text-xs transition-all ${
                        isSelected
                          ? "bg-indigo-50 border-indigo-300 text-indigo-900"
                          : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <span className="flex items-center gap-2 font-semibold">
                        <span
                          className={`h-2 w-2 rounded-full shrink-0 ${
                            isBusy ? "bg-amber-500" : isSelected ? "bg-indigo-500" : "bg-emerald-500"
                          }`}
                        />
                        {w.name}
                        {isLead && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-indigo-100 text-indigo-700 border border-indigo-200">
                            Lead • OTP holder
                          </span>
                        )}
                      </span>
                      <span className="flex items-center gap-2 shrink-0">
                        {w.phone && <span className="text-[10px] text-slate-400 font-mono">{w.phone}</span>}
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                            isBusy
                              ? "bg-amber-100 text-amber-800"
                              : "bg-emerald-100 text-emerald-800"
                          }`}
                        >
                          {isBusy ? "Booked this slot" : "Available"}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>
                {selectedWorkerIds.length} worker{selectedWorkerIds.length === 1 ? "" : "s"} selected
              </span>
              {activeWorkerIds.size > 0 && (
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  amber = already on another job in this date &amp; time window
                </span>
              )}
            </div>

            {assignmentErrorMsg && (
              <div className="p-2.5 rounded-md bg-red-50 border border-red-200 text-red-700 text-[11px] flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{assignmentErrorMsg}</span>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={assignmentSaving}
              onClick={() => setAssignmentOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={assignmentSaving}
              onClick={handleAssignConfirm}
              className="bg-indigo-600 hover:bg-indigo-500 text-white gap-1.5"
            >
              {assignmentSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {assignmentSaving ? "Saving…" : `Confirm ${selectedWorkerIds.length} Worker${selectedWorkerIds.length === 1 ? "" : "s"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Photo Upload Dialog */}
      <Dialog open={photoUploadOpen} onOpenChange={setPhotoUploadOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Upload Service Evidence Photo</DialogTitle>
            <DialogDescription>
              Record before or after condition with area tag and caption for customer audit.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handlePhotoUploadSubmit} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700">Area / Room</label>
              <select
                value={photoArea}
                onChange={(e) => setPhotoArea(e.target.value)}
                className="w-full h-9 rounded-md border border-slate-200 text-xs px-3 bg-white"
              >
                {/* §7 canonical areas — the gallery groups photos by these */}
                <option value="Living Room">Living Room</option>
                <option value="Bedroom">Bedroom</option>
                <option value="Kitchen">Kitchen</option>
                <option value="Bathroom">Bathroom</option>
                <option value="Balcony">Balcony</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700">Photo Type</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-1.5 text-xs text-slate-700">
                  <input
                    type="radio"
                    checked={photoType === "before"}
                    onChange={() => setPhotoType("before")}
                  />
                  Before (Initial State)
                </label>
                <label className="flex items-center gap-1.5 text-xs text-slate-700">
                  <input
                    type="radio"
                    checked={photoType === "after"}
                    onChange={() => setPhotoType("after")}
                  />
                  After (Delivered Result)
                </label>
              </div>
            </div>

            {/* Camera Capture / File Upload UI */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700 block">Capture or Select Evidence Photo</label>

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
                      className="h-7 text-xs bg-white text-slate-900 font-semibold"
                      onClick={() => cameraInputRef.current?.click()}
                    >
                      <Camera className="h-3.5 w-3.5 mr-1 text-slate-700" />
                      Retake
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      className="h-7 text-xs bg-red-600 hover:bg-red-700 text-white font-medium"
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
                    className="p-3 rounded-lg border-2 border-dashed border-blue-300 bg-blue-50/60 hover:bg-blue-100/70 transition-all flex flex-col items-center justify-center text-center group"
                  >
                    <div className="h-8 w-8 rounded-full bg-blue-600 text-white flex items-center justify-center mb-1 shadow-xs group-hover:scale-105 transition-transform">
                      <Camera className="h-4 w-4" />
                    </div>
                    <span className="text-xs font-semibold text-blue-950">Camera</span>
                    <span className="text-[10px] text-blue-600">Snap photo</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="p-3 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 transition-all flex flex-col items-center justify-center text-center group"
                  >
                    <div className="h-8 w-8 rounded-full bg-slate-800 text-white flex items-center justify-center mb-1 shadow-xs group-hover:scale-105 transition-transform">
                      <Upload className="h-4 w-4" />
                    </div>
                    <span className="text-xs font-semibold text-slate-900">Gallery / Files</span>
                    <span className="text-[10px] text-slate-500">Pick image file</span>
                  </button>
                </div>
              )}

              {photoError && (
                <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2.5 py-1.5">{photoError}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700">Caption / Notes</label>
              <Input
                value={photoCaption}
                onChange={(e) => setPhotoCaption(e.target.value)}
                placeholder="E.g., Heavy carbon descaled with eco degreaser"
                className="text-xs"
              />
            </div>

            <DialogFooter className="pt-3 border-t border-slate-100">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPhotoUploadOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={photoUploading} className="">
                {photoUploading ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    Uploading…
                  </>
                ) : (
                  "Upload & Record"
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
        confirmText={promptConfig.confirmText}
        onSubmit={promptConfig.onSubmit}
      />

      {/* Printable Tax Invoice Modal */}
      {invoice && (
        <PrintableInvoiceModal
          isOpen={isInvoicePrintOpen}
          onClose={() => setIsInvoicePrintOpen(false)}
          invoice={invoice}
          job={job}
          customer={customer}
          property={property}
          service={service}
          payments={payments.filter((p) => p.invoiceId === invoice.id)}
          systemSettings={systemSettings}
        />
      )}

      {/* Lightbox Image Preview Modal */}
      {lightboxPhoto && (
        <ImageLightboxModal
          isOpen={!!lightboxPhoto}
          onClose={() => setLightboxPhoto(null)}
          imageUrl={lightboxPhoto.url}
          title={lightboxPhoto.title}
          category={lightboxPhoto.category}
          uploadedBy={lightboxPhoto.uploadedBy}
          uploadedAt={lightboxPhoto.uploadedAt}
          notes={lightboxPhoto.notes}
        />
      )}
    </AdminLayout>
  );
}
