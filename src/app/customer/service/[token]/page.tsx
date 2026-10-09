"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  Loader2,
  ShieldCheck,
  MapPin,
  Users,
  AlertTriangle,
  CheckCircle2,
  Star,
  Calendar,
  Sparkles,
  MessageSquareWarning,
  ExternalLink,
  Clock,
  Images,
  FileText,
  XCircle,
  Home,
  ClipboardList,
  User,
  Check,
  Navigation,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/states";
import { IntenseAIChat } from "@/components/ai/IntenseAIChat";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * /customer/service/[token] — "My Service": the customer's ONE secure link
 * for the whole job (no app, no login). Home · My Service · Reports · Profile.
 * The Home screen follows the job:
 *
 *   SCHEDULED       → [VIEW SERVICE]
 *   ARRIVED         → Team arrived ✓ → [CONFIRM & START]
 *   IN PROGRESS     → progress bar → [VIEW PROGRESS]
 *   WORK COMPLETED  → Quality check pending
 *   QC PASSED       → [VIEW BEFORE / AFTER] → [APPROVE SERVICE]
 *   COMPLETED       → Thank you ✓ · rating · [LEAVE GOOGLE REVIEW]
 *
 * The server authorizes every read and action by the token. The customer sees
 * their own service, before/after photos, a plain QC result and their own
 * invoice — never internal notes, QC findings, rework photos or other customers.
 */

interface CustomerPayload {
  /** What this customer may see — anything off is not sent at all. */
  visibility: Record<string, boolean>;
  job: {
    id: string | null;
    status: string;
    showStatus: boolean;
    serviceName: string | null;
    scheduledDate: string | null;
    scheduledTimeSlot: string | null;
    arrivedAt: string | null;
    completedAt: string | null;
    customerConfirmedAt: string | null;
    arrivalVerified: boolean;
  };
  property: { title: string; address: string } | null;
  location: { lat: number; lng: number } | null;
  customer: { name: string; phoneMasked: string };
  team: string[];
  checklist: { id: string; area: string; task: string; completed: boolean }[];
  photos: { id: string; area: string; photoType: string; url: string; uploadedAt: string }[];
  qualityCheck: { passed: boolean } | null;
  /** Customer-facing QC result: checking → (improving) → passed. */
  qualityResult: "checking" | "improving" | "passed" | null;
  invoice: CustomerInvoice | null;
  serviceNotes: string | null;
  quotation: { quoteNumber: string; total: number; validUntil: string; status: string; url: string | null } | null;
  paymentStatus: string | null;
  approval: { approvedAt: string; approvedBy: string; method: string } | null;
  feedback: { rating: number; comment: string | null; feedbackAt: string | null; googleReviewClicked: boolean } | null;
  complaintCount: number;
  company: { name: string; googleReviewUrl: string };
}

interface CustomerInvoice {
  invoiceNumber: string;
  invoiceType: "GST" | "NON_GST";
  issuedAt: string;
  dueDate: string;
  subtotal: number;
  discount: number;
  taxable: number;
  gstRate?: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  totalGst?: number;
  customerGstin?: string;
  companyGstin?: string;
  total: number;
  items?: { description: string; quantity: number; rate: number; amount: number }[];
  amountPaid?: number;
  balanceDue?: number;
  status?: string;
  paymentTerms?: string;
  companyName: string;
  companyAddress: string;
}

const PAYMENT_TEXT: Record<string, { text: string; tone: string }> = {
  PAID: { text: "Paid ✓", tone: "text-emerald-700" },
  PARTIAL: { text: "Partly paid", tone: "text-amber-700" },
  PENDING: { text: "Payment pending", tone: "text-amber-700" },
  UNPAID: { text: "Payment pending", tone: "text-amber-700" },
  OVERDUE: { text: "Payment overdue", tone: "text-red-700" },
};
const navigateHref = (loc: { lat: number; lng: number } | null, address?: string) =>
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(loc ? `${loc.lat},${loc.lng}` : address ?? "")}`;

const QC_TEXT: Record<NonNullable<CustomerPayload["qualityResult"]>, { text: string; tone: string }> = {
  checking: { text: "Being checked", tone: "text-amber-700" },
  improving: { text: "Finishing touches", tone: "text-amber-700" },
  passed: { text: "Passed ✓", tone: "text-emerald-700" },
};

type Stage = "scheduled" | "arrived" | "in_progress" | "qc_pending" | "approve" | "completed" | "cancelled";
type Tab = "home" | "service" | "reports" | "profile";

function stageOf(status: string, confirmed: boolean, approved: boolean): Stage {
  if (approved) return "completed";
  switch (status) {
    case "DRAFT":
    case "SCHEDULED":
    case "ASSIGNED":
      return "scheduled";
    case "ARRIVED":
      return confirmed ? "in_progress" : "arrived";
    case "CUSTOMER_VERIFIED":
    case "IN_PROGRESS":
      return "in_progress";
    case "PASS":
    case "CUSTOMER_APPROVAL":
      return "approve";
    case "COMPLETED":
    case "FEEDBACK_REQUESTED":
    case "CLOSED":
      return "completed";
    case "CANCELLED":
      return "cancelled";
    default:
      return "qc_pending";
  }
}

const STATUS_LINE: Record<Stage, { text: string; tone: "neutral" | "info" | "warning" | "success" | "error" }> = {
  scheduled: { text: "Scheduled", tone: "neutral" },
  arrived: { text: "Team Arrived ✓", tone: "info" },
  in_progress: { text: "Service in progress", tone: "info" },
  qc_pending: { text: "Quality check pending", tone: "warning" },
  approve: { text: "Quality passed ✓", tone: "success" },
  completed: { text: "Completed ✓", tone: "success" },
  cancelled: { text: "Cancelled", tone: "error" },
};

const JOURNEY = ["Booked", "Arrived", "Cleaning", "Quality", "Approved"];
const JOURNEY_INDEX: Record<Stage, number> = { scheduled: 0, arrived: 1, in_progress: 2, qc_pending: 3, approve: 3, completed: 4, cancelled: 0 };

export default function CustomerServicePage() {
  const params = useParams();
  const token = (params?.token as string) || "";
  const [data, setData] = useState<CustomerPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [showComplaint, setShowComplaint] = useState(false);
  const [complaintCategory, setComplaintCategory] = useState("missed_area");
  const [complaintText, setComplaintText] = useState("");
  const [complaintSent, setComplaintSent] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [commentSent, setCommentSent] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/customer/job/${encodeURIComponent(token)}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) {
        setData(json.data);
        setError(null);
        if (json.data.feedback?.rating) setRating(json.data.feedback.rating);
        if (json.data.feedback?.comment) setCommentSent(true);
      } else {
        setKind(json?.kind || "not_found");
        setError(json?.error || "This link is invalid or has expired.");
      }
    } catch {
      setError("We couldn't load your service. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Live: the page follows the job (team arrives, QC passes …) without a reload.
  useEffect(() => {
    void load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 15000);
    return () => clearInterval(t);
  }, [load]);

  const go = (t: Tab) => {
    setTab(t);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/customer/job/${encodeURIComponent(token)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    if (!res) return { ok: false, json: { error: "You're offline. Please try again when you're connected." } };
    return { ok: res.ok, json: await res.json().catch(() => null) };
  };

  const act = async (body: Record<string, unknown>, okMessage: string) => {
    setBusy(true);
    setActionError(null);
    const { ok, json } = await post(body);
    setBusy(false);
    if (ok && json?.success) {
      setSuccess(okMessage);
      setTimeout(() => setSuccess(null), 4000);
      await load();
      return true;
    }
    setActionError(json?.error || "That didn't go through. Please try again.");
    return false;
  };

  if (loading) {
    return (
      <Shell>
        <div className="space-y-4" role="status" aria-label="Loading your service">
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-64 rounded-3xl" />
          <Skeleton className="h-24 rounded-3xl" />
        </div>
      </Shell>
    );
  }

  if (error || !data) {
    return (
      <Shell>
        <div className="bg-white p-8 rounded-3xl border border-zinc-200 text-center space-y-3 mt-8">
          <div className={cn("h-14 w-14 rounded-2xl flex items-center justify-center mx-auto", kind === "revoked" ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600")}>
            <AlertTriangle className="h-7 w-7" aria-hidden />
          </div>
          <h1 className="text-xl font-semibold text-zinc-950">{kind === "revoked" ? "This link is no longer active" : "We couldn't open your service"}</h1>
          <p className="text-base text-zinc-600">{error}</p>
          {kind !== "revoked" && kind !== "not_found" && (
            <button onClick={() => { setLoading(true); void load(); }} className="h-12 px-5 rounded-xl border border-zinc-300 text-sm font-semibold">Try again</button>
          )}
          <p className="text-sm text-zinc-500">Please contact us for a new link.</p>
        </div>
      </Shell>
    );
  }

  const { job, property, team, checklist, company } = data;
  const confirmed = !!job.customerConfirmedAt;
  const stage = stageOf(job.status, confirmed, !!data.approval);
  const doneCount = checklist.filter((c) => c.completed).length;
  const pct = checklist.length ? Math.round((doneCount / checklist.length) * 100) : 0;
  const areas = Array.from(new Set([...checklist.map((c) => c.area), ...data.photos.map((p) => p.area)]));
  const when = job.scheduledDate ? formatWhen(job.scheduledDate, job.scheduledTimeSlot ?? "") : "";
  const vis = data.visibility ?? {};
  const serviceTitle = job.serviceName ?? "Your service";
  const where = property ? `${property.title}${property.address ? ` — ${property.address}` : ""}` : null;
  const payment = data.paymentStatus ? PAYMENT_TEXT[data.paymentStatus] ?? { text: data.paymentStatus, tone: "text-zinc-800" } : null;
  const status = STATUS_LINE[stage];

  /* ------------------------------------------- the ONE primary action */
  const primary = (() => {
    if (tab !== "home") return null;
    switch (stage) {
      case "scheduled":
        return <Cta tone="neutral" onClick={() => go("service")} icon={<FileText className="h-5 w-5" aria-hidden />}>VIEW SERVICE</Cta>;
      case "arrived":
        return <Cta busy={busy} onClick={() => void act({ action: "confirm" }, "Thank you — your service is starting.")} icon={<CheckCircle2 className="h-5 w-5" aria-hidden />}>CONFIRM &amp; START</Cta>;
      case "in_progress":
        return <Cta tone="neutral" onClick={() => go("service")} icon={<ClipboardList className="h-5 w-5" aria-hidden />}>VIEW PROGRESS</Cta>;
      case "approve":
        return <Cta tone="success" busy={busy} onClick={() => void act({ action: "approve", signatoryName: data.customer.name || "Customer", confirmChecked: true }, "Service approved ✓ Thank you!")} icon={<CheckCircle2 className="h-5 w-5" aria-hidden />}>APPROVE SERVICE</Cta>;
      case "completed":
        return <Cta tone="neutral" onClick={() => go("reports")} icon={<FileText className="h-5 w-5" aria-hidden />}>VIEW REPORT</Cta>;
      default:
        return null;
    }
  })();

  return (
    <Shell action={primary} tab={tab} onTab={go} onAskAi={() => setAiOpen(true)}>
      {success && (
        <div role="status" className="rounded-2xl bg-emerald-600 text-white text-base font-semibold px-4 py-3 flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
          <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden /> {success}
        </div>
      )}
      {actionError && (
        <div role="alert" className="rounded-2xl bg-red-50 border border-red-200 text-red-800 text-base px-4 py-3">{actionError}</div>
      )}

      {/* ------------------------------------------------------------ HOME */}
      {tab === "home" && (
        <>
          {stage !== "cancelled" && (
            <ol className="flex items-start gap-1" aria-label="Your service journey">
              {JOURNEY.map((label, i) => {
                const at = JOURNEY_INDEX[stage];
                const done = i < at || (stage === "completed" && i === at);
                return (
                  <li key={label} className="flex-1 min-w-0">
                    <div className={cn("h-1.5 rounded-full transition-colors duration-500", done ? "bg-emerald-500" : i === at ? "bg-rose-500" : "bg-zinc-200")} aria-hidden />
                    <div className={cn("mt-1.5 text-xs font-semibold text-center leading-tight", i === at ? "text-zinc-950" : "text-zinc-400")}>
                      {label}
                      <span className="sr-only">{done ? " — done" : i === at ? " — now" : ""}</span>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}

          <section className="bg-white rounded-3xl border border-zinc-200 p-6 shadow-sm space-y-5 animate-in fade-in">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Your service</div>
              <h1 className="text-2xl font-semibold text-zinc-950 mt-1">{serviceTitle}</h1>
              {when && <p className="text-base text-zinc-600 mt-1 flex items-center gap-1.5"><Calendar className="h-4 w-4 shrink-0" aria-hidden /> {when}</p>}
            </div>
            {job.showStatus && (
              <div className="flex items-center justify-between gap-3 rounded-2xl bg-zinc-50 px-4 py-3">
                <span className="text-sm text-zinc-500">Status</span>
                <span className={cn("text-base font-semibold text-right", status.tone === "success" ? "text-emerald-700" : status.tone === "warning" ? "text-amber-700" : status.tone === "info" ? "text-info-700" : status.tone === "error" ? "text-red-700" : "text-zinc-800")}>{status.text}</span>
              </div>
            )}
            <dl className="divide-y divide-zinc-100 text-sm">
              {job.id && <div className="flex items-start justify-between gap-3 py-2"><dt className="text-zinc-500 shrink-0">Job ID</dt><dd className="font-mono font-semibold text-zinc-900 text-right break-all">{job.id}</dd></div>}
              <div className="flex items-start justify-between gap-3 py-2"><dt className="text-zinc-500 shrink-0">Name</dt><dd className="font-medium text-zinc-900 text-right break-words">{data.customer.name}</dd></div>
              {where && (
                <div className="flex items-start justify-between gap-3 py-2">
                  <dt className="text-zinc-500 shrink-0">Location</dt>
                  <dd className="text-right min-w-0">
                    <span className="block font-medium text-zinc-900 break-words">{where}</span>
                    <a href={navigateHref(data.location, property?.address)} target="_blank" rel="noreferrer" className="min-h-10 inline-flex items-center gap-1 font-semibold text-rose-600"><Navigation className="h-4 w-4" aria-hidden /> Navigate</a>
                  </dd>
                </div>
              )}
              {vis.team !== false && <div className="flex items-start justify-between gap-3 py-2"><dt className="text-zinc-500 shrink-0">Team</dt><dd className="font-medium text-zinc-900 text-right break-words">{team.length ? team.join(", ") : "Being assigned"}</dd></div>}
              {data.qualityResult && (
                <div className="flex items-start justify-between gap-3 py-2"><dt className="text-zinc-500 shrink-0">Quality check</dt><dd className={cn("font-semibold text-right", QC_TEXT[data.qualityResult].tone)}>{QC_TEXT[data.qualityResult].text}</dd></div>
              )}
              {data.quotation?.url && (
                <div className="flex items-center justify-between gap-3 py-2">
                  <dt className="text-zinc-500 shrink-0">Quotation</dt>
                  <dd className="text-right">
                    <a href={data.quotation.url} className="min-h-10 font-semibold text-rose-600 inline-flex items-center gap-1">{formatInr(data.quotation.total)} · View</a>
                  </dd>
                </div>
              )}
              {payment && (
                <div className="flex items-start justify-between gap-3 py-2"><dt className="text-zinc-500 shrink-0">Payment</dt><dd className={cn("font-semibold text-right", payment.tone)}>{payment.text}</dd></div>
              )}
              {data.invoice && (
                <div className="flex items-center justify-between gap-3 py-2">
                  <dt className="text-zinc-500 shrink-0">Invoice</dt>
                  <dd className="text-right">
                    <button onClick={() => go("reports")} className="min-h-10 font-semibold text-rose-600 inline-flex items-center gap-1">
                      {formatInr(data.invoice.total)} · View
                    </button>
                  </dd>
                </div>
              )}
            </dl>

            {data.serviceNotes && <p className="rounded-2xl bg-zinc-50 px-4 py-3 text-sm text-zinc-700 break-words"><span className="font-semibold">Note from us:</span> {data.serviceNotes}</p>}

            {stage === "scheduled" && <p className="text-base text-zinc-600">We&apos;ll update this page the moment your team arrives.</p>}

            {stage === "arrived" && (
              <div className="text-center space-y-2 py-2">
                <Badge tone="green" icon={<CheckCircle2 className="h-8 w-8" aria-hidden />} />
                <p className="text-xl font-semibold text-zinc-950">Your team has arrived ✓</p>
                <p className="text-base text-zinc-600">{team.length ? `${team.join(", ")} ${team.length === 1 ? "is" : "are"} at ${property?.title ?? "your property"}.` : `Your team is at ${property?.title ?? "your property"}.`} Tap Confirm &amp; Start to let them begin.</p>
              </div>
            )}

            {stage === "in_progress" && (
              <div className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-base font-semibold text-zinc-950">Service in progress</span>
                  <span className="text-3xl font-semibold text-rose-500 tabular-nums">{pct}%</span>
                </div>
                <div className="h-3 rounded-full bg-zinc-100 overflow-hidden" role="progressbar" aria-label="Service progress" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full rounded-full bg-rose-500 transition-all duration-700" style={{ width: `${pct}%` }} />
                </div>
                <p className="text-sm text-zinc-500">{doneCount} of {checklist.length} tasks done · updates live</p>
              </div>
            )}

            {stage === "qc_pending" && (
              <div className="text-center space-y-2 py-2">
                <Badge tone="amber" icon={<Clock className="h-8 w-8" aria-hidden />} />
                <p className="text-xl font-semibold text-zinc-950">Service completed ✓</p>
                <p className="text-base text-zinc-600">Our quality team is checking every area. You&apos;ll approve right here.</p>
              </div>
            )}

            {stage === "approve" && (
              <div className="space-y-3">
                <div className="text-center space-y-2 py-1">
                  <Badge tone="green" icon={<ShieldCheck className="h-8 w-8" aria-hidden />} />
                  <p className="text-xl font-semibold text-zinc-950">Service completed ✓</p>
                  <p className="text-base text-zinc-600">Quality: <strong className="text-emerald-700">PASSED ✓</strong></p>
                </div>
                {data.photos.length > 0 && (
                  <button onClick={() => go("reports")} className="h-12 w-full rounded-2xl border border-zinc-300 bg-white text-base font-semibold text-zinc-900 inline-flex items-center justify-center gap-2">
                    <Images className="h-5 w-5" aria-hidden /> VIEW BEFORE / AFTER
                  </button>
                )}
              </div>
            )}

            {stage === "completed" && (
              <div className="text-center space-y-3 py-1">
                <Badge tone="green" icon={<CheckCircle2 className="h-8 w-8" aria-hidden />} />
                <p className="text-xl font-semibold text-zinc-950">Thank you ✓</p>
                {vis.feedback !== false && (
                  <>
                    <p className="text-base text-zinc-600">{rating ? `You rated us ${rating}/5.` : "How did we do?"}</p>
                    <Stars rating={rating} onRate={(n) => { setRating(n); void act({ action: "feedback", rating: n, googleReviewClicked: !!data.feedback?.googleReviewClicked }, "Thanks for your rating!"); }} />
                    {rating > 0 && !commentSent && (
                      <div className="space-y-2 text-left">
                        <label htmlFor="fb-comment" className="block text-sm font-medium text-zinc-800">Anything you&apos;d like to tell us? <span className="text-zinc-500">(private)</span></label>
                        <textarea id="fb-comment" value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={2000} className="w-full p-3 rounded-xl border border-zinc-300 text-base" placeholder="What went well, what we can do better…" />
                        <button
                          disabled={comment.trim().length < 2 || busy}
                          onClick={async () => {
                            if (await act({ action: "feedback", rating, comment: comment.trim(), googleReviewClicked: !!data.feedback?.googleReviewClicked }, "Thanks for your feedback!")) setCommentSent(true);
                          }}
                          className="h-12 w-full rounded-2xl border border-zinc-300 bg-white text-base font-semibold text-zinc-900 disabled:opacity-50"
                        >
                          Send feedback
                        </button>
                      </div>
                    )}
                    {commentSent && data.feedback?.comment && <p className="text-sm text-zinc-500 break-words">Your feedback: “{data.feedback.comment}”</p>}
                  </>
                )}
                {company.googleReviewUrl && (
                  <a href={company.googleReviewUrl} target="_blank" rel="noreferrer" onClick={() => void post({ action: "feedback", rating: rating || 5, googleReviewClicked: true })} className="h-12 w-full rounded-2xl bg-zinc-900 text-white text-base font-semibold inline-flex items-center justify-center gap-2">
                    <ExternalLink className="h-5 w-5" aria-hidden /> LEAVE GOOGLE REVIEW
                  </a>
                )}
              </div>
            )}

            {stage === "cancelled" && (
              <div className="text-center space-y-2 py-2">
                <Badge tone="amber" icon={<XCircle className="h-8 w-8" aria-hidden />} />
                <p className="text-xl font-semibold text-zinc-950">This service was cancelled</p>
                <p className="text-base text-zinc-600">Please contact us if you&apos;d like to book again.</p>
              </div>
            )}
          </section>
        </>
      )}

      {/* ---------------------------------------------------- MY SERVICE */}
      {tab === "service" && (
        <>
          <Panel title="My service">
            {job.serviceName && <Detail icon={<Sparkles className="h-5 w-5" aria-hidden />} label="Service" value={job.serviceName} />}
            {when && <Detail icon={<Calendar className="h-5 w-5" aria-hidden />} label="When" value={when} />}
            {where && <Detail icon={<MapPin className="h-5 w-5" aria-hidden />} label="Where" value={where} />}
            {vis.team !== false && <Detail icon={<Users className="h-5 w-5" aria-hidden />} label="Your team" value={team.length ? team.join(", ") : "Being assigned"} />}
            {data.serviceNotes && <Detail icon={<FileText className="h-5 w-5" aria-hidden />} label="Notes" value={data.serviceNotes} />}
          </Panel>
          {where && (
            <a href={navigateHref(data.location, property?.address)} target="_blank" rel="noreferrer" className="h-12 w-full rounded-2xl border border-zinc-300 bg-white text-base font-semibold text-zinc-900 inline-flex items-center justify-center gap-2">
              <Navigation className="h-5 w-5 text-rose-500" aria-hidden /> Navigate to location
            </a>
          )}
          {job.showStatus && <Panel title={`Progress · ${doneCount} of ${checklist.length}`}>
            {checklist.length === 0 ? (
              <p className="py-3 text-base text-zinc-500">Progress shows here once the service starts.</p>
            ) : (
              Array.from(new Set(checklist.map((c) => c.area))).map((area) => (
                <div key={area} className="py-3">
                  <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1">{area}</div>
                  {checklist.filter((c) => c.area === area).map((item) => (
                    <div key={item.id} className="py-1.5 flex items-center gap-2.5 text-base">
                      <span className={cn("h-6 w-6 rounded-full flex items-center justify-center shrink-0", item.completed ? "bg-emerald-500 text-white" : "border-2 border-zinc-300")}>
                        {item.completed && <Check className="h-4 w-4" aria-hidden />}
                      </span>
                      <span className={item.completed ? "text-zinc-800" : "text-zinc-400"}>{item.task}<span className="sr-only">{item.completed ? " — done" : " — not yet"}</span></span>
                    </div>
                  ))}
                </div>
              ))
            )}
          </Panel>}
        </>
      )}

      {/* -------------------------------------------------------- REPORTS */}
      {tab === "reports" && (
        <>
          {stage === "completed" && (
            <div className="print:hidden">
            <Panel title="Service report">
              {job.serviceName && <Detail icon={<Sparkles className="h-5 w-5" aria-hidden />} label="Service" value={job.serviceName} />}
              {when && <Detail icon={<Calendar className="h-5 w-5" aria-hidden />} label="Date" value={when} />}
              {vis.team !== false && <Detail icon={<Users className="h-5 w-5" aria-hidden />} label="Team" value={team.join(", ") || "—"} />}
              {data.qualityResult && <Detail icon={<ShieldCheck className="h-5 w-5" aria-hidden />} label="Quality" value="Passed ✓" />}
              {data.approval && <Detail icon={<CheckCircle2 className="h-5 w-5" aria-hidden />} label="Approved" value={new Date(data.approval.approvedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} />}
              {checklist.length > 0 && <Detail icon={<ClipboardList className="h-5 w-5" aria-hidden />} label="Tasks" value={`${doneCount} of ${checklist.length} done`} />}
            </Panel>
            </div>
          )}
          {(vis.beforePhotos !== false || vis.afterPhotos !== false) && (
            <div className="print:hidden">
              <Panel title={vis.beforePhotos === false ? "After photos" : vis.afterPhotos === false ? "Before photos" : "Before / After"}>
                <BeforeAfter photos={data.photos} areas={areas} />
              </Panel>
            </div>
          )}
          {data.quotation?.url && (
            <a href={data.quotation.url} className="print:hidden flex items-center justify-between gap-3 bg-white rounded-3xl border border-zinc-200 p-5 shadow-sm">
              <span className="min-w-0">
                <span className="block text-lg font-semibold text-zinc-950">Quotation</span>
                <span className="block text-sm text-zinc-500 font-mono break-all">{data.quotation.quoteNumber} · {formatInr(data.quotation.total)}</span>
              </span>
              <ExternalLink className="h-5 w-5 text-zinc-400 shrink-0" aria-hidden />
            </a>
          )}
          {data.invoice && <InvoicePanel invoice={data.invoice} customerName={data.customer.name} jobId={job.id} serviceName={job.serviceName} />}
          {stage === "approve" && (
            <button onClick={() => go("home")} className="h-12 w-full rounded-2xl bg-emerald-600 text-white text-base font-semibold">Back to approve</button>
          )}
        </>
      )}

      {/* -------------------------------------------------------- PROFILE */}
      {tab === "profile" && (
        <>
          <Panel title="Profile">
            <Detail icon={<User className="h-5 w-5" aria-hidden />} label="Name" value={data.customer.name} />
            <Detail icon={<ShieldCheck className="h-5 w-5" aria-hidden />} label="Phone" value={data.customer.phoneMasked} />
            {property && <Detail icon={<MapPin className="h-5 w-5" aria-hidden />} label="Property" value={property.title} />}
          </Panel>
          {complaintSent && (
            <div role="status" className="p-4 rounded-2xl border border-amber-200 bg-amber-50 text-amber-900 text-base">
              Thanks — your message reached our team. We&apos;ll contact you shortly.
            </div>
          )}
          {stage !== "cancelled" && !data.approval && (
            <button onClick={() => setShowComplaint(true)} className="h-12 w-full rounded-2xl border border-zinc-300 bg-white text-base font-semibold text-zinc-800 inline-flex items-center justify-center gap-2">
              <MessageSquareWarning className="h-5 w-5 text-amber-600" aria-hidden /> Something not right? Tell us
            </button>
          )}
          <p className="text-sm text-zinc-500 text-center">This is your private, secure link. Please don&apos;t share it.</p>
        </>
      )}

      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogTitle className="sr-only">Intense AI</DialogTitle>
          {aiOpen && <IntenseAIChat role="customer" userName={data.customer.name} token={token} storageKey={`intense-ai:customer:${job.id ?? token.slice(0, 12)}`} compact />}
        </DialogContent>
      </Dialog>

      <Dialog open={showComplaint} onOpenChange={setShowComplaint}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tell us what&apos;s wrong</DialogTitle>
            <DialogDescription>Our team will look into it and contact you.</DialogDescription>
          </DialogHeader>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-zinc-800">What happened?</span>
            <select value={complaintCategory} onChange={(e) => setComplaintCategory(e.target.value)} className="w-full h-12 rounded-xl border border-zinc-300 px-3 text-base bg-white">
              <option value="missed_area">An area wasn&apos;t cleaned</option>
              <option value="quality">Quality issue</option>
              <option value="damage">Something was damaged</option>
              <option value="staff_behavior">Team conduct</option>
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-zinc-800">Details</span>
            <textarea value={complaintText} onChange={(e) => setComplaintText(e.target.value)} rows={4} placeholder="Tell us what went wrong…" className="w-full p-3 rounded-xl border border-zinc-300 text-base" />
          </label>
          <DialogFooter>
            <button onClick={() => setShowComplaint(false)} className="h-12 px-5 rounded-xl border border-zinc-300 text-base font-semibold text-zinc-700">Cancel</button>
            <button
              disabled={complaintText.trim().length < 5 || busy}
              onClick={async () => {
                const ok = await act({ action: "complaint", category: complaintCategory, description: complaintText.trim() }, "Message sent to our team.");
                if (ok) {
                  setShowComplaint(false);
                  setComplaintSent(true);
                  setComplaintText("");
                }
              }}
              className="h-12 px-5 rounded-xl bg-rose-500 text-white text-base font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Send
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Shell>
  );
}

function formatWhen(iso: string, slot: string): string {
  const d = new Date(`${iso}T00:00:00`);
  const today = new Date();
  const time = slot.split(/\s*[-–]\s*/)[0];
  const t = /^\d{1,2}:\d{2}$/.test(time) ? new Date(`${iso}T${time.padStart(5, "0")}:00`).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : time;
  if (Number.isNaN(d.getTime())) return `${iso} · ${slot}`;
  const isToday = d.toDateString() === today.toDateString();
  return `${isToday ? "Today" : d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })} · ${t}`;
}

const TABS: { key: Tab; label: string; Icon: React.ElementType }[] = [
  { key: "home", label: "Home", Icon: Home },
  { key: "service", label: "My Service", Icon: ClipboardList },
  { key: "reports", label: "Reports", Icon: Images },
  { key: "profile", label: "Profile", Icon: User },
];

function Shell({ jobId, action, tab, onTab, onAskAi, children }: { jobId?: string; action?: React.ReactNode; tab?: Tab; onTab?: (t: Tab) => void; onAskAi?: () => void; children: React.ReactNode }) {
  return (
    <div className={cn("min-h-screen bg-zinc-50 text-zinc-900", tab ? (action ? "pb-48" : "pb-28") : "pb-10")}>
      <header className="print:hidden bg-white/95 backdrop-blur border-b border-zinc-200 sticky top-0 z-30">
        <div className="max-w-lg mx-auto h-16 px-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-rose-500 text-white flex items-center justify-center shrink-0">
              <Sparkles className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <div className="text-base font-semibold text-zinc-950 leading-tight">My Service</div>
              <div className="text-xs text-zinc-500 flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden /> Secure link</div>
            </div>
          </div>
          {jobId && <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-zinc-100 text-zinc-700 whitespace-nowrap">{jobId}</span>}
          {onAskAi && (
            <button onClick={onAskAi} className="h-10 px-3 rounded-xl bg-zinc-950 text-white text-sm font-semibold inline-flex items-center gap-1.5 shrink-0">
              <Sparkles className="h-4 w-4 text-rose-300" aria-hidden /> Intense AI
            </button>
          )}
        </div>
      </header>
      <main className="max-w-lg mx-auto px-4 py-5 space-y-4">{children}</main>
      {(action || tab) && (
        <div className="print:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-zinc-200 pb-[env(safe-area-inset-bottom)]">
          {action && <div className="max-w-lg mx-auto px-4 pt-3">{action}</div>}
          {tab && onTab && (
            <nav aria-label="Main" className="max-w-lg mx-auto grid grid-cols-4">
              {TABS.map(({ key, label, Icon }) => (
                <button key={key} onClick={() => onTab(key)} aria-current={tab === key ? "page" : undefined} className={cn("h-16 flex flex-col items-center justify-center gap-1 text-xs font-semibold", tab === key ? "text-rose-600" : "text-zinc-500")}>
                  <Icon className="h-6 w-6" aria-hidden />
                  {label}
                </button>
              ))}
            </nav>
          )}
        </div>
      )}
    </div>
  );
}

const formatInr = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

/** The customer's own invoice. GST fields appear only on a GST invoice. */
function InvoicePanel({ invoice: inv, customerName, jobId, serviceName }: { invoice: CustomerInvoice; customerName: string; jobId: string | null; serviceName: string | null }) {
  const gst = inv.invoiceType === "GST";
  const half = (inv.gstRate ?? 0) / 2;
  const rows: [string, string, boolean?][] = gst
    ? [
        ["Taxable amount", formatInr(inv.taxable)],
        ...(inv.igst ? ([[`IGST @ ${inv.gstRate}%`, formatInr(inv.igst)]] as [string, string][]) : ([[`CGST @ ${half}%`, formatInr(inv.cgst ?? 0)], [`SGST @ ${half}%`, formatInr(inv.sgst ?? 0)]] as [string, string][])),
        ["Total GST", formatInr(inv.totalGst ?? 0)],
        ["Grand total", formatInr(inv.total), true],
      ]
    : [
        ["Amount", formatInr(inv.taxable)],
        ["Grand total", formatInr(inv.total), true],
      ];
  return (
    <section className="bg-white rounded-3xl border border-zinc-200 p-5 shadow-sm space-y-4 print:border-0 print:shadow-none">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-zinc-950">{gst ? "Tax invoice" : "Invoice"}</h2>
          <p className="text-sm text-zinc-500 font-mono break-all">{inv.invoiceNumber}</p>
        </div>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full border border-zinc-200 bg-zinc-50 text-zinc-700 shrink-0">{gst ? "GST" : "Non-GST"}</span>
      </div>
      <dl className="text-sm space-y-1">
        <div className="flex justify-between gap-3"><dt className="text-zinc-500">From</dt><dd className="text-right font-medium break-words">{inv.companyName}</dd></div>
        {gst && inv.companyGstin && <div className="flex justify-between gap-3"><dt className="text-zinc-500">GSTIN</dt><dd className="font-mono">{inv.companyGstin}</dd></div>}
        <div className="flex justify-between gap-3"><dt className="text-zinc-500">Bill to</dt><dd className="text-right font-medium break-words">{customerName}</dd></div>
        {gst && inv.customerGstin && <div className="flex justify-between gap-3"><dt className="text-zinc-500">Your GSTIN</dt><dd className="font-mono">{inv.customerGstin}</dd></div>}
        <div className="flex justify-between gap-3"><dt className="text-zinc-500">Date</dt><dd>{new Date(inv.issuedAt).toLocaleDateString("en-IN", { dateStyle: "medium" })}</dd></div>
        {jobId && <div className="flex justify-between gap-3"><dt className="text-zinc-500">Job ID</dt><dd className="font-mono text-right break-all">{jobId}</dd></div>}
        {serviceName && !inv.items?.length && <div className="flex justify-between gap-3"><dt className="text-zinc-500">Service</dt><dd className="text-right break-words">{serviceName}</dd></div>}
      </dl>
      {inv.items && inv.items.length > 0 && (
        <ul className="rounded-2xl border border-zinc-200 divide-y divide-zinc-100">
          {inv.items.map((l, i) => (
            <li key={i} className="px-4 py-2.5 flex items-start justify-between gap-3 text-sm">
              <span className="min-w-0">
                <span className="block font-medium text-zinc-900 break-words">{l.description}</span>
                <span className="block text-xs text-zinc-500 tabular-nums">{l.quantity} × {formatInr(l.rate)}</span>
              </span>
              <span className="font-semibold tabular-nums shrink-0">{formatInr(l.amount)}</span>
            </li>
          ))}
        </ul>
      )}
      <dl className="rounded-2xl border border-zinc-200 divide-y divide-zinc-100 overflow-hidden">
        {rows.map(([k, v, strong]) => (
          <div key={k} className={cn("flex justify-between gap-3 px-4 py-2.5", strong && "bg-zinc-50")}>
            <dt className={strong ? "font-semibold text-zinc-950" : "text-zinc-600"}>{k}</dt>
            <dd className={cn("tabular-nums", strong ? "text-lg font-semibold text-zinc-950" : "font-medium")}>{v}</dd>
          </div>
        ))}
        {typeof inv.balanceDue === "number" && (
          <div className="flex justify-between gap-3 px-4 py-2.5"><dt className="text-zinc-600">{inv.balanceDue > 0 ? "Balance due" : "Payment"}</dt><dd className={cn("font-semibold", inv.balanceDue > 0 ? "text-amber-700" : "text-emerald-700")}>{inv.balanceDue > 0 ? formatInr(inv.balanceDue) : "Paid ✓"}</dd></div>
        )}
      </dl>
      {inv.paymentTerms && <p className="text-sm text-zinc-600 break-words"><span className="font-semibold">Payment terms:</span> {inv.paymentTerms}</p>}
      <button onClick={() => window.print()} className="print:hidden h-12 w-full rounded-2xl border border-zinc-300 bg-white text-base font-semibold text-zinc-900 inline-flex items-center justify-center gap-2">
        <FileText className="h-5 w-5" aria-hidden /> Download / Print invoice
      </button>
    </section>
  );
}

function Cta({ children, onClick, busy, icon, tone = "primary" }: { children: React.ReactNode; onClick: () => void; busy?: boolean; icon?: React.ReactNode; tone?: "primary" | "success" | "neutral" }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={cn(
        "w-full h-14 rounded-2xl text-base font-semibold inline-flex items-center justify-center gap-2 shadow-sm transition-all active:scale-[0.99] disabled:opacity-60",
        tone === "primary" && "bg-rose-500 hover:bg-rose-600 text-white",
        tone === "success" && "bg-emerald-600 hover:bg-emerald-700 text-white",
        tone === "neutral" && "bg-zinc-900 hover:bg-zinc-800 text-white"
      )}
    >
      {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

function Badge({ icon, tone }: { icon: React.ReactNode; tone: "green" | "amber" }) {
  return <div className={cn("h-16 w-16 rounded-2xl flex items-center justify-center mx-auto", tone === "green" ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600")}>{icon}</div>;
}

function Stars({ rating, onRate }: { rating: number; onRate: (n: number) => void }) {
  return (
    <div className="flex items-center justify-center gap-1" role="radiogroup" aria-label="Rate your service">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} role="radio" aria-checked={rating === n} onClick={() => onRate(n)} className="h-12 w-12 inline-flex items-center justify-center active:scale-90 transition-transform" aria-label={`${n} star${n === 1 ? "" : "s"}`}>
          <Star className={cn("h-9 w-9 transition-colors", n <= rating ? "text-amber-400 fill-amber-400" : "text-zinc-300")} aria-hidden />
        </button>
      ))}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-3xl border border-zinc-200 p-5 shadow-sm animate-in fade-in">
      <h2 className="text-lg font-semibold text-zinc-950 mb-1">{title}</h2>
      <div className="divide-y divide-zinc-100">{children}</div>
    </section>
  );
}

function Detail({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="py-3 flex items-start gap-3">
      <span className="h-9 w-9 rounded-xl bg-zinc-100 text-zinc-500 flex items-center justify-center shrink-0">{icon}</span>
      <div className="min-w-0">
        <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">{label}</div>
        <div className="text-base text-zinc-900 break-words">{value}</div>
      </div>
    </div>
  );
}

function BeforeAfter({ photos, areas }: { photos: CustomerPayload["photos"]; areas: string[] }) {
  const withPhotos = areas.filter((a) => photos.some((p) => p.area === a));
  if (withPhotos.length === 0) return <p className="py-3 text-base text-zinc-500">Before and after photos appear here once the work is done.</p>;
  return (
    <div className="space-y-4 pt-2">
      {withPhotos.map((a) => {
        const b = photos.find((p) => p.area === a && p.photoType === "before");
        const af = photos.find((p) => p.area === a && p.photoType === "after");
        return (
          <div key={a} className="pt-2">
            <div className="text-sm font-semibold text-zinc-900 mb-2 uppercase tracking-wide">{a}</div>
            <div className="grid grid-cols-2 gap-2">
              {[{ label: "BEFORE", p: b }, { label: "AFTER", p: af }].map(({ label, p }) => (
                <div key={label} className="relative aspect-[4/3] rounded-xl overflow-hidden bg-zinc-100">
                  {p ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={p.url} alt={`${a} ${label.toLowerCase()}`} className="h-full w-full object-cover" loading="lazy" decoding="async" />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center text-sm text-zinc-400">No photo</div>
                  )}
                  <span className={cn("absolute top-2 left-2 px-2 py-0.5 rounded-md text-xs font-bold text-white", label === "BEFORE" ? "bg-zinc-900/80" : "bg-emerald-600")}>{label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
