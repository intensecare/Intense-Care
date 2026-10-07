"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { JobStatusBadge } from "@/components/common/JobStatusBadge";
import { BeforeAfterGallery } from "@/components/common/BeforeAfterGallery";
import { useApp } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import { cn, formatDate, formatTimeSlot } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2, AlertTriangle, Plus, X, Loader2, ShieldCheck } from "lucide-react";
import type { Job } from "@/lib/types";

type DeskJob = Job & { customerName?: string; propertyTitle?: string; service?: { name: string } };
type DraftIssue = { area: string; itemDescription: string; severity: "minor" | "major" | "critical"; notes: string };

/**
 * QC inspection screen (§10 / §23) — optimized for speed:
 * job → checklist (tap ⚠ to raise an issue in one step) → before/after →
 * [PASS] or [REWORK REQUIRED]. The score is derived from the issues raised.
 */
export default function QualityInspectPage() {
  const params = useParams();
  const router = useRouter();
  const jobId = String(params?.id ?? "");
  const { jobs, checklistItems, photos, reworkTasks, qualityIssues, submitQualityCheck, reinspectAndPassQC, refreshJobs, refreshQuality, refreshPhotos } = useApp();
  const { can } = useAuth();

  const job = jobs.find((j) => j.id === jobId) as DeskJob | undefined;
  const checklist = useMemo(() => checklistItems.filter((c) => c.jobId === jobId), [checklistItems, jobId]);
  const jobPhotos = useMemo(() => photos.filter((p) => p.jobId === jobId), [photos, jobId]);
  const pastIssues = useMemo(() => qualityIssues.filter((i) => i.jobId === jobId), [qualityIssues, jobId]);
  const openRework = useMemo(() => reworkTasks.filter((t) => t.jobId === jobId && t.status !== "completed"), [reworkTasks, jobId]);

  const [issues, setIssues] = useState<DraftIssue[]>([]);
  const [notes, setNotes] = useState("");
  const [adding, setAdding] = useState<{ area: string; itemDescription: string } | null>(null);
  const [severity, setSeverity] = useState<DraftIssue["severity"]>("major");
  const [issueNotes, setIssueNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refreshJobs();
      void refreshPhotos();
      void refreshQuality();
    }, 10000);
    return () => clearInterval(t);
  }, [refreshJobs, refreshPhotos, refreshQuality]);

  // Opening a WORK_COMPLETED job starts the inspection (server-validated).
  useEffect(() => {
    if (!job || started || job.status !== "WORK_COMPLETED" || !can("qc.inspect")) return;
    setStarted(true);
    void fetch("/api/quality", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start-inspection", jobId }) }).then(() => refreshJobs());
  }, [job, started, jobId, can, refreshJobs]);

  if (!job) {
    return (
      <AdminLayout>
        <div className="p-12 text-center bg-white rounded-lg border border-slate-200 text-sm text-slate-500">Job not found or outside your queue.</div>
      </AdminLayout>
    );
  }

  const reinspect = ["REWORK_COMPLETED", "REINSPECTION"].includes(job.status);
  const inspectable = ["WORK_COMPLETED", "QUALITY_CHECK", "REWORK_COMPLETED", "REINSPECTION"].includes(job.status);
  const areas = Array.from(new Set(checklist.map((c) => c.area)));
  const itemsTotal = Math.max(checklist.length, 1);
  const flagged = new Set(issues.map((i) => `${i.area}::${i.itemDescription}`));
  const score = Math.max(0, Math.round(100 - (issues.reduce((acc, i) => acc + (i.severity === "critical" ? 3 : i.severity === "major" ? 2 : 1), 0) / itemsTotal) * 100));

  const addIssue = () => {
    if (!adding) return;
    setIssues((prev) => [...prev, { area: adding.area, itemDescription: adding.itemDescription, severity, notes: issueNotes }]);
    setAdding(null);
    setIssueNotes("");
    setSeverity("major");
  };

  const decide = async (decision: "PASS" | "REWORK_REQUIRED") => {
    setBusy(true);
    setError(null);
    const res =
      reinspect && decision === "PASS"
        ? await reinspectAndPassQC(job.id, notes)
        : await submitQualityCheck(job.id, decision === "PASS" ? 100 : score, decision, notes, issues);
    setBusy(false);
    if (!res.success) {
      setError(res.message);
      return;
    }
    await refreshJobs();
    router.push("/quality-queue");
  };

  return (
    <AdminLayout>
      <PageHeader
        title={`Quality Inspection · ${job.id}`}
        description={`${job.service?.name ?? "Service"} for ${job.customerName ?? "Customer"} · ${formatDate(job.scheduledDate)} ${formatTimeSlot(job.scheduledTimeSlot)}`}
        breadcrumbs={[{ label: "Quality Queue", href: "/quality-queue" }, { label: job.id }]}
        badge={<JobStatusBadge status={job.status} />}
      />

      {error && <div className="mb-4 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      {!inspectable && (
        <div className="mb-4 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          This job is not awaiting inspection right now ({job.status}). {openRework.length > 0 && `${openRework.length} rework item(s) still open.`}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <BeforeAfterGallery photos={jobPhotos} title="Before / After evidence" />

          <div className="rounded-lg border border-zinc-200 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-900">Checklist — tap ⚠ to raise an issue</h3>
              <span className="text-xs text-zinc-500">{checklist.filter((c) => c.status === "completed").length}/{checklist.length} done by team</span>
            </div>
            {areas.map((area) => (
              <div key={area}>
                <div className="px-4 py-1.5 bg-zinc-50 text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">{area}</div>
                <ul className="divide-y divide-zinc-100">
                  {checklist
                    .filter((c) => c.area === area)
                    .map((item) => {
                      const isFlagged = flagged.has(`${item.area}::${item.task}`);
                      return (
                        <li key={item.id} className={cn("px-4 py-2.5 flex items-center gap-3", isFlagged && "bg-amber-50/60")}>
                          <span className={cn("h-6 w-6 rounded-full flex items-center justify-center shrink-0", item.status === "completed" ? "bg-emerald-100 text-emerald-700" : item.status === "issue" ? "bg-amber-100 text-amber-700" : "bg-zinc-100 text-zinc-400")}>
                            {item.status === "completed" ? <CheckCircle2 className="h-4 w-4" /> : item.status === "issue" ? <AlertTriangle className="h-4 w-4" /> : <span className="text-[10px]">○</span>}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className={cn("text-xs", isFlagged ? "text-amber-900 font-semibold" : "text-zinc-800")}>{item.task}</div>
                            {item.issueNotes && <div className="text-[11px] text-amber-700">Team note: {item.issueNotes}</div>}
                          </div>
                          {inspectable && can("qc.rework") && !isFlagged && (
                            <button onClick={() => setAdding({ area: item.area, itemDescription: item.task })} className="h-8 px-2.5 rounded-md text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 hover:bg-amber-100 inline-flex items-center gap-1">
                              <AlertTriangle className="h-3.5 w-3.5" /> Issue
                            </button>
                          )}
                        </li>
                      );
                    })}
                </ul>
              </div>
            ))}
            {checklist.length === 0 && <div className="p-6 text-center text-xs text-zinc-500">No checklist on this service.</div>}
          </div>

          {pastIssues.length > 0 && (
            <div className="rounded-lg border border-zinc-200 bg-white p-4">
              <h3 className="text-sm font-semibold text-zinc-900 mb-2">Previous issues on this job</h3>
              <ul className="space-y-1 text-xs">
                {pastIssues.map((i) => (
                  <li key={i.id} className="flex items-center justify-between">
                    <span>
                      <span className="font-semibold">{i.area}</span> · {i.itemDescription}
                    </span>
                    <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-semibold", i.status === "resolved" || i.status === "reinspected_pass" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")}>{i.status.replace(/_/g, " ")}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-zinc-200 bg-white p-4 space-y-3 sticky top-20">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-900">Result</h3>
              <span className={cn("text-2xl font-semibold", issues.length ? "text-amber-700" : "text-emerald-700")}>{issues.length ? `${score}%` : "100%"}</span>
            </div>

            {issues.length === 0 ? (
              <p className="text-xs text-zinc-500">No issues raised. Pass the job or tap ⚠ next to a checklist item.</p>
            ) : (
              <ul className="space-y-1.5">
                {issues.map((i, idx) => (
                  <li key={idx} className="text-xs rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-amber-900">{i.area}: {i.itemDescription}</div>
                      <div className="text-[11px] text-amber-800">{i.severity}{i.notes ? ` — ${i.notes}` : ""}</div>
                    </div>
                    <button onClick={() => setIssues((prev) => prev.filter((_, k) => k !== idx))} className="text-amber-700 hover:text-amber-900">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {inspectable && can("qc.rework") && (
              <button onClick={() => setAdding({ area: areas[0] ?? "General", itemDescription: "" })} className="w-full h-9 rounded-md border border-dashed border-zinc-300 text-xs text-zinc-600 hover:bg-zinc-50 inline-flex items-center justify-center gap-1">
                <Plus className="h-3.5 w-3.5" /> Add issue
              </button>
            )}

            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Inspector notes (optional)" rows={2} className="w-full rounded-md border border-zinc-200 px-3 py-2 text-xs" />

            {inspectable && (
              <div className="grid grid-cols-1 gap-2 pt-1">
                {can("qc.pass") && (
                  <Button disabled={busy || issues.length > 0} onClick={() => decide("PASS")} className="h-11 text-sm text-white bg-emerald-600 hover:bg-emerald-700 border-emerald-600">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldCheck className="h-4 w-4 mr-2" />} PASS
                  </Button>
                )}
                {can("qc.rework") && (
                  <Button variant="destructive" disabled={busy || issues.length === 0} onClick={() => decide("REWORK_REQUIRED")} className="h-11 text-sm">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <AlertTriangle className="h-4 w-4 mr-2" />} REWORK REQUIRED ({issues.length})
                  </Button>
                )}
              </div>
            )}
            <Link href="/quality-queue" className="block text-center text-[11px] text-zinc-400 pt-1">Back to queue</Link>
          </div>
        </div>
      </div>

      {adding && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-2xl max-w-md w-full border border-slate-200 p-5 space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Raise an issue</h3>
              <button onClick={() => setAdding(null)} className="text-slate-400 hover:text-slate-900"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Area</label>
                <select value={adding.area} onChange={(e) => setAdding({ ...adding, area: e.target.value })} className="w-full h-9 rounded-md border border-slate-200 px-2">
                  {(areas.length ? areas : ["General"]).map((a) => <option key={a}>{a}</option>)}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Severity</label>
                <select value={severity} onChange={(e) => setSeverity(e.target.value as DraftIssue["severity"])} className="w-full h-9 rounded-md border border-slate-200 px-2">
                  <option value="minor">Minor</option>
                  <option value="major">Major</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">What is wrong?</label>
              <Input autoFocus value={adding.itemDescription} onChange={(e) => setAdding({ ...adding, itemDescription: e.target.value })} placeholder="e.g. Mirror not cleaned properly" className="text-xs" />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Instruction for the team (optional)</label>
              <Input value={issueNotes} onChange={(e) => setIssueNotes(e.target.value)} placeholder="e.g. Re-clean with glass cleaner, wipe streaks" className="text-xs" />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setAdding(null)}>Cancel</Button>
              <Button size="sm" className="text-white" disabled={!adding.itemDescription.trim()} onClick={addIssue}>Add issue</Button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
