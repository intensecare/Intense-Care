"use client";

import React, { useState } from "react";
import { ShieldCheck, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/states";
import { SelectField, textareaCls, useApiList, Pill } from "@/components/biz/Bits";
import { Field } from "@/components/ui/input";
import { useApp } from "@/lib/app-context";
import { START_MODES, START_MODE_INFO, effectiveStartMode, type StartMode, type StartVerificationSettings } from "@/lib/start-verification";
import type { Job } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

interface Attempt { id: string; at: string; user: string; role: string; mode: StartMode; result: "PASSED" | "FAILED" | "OVERRIDE"; failureReason: string | null; lat: number | null; lng: number | null; accuracy: number | null; distanceM: number | null; qrResult: string | null; overrideReason: string | null; statusBefore: string; statusAfter: string }

const QR_LABEL: Record<string, string> = { VALID: "QR valid", INVALID: "QR invalid", OTHER_JOB: "QR of another job", MISSING: "No QR scanned" };

async function patchJob(id: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/jobs/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  if (!res) return "You're offline. Try again when the connection returns.";
  const json = await res.json().catch(() => null);
  return res.ok && json?.success ? null : json?.error || "Couldn't save. Please try again.";
}

/** Job details (Admin): which start verification applies, change it for this job, override, and every attempt. */
export function StartVerificationCard({ job, canEdit }: { job: Job; canEdit: boolean }) {
  const { systemSettings, refreshJobs } = useApp();
  const sv: StartVerificationSettings = systemSettings.jobStartVerification;
  const mode = effectiveStartMode(job.startVerificationMode, sv);
  const custom = sv.allowPerJobOverride && !!job.startVerificationMode;
  const notStarted = ["SCHEDULED", "ASSIGNED"].includes(job.status);
  const log = useApiList<{ attempts: Attempt[] }>(() => `/api/jobs/${encodeURIComponent(job.id)}/start-verification`, [job.id, job.status]);

  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState<string>(job.startVerificationMode ?? "");
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (body: Record<string, unknown>, done: () => void) => {
    setBusy(true);
    setError(null);
    const err = await patchJob(job.id, body);
    setBusy(false);
    if (err) return setError(err);
    done();
    await refreshJobs();
    void log.reload();
  };

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm space-y-3" aria-labelledby="sv-h">
      <div className="flex items-center justify-between gap-2">
        <h2 id="sv-h" className="text-base font-semibold text-zinc-900 flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-rose-500" aria-hidden /> Job start verification</h2>
        {canEdit && notStarted && sv.allowPerJobOverride && (
          <Button size="sm" variant="ghost" onClick={() => { setDraft(job.startVerificationMode ?? ""); setError(null); setEdit(true); }}><Pencil className="h-4 w-4" aria-hidden /> Change</Button>
        )}
      </div>
      <p className="text-sm text-zinc-800"><span className="font-semibold">{START_MODE_INFO[mode].label}</span> {custom ? "(set for this job)" : "(company default)"}</p>
      <p className="text-sm text-zinc-600">{START_MODE_INFO[mode].needs}{mode === "GPS" || mode === "QR_GPS" ? ` Within ${sv.maxDistanceMeters} m, GPS accuracy ±${sv.maxAccuracyMeters} m or better.` : ""}</p>
      {canEdit && notStarted && (
        <Button size="sm" variant="outline" onClick={() => { setReason(""); setError(null); setOverride(true); }}>Start on the Field Manager&apos;s behalf…</Button>
      )}

      {(log.data?.attempts?.length ?? 0) > 0 && (
        <details className="rounded-xl border border-zinc-200">
          <summary className="cursor-pointer min-h-11 px-3 py-2.5 text-sm font-semibold text-zinc-800">Verification history ({log.data!.attempts.length})</summary>
          <ul className="divide-y divide-zinc-100">
            {log.data!.attempts.map((a) => (
              <li key={a.id} className="px-3 py-2.5 text-sm space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone={a.result === "PASSED" ? "good" : a.result === "OVERRIDE" ? "warn" : "bad"}>{a.result === "PASSED" ? "Passed" : a.result === "OVERRIDE" ? "Admin override" : "Failed"}</Pill>
                  <span className="text-zinc-800">{a.user}</span>
                  <span className="text-zinc-500">{formatDateTime(a.at)}</span>
                </div>
                <div className="text-xs text-zinc-600 break-words">
                  {START_MODE_INFO[a.mode]?.label ?? a.mode}
                  {a.distanceM !== null ? ` · ${a.distanceM} m away` : ""}
                  {a.accuracy !== null ? ` · ±${Math.round(a.accuracy)} m` : ""}
                  {a.lat !== null && a.lng !== null ? ` · ${a.lat.toFixed(5)}, ${a.lng.toFixed(5)}` : ""}
                  {a.qrResult && QR_LABEL[a.qrResult] ? ` · ${QR_LABEL[a.qrResult]}` : ""}
                  {` · ${a.statusBefore.toLowerCase()} → ${a.statusAfter.toLowerCase()}`}
                </div>
                {a.failureReason && <div className="text-xs text-red-700 break-words">{a.failureReason}</div>}
                {a.overrideReason && <div className="text-xs text-amber-800 break-words">Reason: {a.overrideReason}</div>}
              </li>
            ))}
          </ul>
        </details>
      )}

      <Dialog open={edit} onOpenChange={setEdit}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Start verification for this job</DialogTitle>
            <DialogDescription>The Field Manager sees what is required before they arrive.</DialogDescription>
          </DialogHeader>
          <SelectField label="Mode" id="sv-mode" value={draft} onChange={setDraft}>
            <option value="">Company default ({START_MODE_INFO[sv.defaultMode].label})</option>
            {START_MODES.map((m) => <option key={m} value={m}>{START_MODE_INFO[m].label}</option>)}
          </SelectField>
          {error && <Notice tone="error">{error}</Notice>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(false)}>Cancel</Button>
            <Button loading={busy} onClick={() => void run({ startVerificationMode: draft || null }, () => setEdit(false))}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={override} onOpenChange={setOverride}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Admin override</DialogTitle>
            <DialogDescription>Marks the team as arrived without the {START_MODE_INFO[mode].label} check. Your name, the time and the reason are saved on the job.</DialogDescription>
          </DialogHeader>
          <Field label="Reason" htmlFor="sv-reason" required hint="At least 5 characters — e.g. GPS not working in the basement, customer confirmed by phone.">
            <textarea id="sv-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className={textareaCls} maxLength={300} />
          </Field>
          {error && <Notice tone="error">{error}</Notice>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverride(false)}>Cancel</Button>
            <Button loading={busy} disabled={reason.trim().length < 5} onClick={() => void run({ status: "ARRIVED", arrival: { bypassReason: reason.trim() } }, () => setOverride(false))}>Override and start</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
