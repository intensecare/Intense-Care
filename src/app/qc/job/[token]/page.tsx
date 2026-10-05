"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2, ShieldCheck, CheckCircle2, AlertTriangle, Camera, MapPin, FileCheck, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * /qc/job/[token] — §17, §18, §20, §29, §34, §40.
 *
 * QC inspector's visual inspection: checklist + before/after evidence +
 * rework history, then [PASS] / [REWORK REQUIRED]. On REWORK the inspector
 * files issues (area / problem / severity / comment) that auto-create rework
 * tasks. Reinspection shows original issue → rework evidence → verdict.
 * Idempotent: a completed inspection shows "QUALITY CHECK ALREADY COMPLETED".
 */

interface QcPayload {
  purpose: string;
  job: { id: string; status: string; serviceName: string; scheduledDate: string; completedAt: string | null; internalNotes: string | null };
  property: { title: string; address: string };
  customerName: string;
  checklist: { id: string; area: string; task: string; critical: boolean; status: string; issueNotes: string | null }[];
  photos: { id: string; area: string; photoType: string; url: string }[];
  issues: { id: string; area: string; itemDescription: string; severity: string; notes: string; status: string; reworkTaskId: string | null }[];
  rework: { id: string; instructions: string; status: string; completedNotes: string | null; completedAt: string | null }[];
  qcHistory: { id: string; score: number; decision: string; notes: string | null; createdAt: string }[];
}

interface DraftIssue {
  area: string;
  problem: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  comment: string;
}

export default function QcInspectionPage() {
  const params = useParams();
  const token = (params?.token as string) || "";
  const [data, setData] = useState<QcPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [done, setDone] = useState<{ decision: string } | null>(null);
  const [alreadyDone, setAlreadyDone] = useState(false);

  const [showIssueForm, setShowIssueForm] = useState(false);
  const [drafts, setDrafts] = useState<DraftIssue[]>([{ area: "", problem: "", severity: "MEDIUM", comment: "" }]);
  const [notes, setNotes] = useState("");

  const load = async () => {
    try {
      const res = await fetch(`/api/qc/job/${encodeURIComponent(token)}`);
      const json = await res.json();
      if (res.ok && json?.success) {
        setData(json.data);
        const active = ["PASS", "CUSTOMER_APPROVAL", "COMPLETED"].includes(json.data.job.status);
        if (active && json.data.qcHistory.length > 0) {
          setAlreadyDone(true);
          setDone({ decision: json.data.qcHistory[json.data.qcHistory.length - 1].decision });
        }
      } else {
        setKind(json?.kind || "not_found");
        setError(json?.error || "This link is invalid or has expired.");
      }
    } catch {
      setError("Unable to load the inspection. Check your connection.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const decide = async (decision: "pass" | "rework" | "reinspect-pass") => {
    setBusy(true);
    try {
      const body: Record<string, unknown> =
        decision === "pass"
          ? { action: "pass", score: 95, notes }
          : decision === "reinspect-pass"
          ? { action: "reinspect-pass", score: 95 }
          : {
              action: "rework",
              score: Math.max(0, 100 - drafts.length * 15),
              notes,
              issues: drafts
                .filter((d) => d.area.trim() && d.problem.trim())
                .map((d) => ({ area: d.area.trim(), problem: d.problem.trim(), severity: d.severity, comment: d.comment || undefined })),
            };
      const res = await fetch(`/api/qc/job/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (res.ok && json?.success) {
        setDone({ decision: decision === "rework" ? "REWORK_REQUIRED" : "PASS" });
        setToast(decision === "rework" ? "Rework dispatched to field staff" : decision === "pass" ? "PASSED — customer handover link sent" : "Reinspection passed");
        await load();
      } else {
        setToast(json?.error || "Decision failed.");
      }
    } catch {
      setToast("Network error — try again.");
    } finally {
      setBusy(false);
      setTimeout(() => setToast(null), 4000);
    }
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

  const { job, checklist, photos, issues, rework, qcHistory } = data;
  const isReinspection = data.purpose === "REINSPECTION" || job.status === "REWORK_COMPLETED" || job.status === "REINSPECTION";
  const before = photos.filter((p) => p.photoType === "before");
  const after = photos.filter((p) => p.photoType === "after");
  const inspectionOpen = ["WORK_COMPLETED", "QUALITY_CHECK", "REWORK_COMPLETED", "REINSPECTION"].includes(job.status);
  const showIssueFormNeeded = drafts.some((d) => d.area.trim() && d.problem.trim());

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-44">
      <header className="bg-white border-b border-slate-200 py-3 px-4 sticky top-0 z-30 shadow-xs">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-purple-600 text-white flex items-center justify-center">
              <ShieldCheck className="h-4.5 w-4.5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900">{isReinspection ? "Reinspection" : "Quality Inspection"}</div>
              <div className="text-[10px] text-slate-500 font-semibold">
                {job.serviceName} · <span className="font-mono">{job.id}</span>
              </div>
            </div>
          </div>
          <button onClick={() => void load()} className="h-9 w-9 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </header>

      {toast && (
        <div className="max-w-lg mx-auto mt-2 px-4">
          <div className="p-3 rounded-xl bg-slate-900 text-white text-xs font-semibold shadow">{toast}</div>
        </div>
      )}

      <main className="max-w-lg mx-auto p-4 space-y-4">
        {/* Job details */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-2 text-xs">
          <div className="flex items-start gap-2">
            <MapPin className="h-4 w-4 text-rose-600 mt-0.5" />
            <span className="text-slate-700">
              {data.property.title}
              <span className="block text-[11px] text-slate-500">{data.property.address}</span>
            </span>
          </div>
          <p className="text-slate-500">
            Customer: <span className="font-semibold text-slate-700">{data.customerName}</span> · Completed:{" "}
            {job.completedAt ? new Date(job.completedAt).toLocaleDateString() : "—"}
          </p>
          {job.internalNotes && (
            <p className="p-2 rounded-lg bg-slate-50 border border-slate-100 text-[11px] text-slate-600">
              <span className="font-semibold">Internal notes:</span> {job.internalNotes}
            </p>
          )}
        </div>

        {/* Checklist summary */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-1.5">
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
            <FileCheck className="h-4 w-4 text-emerald-600" /> Checklist
          </h3>
          <div className="divide-y divide-slate-100">
            {checklist.map((item) => (
              <div key={item.id} className="py-1.5 flex items-center gap-2 text-xs">
                <CheckCircle2 className={cn("h-4 w-4 shrink-0", item.status === "completed" ? "text-emerald-600" : item.status === "issue" ? "text-red-500" : "text-slate-300")} />
                <span className={item.status === "completed" ? "text-slate-800" : "text-slate-500"}>{item.task}</span>
                {item.status === "issue" && item.issueNotes && <span className="text-[10px] text-red-600 ml-auto">{item.issueNotes}</span>}
                <span className="ml-auto text-[10px] text-slate-400 shrink-0">{item.area}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Evidence */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
            <Camera className="h-4 w-4 text-slate-500" /> Before / After evidence
          </h3>
          {Array.from(new Set(photos.map((p) => p.area))).map((area) => {
            const b = before.find((p) => p.area === area);
            const a = after.find((p) => p.area === area);
            return (
              <div key={area} className="grid grid-cols-2 gap-2">
                <div className="relative rounded-lg overflow-hidden border border-slate-200 aspect-video bg-slate-100">
                  {b ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={b.url} alt={`before ${area}`} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[10px] text-slate-400">no before</div>
                  )}
                  <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded text-[9px] font-bold text-white bg-amber-600">BEFORE</span>
                </div>
                <div className="relative rounded-lg overflow-hidden border border-slate-200 aspect-video bg-slate-100">
                  {a ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.url} alt={`after ${area}`} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[10px] text-slate-400">no after</div>
                  )}
                  <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded text-[9px] font-bold text-white bg-emerald-600">AFTER</span>
                </div>
              </div>
            );
          })}
          {photos.length === 0 && <p className="text-xs text-slate-400">No evidence photos uploaded.</p>}
        </div>

        {/* §20 reinspection context: original issue → rework evidence */}
        {isReinspection && issues.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 space-y-2.5">
            <h3 className="text-sm font-bold text-red-900">Original issues → rework evidence</h3>
            {issues.map((iss) => {
              const task = rework.find((r) => r.id === iss.reworkTaskId);
              return (
                <div key={iss.id} className="bg-white rounded-xl border border-red-100 p-3 text-xs space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-bold", iss.severity === "critical" ? "bg-red-600 text-white" : iss.severity === "major" ? "bg-amber-100 text-amber-800" : "bg-slate-200 text-slate-700")}>
                      {iss.severity.toUpperCase()}
                    </span>
                    <span className="font-semibold text-slate-800">{iss.area}</span>
                    <span className={cn("ml-auto text-[10px] font-semibold", iss.status === "resolved" ? "text-emerald-600" : iss.status === "reinspected_pass" ? "text-emerald-600" : "text-amber-600")}>
                      {iss.status.replace("_", " ")}
                    </span>
                  </div>
                  <p className="text-slate-700">{iss.itemDescription}</p>
                  {task?.completedNotes && (
                    <p className="p-2 rounded-lg bg-emerald-50 border border-emerald-100 text-[11px] text-emerald-900">
                      <span className="font-semibold">Rework evidence:</span> {task.completedNotes}
                      {task.completedAt ? ` · ${new Date(task.completedAt).toLocaleString()}` : ""}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Prior QC attempts (§20 history) */}
        {qcHistory.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-1.5">
            <h3 className="text-sm font-semibold text-slate-900">Inspection history</h3>
            {qcHistory.map((q) => (
              <div key={q.id} className="flex items-center justify-between text-xs py-1 border-b border-slate-50 last:border-0">
                <span className={cn("font-bold", q.decision === "PASS" ? "text-emerald-600" : "text-red-600")}>{q.decision === "PASS" ? "PASSED" : "REWORK REQUIRED"}</span>
                <span className="text-slate-500">{q.score}% · {new Date(q.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}

        {/* Idempotent state (§30) */}
        {alreadyDone || done ? (
          <div className="bg-white rounded-2xl border-2 border-emerald-200 p-5 text-center space-y-1.5">
            <CheckCircle2 className="h-10 w-10 text-emerald-600 mx-auto" />
            <h3 className="text-base font-bold text-slate-900">QUALITY CHECK ALREADY COMPLETED</h3>
            <p className="text-xs text-slate-500">Decision recorded: {done?.decision === "PASS" ? "PASSED ✓" : "REWORK dispatched"}. The pipeline has moved on.</p>
          </div>
        ) : inspectionOpen ? (
          <>
            {/* Issue drafts (§18) */}
            {showIssueForm && (
              <div className="bg-white rounded-2xl border border-red-200 p-4 space-y-3">
                <h3 className="text-sm font-bold text-red-900">QC issues</h3>
                {drafts.map((d, i) => (
                  <div key={i} className="p-3 rounded-xl bg-red-50/60 border border-red-100 space-y-2">
                    <input
                      value={d.area}
                      onChange={(e) => setDrafts((ds) => ds.map((x, j) => (j === i ? { ...x, area: e.target.value } : x)))}
                      placeholder="Area — e.g. Bathroom"
                      className="w-full h-10 rounded-lg border border-slate-200 px-3 text-xs"
                    />
                    <input
                      value={d.problem}
                      onChange={(e) => setDrafts((ds) => ds.map((x, j) => (j === i ? { ...x, problem: e.target.value } : x)))}
                      placeholder="Problem — e.g. Mirror not cleaned properly"
                      className="w-full h-10 rounded-lg border border-slate-200 px-3 text-xs"
                    />
                    <div className="grid grid-cols-3 gap-1.5">
                      {(["LOW", "MEDIUM", "HIGH"] as const).map((sev) => (
                        <button
                          key={sev}
                          onClick={() => setDrafts((ds) => ds.map((x, j) => (j === i ? { ...x, severity: sev } : x)))}
                          className={cn(
                            "h-9 rounded-lg text-[11px] font-bold border",
                            d.severity === sev ? (sev === "HIGH" ? "bg-red-600 text-white border-red-600" : sev === "MEDIUM" ? "bg-amber-400 text-amber-950 border-amber-400" : "bg-slate-200 text-slate-800 border-slate-200") : "bg-white text-slate-500 border-slate-200"
                          )}
                        >
                          {sev}
                        </button>
                      ))}
                    </div>
                    <input
                      value={d.comment}
                      onChange={(e) => setDrafts((ds) => ds.map((x, j) => (j === i ? { ...x, comment: e.target.value } : x)))}
                      placeholder="Comment (optional)"
                      className="w-full h-10 rounded-lg border border-slate-200 px-3 text-xs"
                    />
                  </div>
                ))}
                <button
                  onClick={() => setDrafts((ds) => [...ds, { area: "", problem: "", severity: "MEDIUM", comment: "" }])}
                  className="h-9 px-3 rounded-lg border border-dashed border-slate-300 text-xs font-semibold text-slate-500 w-full"
                >
                  + Add another issue
                </button>
              </div>
            )}

            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Inspection notes (optional)"
              className="w-full p-3 rounded-2xl border border-slate-200 text-xs"
            />

            {/* Primary choices (§17) */}
            <div className="fixed bottom-0 inset-x-0 z-40 p-4 bg-gradient-to-t from-slate-50 via-slate-50/95 to-transparent">
              <div className="max-w-lg mx-auto grid grid-cols-2 gap-2">
                <button
                  onClick={() => (showIssueForm ? decide("rework") : setShowIssueForm(true))}
                  disabled={busy || (showIssueForm && !showIssueFormNeeded)}
                  className="h-14 rounded-2xl bg-red-600 hover:bg-red-700 text-white text-sm font-bold shadow-lg disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : showIssueForm ? "CREATE REWORK" : "REWORK REQUIRED"}
                </button>
                <button
                  onClick={() => decide(isReinspection && job.status !== "WORK_COMPLETED" ? "reinspect-pass" : "pass")}
                  disabled={busy}
                  className="h-14 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold shadow-lg disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : isReinspection ? "PASS REINSPECTION" : "PASS"}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 p-4 text-center text-xs text-slate-500">
            This job is currently at <span className="font-bold text-slate-700">{job.status.replace(/_/g, " ").toLowerCase()}</span> — inspection opens when work is completed.
          </div>
        )}
      </main>
    </div>
  );
}
