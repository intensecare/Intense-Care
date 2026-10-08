"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { QualityShell } from "@/components/quality/QualityShell";
import { PrimaryAction } from "@/components/workspace/WorkspaceWidgets";
import { useApp } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import { compressImageForUpload } from "@/lib/image-compress";
import { cn, formatDate, formatDateTime, formatTimeSlot } from "@/lib/utils";
import { CheckCircle2, AlertTriangle, Plus, X, Loader2, ShieldCheck, Camera, RotateCcw, MapPin, ClipboardList, Check } from "lucide-react";
import type { Job, JobPhoto } from "@/lib/types";

type DeskJob = Job & { customerName?: string; propertyTitle?: string; service?: { name: string } };
type DraftIssue = { area: string; issue: string; comment: string; photo?: JobPhoto };

const INSPECTABLE = ["WORK_COMPLETED", "QUALITY_CHECK", "REWORK_COMPLETED", "REINSPECTION"];

/**
 * QUALITY CHECK — one job.
 * Service details, checklist, before/after photos and work notes → [PASS] or
 * [REWORK REQUIRED] (area · issue · photo · comment → [CREATE REWORK]).
 * Reinspection offers PASS or REWORK AGAIN. Every round stays in the history;
 * rework always stays on the SAME job.
 */
export default function QualityInspectPage() {
  const params = useParams();
  const router = useRouter();
  const jobId = String(params?.id ?? "");
  const { jobs, checklistItems, photos, qualityIssues, qualityChecks, submitQualityCheck, reinspectAndPassQC, addJobPhoto, refreshJobs, refreshQuality, refreshPhotos } = useApp();
  const { can } = useAuth();

  const job = jobs.find((j) => j.id === jobId) as DeskJob | undefined;
  const checklist = useMemo(() => checklistItems.filter((c) => c.jobId === jobId), [checklistItems, jobId]);
  const jobPhotos = useMemo(() => photos.filter((p) => p.jobId === jobId), [photos, jobId]);
  const history = useMemo(() => qualityChecks.filter((q) => q.jobId === jobId).sort((a, b) => (b.inspectedAt ?? "").localeCompare(a.inspectedAt ?? "")), [qualityChecks, jobId]);
  const pastIssues = useMemo(() => qualityIssues.filter((i) => i.jobId === jobId), [qualityIssues, jobId]);

  const [mode, setMode] = useState<"review" | "rework">("review");
  const [issues, setIssues] = useState<DraftIssue[]>([]);
  const [draft, setDraft] = useState<DraftIssue>({ area: "", issue: "", comment: "" });
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);

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

  const areas = useMemo(() => {
    const list = Array.from(new Set([...checklist.map((c) => c.area), ...jobPhotos.map((p) => p.area)]));
    return list.length ? list : ["General"];
  }, [checklist, jobPhotos]);

  useEffect(() => {
    if (!draft.area && areas.length) setDraft((d) => ({ ...d, area: areas[0] }));
  }, [areas, draft.area]);

  if (!job) {
    return (
      <QualityShell title="Quality Check" backHref="/quality-queue">
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">Job not found or not waiting for a quality check.</div>
      </QualityShell>
    );
  }

  const reinspect = ["REWORK_COMPLETED", "REINSPECTION"].includes(job.status);
  const inspectable = INSPECTABLE.includes(job.status) && can("qc.inspect");

  const onPhotoPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setError(null);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const prepared = await compressImageForUpload(String(ev.target?.result ?? ""));
      const r = await addJobPhoto({ jobId, area: draft.area || "General", photoType: "qc", imageDataUrl: prepared.dataUrl, caption: draft.issue || undefined });
      setUploading(false);
      if (!r.success || !r.photo) setError(r.message);
      else setDraft((d) => ({ ...d, photo: r.photo }));
    };
    reader.readAsDataURL(file);
  };

  const addDraft = () => {
    if (!draft.issue.trim()) return;
    setIssues((prev) => [...prev, { ...draft, issue: draft.issue.trim(), comment: draft.comment.trim() }]);
    setDraft({ area: draft.area, issue: "", comment: "" });
  };

  const pass = async () => {
    setBusy(true);
    setError(null);
    const res = reinspect ? await reinspectAndPassQC(job.id, "") : await submitQualityCheck(job.id, 100, "PASS", "", []);
    setBusy(false);
    if (!res.success) {
      setError(res.message);
      return;
    }
    await refreshJobs();
    router.push("/quality-queue");
  };

  const createRework = async () => {
    const all = draft.issue.trim() ? [...issues, { ...draft, issue: draft.issue.trim(), comment: draft.comment.trim() }] : issues;
    if (all.length === 0) return;
    setBusy(true);
    setError(null);
    const score = Math.max(0, 100 - all.length * 10);
    const res = await submitQualityCheck(
      job.id,
      score,
      "REWORK_REQUIRED",
      "",
      all.map((i) => ({ area: i.area, itemDescription: i.issue, severity: "major" as const, notes: i.comment }))
    );
    setBusy(false);
    if (!res.success) {
      setError(res.message);
      return;
    }
    await refreshJobs();
    await refreshQuality();
    router.push("/quality-queue");
  };

  const pendingCount = issues.length + (draft.issue.trim() ? 1 : 0);
  const action = !inspectable ? undefined : mode === "review" ? (
    <div className="grid grid-cols-2 gap-2">
      <PrimaryAction label={reinspect ? "REWORK AGAIN" : "REWORK REQUIRED"} tone="warning" disabled={busy} onClick={() => setMode("rework")} icon={<RotateCcw className="h-5 w-5" />} />
      <PrimaryAction label="PASS" tone="success" busy={busy} onClick={() => void pass()} icon={<ShieldCheck className="h-5 w-5" />} />
    </div>
  ) : (
    <PrimaryAction label={`CREATE REWORK${pendingCount ? ` (${pendingCount})` : ""}`} tone="warning" disabled={pendingCount === 0 || uploading} busy={busy} onClick={() => void createRework()} icon={<AlertTriangle className="h-5 w-5" />} />
  );

  const before = (a: string) => jobPhotos.filter((p) => p.area === a && p.photoType === "before");
  const after = (a: string) => jobPhotos.filter((p) => p.area === a && p.photoType === "after");
  const reworkPhotos = jobPhotos.filter((p) => p.photoType === "rework");

  return (
    <QualityShell title={job.customerName ?? job.id} subtitle={reinspect ? "Reinspection" : "Quality Check"} backHref="/quality-queue" action={action}>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPhotoPicked} />

      {error && (
        <div className="rounded-2xl bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}
      {!inspectable && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
          This job is not waiting for a quality check right now.
        </div>
      )}

      {/* Service details */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 font-mono">{job.jobNumber ?? job.id}</span>
          {reinspect ? (
            <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">Reinspection</span>
          ) : (
            <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">First inspection</span>
          )}
        </div>
        <div className="text-lg font-semibold text-slate-900">{job.service?.name ?? "Service"}</div>
        <div className="text-sm text-slate-600 flex items-start gap-1.5">
          <MapPin className="h-4 w-4 mt-0.5 shrink-0 text-slate-400" /> {job.propertyTitle ?? "Property"}
        </div>
        <div className="text-sm text-slate-500">
          {formatDate(job.scheduledDate)} · {formatTimeSlot(job.scheduledTimeSlot)}
        </div>
        {job.notes && <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700"><strong>Work notes:</strong> {job.notes}</div>}
      </div>

      {mode === "rework" && inspectable && (
        <section className="rounded-2xl border border-amber-300 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-4 bg-amber-50 border-b border-amber-200 flex items-center justify-between">
            <div className="text-lg font-semibold text-amber-900">{reinspect ? "Rework again" : "Rework required"}</div>
            <button onClick={() => setMode("review")} className="text-sm font-semibold text-amber-800">Cancel</button>
          </div>
          {issues.length > 0 && (
            <ul className="divide-y divide-slate-100 border-b border-slate-100">
              {issues.map((i, idx) => (
                <li key={idx} className="px-5 py-3 flex items-start gap-3">
                  {i.photo ? <img src={i.photo.thumbnailUrl || i.photo.photoUrl} alt="" className="h-12 w-12 rounded-lg object-cover shrink-0" /> : <span className="h-12 w-12 rounded-lg bg-slate-100 shrink-0" />}
                  <div className="flex-1 min-w-0 text-sm">
                    <div className="font-semibold text-slate-900">{i.area}: {i.issue}</div>
                    {i.comment && <div className="text-slate-500">{i.comment}</div>}
                  </div>
                  <button onClick={() => setIssues((prev) => prev.filter((_, k) => k !== idx))} className="h-9 w-9 rounded-lg text-slate-400 hover:bg-slate-100 inline-flex items-center justify-center" aria-label="Remove">
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="p-5 space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-slate-700">Area</label>
              <div className="flex flex-wrap gap-2">
                {areas.map((a) => (
                  <button key={a} type="button" onClick={() => setDraft({ ...draft, area: a })} className={cn("h-10 px-3 rounded-xl text-sm font-medium border", draft.area === a ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200")}>
                    {a}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="qc-issue" className="text-sm font-semibold text-slate-700">Issue</label>
              <input id="qc-issue" value={draft.issue} onChange={(e) => setDraft({ ...draft, issue: e.target.value })} placeholder="e.g. Mirror has streaks" className="w-full h-12 rounded-xl border border-slate-200 px-3 text-base focus:outline-none focus:ring-2 focus:ring-amber-500" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-slate-700">Photo</label>
              {draft.photo ? (
                <div className="flex items-center gap-3">
                  <img src={draft.photo.thumbnailUrl || draft.photo.photoUrl} alt="" className="h-16 w-16 rounded-xl object-cover" />
                  <button onClick={() => setDraft({ ...draft, photo: undefined })} className="text-sm text-slate-500 underline">Remove</button>
                </div>
              ) : (
                <button type="button" disabled={uploading} onClick={() => cameraRef.current?.click()} className="h-12 w-full rounded-xl border border-dashed border-slate-300 bg-slate-50 text-sm font-semibold text-slate-700 inline-flex items-center justify-center gap-2">
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />} ADD PHOTO
                </button>
              )}
            </div>
            <div className="space-y-1.5">
              <label htmlFor="qc-comment" className="text-sm font-semibold text-slate-700">Comment (optional)</label>
              <textarea id="qc-comment" rows={2} value={draft.comment} onChange={(e) => setDraft({ ...draft, comment: e.target.value })} placeholder="How to fix it" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-amber-500" />
            </div>
            <button type="button" disabled={!draft.issue.trim()} onClick={addDraft} className="h-11 w-full rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 inline-flex items-center justify-center gap-2 disabled:opacity-40">
              <Plus className="h-4 w-4" /> Add another issue
            </button>
          </div>
        </section>
      )}

      {/* Checklist */}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="text-base font-semibold text-slate-900 flex items-center gap-2"><ClipboardList className="h-5 w-5 text-slate-400" /> Checklist</div>
          <div className="text-sm text-slate-500">{checklist.filter((c) => c.status === "completed" || c.status === "skipped").length}/{checklist.length} done</div>
        </div>
        {Array.from(new Set(checklist.map((c) => c.area))).map((area) => (
          <div key={area}>
            <div className="px-5 py-2 bg-slate-50 text-xs font-semibold text-slate-600 uppercase tracking-wide">{area}</div>
            <ul className="divide-y divide-slate-100">
              {checklist.filter((c) => c.area === area).map((item) => {
                const done = item.status === "completed" || item.status === "skipped";
                return (
                  <li key={item.id} className="px-5 py-2.5 flex items-center gap-3 text-sm">
                    <span className={cn("h-6 w-6 rounded-full flex items-center justify-center shrink-0", done ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400")}>
                      {done ? <Check className="h-4 w-4" /> : <span className="text-[10px]">○</span>}
                    </span>
                    <span className={done ? "text-slate-800" : "text-slate-500"}>{item.task}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {checklist.length === 0 && <div className="p-6 text-center text-sm text-slate-500">No checklist on this service.</div>}
      </section>

      {/* Before / After */}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 text-base font-semibold text-slate-900">Before / After</div>
        <ul className="divide-y divide-slate-100">
          {areas.map((a) => (
            <li key={a} className="p-5 space-y-2">
              <div className="text-sm font-semibold text-slate-900">{a}</div>
              <div className="grid grid-cols-2 gap-2">
                {[{ label: "BEFORE", list: before(a) }, { label: "AFTER", list: after(a) }].map(({ label, list }) => (
                  <div key={label}>
                    <div className="text-[11px] font-semibold text-slate-400 mb-1">{label}</div>
                    {list.length ? (
                      <a href={list[0].photoUrl} target="_blank" rel="noreferrer">
                        <img src={list[0].thumbnailUrl || list[0].photoUrl} alt={`${label} ${a}`} className="aspect-[4/3] w-full rounded-xl object-cover" />
                      </a>
                    ) : (
                      <div className="aspect-[4/3] w-full rounded-xl bg-slate-100 text-xs text-slate-400 flex items-center justify-center">No photo</div>
                    )}
                    {list.length > 1 && <div className="text-[11px] text-slate-400 mt-1">+{list.length - 1} more</div>}
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {reworkPhotos.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5 space-y-2">
          <div className="text-base font-semibold text-slate-900">Rework photos</div>
          <div className="flex gap-2 overflow-x-auto">
            {reworkPhotos.map((p) => (
              <a key={p.id} href={p.photoUrl} target="_blank" rel="noreferrer" className="shrink-0 text-center">
                <img src={p.thumbnailUrl || p.photoUrl} alt="" className="h-24 w-24 rounded-xl object-cover" />
                <span className="text-[11px] text-slate-500">{p.area}</span>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* History — every QC round on this job */}
      {(history.length > 0 || pastIssues.length > 0) && (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 text-base font-semibold text-slate-900">History</div>
          <ul className="divide-y divide-slate-100">
            {history.map((q) => {
              const passed = q.status === "PASS";
              const round = pastIssues.filter((i) => i.qualityCheckId === q.id);
              return (
                <li key={q.id} className="px-5 py-4 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn("inline-flex items-center gap-1.5 text-sm font-semibold", passed ? "text-emerald-700" : "text-amber-800")}>
                      {passed ? <CheckCircle2 className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />} {passed ? "Passed" : "Rework required"}
                    </span>
                    <span className="text-xs text-slate-400">{q.inspectedAt ? formatDateTime(q.inspectedAt) : ""}</span>
                  </div>
                  {q.inspectorName && <div className="text-xs text-slate-500">by {q.inspectorName}</div>}
                  {round.length > 0 && (
                    <ul className="space-y-1">
                      {round.map((i) => (
                        <li key={i.id} className="text-sm text-slate-700 flex items-start justify-between gap-2">
                          <span><strong>{i.area}:</strong> {i.itemDescription}{i.notes && i.notes !== i.itemDescription ? ` — ${i.notes}` : ""}</span>
                          <span className={cn("shrink-0 px-2 py-0.5 rounded-lg text-[11px] font-semibold", i.status === "resolved" || i.status === "reinspected_pass" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800")}>
                            {i.status === "resolved" ? "Fixed" : i.status === "reinspected_pass" ? "Passed" : "Open"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </QualityShell>
  );
}
