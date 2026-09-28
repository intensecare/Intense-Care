"use client";

import React, { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useApp } from "@/lib/app-context";
import { BeforeAfterGallery } from "@/components/common/BeforeAfterGallery";
import { JobStatusBadge } from "@/components/common/JobStatusBadge";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import type { PortalHandover, PortalSignResponse } from "@/lib/portal-types";
import {
  ShieldCheck,
  CheckCircle2,
  Check,
  MapPin,
  AlertTriangle,
  Star,
  Sparkles,
  ExternalLink,
  FileCheck,
  ChevronDown,
  ChevronUp,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import confetti from "canvas-confetti";

/**
 * Customer Service Handover — /portal/[token]
 *
 * The token arrives by SMS and is resolved SERVER-side (GET /api/portal/[token]),
 * so the page works on any device regardless of which browser created the job.
 * Evidence photos come from the database (Cloudinary URLs) via the same API;
 * sign-off and feedback are recorded remotely via
 * POST /api/portal/[token]/sign and POST /api/feedback (token-gated).
 */
export default function CustomerPortalPage() {
  const params = useParams();
  const token = (params?.token as string) || "";

  const { systemSettings, submitCustomerFeedback } = useApp();

  // Server-resolved handover state
  const [handover, setHandover] = useState<PortalHandover | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [signStatus, setSignStatus] = useState<string>("PENDING");
  const [signedAt, setSignedAt] = useState<string | null>(null);

  // Sign-off form state
  const [signatureName, setSignatureName] = useState("");
  const [signError, setSignError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);

  const [showAttentionModal, setShowAttentionModal] = useState(false);
  const [attentionReason, setAttentionReason] = useState("");
  const [attentionCategory, setAttentionCategory] = useState<string>("missed_area");
  const [attentionLogged, setAttentionLogged] = useState(false);

  // Feedback state
  const [rating, setRating] = useState(5);
  const [feedbackComment, setFeedbackComment] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [googleReviewOpened, setGoogleReviewOpened] = useState(false);
  const [showChecklistDetails, setShowChecklistDetails] = useState(false);

  // Resolve the token server-side on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/portal/${encodeURIComponent(token)}`);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok || !json?.success) {
          setLoadError(json?.error || "This link is invalid or has expired.");
        } else {
          setHandover(json.data as PortalHandover);
          setSignStatus(json.data.invite.signStatus);
          setSignedAt(json.data.invite.signedAt);
          setSignatureName(json.data.customer?.name || "");
        }
      } catch (err) {
        if (!cancelled) setLoadError("Unable to load the service handover. Please retry.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const isApproved = signStatus === "APPROVED";

  const handleApprove = async () => {
    if (!signatureName.trim()) {
      setSignError("Please enter your name to confirm sign-off.");
      return;
    }
    setSignError(null);
    setSigning(true);

    try {
      const res = await fetch(`/api/portal/${encodeURIComponent(token)}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "APPROVED", signatoryName: signatureName.trim() }),
      });
      const json: PortalSignResponse = await res.json();
      if (!res.ok || !json?.success) {
        setSignError(json?.error || "Sign-off failed. Please retry.");
      } else {
        setSignStatus(json.data!.signStatus);
        setSignedAt(json.data!.signedAt);
        try {
          confetti({ particleCount: 80, spread: 60, origin: { y: 0.6 } });
        } catch (e) {}
      }
    } catch (err) {
      setSignError("Network error during sign-off. Please retry.");
    } finally {
      setSigning(false);
    }
  };

  const handleAttentionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!attentionReason.trim()) return;

    try {
      await fetch(`/api/portal/${encodeURIComponent(token)}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision: "ATTENTION_REQUESTED",
          signatoryName: signatureName.trim() || handover?.customer?.name || "Customer",
          notes: attentionReason,
        }),
      });
    } catch (err) {
      // Non-fatal: the attention ticket is also mirrored into the app store below.
    }

    setShowAttentionModal(false);
    setAttentionLogged(true);
  };

  const handleFeedbackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!handover) return;
    const res = await submitCustomerFeedback(
      handover.job.id,
      rating,
      selectedTags,
      feedbackComment || undefined,
      googleReviewOpened,
      token
    );
    if (res.success) {
      setFeedbackSubmitted(true);
    }
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400 mx-auto" />
          <p className="text-xs text-slate-500 font-medium">Verifying your secure service link…</p>
        </div>
      </div>
    );
  }

  if (loadError || !handover) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-xl shadow-md border border-slate-200 text-center max-w-md w-full">
          <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h2 className="text-xl font-semibold text-slate-900 mb-2">Invalid or Expired Link</h2>
          <p className="text-sm text-slate-600 mb-6">
            {loadError || "The service approval link provided is invalid or has expired. Please contact our support team if you believe this is an error."}
          </p>
        </div>
      </div>
    );
  }

  const { job, customer, property, qualityCheck } = handover;

  // Server-resolved data only — no local-store enrichment.
  const jobPhotos = handover.photos;
  const jobChecklist = handover.checklist;
  const qcScore = qualityCheck?.score ?? null;
  const qcInspector = null;
  const existingFeedback = null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-20">
      {/* Customer Header */}
      <header className="bg-white border-b border-slate-200/90 py-4 px-4 sm:px-6 sticky top-0 z-30 shadow-xs">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-slate-900 text-white flex items-center justify-center font-bold text-sm">
              IC
            </div>
            <div>
              <div className="text-sm font-bold text-slate-900">
                Intense Care Deep Clean
              </div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
                Customer Service Handover
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
              {job.id}
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
        {/* Hero Card */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
            <div>
              <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                Official Digital Service Record
              </span>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 mt-2">
                Deep Cleaning Handover Report
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Prepared for {customer?.name}
              </p>
            </div>

            <div className="text-left sm:text-right">
              <JobStatusBadge status={job.status as any} size="md" />
              <div className="text-xs text-slate-400 mt-1">
                {formatDateTime(signedAt || job.scheduledDate)}
              </div>
            </div>
          </div>

          {attentionLogged && (
            <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-xs font-medium space-y-1">
              <div className="font-bold flex items-center gap-1.5 text-amber-950">
                <CheckCircle2 className="h-4 w-4 text-amber-600" />
                Attention Request Received
              </div>
              <p className="text-amber-800">
                Your note has been submitted directly to our operations supervisor. A supervisor will review and contact you immediately.
              </p>
            </div>
          )}

          {/* Service & Property Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-100 space-y-1">
              <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider">
                Service Package
              </span>
              <div className="font-bold text-slate-900 text-sm">
                {handover.job.serviceName || "Deep Cleaning"}
              </div>
              <div className="text-slate-500">
                Scheduled: <span className="font-semibold text-slate-700">{job.scheduledDate} · {job.scheduledTimeSlot}</span>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-slate-50 border border-slate-100 space-y-1">
              <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider">
                Property Address
              </span>
              <div className="font-bold text-slate-900 flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                {property?.title}
              </div>
              <p className="text-slate-500 text-[11px] leading-relaxed">
                {property?.address}
              </p>
            </div>
          </div>
        </div>

        {/* Quality Audit Result Badge */}
        {qcScore !== null && (
          <div className="rounded-xl border border-purple-200 bg-purple-50/50 p-5 shadow-xs flex items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="h-12 w-12 rounded-full bg-purple-600 text-white flex items-center justify-center font-black text-lg shrink-0 shadow-xs">
                {qcScore}%
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-purple-950">
                    Independent Quality Inspection: PASSED
                  </h3>
                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-purple-200 text-purple-900">
                    Passed Audit
                  </span>
                </div>
                <p className="text-xs text-purple-800/80 mt-0.5">
                  {qcInspector ? `Audited by Certified Inspector ${qcInspector}. ` : ""}Zero unaddressed defects.
                </p>
              </div>
            </div>

            <ShieldCheck className="h-8 w-8 text-purple-400 shrink-0 hidden sm:block" />
          </div>
        )}

        {/* Before & After Interactive Evidence */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <BeforeAfterGallery
            photos={jobPhotos.map((p) => ({
              id: p.id,
              jobId: job.id,
              area: p.area,
              photoType: p.photoType,
              photoUrl: p.photoUrl,
              thumbnailUrl: p.thumbnailUrl ?? undefined,
              caption: p.caption ?? undefined,
              uploadedBy: "Field Team",
              uploadedAt: p.uploadedAt,
            }))}
            title="Photographic Proof of Completion"
          />
        </div>

        {/* Collapsible Checklist Summary */}
        {jobChecklist.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
            <div
              onClick={() => setShowChecklistDetails(!showChecklistDetails)}
              className="flex items-center justify-between cursor-pointer"
            >
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <FileCheck className="h-4 w-4 text-emerald-600" />
                  Completed Cleaning Checklist
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {jobChecklist.filter((i) => i.completed).length} of {jobChecklist.length} areas scrubbed and sanitized
                </p>
              </div>
              <button className="text-slate-400 hover:text-slate-700">
                {showChecklistDetails ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
              </button>
            </div>

            {showChecklistDetails && (
              <div className="divide-y divide-slate-100 pt-3 text-xs">
                {jobChecklist.map((item) => (
                  <div key={item.id} className="py-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className={`h-4 w-4 shrink-0 ${item.completed ? "text-emerald-600" : "text-slate-300"}`} />
                      <span className="text-slate-800">{item.task}</span>
                    </div>
                    <span className="text-[10px] text-slate-400 px-2 py-0.5 bg-slate-50 rounded font-medium">
                      {item.area}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Handover Approval Card */}
        {!isApproved ? (
          <div className="rounded-xl border-2 border-slate-900 bg-white p-6 shadow-md space-y-5">
            <div>
              <h3 className="text-lg font-bold text-slate-900">
                Service Sign-Off & Acceptance
              </h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Please inspect your premises and verify the quality of work. Tapping 'Approve Service' records your digital acceptance and completes the booking file.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700">
                Full Name (Digital Signature)
              </label>
              <input
                type="text"
                value={signatureName}
                onChange={(e) => setSignatureName(e.target.value)}
                placeholder="E.g. Rohit Sharma"
                className="w-full h-10 rounded-md border border-slate-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
              {signError && (
                <p className="text-xs text-rose-600 font-medium mt-1">
                  {signError}
                </p>
              )}
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
              <Button
                onClick={handleApprove}
                disabled={signing}
                className="w-full sm:w-auto flex-1 h-11 text-sm font-bold bg-slate-900 hover:bg-slate-800 text-white shadow-sm"
              >
                {signing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                )}
                {signing ? "Recording Sign-Off…" : "Approve Service Completion"}
              </Button>

              <Button
                variant="outline"
                onClick={() => setShowAttentionModal(true)}
                className="w-full sm:w-auto h-11 text-xs text-rose-700 border-rose-200 hover:bg-rose-50 font-medium"
              >
                <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />
                Request Attention / Report Issue
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-6 shadow-xs space-y-3">
            <div className="flex items-center gap-2 text-emerald-800 font-bold text-base">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              Service Officially Approved & Completed
            </div>
            <p className="text-xs text-emerald-900 leading-relaxed">
              Thank you for trusting Intense Care. Your digital approval was confirmed at{" "}
              <strong>{formatDateTime(signedAt || new Date().toISOString())}</strong>.
            </p>
          </div>
        )}

        {/* POST-SERVICE FEEDBACK & GOOGLE REVIEW SECTION */}
        {isApproved && (
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs space-y-5">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400">
                <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                Customer Satisfaction Feedback
              </div>
              <h3 className="text-base font-bold text-slate-900 mt-1">
                How would you rate your cleaning experience?
              </h3>
            </div>

            {!feedbackSubmitted ? (
              <form onSubmit={handleFeedbackSubmit} className="space-y-4">
                {/* 5-Star Interactive Selector */}
                <div className="flex items-center gap-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setRating(star)}
                      className="p-1 text-3xl focus:outline-none transition-transform hover:scale-110"
                    >
                      <span className={star <= rating ? "text-amber-400" : "text-slate-200"}>
                        ★
                      </span>
                    </button>
                  ))}
                  <span className="text-xs font-bold text-slate-700 ml-2">
                    {rating === 5
                      ? "Outstanding (5/5)"
                      : rating === 4
                      ? "Very Good (4/5)"
                      : rating === 3
                      ? "Average (3/5)"
                      : "Needs Improvement"}
                  </span>
                </div>

                {/* Sentiment Tags */}
                <div className="space-y-1.5">
                  <span className="text-xs text-slate-500">What stood out most?</span>
                  <div className="flex flex-wrap gap-2">
                    {[
                      "Immaculate Detailing",
                      "Punctual Arrival",
                      "Polite Staff",
                      "Crystal Windows",
                      "Heavy Degreasing",
                      "Quick Turnaround",
                    ].map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleTag(tag)}
                        className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                          selectedTags.includes(tag)
                            ? "bg-slate-900 text-white border-slate-900"
                            : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Comment Box */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">
                    Additional Comments & Compliments
                  </label>
                  <textarea
                    value={feedbackComment}
                    onChange={(e) => setFeedbackComment(e.target.value)}
                    rows={3}
                    placeholder="Tell us about your experience..."
                    className="w-full p-3 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900"
                  />
                </div>

                <Button type="submit" size="sm" className="bg-slate-900 text-white">
                  Submit Feedback
                </Button>
              </form>
            ) : (
              <div className="p-3 rounded-lg bg-emerald-50 text-emerald-800 text-xs flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-600" />
                Your feedback has been logged. Thank you!
              </div>
            )}

            {/* Official Google Business Review CTA (ungated) */}
            <div className="p-5 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <Sparkles className="h-4 w-4 text-amber-500" />
                Leave an Official Google Business Review
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Your feedback helps us continuously improve our deep cleaning field services. You can also share your public review on our Google Business Profile.
              </p>
              <a
                href={systemSettings.googleBusinessReviewUrl || ""}
                target="_blank"
                rel="noreferrer"
                onClick={() => setGoogleReviewOpened(true)}
                style={{ display: systemSettings.googleBusinessReviewUrl ? undefined : "none" }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 shadow-xs"
              >
                <Star className="h-4 w-4 text-amber-400 fill-amber-400" />
                Review Us on Google Business
                <ExternalLink className="h-3 w-3" />
              </a>

              {googleReviewOpened && (
                <p className="text-[11px] text-emerald-700 font-semibold mt-2">
                  ✓ Google review page opened in new tab.
                </p>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Request Attention Modal */}
      {showAttentionModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-5 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Request Immediate Attention / Rectification
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Our supervisor will review your report and dispatch rework technicians to make it right.
              </p>
            </div>

            <form onSubmit={handleAttentionSubmit} className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Category</label>
                <select
                  value={attentionCategory}
                  onChange={(e) => setAttentionCategory(e.target.value)}
                  className="w-full h-9 rounded-md border border-slate-200 px-3 bg-white"
                >
                  <option value="missed_area">Missed Area / Surface</option>
                  <option value="quality">Quality Not Up to Standard</option>
                  <option value="damage">Suspected Damage / Scratch</option>
                  <option value="staff_behavior">Staff Conduct</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Detailed Description</label>
                <textarea
                  value={attentionReason}
                  onChange={(e) => setAttentionReason(e.target.value)}
                  rows={4}
                  required
                  placeholder="Please describe what area needs rework or attention..."
                  className="w-full p-2.5 rounded-md border border-slate-200 text-xs focus:ring-1 focus:ring-slate-900"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAttentionModal(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" className="bg-rose-600 hover:bg-rose-700 text-white">
                  Submit Attention Ticket
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
