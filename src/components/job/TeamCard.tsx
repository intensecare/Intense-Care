"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Users, UserPlus, Crown, Phone, History, CheckCircle2, AlertTriangle, Pencil, LogIn, LogOut, UserX } from "lucide-react";
import { PromptModal } from "@/components/common/PromptModal";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Notice } from "@/components/ui/states";
import { Pill, SelectField, callApi, inr, textareaCls, useApiList } from "@/components/biz/Bits";
import { employmentLabel, type AssignmentRow } from "@/lib/business";
import { formatDateTime, toLocalDateString } from "@/lib/utils";

interface Conflict { kind: string; blocking: boolean; message: string; jobNumber?: string }
interface TeamData {
  job: { requiredSkills: string[]; expectedDurationHours: number | null; specialInstructions: string | null; confirmedAt: string | null; closed: boolean };
  assignments: (AssignmentRow & { conflicts: Conflict[] })[];
  history?: { id: string; action: string; employeeName: string | null; actor: string; detail: string | null; at: string }[];
  candidates?: { id: string; name: string; code: string; employmentType: string; skills: string[]; availabilityNotes: string | null; payType: string | null; payRate: number | null; free: boolean; conflicts: Conflict[]; missingSkills: string[] }[];
}
interface Attendance { records: { employeeId: string; status: string; checkIn: string | null; checkOut: string | null }[] }

const ACTION_TEXT: Record<string, string> = { ASSIGNED: "Assigned", REMOVED: "Removed", ROLE_CHANGED: "Role changed", ACCEPTED: "Accepted", DECLINED: "Declined", COMPLETED: "Completed", MANAGER_CHANGED: "Field Manager changed", TEAM_CONFIRMED: "Team confirmed", RESCHEDULED: "Rescheduled" };
const statusTone = (s: string) => (s === "COMPLETED" ? "good" : s === "DECLINED" || s === "REMOVED" ? "bad" : s === "ACCEPTED" ? "info" : "neutral");

/**
 * The cleaning team on a job. Admin: add people (with availability and conflict
 * checks), set the team leader, record accept / decline, remove, and confirm the
 * assignment so the team is notified. Field Manager: see the team and record today's attendance.
 */
export function TeamCard({ jobId, jobDate, mode, canEdit = false }: { jobId: string; jobDate: string; mode: "admin" | "field"; canEdit?: boolean }) {
  const { data, error, reload } = useApiList<TeamData>(() => `/api/jobs/${jobId}/team`, [jobId]);
  const attToday = mode === "field" && jobDate === toLocalDateString();
  const att = useApiList<Attendance>(() => `/api/hr/attendance?date=${jobDate}`, [jobId, jobDate, attToday]);
  const [adding, setAdding] = useState(false);
  const [details, setDetails] = useState(false);
  const [removing, setRemoving] = useState<AssignmentRow | null>(null);
  const [hours, setHours] = useState<AssignmentRow | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const post = async (body: Record<string, unknown>, ok: string) => {
    const r = await callApi(`/api/jobs/${jobId}/team`, { method: "POST", json: body });
    setNotice({ tone: r.error ? "error" : "success", text: r.error ?? ok });
    if (!r.error) void reload();
    return r;
  };
  const mark = async (employeeId: string, action: "check-in" | "check-out" | "mark", status?: string) => {
    const r = await callApi("/api/hr/attendance", { method: "POST", json: { employeeId, date: jobDate, action, status, jobId, verificationMethod: "MANUAL" } });
    setNotice({ tone: r.error ? "error" : "success", text: r.error ?? "Attendance recorded." });
    void att.reload();
  };

  if (error) return null; // a role without access simply doesn't see the card
  if (!data) return <section className="rounded-2xl border border-zinc-200 bg-white p-5 text-sm text-zinc-500">Loading team…</section>;
  const active = data.assignments.filter((a) => ["ASSIGNED", "ACCEPTED", "COMPLETED"].includes(a.status));
  const inactive = data.assignments.filter((a) => !active.includes(a));
  const attOf = (id: string) => att.data?.records.find((r) => r.employeeId === id);
  const editable = mode === "admin" && canEdit && !data.job.closed;

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6 shadow-sm space-y-4" aria-labelledby="team-h">
      <div className="flex items-center justify-between gap-2">
        <h2 id="team-h" className="text-base font-semibold text-zinc-900 flex items-center gap-2"><Users className="h-4 w-4 text-rose-500" aria-hidden /> Cleaning team</h2>
        {editable && (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setDetails(true)}><Pencil className="h-4 w-4" aria-hidden /> Requirements</Button>
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}><UserPlus className="h-4 w-4" aria-hidden /> Add</Button>
          </div>
        )}
      </div>
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      {(data.job.requiredSkills.length > 0 || data.job.expectedDurationHours || data.job.specialInstructions) && (
        <dl className="rounded-xl bg-zinc-50 px-4 py-3 text-sm space-y-1">
          {data.job.requiredSkills.length > 0 && <div className="flex justify-between gap-3"><dt className="text-zinc-500">Skills needed</dt><dd className="text-right">{data.job.requiredSkills.join(", ")}</dd></div>}
          {data.job.expectedDurationHours ? <div className="flex justify-between gap-3"><dt className="text-zinc-500">Expected duration</dt><dd>{data.job.expectedDurationHours} h</dd></div> : null}
          {data.job.specialInstructions && <div className="flex justify-between gap-3"><dt className="text-zinc-500 shrink-0">Instructions</dt><dd className="text-right break-words">{data.job.specialInstructions}</dd></div>}
        </dl>
      )}

      {active.length === 0 ? (
        <p className="text-sm text-zinc-500">{mode === "admin" ? "No cleaners assigned yet. Add the people who will work on this job." : "No cleaners are assigned to this job yet."}</p>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {active.map((a) => {
            const rec = attOf(a.employeeId);
            return (
              <li key={a.id} className="py-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {mode === "admin" ? <Link href={`/hr/${a.employeeId}`} className="text-sm font-semibold text-zinc-950 hover:underline">{a.employeeName}</Link> : <span className="text-sm font-semibold text-zinc-950">{a.employeeName}</span>}
                      {a.role === "LEAD" && <Pill tone="violet"><Crown className="h-3.5 w-3.5 mr-1" aria-hidden />Team leader</Pill>}
                      <Pill tone={statusTone(a.status)}>{a.status.charAt(0) + a.status.slice(1).toLowerCase()}</Pill>
                    </div>
                    <div className="text-xs text-zinc-500 mt-0.5">{a.employeeCode} · {employmentLabel(a.employmentType)}{a.rate != null ? ` · ${inr(a.rate)}${a.rateType === "HOURLY" ? "/h" : " fixed"}` : ""}{a.actualHours ? ` · ${a.actualHours} h` : ""}</div>
                    {a.phone && <a href={`tel:${a.phone}`} className="mt-1 inline-flex items-center gap-1 text-sm text-rose-600 font-medium min-h-9"><Phone className="h-4 w-4" aria-hidden /> {a.phone}</a>}
                  </div>
                </div>
                {a.conflicts.length > 0 && <p className="flex items-start gap-1.5 text-xs text-amber-800"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /> {a.conflicts.map((c) => c.message).join(" ")}</p>}
                {editable && (
                  <div className="flex flex-wrap gap-2">
                    {a.role !== "LEAD" && <Button size="sm" variant="outline" onClick={() => void post({ action: "set-lead", employeeId: a.employeeId }, "Team leader updated.")}><Crown className="h-4 w-4" aria-hidden /> Make leader</Button>}
                    {a.employmentType === "FREELANCE" && a.status === "ASSIGNED" && <><Button size="sm" variant="outline" onClick={() => void post({ action: "respond", employeeId: a.employeeId, response: "ACCEPTED" }, "Marked as accepted.")}>Accepted</Button><Button size="sm" variant="ghost" onClick={() => void post({ action: "respond", employeeId: a.employeeId, response: "DECLINED" }, "Marked as declined.")}>Declined</Button></>}
                    {a.status !== "COMPLETED" && <Button size="sm" variant="outline" onClick={() => (a.rateType === "HOURLY" ? setHours(a) : void post({ action: "complete", employeeId: a.employeeId }, "Marked as completed."))}>Mark completed</Button>}
                    <Button size="sm" variant="ghost" onClick={() => setRemoving(a)}>Remove</Button>
                  </div>
                )}
                {attToday && (
                  <div className="flex flex-wrap items-center gap-2">
                    {rec ? <Pill tone={rec.status === "PRESENT" ? "good" : rec.status === "ABSENT" ? "bad" : "neutral"}>{rec.status === "PRESENT" ? `In ${rec.checkIn ? new Date(rec.checkIn).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : ""}${rec.checkOut ? ` · out ${new Date(rec.checkOut).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}` : ""}` : rec.status.replace("_", " ").toLowerCase()}</Pill> : <span className="text-xs text-zinc-500">Attendance not recorded</span>}
                    {!rec && <><Button size="sm" variant="outline" onClick={() => void mark(a.employeeId, "check-in")}><LogIn className="h-4 w-4" aria-hidden /> Check in</Button><Button size="sm" variant="ghost" onClick={() => void mark(a.employeeId, "mark", "ABSENT")}><UserX className="h-4 w-4" aria-hidden /> Absent</Button></>}
                    {rec && rec.checkIn && !rec.checkOut && <Button size="sm" variant="outline" onClick={() => void mark(a.employeeId, "check-out")}><LogOut className="h-4 w-4" aria-hidden /> Check out</Button>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {inactive.length > 0 && mode === "admin" && <p className="text-xs text-zinc-500">Not on the job: {inactive.map((a) => `${a.employeeName} (${a.status.toLowerCase()})`).join(", ")}</p>}

      {mode === "admin" && (
        <div className="rounded-xl border border-zinc-200 p-3 space-y-2">
          {data.job.confirmedAt ? <p className="flex items-center gap-2 text-sm text-emerald-800"><CheckCircle2 className="h-4 w-4" aria-hidden /> Team confirmed {formatDateTime(data.job.confirmedAt)}. Changes are sent to the people affected.</p> : <p className="text-sm text-zinc-600">Not confirmed yet. Confirming tells the Field Manager and the cleaners about the job.</p>}
          {editable && <Button variant={data.job.confirmedAt ? "outline" : "default"} size="sm" onClick={async () => { const r = await post({ action: "confirm" }, ""); if (!r.error) setNotice({ tone: "success", text: "Team confirmed." }); }}>{data.job.confirmedAt ? "Send the team details again" : "Confirm team & notify"}</Button>}
        </div>
      )}

      {mode === "admin" && data.history && data.history.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowHistory((s) => !s)} className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-700 min-h-10"><History className="h-4 w-4" aria-hidden /> Assignment history ({data.history.length})</button>
          {showHistory && (
            <ul className="mt-2 space-y-1.5 text-sm">
              {data.history.map((h) => <li key={h.id} className="flex flex-wrap justify-between gap-x-3 text-zinc-700"><span className="min-w-0 break-words"><span className="font-medium">{ACTION_TEXT[h.action] ?? h.action}</span>{h.employeeName ? ` — ${h.employeeName}` : ""}{h.detail ? <span className="text-zinc-500"> · {h.detail}</span> : null}</span><span className="text-xs text-zinc-500 shrink-0">{h.actor} · {formatDateTime(h.at)}</span></li>)}
            </ul>
          )}
        </div>
      )}

      {adding && <AddDialog jobId={jobId} onClose={() => setAdding(false)} onDone={(t) => { setAdding(false); setNotice({ tone: "success", text: t }); void reload(); }} />}
      {details && <DetailsDialog data={data.job} onClose={() => setDetails(false)} onSave={async (b) => { const r = await post({ action: "details", ...b }, "Requirements saved."); if (!r.error) setDetails(false); }} />}
      <PromptModal isOpen={!!removing} onClose={() => setRemoving(null)} title={`Remove ${removing?.employeeName ?? ""}?`} description="They are taken off this job and told if the team was already confirmed. Say why." placeholder="Reason" confirmText="Remove" onSubmit={(t) => { if (t.length < 3 || !removing) return; const a = removing; setRemoving(null); void post({ action: "remove", employeeId: a.employeeId, reason: t }, "Removed from the job."); }} />
      {hours && <HoursPrompt row={hours} onClose={() => setHours(null)} onDone={async (h) => { const r = await post({ action: "complete", employeeId: hours.employeeId, actualHours: h }, "Marked as completed."); if (!r.error) setHours(null); }} />}
    </section>
  );
}

function HoursPrompt({ row, onClose, onDone }: { row: AssignmentRow; onClose: () => void; onDone: (h: number) => Promise<void> }) {
  const [h, setH] = useState(row.actualHours ? String(row.actualHours) : row.expectedHours ? String(row.expectedHours) : "");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Hours worked</DialogTitle><DialogDescription>{row.employeeName} is paid per hour. Enter the hours actually worked.</DialogDescription></DialogHeader>
        <Field label="Hours" htmlFor="th" required><Input id="th" inputMode="decimal" value={h} onChange={(e) => setH(e.target.value)} /></Field>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={async () => { const n = Number(h); if (!(n > 0)) return; setBusy(true); await onDone(n); setBusy(false); }}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailsDialog({ data, onClose, onSave }: { data: TeamData["job"]; onClose: () => void; onSave: (b: { requiredSkills: string[]; expectedDurationHours: number | null; specialInstructions: string | null }) => Promise<void> }) {
  const [skills, setSkills] = useState(data.requiredSkills.join(", "));
  const [dur, setDur] = useState(data.expectedDurationHours ? String(data.expectedDurationHours) : "");
  const [ins, setIns] = useState(data.specialInstructions ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Team requirements</DialogTitle><DialogDescription>Used to flag people who lack a needed skill, and shown to the team.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <Field label="Skills needed" htmlFor="td-sk" hint="Separate with commas"><Input id="td-sk" value={skills} onChange={(e) => setSkills(e.target.value)} /></Field>
          <Field label="Expected duration (hours)" htmlFor="td-d"><Input id="td-d" inputMode="decimal" value={dur} onChange={(e) => setDur(e.target.value)} /></Field>
          <Field label="Special instructions for the team" htmlFor="td-i"><textarea id="td-i" rows={3} value={ins} onChange={(e) => setIns(e.target.value)} className={textareaCls} maxLength={1000} /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={async () => { setBusy(true); await onSave({ requiredSkills: Array.from(new Set(skills.split(",").map((s) => s.trim()).filter(Boolean))), expectedDurationHours: dur === "" ? null : Number(dur), specialInstructions: ins || null }); setBusy(false); }}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddDialog({ jobId, onClose, onDone }: { jobId: string; onClose: () => void; onDone: (t: string) => void }) {
  const { data, error } = useApiList<TeamData>(() => `/api/jobs/${jobId}/team?candidates=1`, [jobId]);
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<NonNullable<TeamData["candidates"]>[number] | null>(null);
  const [role, setRole] = useState("MEMBER");
  const [rateType, setRateType] = useState("HOURLY");
  const [rate, setRate] = useState("");
  const [hrs, setHrs] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ text: string; needsConfirmation?: boolean } | null>(null);
  const list = (data?.candidates ?? []).filter((c) => !q.trim() || `${c.name} ${c.code} ${c.skills.join(" ")}`.toLowerCase().includes(q.trim().toLowerCase())).sort((a, b) => Number(b.free) - Number(a.free) || a.missingSkills.length - b.missingSkills.length);
  const choose = (c: NonNullable<TeamData["candidates"]>[number]) => { setPick(c); setProblem(null); setAck(false); if (c.employmentType === "FREELANCE") { setRateType(c.payType === "PER_JOB" ? "FIXED" : "HOURLY"); setRate(c.payRate != null ? String(c.payRate) : ""); } };
  const save = async () => {
    if (!pick) return;
    setBusy(true);
    setProblem(null);
    const free = pick.employmentType === "FREELANCE";
    const r = await callApi(`/api/jobs/${jobId}/team`, { method: "POST", json: { action: "add", employeeId: pick.id, role, acknowledgeConflict: ack, ...(free ? { rateType, rate: Number(rate) } : {}), ...(hrs ? { expectedHours: Number(hrs) } : {}) } });
    setBusy(false);
    if (r.error) return setProblem({ text: r.error, needsConfirmation: !!(r.extra as { needsConfirmation?: boolean } | undefined)?.needsConfirmation });
    onDone(`${pick.name} added to the job.`);
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Add to the team</DialogTitle><DialogDescription>People who are free at this time come first. Anyone with a clash or missing skill is flagged.</DialogDescription></DialogHeader>
        {!pick ? (
          <div className="space-y-3">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, ID or skill" aria-label="Search staff" />
            {error ? <Notice tone="error">{error}</Notice> : !data ? <p className="text-sm text-zinc-500">Checking availability…</p> : list.length === 0 ? <p className="text-sm text-zinc-500">No one else is available to add. Add staff under HR.</p> : (
              <ul className="space-y-2 max-h-[50vh] overflow-y-auto">
                {list.map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => choose(c)} className="w-full text-left rounded-xl border border-zinc-200 p-3 hover:bg-zinc-50 min-h-14">
                      <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-zinc-950">{c.name}</span><Pill tone={c.free ? "good" : c.conflicts.some((x) => x.blocking) ? "bad" : "warn"}>{c.free ? "Free" : c.conflicts.some((x) => x.blocking) ? "Unavailable" : "Check"}</Pill></div>
                      <div className="text-xs text-zinc-500">{c.code} · {employmentLabel(c.employmentType)}{c.skills.length ? ` · ${c.skills.slice(0, 4).join(", ")}` : ""}</div>
                      {c.conflicts.length > 0 && <div className="mt-1 text-xs text-amber-800">{c.conflicts.map((x) => x.message).join(" ")}</div>}
                      {c.missingSkills.length > 0 && <div className="mt-1 text-xs text-amber-800">Missing skills: {c.missingSkills.join(", ")}</div>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm"><span className="font-semibold">{pick.name}</span> <span className="text-zinc-500">({pick.code})</span> <button type="button" className="text-rose-600 font-medium ml-2" onClick={() => setPick(null)}>Change</button></p>
            {pick.conflicts.length > 0 && <Notice tone="info">{pick.conflicts.map((c) => c.message).join(" ")}</Notice>}
            <SelectField label="Role on this job" id="ad-role" value={role} onChange={setRole}><option value="MEMBER">Cleaner</option><option value="LEAD">Team leader</option></SelectField>
            {pick.employmentType === "FREELANCE" && (
              <div className="grid grid-cols-2 gap-4">
                <SelectField label="Agreed payment" id="ad-rt" value={rateType} onChange={setRateType}><option value="HOURLY">Per hour</option><option value="FIXED">Fixed for the job</option></SelectField>
                <Field label={rateType === "HOURLY" ? "Rate per hour (₹)" : "Amount for the job (₹)"} htmlFor="ad-rate" required><Input id="ad-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
              </div>
            )}
            <Field label="Expected hours" htmlFor="ad-h"><Input id="ad-h" inputMode="decimal" value={hrs} onChange={(e) => setHrs(e.target.value)} /></Field>
            {problem?.needsConfirmation && <label className="flex items-start gap-3 text-sm font-medium text-zinc-800"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="h-5 w-5 mt-0.5 accent-rose-500" /> I know about this and still want to assign them.</label>}
            {problem && <Notice tone="error">{problem.text}</Notice>}
          </div>
        )}
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button>{pick && <Button loading={busy} disabled={problem?.needsConfirmation ? !ack : false} onClick={() => void save()}>Add to team</Button>}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
