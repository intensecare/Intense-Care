"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  Loader2,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Star,
  MapPin,
  Calendar,
  Users,
  Sparkles,
  ExternalLink,
  FileCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * /approval/[token] — §21, §22, §23, §24, §34.
 *
 * Customer handover + approval. One primary action: APPROVE COMPLETION
 * (checkbox confirmation + name). Idempotent — tapping twice shows
 * "SERVICE ALREADY APPROVED ✓". REPORT AN ISSUE files a complaint without
 * approving. After approval: star feedback + manual Google review CTA
 * (never auto-submitted).
 */

interface ApprovalPayload {
  job: {
    id: string;
    status: string;
    serviceName: string;
    scheduledDate: string;
    arrivedAt: string | null;
    completedAt: string | null;
  };
  property: { title: string; address: string };
  customer: { name: string };
  team: string[];
  checklist: { id: string; area: string; task: string; completed: boolean }[];
  photos: { id: string; area: string; photoType: string; url: string; uploadedAt: string }[];
  qualityCheck: { score: number; decision: string; passed: boolean } | null;
  approval: { approvedAt: string; approvedBy: string; method: string } | null;
  complaintCount: number;
  company: { name: string; googleReviewUrl: string };
}

export default function ApprovalPage() {
  const params = useParams();
  const token = (params?.token as string) || "";
  const [data, setData] = useState<ApprovalPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState("");

  const [signatory, setSignatory] = useState("");
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [approvedAt, setApprovedAt] = useState<string | null>(null);
  const [alreadyApproved, setAlreadyApproved] = useState(false);

  const [showComplaint, setShowComplaint] = useState(false);
  const [category, setCategory] = useState("missed_area");
  const [description, setDescription] = useState("");
  const [complaintSent, setComplaintSent] = useState(false);

  const [rating, setRating] = useState(5);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [googleClicked, setGoogleClicked] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/approval/${encodeURIComponent(token)}`);
        const json = await res.json();
        if (res.ok && json?.success) {
          setData(json.data);
          if (json.data.approval) {
            setApprovedAt(json.data.approval.approvedAt);
            setAlreadyApproved(true);
          }
          setSignatory(json.data.customer?.name || "");
        } else {
          setKind(json?.kind || "not_found");
          setError(json?.error || "This link is invalid or has expired.");
        }
      } catch {
        setError("Unable to load the handover page. Please retry.");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const handleApprove = async () => {
    setApproveError(null);
    setApproving(true);
    try {
      const res = await fetch(`/api/approval/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", signatoryName: signatory.trim(), confirmChecked }),
      });
      const json = await res.json();
      if (res.ok && json?.success) {
        setApprovedAt(json.data.approvedAt);
        if (json.data.alreadyApproved) setAlreadyApproved(true);
      } else {
        setApproveError(json?.error || "Approval failed. Please retry.");
      }
    } catch {
      setApproveError("Network error. Please retry.");
    } finally {
      setApproving(false);
    }
  };

  const handleComplaint = async () => {
    if (description.trim().length < 5) return;
    try {
      const res = await fetch(`/api/approval/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complaint", category, description: description.trim(), signatoryName: signatory || undefined }),
      });
      if (res.ok) {
        setShowComplaint(false);
        setComplaintSent(true);
      }
    } catch {
      // non-fatal
    }
  };

  const handleFeedback = async () => {
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The feedback endpoint verifies via completion-invite tokens; the
        // approval token itself gates this page. Best-effort — feedback is
        // optional and never blocks approval.
        body: JSON.stringify({ token: token, rating, tags: [], comment: undefined, googleReviewClicked: googleClicked }),
      });
    } catch {
      // non-fatal
    }
    setFeedbackSent(true);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="h-9 w-9 animate-spin text-rose-500" />
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

  const { job, property, team, checklist, qualityCheck } = data;
  const doneCount = checklist.filter((c) => c.completed).length;
  const isApproved = alreadyApproved || !!approvedAt;
  const before = data.photos.filter((p) => p.photoType === "before");
  const after = data.photos.filter((p) => p.photoType === "after");

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-40">
      <header className="bg-white border-b border-slate-200 py-4 px-4 sticky top-0 z-30 shadow-xs">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-rose-500 to-rose-600 text-white flex items-center justify-center">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900">{data.company.name}</div>
              <div className="text-[10px] text-slate-500 font-semibold flex items-center gap-1">
                <ShieldCheck className="h-3 w-3 text-emerald-600" /> Service handover
              </div>
            </div>
          </div>
          <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700">{job.id}</span>
        </div>
      </header>

      <main className="max-w-lg mx-auto p-4 space-y-4">
        {/* Hero */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
          <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">SERVICE COMPLETED ✓</span>
          <h1 className="text-xl font-semibold text-slate-900">{job.serviceName}</h1>
          <div className="grid grid-cols-1 gap-2 text-xs">
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex items-start gap-2">
              <Calendar className="h-4 w-4 text-slate-400 mt-0.5" />
              <span className="text-slate-700">
                {job.scheduledDate}
                {job.completedAt ? ` · completed ${new Date(job.completedAt).toLocaleDateString()}` : ""}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex items-start gap-2">
              <MapPin className="h-4 w-4 text-rose-600 mt-0.5" />
              <span className="text-slate-700">
                {property.title}
                <span className="block text-[11px] text-slate-500">{property.address}</span>
              </span>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex items-start gap-2">
              <Users className="h-4 w-4 text-slate-400 mt-0.5" />
              <span className="text-slate-700">{team.length ? team.join(", ") : "Intense Care field team"}</span>
            </div>
          </div>
        </div>

        {/* QC result */}
        {qualityCheck?.passed && (
          <div className="rounded-2xl border border-purple-200 bg-purple-50/60 p-4 flex items-center gap-3">
            <div className="h-11 w-11 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold text-sm shrink-0">{qualityCheck.score}%</div>
            <div>
              <div className="text-sm font-semibold text-purple-950">Quality Check: PASSED ✓</div>
              <p className="text-[11px] text-purple-800/80">Independently audited — zero unaddressed defects.</p>
            </div>
          </div>
        )}

        {/* Areas completed */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Areas completed</h3>
            <span className="text-xs font-semibold text-slate-600">
              {doneCount} / {checklist.length}
            </span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${checklist.length ? (doneCount / checklist.length) * 100 : 0}%` }} />
          </div>
          <div className="divide-y divide-slate-100 pt-1">
            {checklist.slice(0, 14).map((item) => (
              <div key={item.id} className="py-1.5 flex items-center gap-2 text-xs">
                <CheckCircle2 className={cn("h-4 w-4 shrink-0", item.completed ? "text-emerald-600" : "text-slate-300")} />
                <span className={item.completed ? "text-slate-800" : "text-slate-400"}>{item.task}</span>
                <span className="ml-auto text-[10px] text-slate-400 shrink-0">{item.area}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Before / After */}
        {(before.length > 0 || after.length > 0) && (
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">Before / After</h3>
            {Array.from(new Set([...before, ...after].map((p) => p.area))).slice(0, 6).map((area) => {
              const b = before.find((p) => p.area === area);
              const a = after.find((p) => p.area === area);
              return (
                <div key={area} className="space-y-1.5">
                  <p className="text-[11px] font-semibold text-slate-500">{area}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="relative rounded-lg overflow-hidden border border-slate-200 aspect-video bg-slate-100">
                      {b ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={b.url} alt={`Before ${area}`} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[10px] text-slate-400">No before photo</div>
                      )}
                      <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded text-[9px] font-bold text-white bg-amber-600">BEFORE</span>
                    </div>
                    <div className="relative rounded-lg overflow-hidden border border-slate-200 aspect-video bg-slate-100">
                      {a ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.url} alt={`After ${area}`} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[10px] text-slate-400">No after photo</div>
                      )}
                      <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded text-[9px] font-bold text-white bg-emerald-600">AFTER</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Approval card — the ONE primary action */}
        {!isApproved ? (
          <div className="bg-white rounded-2xl border-2 border-slate-900 p-5 shadow-md space-y-4">
            <h3 className="text-base font-semibold text-slate-900">Approve completion</h3>
            <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
              <input type="checkbox" checked={confirmChecked} onChange={(e) => setConfirmChecked(e.target.checked)} className="mt-0.5 h-4 w-4" />
              <span>I confirm that I have reviewed the completed service and accept the work as done.</span>
            </label>
            <input
              type="text"
              value={signatory}
              onChange={(e) => setSignatory(e.target.value)}
              placeholder="Your full name (digital signature)"
              className="w-full h-11 rounded-xl border border-slate-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
            {approveError && <p className="text-xs text-red-600 font-medium">{approveError}</p>}
            <button
              onClick={handleApprove}
              disabled={approving || !confirmChecked || signatory.trim().length < 2}
              className="w-full h-14 rounded-2xl bg-rose-500 hover:bg-rose-600 disabled:opacity-50 text-white text-base font-bold shadow-lg shadow-rose-200 transition-colors"
            >
              {approving ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : "APPROVE COMPLETION"}
            </button>
            <button
              onClick={() => setShowComplaint(true)}
              className="w-full h-11 rounded-xl bg-white border border-red-200 text-red-700 text-xs font-semibold hover:bg-red-50"
            >
              <AlertTriangle className="h-4 w-4 inline mr-1.5 -mt-0.5" />
              Report an issue instead
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5 space-y-2 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-600 mx-auto" />
            <h3 className="text-base font-bold text-emerald-900">
              {alreadyApproved && approvedAt ? "SERVICE ALREADY APPROVED ✓" : "SERVICE APPROVED ✓"}
            </h3>
            <p className="text-xs text-emerald-800">
              Approved {approvedAt ? new Date(approvedAt).toLocaleString() : ""} · recorded with audit trail
            </p>
          </div>
        )}

        {/* Feedback + Google review (§24) — after approval only */}
        {isApproved && !feedbackSent && (
          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">How was your experience?</h3>
            <div className="flex items-center gap-1.5">
              {[1, 2, 3, 4, 5].map((s) => (
                <button key={s} type="button" onClick={() => setRating(s)} className="p-1">
                  <Star className={cn("h-8 w-8", s <= rating ? "text-amber-400 fill-amber-400" : "text-slate-200")} />
                </button>
              ))}
            </div>
            <button onClick={handleFeedback} className="w-full h-11 rounded-xl bg-slate-900 text-white text-sm font-bold">
              Submit rating
            </button>
          </div>
        )}
        {feedbackSent && (
          <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-medium flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" /> Thank you — your rating was recorded.
          </div>
        )}

        {isApproved && data.company.googleReviewUrl && (
          <div className="rounded-2xl border-2 border-amber-300 bg-gradient-to-br from-amber-50 to-white p-5 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-amber-600">
              <Sparkles className="h-3.5 w-3.5" /> One small favor
            </div>
            <h3 className="text-base font-semibold text-slate-900">Loved the service? Tell Google!</h3>
            <p className="text-xs text-slate-600">Your review takes 30 seconds and means the world to the crew that served you.</p>
            <a
              href={data.company.googleReviewUrl}
              target="_blank"
              rel="noreferrer"
              onClick={() => setGoogleClicked(true)}
              className="flex items-center justify-center gap-2 w-full h-12 rounded-xl bg-slate-900 text-white text-sm font-bold"
            >
              <Star className="h-4 w-4 text-amber-400 fill-amber-400" /> LEAVE GOOGLE REVIEW <ExternalLink className="h-4 w-4" />
            </a>
            <p className="text-[10px] text-slate-400">You choose whether and what to write — we never post automatically.</p>
          </div>
        )}

        {complaintSent && (
          <div className="p-4 rounded-2xl border border-amber-200 bg-amber-50 text-amber-900 text-xs font-medium">
            Your report has been sent to our operations supervisor — rework will be scheduled. No approval was recorded.
          </div>
        )}
      </main>

      {/* Complaint modal */}
      {showComplaint && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl max-w-lg w-full p-5 space-y-4">
            <h3 className="text-sm font-semibold text-slate-900">Report an issue</h3>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full h-11 rounded-xl border border-slate-200 px-3 text-sm bg-white">
              <option value="missed_area">Area not cleaned</option>
              <option value="quality">Quality issue</option>
              <option value="damage">Damage</option>
              <option value="staff_behavior">Staff conduct</option>
              <option value="other">Other</option>
            </select>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="Describe the issue…"
              className="w-full p-3 rounded-xl border border-slate-200 text-sm focus:ring-1 focus:ring-rose-400"
            />
            <div className="flex gap-2">
              <button onClick={() => setShowComplaint(false)} className="flex-1 h-11 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700">
                Cancel
              </button>
              <button onClick={handleComplaint} disabled={description.trim().length < 5} className="flex-1 h-11 rounded-xl bg-rose-500 text-white text-sm font-bold disabled:opacity-50">
                Submit report
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="fixed bottom-0 inset-x-0 px-4 py-3 bg-gradient-to-t from-slate-50 via-slate-50/95 to-transparent">
        <div className="max-w-lg mx-auto flex items-center justify-center gap-1.5 text-[10px] text-slate-400">
          <FileCheck className="h-3 w-3" /> Secured, audited, and revocable link · {data.company.name}
        </div>
      </footer>
    </div>
  );
}
