"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2, ShieldCheck, MapPin, Users, AlertTriangle, CheckCircle2, Star, Calendar, Sparkles, MessageSquareWarning, ExternalLink, Clock, ChevronDown, Images, FileText, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * /customer/service/[token] — "My Service": the customer's ONE secure link
 * for the whole job (no app, no login). The page changes with the job:
 *
 *   SCHEDULED       → [VIEW SERVICE]
 *   ARRIVED         → YOUR TEAM HAS ARRIVED ✓ → [CONFIRM & START]
 *   IN PROGRESS     → progress bar → [VIEW PROGRESS]
 *   WORK COMPLETED  → Quality check pending
 *   QC PASSED       → [VIEW BEFORE / AFTER] → [APPROVE SERVICE]
 *   COMPLETED       → [VIEW REPORT] · rating · [LEAVE GOOGLE REVIEW]
 *
 * The server authorizes every read and action by the token; nothing internal
 * (notes, amounts, QC findings, other customers) is ever returned.
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
  checklist: { id: string; area: string; task: string; completed: boolean }[];
  photos: { id: string; area: string; photoType: string; url: string; uploadedAt: string }[];
  qualityCheck: { passed: boolean } | null;
  approval: { approvedAt: string; approvedBy: string; method: string } | null;
  feedback: { rating: number; feedbackAt: string | null; googleReviewClicked: boolean } | null;
  complaintCount: number;
  company: { name: string; googleReviewUrl: string };
}

type Stage = "scheduled" | "arrived" | "in_progress" | "qc_pending" | "approve" | "completed" | "cancelled";

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
      return "qc_pending"; // work completed, QC, rework, reinspection
  }
}

const JOURNEY = ["Booked", "Arrived", "Cleaning", "Quality check", "Approved"];
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
  const [panel, setPanel] = useState<"details" | "progress" | "photos" | "report" | null>(null);
  const [showComplaint, setShowComplaint] = useState(false);
  const [complaintCategory, setComplaintCategory] = useState("missed_area");
  const [complaintText, setComplaintText] = useState("");
  const [complaintSent, setComplaintSent] = useState(false);
  const [rating, setRating] = useState(0);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/customer/job/${encodeURIComponent(token)}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) {
        setData(json.data);
        setError(null);
        if (json.data.feedback?.rating) setRating(json.data.feedback.rating);
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

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/customer/job/${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
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
      setPanel(null);
      await load();
      return true;
    }
    setActionError(json?.error || "That didn't go through. Please try again.");
    return false;
  };

  if (loading) {
    return (
      <Shell>
        <div className="py-24 text-center space-y-3">
          <Loader2 className="h-9 w-9 animate-spin text-rose-500 mx-auto" />
          <p className="text-sm text-slate-500">Opening your service…</p>
        </div>
      </Shell>
    );
  }

  if (error || !data) {
    return (
      <Shell>
        <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-200 text-center space-y-3 mt-8">
          <div className={cn("h-14 w-14 rounded-full flex items-center justify-center mx-auto", kind === "revoked" ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600")}>
            <AlertTriangle className="h-7 w-7" />
          </div>
          <h1 className="text-xl font-semibold text-slate-900">{kind === "revoked" ? "This link is no longer active" : "Link unavailable"}</h1>
          <p className="text-sm text-slate-600">{error}</p>
          <p className="text-xs text-slate-400">Please contact us for a new link.</p>
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
  const when = `${formatDay(job.scheduledDate)} · ${job.scheduledTimeSlot}`;

  /* ----------------------------------------------- the ONE primary action */
  const primary = (() => {
    switch (stage) {
      case "scheduled":
        return <Cta onClick={() => setPanel(panel === "details" ? null : "details")} icon={<FileText className="h-5 w-5" />}>VIEW SERVICE</Cta>;
      case "arrived":
        return <Cta busy={busy} onClick={() => void act({ action: "confirm" }, "Thank you — your service is starting.")} icon={<CheckCircle2 className="h-5 w-5" />}>CONFIRM &amp; START</Cta>;
      case "in_progress":
        return <Cta tone="neutral" onClick={() => setPanel(panel === "progress" ? null : "progress")} icon={<ChevronDown className="h-5 w-5" />}>VIEW PROGRESS</Cta>;
      case "approve":
        return <Cta tone="success" busy={busy} onClick={() => void act({ action: "approve", signatoryName: data.customer.name || "Customer", confirmChecked: true }, "Service approved ✓ Thank you!")} icon={<CheckCircle2 className="h-5 w-5" />}>APPROVE SERVICE</Cta>;
      case "completed":
        return <Cta tone="neutral" onClick={() => setPanel(panel === "report" ? null : "report")} icon={<FileText className="h-5 w-5" />}>VIEW REPORT</Cta>;
      default:
        return null;
    }
  })();

  return (
    <Shell jobId={job.id} action={primary}>
      {success && (
        <div className="rounded-2xl bg-emerald-600 text-white text-sm font-semibold px-4 py-3 flex items-center gap-2 shadow-sm animate-in fade-in slide-in-from-top-2">
          <CheckCircle2 className="h-5 w-5 shrink-0" /> {success}
        </div>
      )}

      {/* Journey */}
      {stage !== "cancelled" && (
        <ol className="flex items-start gap-1" aria-label="Service journey">
          {JOURNEY.map((label, i) => {
            const at = JOURNEY_INDEX[stage];
            const done = i < at || (stage === "completed" && i === at);
            return (
              <li key={label} className="flex-1">
                <div className={cn("h-1.5 rounded-full transition-colors duration-500", done ? "bg-emerald-500" : i === at ? "bg-rose-500" : "bg-slate-200")} />
                <div className={cn("mt-1.5 text-[11px] font-semibold text-center leading-tight", i === at ? "text-slate-900" : "text-slate-400")}>{label}</div>
              </li>
            );
          })}
        </ol>
      )}

      {/* WHERE AM I / WHAT HAPPENED / WHAT HAPPENS NEXT */}
      <section className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm text-center space-y-3 animate-in fade-in">
        {stage === "scheduled" && (
          <>
            <Badge icon={<Calendar className="h-7 w-7" />} tone="rose" />
            <h1 className="text-2xl font-semibold text-slate-900">Your service is booked</h1>
            <p className="text-base text-slate-600">{job.serviceName}</p>
            <p className="text-sm text-slate-500">{when}</p>
            <p className="text-xs text-slate-400">We&apos;ll update this page when your team arrives.</p>
          </>
        )}
        {stage === "arrived" && (
          <>
            <Badge icon={<CheckCircle2 className="h-7 w-7" />} tone="green" />
            <h1 className="text-2xl font-semibold text-slate-900">YOUR TEAM HAS ARRIVED ✓</h1>
            <p className="text-sm text-slate-600">{team.length ? `${team.join(", ")} ${team.length === 1 ? "is" : "are"} at ${property.title}.` : `Your team is at ${property.title}.`}</p>
            <p className="text-sm text-slate-500">Tap <strong>Confirm &amp; Start</strong> to let them begin.</p>
          </>
        )}
        {stage === "in_progress" && (
          <>
            <h1 className="text-2xl font-semibold text-slate-900">Cleaning in progress</h1>
            <div className="text-5xl font-semibold text-rose-500 tabular-nums">{pct}%</div>
            <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full rounded-full bg-rose-500 transition-all duration-700" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-sm text-slate-500">{doneCount} of {checklist.length} tasks done · updates live</p>
          </>
        )}
        {stage === "qc_pending" && (
          <>
            <Badge icon={<Clock className="h-7 w-7" />} tone="amber" />
            <h1 className="text-2xl font-semibold text-slate-900">Work completed</h1>
            <p className="text-base text-slate-600">Quality check pending</p>
            <p className="text-sm text-slate-500">Our quality team is checking every area. You&apos;ll be asked to approve right here.</p>
          </>
        )}
        {stage === "approve" && (
          <>
            <Badge icon={<ShieldCheck className="h-7 w-7" />} tone="green" />
            <h1 className="text-2xl font-semibold text-slate-900">Quality check passed ✓</h1>
            <p className="text-sm text-slate-600">Have a look at the before and after photos, then approve your service.</p>
            {data.photos.length > 0 && (
              <button onClick={() => setPanel(panel === "photos" ? null : "photos")} className="h-12 w-full rounded-2xl border border-slate-300 bg-white text-sm font-semibold text-slate-800 inline-flex items-center justify-center gap-2">
                <Images className="h-5 w-5" /> VIEW BEFORE / AFTER
              </button>
            )}
          </>
        )}
        {stage === "completed" && (
          <>
            <Badge icon={<CheckCircle2 className="h-7 w-7" />} tone="green" />
            <h1 className="text-2xl font-semibold text-slate-900">Service completed ✓</h1>
            <p className="text-sm text-slate-600">{rating ? `Thank you for rating us ${rating}/5.` : "How did we do?"}</p>
            <div className="flex items-center justify-center gap-1.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} onClick={() => { setRating(n); void act({ action: "feedback", rating: n, googleReviewClicked: !!data.feedback?.googleReviewClicked }, "Thanks for your rating!"); }} className="p-1 active:scale-90 transition-transform" aria-label={`Rate ${n} star${n === 1 ? "" : "s"}`}>
                  <Star className={cn("h-10 w-10 transition-colors", n <= rating ? "text-amber-400 fill-amber-400" : "text-slate-300")} />
                </button>
              ))}
            </div>
            {company.googleReviewUrl && (
              <a
                href={company.googleReviewUrl}
                target="_blank"
                rel="noreferrer"
                onClick={() => void post({ action: "feedback", rating: rating || 5, googleReviewClicked: true })}
                className="h-12 w-full rounded-2xl bg-slate-900 text-white text-sm font-semibold inline-flex items-center justify-center gap-2"
              >
                <ExternalLink className="h-4 w-4" /> LEAVE GOOGLE REVIEW
              </a>
            )}
          </>
        )}
        {stage === "cancelled" && (
          <>
            <Badge icon={<XCircle className="h-7 w-7" />} tone="amber" />
            <h1 className="text-2xl font-semibold text-slate-900">This service was cancelled</h1>
            <p className="text-sm text-slate-500">Please contact us if you'd like to book again.</p>
          </>
        )}
        {actionError && <p className="text-sm text-red-600 font-medium">{actionError}</p>}
      </section>

      {/* Panels opened by the primary/secondary actions */}
      {panel === "details" && (
        <Panel title="Your service">
          <Detail icon={<Sparkles className="h-4 w-4" />} label="Service" value={job.serviceName} />
          <Detail icon={<Calendar className="h-4 w-4" />} label="When" value={when} />
          <Detail icon={<MapPin className="h-4 w-4" />} label="Where" value={`${property.title}${property.address ? ` — ${property.address}` : ""}`} />
          <Detail icon={<Users className="h-4 w-4" />} label="Team" value={team.length ? team.join(", ") : "Being assigned"} />
        </Panel>
      )}

      {(panel === "progress" || panel === "report") && (
        <Panel title={panel === "report" ? "Service report" : "Progress"}>
          {panel === "report" && (
            <div className="space-y-2 pb-2">
              <Detail icon={<Sparkles className="h-4 w-4" />} label="Service" value={job.serviceName} />
              <Detail icon={<Calendar className="h-4 w-4" />} label="Date" value={when} />
              <Detail icon={<Users className="h-4 w-4" />} label="Team" value={team.join(", ") || "—"} />
              {data.approval && <Detail icon={<CheckCircle2 className="h-4 w-4" />} label="Approved" value={new Date(data.approval.approvedAt).toLocaleString()} />}
            </div>
          )}
          {areas.map((area) => {
            const items = checklist.filter((c) => c.area === area);
            if (items.length === 0) return null;
            return (
              <div key={area} className="py-2">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{area}</div>
                {items.map((item) => (
                  <div key={item.id} className="py-1 flex items-center gap-2 text-sm">
                    <CheckCircle2 className={cn("h-4 w-4 shrink-0", item.completed ? "text-emerald-600" : "text-slate-300")} />
                    <span className={item.completed ? "text-slate-800" : "text-slate-400"}>{item.task}</span>
                  </div>
                ))}
              </div>
            );
          })}
          {panel === "report" && <BeforeAfter photos={data.photos} areas={areas} />}
        </Panel>
      )}

      {panel === "photos" && (
        <Panel title="Before / After">
          <BeforeAfter photos={data.photos} areas={areas} />
        </Panel>
      )}

      {complaintSent && (
        <div className="p-4 rounded-2xl border border-amber-200 bg-amber-50 text-amber-900 text-sm">
          Thanks — your message reached our team. We&apos;ll contact you shortly and update this page.
        </div>
      )}

      {/* Secondary: something not right? */}
      {stage !== "cancelled" && stage !== "scheduled" && !data.approval && (
        <button onClick={() => setShowComplaint(true)} className="w-full text-center text-sm text-slate-500 underline underline-offset-4 py-2">
          Something not right? Tell us
        </button>
      )}

      {showComplaint && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl max-w-lg w-full p-6 space-y-4 animate-in slide-in-from-bottom-4">
            <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <MessageSquareWarning className="h-5 w-5 text-amber-600" /> Tell us what&apos;s wrong
            </h2>
            <select value={complaintCategory} onChange={(e) => setComplaintCategory(e.target.value)} className="w-full h-12 rounded-xl border border-slate-200 px-3 text-base bg-white">
              <option value="missed_area">An area wasn&apos;t cleaned</option>
              <option value="quality">Quality issue</option>
              <option value="damage">Something was damaged</option>
              <option value="staff_behavior">Team conduct</option>
            </select>
            <textarea value={complaintText} onChange={(e) => setComplaintText(e.target.value)} rows={4} placeholder="Tell us what went wrong…" className="w-full p-3 rounded-xl border border-slate-200 text-base" />
            <div className="flex gap-2">
              <button onClick={() => setShowComplaint(false)} className="flex-1 h-12 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700">Cancel</button>
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
                className="flex-1 h-12 rounded-xl bg-rose-500 text-white text-sm font-semibold disabled:opacity-50"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}

function formatDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

function Shell({ jobId, action, children }: { jobId?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-32">
      <header className="bg-white/95 backdrop-blur border-b border-slate-200 py-3 px-4 sticky top-0 z-30">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-rose-500 text-white flex items-center justify-center">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <div className="text-base font-semibold text-slate-900 leading-tight">My Service</div>
              <div className="text-[11px] text-slate-500 flex items-center gap-1">
                <ShieldCheck className="h-3 w-3 text-emerald-600" /> Secure link
              </div>
            </div>
          </div>
          {jobId && <span className="font-mono text-xs font-semibold px-2 py-1 rounded-lg bg-slate-100 text-slate-700">{jobId}</span>}
        </div>
      </header>
      <main className="max-w-lg mx-auto p-4 space-y-4">{children}</main>
      {action && (
        <div className="fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-slate-200 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="max-w-lg mx-auto">{action}</div>
        </div>
      )}
    </div>
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
        tone === "neutral" && "bg-slate-900 hover:bg-slate-800 text-white"
      )}
    >
      {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : icon}
      {children}
    </button>
  );
}

function Badge({ icon, tone }: { icon: React.ReactNode; tone: "green" | "amber" | "rose" }) {
  return (
    <div className={cn("h-14 w-14 rounded-2xl flex items-center justify-center mx-auto", tone === "green" ? "bg-emerald-50 text-emerald-600" : tone === "amber" ? "bg-amber-50 text-amber-600" : "bg-rose-50 text-rose-500")}>
      {icon}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-3xl border border-slate-200 p-5 shadow-sm animate-in fade-in slide-in-from-bottom-2">
      <h2 className="text-base font-semibold text-slate-900 mb-2">{title}</h2>
      <div className="divide-y divide-slate-100">{children}</div>
    </section>
  );
}

function Detail({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="py-2.5 flex items-start gap-3">
      <span className="h-8 w-8 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">{icon}</span>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{label}</div>
        <div className="text-sm text-slate-900">{value}</div>
      </div>
    </div>
  );
}

function BeforeAfter({ photos, areas }: { photos: CustomerPayload["photos"]; areas: string[] }) {
  const withPhotos = areas.filter((a) => photos.some((p) => p.area === a));
  if (withPhotos.length === 0) return <div className="py-4 text-sm text-slate-500 text-center">No photos yet.</div>;
  return (
    <div className="space-y-4 pt-2">
      {withPhotos.map((a) => {
        const b = photos.find((p) => p.area === a && p.photoType === "before");
        const af = photos.find((p) => p.area === a && p.photoType === "after");
        return (
          <div key={a} className="pt-2">
            <div className="text-sm font-semibold text-slate-900 mb-1.5">{a}</div>
            <div className="grid grid-cols-2 gap-2">
              {[{ label: "BEFORE", p: b }, { label: "AFTER", p: af }].map(({ label, p }) => (
                <div key={label} className="relative aspect-[4/3] rounded-xl overflow-hidden bg-slate-100">
                  {p ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={p.url} alt={`${a} ${label.toLowerCase()}`} className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center text-xs text-slate-400">—</div>
                  )}
                  <span className={cn("absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md text-[10px] font-bold text-white", label === "BEFORE" ? "bg-slate-900/80" : "bg-emerald-600")}>{label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
