"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2, CheckCircle2, AlertTriangle, Camera, Play, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { compressImageForUpload } from "@/lib/image-compress";

/**
 * /rework/[token] — §19, §29, §30, §40.
 *
 * The assigned staff member's rework screen: ONLY the failed tasks (never the
 * full job). START REWORK → fix → evidence note + optional photo → SUBMIT,
 * which drives REWORK_ASSIGNED → REWORK_IN_PROGRESS → REWORK_COMPLETED and
 * queues QC reinspection. Idempotent: tasks already completed show ✓ and the
 * submit button becomes a receipt.
 */

interface ReworkPayload {
  job: { id: string; status: string; serviceName: string; propertyAddress: string };
  tasks: {
    id: string;
    instructions: string;
    status: string;
    area: string | null;
    severity: string | null;
    problem: string | null;
    completedNotes: string | null;
    completedAt: string | null;
  }[];
}

export default function ReworkPage() {
  const params = useParams();
  const token = (params?.token as string) || "";
  const [data, setData] = useState<ReworkPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const [notes, setNotes] = useState("");
  const [photo, setPhoto] = useState("");
  const cameraRef = React.useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      const res = await fetch(`/api/rework/${encodeURIComponent(token)}`);
      const json = await res.json();
      if (res.ok && json?.success) {
        setData(json.data);
        if (json.data.job.status === "REWORK_COMPLETED") setDone(true);
      } else {
        setKind(json?.kind || "not_found");
        setError(json?.error || "This link is invalid or has expired.");
      }
    } catch {
      setError("Unable to load the rework task. Check your connection.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const act = async (body: Record<string, unknown>, okMsg: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/rework/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (res.ok && json?.success) {
        setToast(okMsg);
        if (body.action === "complete") setDone(true);
        await load();
      } else {
        setToast(json?.error || "Action failed.");
      }
    } catch {
      setToast("Network error — try again.");
    } finally {
      setBusy(false);
      setTimeout(() => setToast(null), 4000);
    }
  };

  const submitWithPhoto = async () => {
    let image: string | undefined;
    if (photo) {
      const prepared = await compressImageForUpload(photo);
      image = prepared.dataUrl;
    }
    await act({ action: "complete", notes, ...(image ? { image } : {}) }, "Rework submitted — QC notified for reinspection");
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

  const { job, tasks } = data;
  const openTasks = tasks.filter((t) => t.status !== "completed");
  const isStarted = ["REWORK_IN_PROGRESS", "REWORK_COMPLETED"].includes(job.status);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-40">
      <header className="bg-white border-b border-slate-200 py-3 px-4 sticky top-0 z-30 shadow-xs">
        <div className="max-w-lg mx-auto">
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Rework Task</div>
          <div className="text-sm font-semibold text-slate-900">
            {job.serviceName} · <span className="font-mono text-xs">{job.id}</span>
          </div>
        </div>
      </header>

      {toast && (
        <div className="max-w-lg mx-auto mt-2 px-4">
          <div className="p-3 rounded-xl bg-emerald-600 text-white text-xs font-semibold shadow">{toast}</div>
        </div>
      )}

      <main className="max-w-lg mx-auto p-4 space-y-4">
        <div className="bg-white rounded-2xl border border-red-200 p-4 space-y-1.5">
          <div className="text-xs font-bold text-red-800 flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4" /> QC found issues — only these areas need rework
          </div>
          <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" /> {job.propertyAddress}
          </p>
        </div>

        {/* Tasks */}
        <div className="space-y-2">
          {tasks.map((t, i) => (
            <div key={t.id} className={cn("bg-white rounded-2xl border p-4 space-y-1.5", t.status === "completed" ? "border-emerald-200" : "border-slate-200")}>
              <div className="flex items-center gap-2">
                <span className={cn("h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold", t.status === "completed" ? "bg-emerald-600 text-white" : "bg-red-100 text-red-700")}>
                  {t.status === "completed" ? "✓" : i + 1}
                </span>
                {t.area && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">{t.area}</span>}
                {t.severity && (
                  <span
                    className={cn(
                      "text-[9px] font-bold px-1.5 py-0.5 rounded",
                      t.severity === "critical" ? "bg-red-600 text-white" : t.severity === "major" ? "bg-amber-100 text-amber-800" : "bg-slate-200 text-slate-700"
                    )}
                  >
                    {t.severity.toUpperCase()}
                  </span>
                )}
              </div>
              <p className="text-xs font-medium text-slate-900">{t.instructions}</p>
              {t.status === "completed" && t.completedNotes && (
                <p className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg p-2">✓ {t.completedNotes}</p>
              )}
            </div>
          ))}
          {tasks.length === 0 && <p className="text-xs text-slate-400 text-center py-6">No rework tasks — you're all clear.</p>}
        </div>

        {/* Evidence + submit */}
        {!done && openTasks.length > 0 && (
          <div className="bg-white rounded-2xl border-2 border-slate-900 p-5 space-y-3">
            {!isStarted ? (
              <button
                onClick={() => act({ action: "start" }, "Rework started")}
                disabled={busy}
                className="w-full h-14 rounded-2xl bg-amber-500 text-amber-950 text-base font-bold shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />} START REWORK
              </button>
            ) : (
              <>
                <h3 className="text-sm font-bold text-slate-900">Upload evidence & submit</h3>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="What did you fix? e.g. Mirror degreased and polished…"
                  className="w-full p-3 rounded-xl border border-slate-200 text-xs focus:ring-1 focus:ring-rose-400"
                />
                <input type="file" accept="image/*" capture="environment" ref={cameraRef} onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = (ev) => setPhoto((ev.target?.result as string) || "");
                  reader.readAsDataURL(file);
                }} className="hidden" />
                {photo ? (
                  <div className="relative rounded-xl overflow-hidden border border-slate-200">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photo} alt="evidence" className="w-full h-36 object-cover" />
                    <button onClick={() => setPhoto("")} className="absolute top-2 right-2 h-8 px-2.5 rounded-lg bg-black/60 text-white text-[11px] font-bold">
                      Remove
                    </button>
                  </div>
                ) : (
                  <button onClick={() => cameraRef.current?.click()} className="w-full h-20 rounded-2xl border-2 border-dashed border-blue-300 bg-blue-50/60 flex items-center justify-center gap-2 text-sm font-bold text-blue-950">
                    <Camera className="h-5 w-5 text-blue-600" /> Add evidence photo (optional)
                  </button>
                )}
                <button
                  onClick={submitWithPhoto}
                  disabled={busy || notes.trim().length < 3}
                  className="w-full h-14 rounded-2xl bg-rose-500 text-white text-base font-bold shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />} SUBMIT REWORK
                </button>
              </>
            )}
          </div>
        )}

        {/* Done receipt (§30 idempotency) */}
        {(done || openTasks.length === 0) && tasks.length > 0 && (
          <div className="bg-white rounded-2xl border-2 border-emerald-200 p-5 text-center space-y-1.5">
            <CheckCircle2 className="h-10 w-10 text-emerald-600 mx-auto" />
            <h3 className="text-base font-bold text-slate-900">REWORK COMPLETED ✓</h3>
            <p className="text-xs text-slate-500">QC has been notified for reinspection. History is preserved.</p>
          </div>
        )}
      </main>
    </div>
  );
}
