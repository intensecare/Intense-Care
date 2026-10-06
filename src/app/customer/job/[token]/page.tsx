"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2, ShieldCheck, MapPin, Users, AlertTriangle, CheckCircle2, Star, Calendar, Sparkles, MessageSquareWarning, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * /customer/job/[token] — THE customer journey on ONE secure link (no app,
 * no login, no OTP). One primary action per stage:
 *   1. CONFIRM & START SERVICE — while the team is on site,
 *   2. live progress (checklist + photos) while work runs,
 *   3. APPROVE / report an issue after QC pass,
 *   4. rating + Google review after approval.
 * The same link the customer first opened carries them to the very end.
 */

interface CustomerPayload {
  job: {
    id: string;
    status: string;
    serviceName: string;
    scheduledDate: string;
    scheduledTimeSlot: string;
    arrivedAt: string | null;
    completedAt: string | null;
    customerConfirmedAt: string | null;
    arrivalVerified: boolean;
  };
  property: { title: string; address: string };
  customer: { name: string; phoneMasked: string };
  team: string[];
  checklist: { id: string; area: string; task: string; completed: boolean; status: string }[];
  photos: { id: string; area: string; photoType: string; url: string; thumbnailUrl: string | null; uploadedAt: string }[];
  qualityCheck: { score: number; decision: string; passed: boolean } | null;
  approval: { approvedAt: string; approvedBy: string; method: string } | null;
  feedback: { rating: number; feedbackAt: string | null; googleReviewClicked: boolean } | null;
  complaintCount: number;
  company: { name: string; googleReviewUrl: string };
}

export default function CustomerJobPage() {
  const params = useParams();
  const token = (params?.token as string) || "";
  const [data, setData] = useState<CustomerPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<string>("");
  const [confirming, setConfirming] = useState(false);
  const [alreadyConfirmed, setAlreadyConfirmed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [signatoryName, setSignatoryName] = useState("");
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approvedAt, setApprovedAt] = useState<string | null>(null);
  const [showComplaint, setShowComplaint] = useState(false);
  const [complaintCategory, setComplaintCategory] = useState("missed_area");
  const [complaintText, setComplaintText] = useState("");
  const [complaintSent, setComplaintSent] = useState(false);
  const [rating, setRating] = useState(0);
  const [ratingSent, setRatingSent] = useState(false);
  const [reviewClicked, setReviewClicked] = useState(false);

  const load = async () => {
    try {
      const res = await fetch(`/api/customer/job/${encodeURIComponent(token)}`);
      const json = await res.json();
      if (res.ok && json?.success) {
        setData(json.data);
        if (json.data.job.customerConfirmedAt || ["CUSTOMER_VERIFIED", "IN_PROGRESS"].includes(json.data.job.status)) {
          setAlreadyConfirmed(true);
        }
        if (json.data.approval) setApprovedAt(json.data.approval.approvedAt);
        if (json.data.feedback) {
          setRatingSent(true);
          setRating(json.data.feedback.rating);
          setReviewClicked(json.data.feedback.googleReviewClicked);
        }
      } else {
        setKind(json?.kind || "not_found");
        setError(json?.error || "This link is invalid or has expired.");
      }
    } catch {
      setError("Unable to load your service page. Please check your connection.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/customer/job/${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, json: await res.json().catch(() => null) };
  };

  const handleConfirm = async () => {
    setConfirming(true);
    setActionError(null);
    const { ok, json } = await post({ action: "confirm" });
    if (ok && json?.success) {
      setAlreadyConfirmed(true);
      void load();
    } else {
      setActionError(json?.error || "Confirmation failed. Please retry.");
    }
    setConfirming(false);
  };

  const handleApprove = async () => {
    setApproving(true);
    setActionError(null);
    const { ok, json } = await post({ action: "approve", signatoryName: signatoryName.trim(), confirmChecked });
    if (ok && json?.success) {
      setApprovedAt(json.data.approvedAt);
      void load();
    } else {
      setActionError(json?.error || "Approval failed. Please retry.");
    }
    setApproving(false);
  };

  const handleComplaintSubmit = async () => {
    if (complaintText.trim().length < 5) return;
    const { ok } = await post({ action: "complaint", category: complaintCategory, description: complaintText.trim() });
    if (ok) {
      setShowComplaint(false);
      setComplaintSent(true);
    }
  };

  const handleRating = async (stars: number) => {
    setRating(stars);
    const { ok, json } = await post({ action: "feedback", rating: stars, googleReviewClicked: reviewClicked });
    if (ok && json?.success) {
      setRatingSent(true);
      void load();
    } else {
      setActionError(json?.error || "Could not save your rating.");
    }
  };

  const handleGoogleReviewClick = async () => {
    setReviewClicked(true);
    void post({ action: "feedback", rating: rating || 5, googleReviewClicked: true });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <Loader2 className="h-9 w-9 animate-spin text-rose-500 mx-auto" />
          <p className="text-xs text-slate-500 font-medium">Verifying your secure link…</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-md border border-slate-200 text-center max-w-md w-full space-y-3">
          <div className={`h-14 w-14 rounded-full flex items-center justify-center mx-auto ${kind === "revoked" ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600"}`}>
            <AlertTriangle className="h-7 w-7" />
          </div>
          <h2 className="text-xl font-semibold text-slate-900">{kind === "revoked" ? "This link is no longer active." : "Link unavailable"}</h2>
          <p className="text-sm text-slate-600">{error}</p>
        </div>
      </div>
    );
  }

  const { job, property, team, checklist, company } = data;
  const journey = [
    { label: "Booked", done: true },
    { label: "Team Arrived", done: !!job.arrivedAt },
    { label: "You Confirmed", done: alreadyConfirmed || !!job.customerConfirmedAt },
    { label: "Service Underway", done: ["IN_PROGRESS", "WORK_COMPLETED", "QUALITY_CHECK", "PASS", "COMPLETED"].includes(job.status) },
    { label: "Quality Checked", done: !!data.qualityCheck?.passed },
    { label: "Completed", done: job.status === "COMPLETED" || !!approvedAt },
  ];
  const canConfirmNow = !alreadyConfirmed && ["ASSIGNED", "ARRIVED"].includes(job.status);
  const canApproveNow = !approvedAt && ["PASS", "CUSTOMER_APPROVAL"].includes(job.status);
  const doneCount = checklist.filter((c) => c.completed).length;
  const approved = !!approvedAt || !!data.approval;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-40">
      <header className="bg-white border-b border-slate-200 py-4 px-4 sticky top-0 z-30 shadow-xs">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-rose-500 text-white flex items-center justify-center">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900">Your Service</div>
              <div className="text-[10px] text-slate-500 font-semibold flex items-center gap-1">
                <ShieldCheck className="h-3 w-3 text-emerald-600" /> Secure link verified
              </div>
            </div>
          </div>
          <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700">{job.id}</span>
        </div>
      </header>

      <main className="max-w-lg mx-auto p-4 space-y-4">
        {/* Journey strip */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Service Journey</h2>
            {job.arrivalVerified && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                Arrival verified ✓
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {journey.map((step, i) => (
              <div key={step.label} className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold",
                    step.done ? "bg-emerald-500 text-white" : "border border-slate-300 text-slate-400"
                  )}
                >
                  {step.done ? "✓" : i + 1}
                </span>
                <span className={cn("text-[11px] font-semibold", step.done ? "text-slate-800" : "text-slate-400")}>{step.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Service / Property / Team */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
          <div className="grid grid-cols-1 gap-3 text-xs">
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-slate-400 text-[10px] font-semibold tracking-wider">SERVICE</span>
              <div className="font-semibold text-slate-900 text-sm mt-0.5">{job.serviceName}</div>
              <div className="text-slate-500 flex items-center gap-1.5 mt-1">
                <Calendar className="h-3.5 w-3.5" /> {job.scheduledDate} · {job.scheduledTimeSlot}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-slate-400 text-[10px] font-semibold tracking-wider">PROPERTY</span>
              <div className="font-semibold text-slate-900 text-sm mt-0.5 flex items-start gap-1.5">
                <MapPin className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                <span>
                  {property.title}
                  <span className="block text-[11px] text-slate-500 font-normal">{property.address}</span>
                </span>
              </div>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-slate-400 text-[10px] font-semibold tracking-wider flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" /> TEAM
              </span>
              <div className="font-semibold text-slate-900 text-sm mt-0.5">{team.length ? team.join(", ") : "Being assigned"}</div>
            </div>
          </div>
        </div>

        {/* Primary state card — ONE action per stage */}
        <div className="bg-white rounded-2xl border-2 border-rose-200 p-5 shadow-sm space-y-4 text-center">
          {canConfirmNow ? (
            <>
              <div className="h-12 w-12 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto">
                <CheckCircle2 className="h-6 w-6 text-emerald-600" />
              </div>
              <h3 className="text-base font-semibold text-slate-900">Your service team has arrived</h3>
              <p className="text-xs text-slate-500">Confirm to let the team begin the service.</p>
              {actionError && <p className="text-xs text-red-600 font-medium">{actionError}</p>}
              <button
                onClick={handleConfirm}
                disabled={confirming}
                className="w-full h-14 rounded-2xl bg-rose-500 hover:bg-rose-600 text-white text-base font-bold shadow-lg shadow-rose-200 disabled:opacity-60 transition-colors"
              >
                {confirming ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : "CONFIRM & START SERVICE"}
              </button>
            </>
          ) : approved ? (
            <>
              <div className="h-12 w-12 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto">
                <CheckCircle2 className="h-6 w-6 text-emerald-600" />
              </div>
              <h3 className="text-base font-semibold text-slate-900">Service approved ✓ Thank you!</h3>
              <p className="text-xs text-slate-500">
                {data.feedback?.rating ? `You rated this service ${data.feedback.rating}/5.` : "How did we do? Your rating helps us improve."}
              </p>
              {/* Rating + Google review */}
              {!ratingSent ? (
                <div className="pt-1">
                  <div className="flex items-center justify-center gap-1.5">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button key={n} onClick={() => handleRating(n)} className="p-1" aria-label={`Rate ${n} star${n === 1 ? "" : "s"}`}>
                        <Star className={cn("h-8 w-8 transition-colors", n <= rating ? "text-amber-400 fill-amber-400" : "text-slate-300 hover:text-amber-200")} />
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">Tap a star to rate</p>
                </div>
              ) : (
                <p className="text-xs font-semibold text-emerald-700">Thanks for rating us {data.feedback?.rating ?? rating}/5! ⭐</p>
              )}
              {company.googleReviewUrl && (
                <a
                  href={company.googleReviewUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={handleGoogleReviewClick}
                  className="block w-full h-12 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-bold leading-[3rem] transition-colors"
                >
                  <ExternalLink className="h-4 w-4 inline mr-2 -mt-0.5" />
                  {reviewClicked ? "Review us on Google again" : "Leave a Google review"}
                </a>
              )}
            </>
          ) : canApproveNow ? (
            <>
              <div className="h-12 w-12 rounded-2xl bg-teal-50 border border-teal-200 flex items-center justify-center mx-auto">
                <CheckCircle2 className="h-6 w-6 text-teal-600" />
              </div>
              <h3 className="text-base font-semibold text-slate-900">Service completed & quality checked</h3>
              {data.qualityCheck && <p className="text-xs text-slate-500">Quality score: {data.qualityCheck.score}%</p>}
              {actionError && <p className="text-xs text-red-600 font-medium">{actionError}</p>}
              <div className="text-left space-y-2 pt-1">
                <input
                  value={signatoryName}
                  onChange={(e) => setSignatoryName(e.target.value)}
                  placeholder="Your full name"
                  className="w-full h-11 rounded-xl border border-slate-200 px-3 text-sm focus:ring-1 focus:ring-rose-400"
                />
                <label className="flex items-start gap-2 text-[11px] text-slate-600">
                  <input type="checkbox" checked={confirmChecked} onChange={(e) => setConfirmChecked(e.target.checked)} className="mt-0.5" />
                  <span>I confirm the service is completed to my satisfaction and approve this job record.</span>
                </label>
                <button
                  onClick={handleApprove}
                  disabled={approving || signatoryName.trim().length < 2 || !confirmChecked}
                  className="w-full h-13 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-base font-bold shadow-lg shadow-emerald-200 disabled:opacity-50 transition-colors"
                >
                  {approving ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : "APPROVE COMPLETION"}
                </button>
              </div>
            </>
          ) : alreadyConfirmed ? (
            <>
              <div className="h-12 w-12 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto">
                <CheckCircle2 className="h-6 w-6 text-emerald-600" />
              </div>
              <h3 className="text-base font-semibold text-slate-900">CUSTOMER VERIFIED ✓ JOB STARTED ✓</h3>
              <p className="text-xs text-slate-500">Thank you for confirming. Track progress below — it updates live.</p>
            </>
          ) : (
            <>
              <h3 className="text-base font-semibold text-slate-900">
                {job.status === "IN_PROGRESS" ? "Service in progress" : "Updates will appear here"}
              </h3>
              <p className="text-xs text-slate-500">Current stage: {job.status.replace(/_/g, " ").toLowerCase()}</p>
            </>
          )}
        </div>

        {/* Live progress: checklist + photos */}
        {checklist.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Progress</h3>
              <span className="text-xs font-semibold text-slate-600">
                {doneCount} / {checklist.length} tasks
              </span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full rounded-full bg-rose-500 transition-all" style={{ width: `${checklist.length ? (doneCount / checklist.length) * 100 : 0}%` }} />
            </div>
            <div className="divide-y divide-slate-100 pt-1">
              {checklist.slice(0, 12).map((item) => (
                <div key={item.id} className="py-1.5 flex items-center gap-2 text-xs">
                  <CheckCircle2 className={cn("h-4 w-4 shrink-0", item.completed ? "text-emerald-600" : "text-slate-300")} />
                  <span className={cn(item.completed ? "text-slate-800" : "text-slate-400")}>{item.task}</span>
                  <span className="ml-auto text-[10px] text-slate-400 shrink-0">{item.area}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {data.photos.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-2">
            <h3 className="text-sm font-semibold text-slate-900">Photos from your service</h3>
            <div className="grid grid-cols-3 gap-2">
              {data.photos.slice(0, 9).map((p) => (
                <div key={p.id} className="relative rounded-lg overflow-hidden border border-slate-200 aspect-square bg-slate-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={`${p.area} ${p.photoType}`} className="w-full h-full object-cover" />
                  <span className={`absolute top-1 left-1 px-1 py-0.5 rounded text-[8px] font-bold text-white ${p.photoType === "before" ? "bg-amber-600" : "bg-emerald-600"}`}>
                    {p.photoType.toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {complaintSent && (
          <div className="p-4 rounded-2xl border border-amber-200 bg-amber-50 text-amber-900 text-xs font-medium">
            Your report has been sent to our operations supervisor. We will contact you shortly.
          </div>
        )}
      </main>

      {/* Sticky bottom — report an issue (always available) */}
      {!approved && (
        <div className="fixed bottom-0 inset-x-0 z-40 p-4 bg-gradient-to-t from-slate-50 via-slate-50/95 to-transparent">
          <div className="max-w-lg mx-auto">
            <button
              onClick={() => setShowComplaint(true)}
              className="w-full h-11 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-50 transition-colors"
            >
              <AlertTriangle className="h-4 w-4 inline mr-1.5 -mt-0.5" />
              Report an issue
            </button>
          </div>
        </div>
      )}

      {/* Complaint modal */}
      {showComplaint && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl max-w-lg w-full p-5 space-y-4">
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <MessageSquareWarning className="h-4 w-4 text-amber-600" /> Report an issue
            </h3>
            <select
              value={complaintCategory}
              onChange={(e) => setComplaintCategory(e.target.value)}
              className="w-full h-11 rounded-xl border border-slate-200 px-3 text-sm bg-white"
            >
              <option value="missed_area">Area not cleaned</option>
              <option value="quality">Quality issue</option>
              <option value="damage">Damage</option>
              <option value="staff_behavior">Staff conduct</option>
              <option value="other">Other</option>
            </select>
            <textarea
              value={complaintText}
              onChange={(e) => setComplaintText(e.target.value)}
              rows={4}
              placeholder="Tell us what went wrong…"
              className="w-full p-3 rounded-xl border border-slate-200 text-sm focus:ring-1 focus:ring-rose-400"
            />
            <div className="flex gap-2">
              <button onClick={() => setShowComplaint(false)} className="flex-1 h-11 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700">
                Cancel
              </button>
              <button
                onClick={handleComplaintSubmit}
                disabled={complaintText.trim().length < 5}
                className="flex-1 h-11 rounded-xl bg-rose-500 text-white text-sm font-bold disabled:opacity-50"
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
